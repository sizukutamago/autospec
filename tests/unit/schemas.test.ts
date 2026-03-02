import { describe, expect, it } from "vitest";
import {
  FindingSchema,
  ReviewOutputSchema,
  parseReviewOutput,
} from "../../src/gates/schemas.js";
import { StructuredOutputError } from "../../src/errors.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validFinding() {
  return {
    severity: "P0" as const,
    target: "src/api/handler.ts",
    field: "error_handling",
    message: "Unhandled promise rejection in request handler",
  };
}

function validFindingWithOptionals() {
  return {
    severity: "P1" as const,
    target: "src/api/handler.ts",
    field: "error_handling",
    impl_file: "src/api/handler.impl.ts",
    message: "Missing error boundary",
    suggestion: "Wrap with try-catch",
    disposition: "wont_fix" as const,
    disposition_reason: "Accepted risk for MVP",
    deferred_to: null,
    original_severity: "P0",
  };
}

function validReviewOutput() {
  return {
    reviewer: "contract-reviewer",
    gate: "contract" as const,
    findings: [validFinding()],
    summary: { p0: 1, p1: 0, p2: 0 },
  };
}

// ---------------------------------------------------------------------------
// FindingSchema
// ---------------------------------------------------------------------------

describe("FindingSchema", () => {
  it("validates a correct finding with only required fields", () => {
    const result = FindingSchema.safeParse(validFinding());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validFinding());
    }
  });

  it("rejects an invalid severity value", () => {
    const bad = { ...validFinding(), severity: "P3" };
    const result = FindingSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field (message)", () => {
    const { message: _, ...incomplete } = validFinding();
    const result = FindingSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field (target)", () => {
    const { target: _, ...incomplete } = validFinding();
    const result = FindingSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field (field)", () => {
    const { field: _, ...incomplete } = validFinding();
    const result = FindingSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  it("allows optional fields to be omitted", () => {
    // validFinding() has no optional fields — should still pass
    const result = FindingSchema.safeParse(validFinding());
    expect(result.success).toBe(true);
  });

  it("allows optional fields when provided", () => {
    const result = FindingSchema.safeParse(validFindingWithOptionals());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.impl_file).toBe("src/api/handler.impl.ts");
      expect(result.data.suggestion).toBe("Wrap with try-catch");
      expect(result.data.disposition).toBe("wont_fix");
      expect(result.data.disposition_reason).toBe("Accepted risk for MVP");
      expect(result.data.deferred_to).toBeNull();
      expect(result.data.original_severity).toBe("P0");
    }
  });

  it("allows disposition to be null", () => {
    const finding = { ...validFinding(), disposition: null };
    const result = FindingSchema.safeParse(finding);
    expect(result.success).toBe(true);
  });

  it("rejects invalid disposition value", () => {
    const finding = { ...validFinding(), disposition: "invalid_value" };
    const result = FindingSchema.safeParse(finding);
    expect(result.success).toBe(false);
  });

  it("accepts all valid severity levels", () => {
    for (const severity of ["P0", "P1", "P2"] as const) {
      const finding = { ...validFinding(), severity };
      const result = FindingSchema.safeParse(finding);
      expect(result.success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// ReviewOutputSchema
// ---------------------------------------------------------------------------

describe("ReviewOutputSchema", () => {
  it("validates a complete review output", () => {
    const result = ReviewOutputSchema.safeParse(validReviewOutput());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reviewer).toBe("contract-reviewer");
      expect(result.data.gate).toBe("contract");
      expect(result.data.findings).toHaveLength(1);
      expect(result.data.summary).toEqual({ p0: 1, p1: 0, p2: 0 });
    }
  });

  it("validates review output with empty findings array", () => {
    const output = { ...validReviewOutput(), findings: [] };
    const result = ReviewOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
  });

  it("accepts all valid gate values", () => {
    for (const gate of ["contract", "test", "code", "doc"] as const) {
      const output = { ...validReviewOutput(), gate };
      const result = ReviewOutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    }
  });

  it("rejects an invalid gate value", () => {
    const output = { ...validReviewOutput(), gate: "security" };
    const result = ReviewOutputSchema.safeParse(output);
    expect(result.success).toBe(false);
  });

  it("rejects missing reviewer field", () => {
    const { reviewer: _, ...incomplete } = validReviewOutput();
    const result = ReviewOutputSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  it("rejects missing gate field", () => {
    const { gate: _, ...incomplete } = validReviewOutput();
    const result = ReviewOutputSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  it("rejects missing findings field", () => {
    const { findings: _, ...incomplete } = validReviewOutput();
    const result = ReviewOutputSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  it("rejects missing summary field", () => {
    const { summary: _, ...incomplete } = validReviewOutput();
    const result = ReviewOutputSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  it("rejects summary with missing count field", () => {
    const output = {
      ...validReviewOutput(),
      summary: { p0: 1, p1: 0 }, // missing p2
    };
    const result = ReviewOutputSchema.safeParse(output);
    expect(result.success).toBe(false);
  });

  it("rejects summary with non-number count", () => {
    const output = {
      ...validReviewOutput(),
      summary: { p0: "one", p1: 0, p2: 0 },
    };
    const result = ReviewOutputSchema.safeParse(output);
    expect(result.success).toBe(false);
  });

  it("rejects when findings contain an invalid finding", () => {
    const output = {
      ...validReviewOutput(),
      findings: [{ severity: "P9", target: "x", field: "y", message: "z" }],
    };
    const result = ReviewOutputSchema.safeParse(output);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseReviewOutput
// ---------------------------------------------------------------------------

describe("parseReviewOutput", () => {
  it("returns a valid ReviewOutput when given correct data", () => {
    const raw = validReviewOutput();
    const result = parseReviewOutput(raw);
    expect(result).toEqual(raw);
  });

  it("returns typed ReviewOutput with correct structure", () => {
    const result = parseReviewOutput(validReviewOutput());
    expect(result.reviewer).toBe("contract-reviewer");
    expect(result.gate).toBe("contract");
    expect(Array.isArray(result.findings)).toBe(true);
    expect(typeof result.summary.p0).toBe("number");
  });

  it("throws StructuredOutputError on completely invalid data", () => {
    expect(() => parseReviewOutput("not an object")).toThrow(
      StructuredOutputError,
    );
  });

  it("throws StructuredOutputError on null input", () => {
    expect(() => parseReviewOutput(null)).toThrow(StructuredOutputError);
  });

  it("throws StructuredOutputError on undefined input", () => {
    expect(() => parseReviewOutput(undefined)).toThrow(StructuredOutputError);
  });

  it("throws StructuredOutputError when required fields are missing", () => {
    const { reviewer: _, ...incomplete } = validReviewOutput();
    expect(() => parseReviewOutput(incomplete)).toThrow(StructuredOutputError);
  });

  it("throws StructuredOutputError when findings contain invalid data", () => {
    const bad = {
      ...validReviewOutput(),
      findings: [{ severity: "CRITICAL" }],
    };
    expect(() => parseReviewOutput(bad)).toThrow(StructuredOutputError);
  });

  it("includes parse error details in the thrown error", () => {
    try {
      parseReviewOutput({ wrong: "data" });
      expect.fail("Expected StructuredOutputError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(StructuredOutputError);
      const soe = err as InstanceType<typeof StructuredOutputError>;
      expect(soe.parseErrors).toBeDefined();
      expect(Array.isArray(soe.parseErrors)).toBe(true);
      expect(soe.parseErrors.length).toBeGreaterThan(0);
    }
  });

  it("includes the stage name in the thrown error", () => {
    try {
      parseReviewOutput(null);
      expect.fail("Expected StructuredOutputError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(StructuredOutputError);
      const soe = err as InstanceType<typeof StructuredOutputError>;
      expect(soe.stage).toBeDefined();
      expect(typeof soe.stage).toBe("string");
    }
  });
});

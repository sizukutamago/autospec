import { describe, expect, it } from "vitest";
import type { Finding } from "../../src/types.js";
import {
  normalizeKey,
  deduplicateFindings,
} from "../../src/gates/normalize.js";

/**
 * Helper to build a Finding with sensible defaults.
 * Only the fields relevant to each test need to be overridden.
 */
function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    severity: "P1",
    target: "UserService",
    field: "createUser",
    message: "Missing input validation",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeKey
// ---------------------------------------------------------------------------
describe("normalizeKey", () => {
  it("generates a key from target, field, and impl_file", () => {
    const finding = makeFinding({
      target: "OrderService",
      field: "placeOrder",
      impl_file: "src/services/order.ts",
    });

    expect(normalizeKey(finding)).toBe(
      "OrderService::placeOrder::src/services/order.ts",
    );
  });

  it("uses an empty string for impl_file when it is undefined", () => {
    const finding = makeFinding({
      target: "AuthService",
      field: "login",
      impl_file: undefined,
    });

    expect(normalizeKey(finding)).toBe("AuthService::login::");
  });

  it("uses an empty string for impl_file when the field is omitted entirely", () => {
    const finding: Finding = {
      severity: "P0",
      target: "PaymentService",
      field: "charge",
      message: "No retry logic",
      // impl_file is not present at all
    };

    expect(normalizeKey(finding)).toBe("PaymentService::charge::");
  });
});

// ---------------------------------------------------------------------------
// deduplicateFindings
// ---------------------------------------------------------------------------
describe("deduplicateFindings", () => {
  it("removes duplicate findings that share the same normalizeKey", () => {
    const findings: Finding[] = [
      makeFinding({
        target: "A",
        field: "x",
        impl_file: "a.ts",
        message: "first",
      }),
      makeFinding({
        target: "A",
        field: "x",
        impl_file: "a.ts",
        message: "second (duplicate key)",
      }),
    ];

    const result = deduplicateFindings(findings);

    expect(result).toHaveLength(1);
  });

  it("keeps the first occurrence when duplicates exist", () => {
    const first = makeFinding({
      target: "B",
      field: "y",
      impl_file: "b.ts",
      message: "I am first",
      severity: "P0",
    });
    const second = makeFinding({
      target: "B",
      field: "y",
      impl_file: "b.ts",
      message: "I am second",
      severity: "P2",
    });

    const result = deduplicateFindings([first, second]);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(first);
    expect(result[0]?.message).toBe("I am first");
    expect(result[0]?.severity).toBe("P0");
  });

  it("preserves findings with different keys", () => {
    const findings: Finding[] = [
      makeFinding({ target: "A", field: "x", impl_file: "a.ts" }),
      makeFinding({ target: "A", field: "y", impl_file: "a.ts" }),
      makeFinding({ target: "B", field: "x", impl_file: "b.ts" }),
      makeFinding({ target: "A", field: "x", impl_file: undefined }),
    ];

    const result = deduplicateFindings(findings);

    // All four have distinct keys, so nothing is removed
    expect(result).toHaveLength(4);
  });

  it("returns an empty array when given an empty array", () => {
    const result = deduplicateFindings([]);

    expect(result).toEqual([]);
    expect(result).toHaveLength(0);
  });

  it("handles a mix of duplicates and unique findings", () => {
    const findings: Finding[] = [
      makeFinding({
        target: "Svc",
        field: "m1",
        impl_file: "svc.ts",
        message: "alpha",
      }),
      makeFinding({
        target: "Svc",
        field: "m2",
        impl_file: "svc.ts",
        message: "beta",
      }),
      makeFinding({
        target: "Svc",
        field: "m1",
        impl_file: "svc.ts",
        message: "gamma (dup of alpha)",
      }),
      makeFinding({
        target: "Svc",
        field: "m2",
        impl_file: "svc.ts",
        message: "delta (dup of beta)",
      }),
      makeFinding({
        target: "Svc",
        field: "m3",
        impl_file: "svc.ts",
        message: "epsilon",
      }),
    ];

    const result = deduplicateFindings(findings);

    expect(result).toHaveLength(3);
    expect(result.map((f) => f.message)).toEqual([
      "alpha",
      "beta",
      "epsilon",
    ]);
  });
});

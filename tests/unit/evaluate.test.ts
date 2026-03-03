import { describe, expect, it } from "vitest";
import { countFindings, evaluateGatePolicy } from "../../src/gates/evaluate.js";
import type { Finding } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Helper to build a Finding with minimal boilerplate
// ---------------------------------------------------------------------------
function makeFinding(severity: Finding["severity"], index = 0): Finding {
  return {
    severity,
    target: `target-${index}`,
    field: `field-${index}`,
    message: `${severity} finding #${index}`,
  };
}

// ===========================================================================
// countFindings
// ===========================================================================
describe("countFindings", () => {
  it("returns zero counts for an empty array", () => {
    const counts = countFindings([]);
    expect(counts).toEqual({ critical: 0, major: 0, minor: 0 });
  });

  it("counts a single critical finding", () => {
    const counts = countFindings([makeFinding("critical")]);
    expect(counts).toEqual({ critical: 1, major: 0, minor: 0 });
  });

  it("counts a single major finding", () => {
    const counts = countFindings([makeFinding("major")]);
    expect(counts).toEqual({ critical: 0, major: 1, minor: 0 });
  });

  it("counts a single minor finding", () => {
    const counts = countFindings([makeFinding("minor")]);
    expect(counts).toEqual({ critical: 0, major: 0, minor: 1 });
  });

  it("counts mixed severities correctly", () => {
    const findings: Finding[] = [
      makeFinding("critical", 1),
      makeFinding("major", 2),
      makeFinding("major", 3),
      makeFinding("minor", 4),
      makeFinding("minor", 5),
      makeFinding("minor", 6),
      makeFinding("critical", 7),
    ];
    const counts = countFindings(findings);
    expect(counts).toEqual({ critical: 2, major: 2, minor: 3 });
  });
});

// ===========================================================================
// evaluateGatePolicy
// ===========================================================================
describe("evaluateGatePolicy", () => {
  it("passes when critical=0 and major=0", () => {
    const result = evaluateGatePolicy({ critical: 0, major: 0, minor: 0 });
    expect(result.passed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("passes at the boundary: critical=0 and major=1 (default maxMajor)", () => {
    const result = evaluateGatePolicy({ critical: 0, major: 1, minor: 0 });
    expect(result.passed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("fails when critical > 0 with reason critical_found", () => {
    const result = evaluateGatePolicy({ critical: 1, major: 0, minor: 0 });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("critical_found");
  });

  it("fails when major > maxMajor (default 1) with reason major_exceeded", () => {
    const result = evaluateGatePolicy({ critical: 0, major: 2, minor: 0 });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("major_exceeded");
  });

  it("respects custom maxMajor option", () => {
    const result = evaluateGatePolicy({ critical: 0, major: 2, minor: 0 }, { maxMajor: 1 });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("major_exceeded");
  });

  it("fails with critical_found when both critical > 0 and major > maxMajor (critical takes precedence)", () => {
    const result = evaluateGatePolicy({ critical: 1, major: 11, minor: 5 });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("critical_found");
  });

  it("minor counts do not affect the gate result (passes)", () => {
    const result = evaluateGatePolicy({ critical: 0, major: 0, minor: 100 });
    expect(result.passed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("minor counts do not affect the gate result (still fails on critical)", () => {
    const result = evaluateGatePolicy({ critical: 1, major: 0, minor: 100 });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("critical_found");
  });
});

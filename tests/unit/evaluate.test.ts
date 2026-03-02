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
    expect(counts).toEqual({ p0: 0, p1: 0, p2: 0 });
  });

  it("counts a single P0 finding", () => {
    const counts = countFindings([makeFinding("P0")]);
    expect(counts).toEqual({ p0: 1, p1: 0, p2: 0 });
  });

  it("counts a single P1 finding", () => {
    const counts = countFindings([makeFinding("P1")]);
    expect(counts).toEqual({ p0: 0, p1: 1, p2: 0 });
  });

  it("counts a single P2 finding", () => {
    const counts = countFindings([makeFinding("P2")]);
    expect(counts).toEqual({ p0: 0, p1: 0, p2: 1 });
  });

  it("counts mixed severities correctly", () => {
    const findings: Finding[] = [
      makeFinding("P0", 1),
      makeFinding("P1", 2),
      makeFinding("P1", 3),
      makeFinding("P2", 4),
      makeFinding("P2", 5),
      makeFinding("P2", 6),
      makeFinding("P0", 7),
    ];
    const counts = countFindings(findings);
    expect(counts).toEqual({ p0: 2, p1: 2, p2: 3 });
  });
});

// ===========================================================================
// evaluateGatePolicy
// ===========================================================================
describe("evaluateGatePolicy", () => {
  it("passes when P0=0 and P1=0", () => {
    const result = evaluateGatePolicy({ p0: 0, p1: 0, p2: 0 });
    expect(result.passed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("passes at the boundary: P0=0 and P1=1", () => {
    const result = evaluateGatePolicy({ p0: 0, p1: 1, p2: 0 });
    expect(result.passed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("fails when P0 > 0 with reason p0_found", () => {
    const result = evaluateGatePolicy({ p0: 1, p1: 0, p2: 0 });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("p0_found");
  });

  it("fails when P1 > 1 with reason p1_exceeded", () => {
    const result = evaluateGatePolicy({ p0: 0, p1: 2, p2: 0 });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("p1_exceeded");
  });

  it("fails with p0_found when both P0 > 0 and P1 > 1 (p0 takes precedence)", () => {
    const result = evaluateGatePolicy({ p0: 1, p1: 2, p2: 5 });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("p0_found");
  });

  it("P2 counts do not affect the gate result (passes)", () => {
    const result = evaluateGatePolicy({ p0: 0, p1: 0, p2: 100 });
    expect(result.passed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("P2 counts do not affect the gate result (still fails on P0)", () => {
    const result = evaluateGatePolicy({ p0: 1, p1: 0, p2: 100 });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("p0_found");
  });
});

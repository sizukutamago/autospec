import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Finding, GateResult, ReviewOutput } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Mock runReviewGate before importing the module under test
// ---------------------------------------------------------------------------
const { mockRunReviewGate } = vi.hoisted(() => {
  const mockRunReviewGate = vi.fn<() => Promise<GateResult>>();
  return { mockRunReviewGate };
});

vi.mock("../../src/gates/review-gate.js", () => ({
  runReviewGate: mockRunReviewGate,
}));

// Import after mock setup (dynamic import is not needed with vi.mock hoisting)
import { runReviseLoop } from "../../src/gates/revise.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeFinding(severity: Finding["severity"], index = 0): Finding {
  return {
    severity,
    target: `target-${index}`,
    field: `field-${index}`,
    message: `${severity} finding #${index}`,
  };
}

function makePassedResult(findings: Finding[] = []): GateResult {
  return {
    status: "passed",
    counts: { p0: 0, p1: findings.filter((f) => f.severity === "P1").length, p2: 0 },
    findings,
  };
}

function makeFailedResult(
  reason: "p0_found" | "p1_exceeded" | "quorum_not_met",
  findings: Finding[],
): GateResult {
  return {
    status: "failed",
    counts: {
      p0: findings.filter((f) => f.severity === "P0").length,
      p1: findings.filter((f) => f.severity === "P1").length,
      p2: findings.filter((f) => f.severity === "P2").length,
    },
    findings,
    reason,
  };
}

function dummyReviewer(): Promise<ReviewOutput> {
  return Promise.resolve({
    reviewer: "test-reviewer",
    gate: "contract",
    findings: [],
    summary: { p0: 0, p1: 0, p2: 0 },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("runReviseLoop", () => {
  beforeEach(() => {
    mockRunReviewGate.mockReset();
  });

  // -------------------------------------------------------------------------
  // Immediate pass
  // -------------------------------------------------------------------------
  it("returns immediately when initial review passes", async () => {
    const passedResult = makePassedResult();
    mockRunReviewGate.mockResolvedValueOnce(passedResult);

    const onRevise = vi.fn();
    const result = await runReviseLoop({
      gate: "contract",
      reviewers: [dummyReviewer],
      onRevise,
    });

    expect(result.status).toBe("passed");
    expect(onRevise).not.toHaveBeenCalled();
    expect(mockRunReviewGate).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // P0 found -> immediate fail, no revise
  // -------------------------------------------------------------------------
  it("returns immediately with p0_found and does not call onRevise", async () => {
    const p0Findings = [makeFinding("P0", 1)];
    const failedResult = makeFailedResult("p0_found", p0Findings);
    mockRunReviewGate.mockResolvedValueOnce(failedResult);

    const onRevise = vi.fn();
    const result = await runReviseLoop({
      gate: "code",
      reviewers: [dummyReviewer],
      onRevise,
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("p0_found");
    expect(onRevise).not.toHaveBeenCalled();
    expect(mockRunReviewGate).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // quorum_not_met -> immediate fail, no revise
  // -------------------------------------------------------------------------
  it("returns immediately with quorum_not_met and does not call onRevise", async () => {
    const failedResult = makeFailedResult("quorum_not_met", []);
    mockRunReviewGate.mockResolvedValueOnce(failedResult);

    const onRevise = vi.fn();
    const result = await runReviseLoop({
      gate: "test",
      reviewers: [dummyReviewer],
      onRevise,
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("quorum_not_met");
    expect(onRevise).not.toHaveBeenCalled();
    expect(mockRunReviewGate).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // P1 exceeded -> revise once -> second review passes
  // -------------------------------------------------------------------------
  it("calls onRevise then re-reviews when p1_exceeded; returns passed on second attempt", async () => {
    const p1Findings = [makeFinding("P1", 1), makeFinding("P1", 2)];
    const failedResult = makeFailedResult("p1_exceeded", p1Findings);
    const passedResult = makePassedResult();

    mockRunReviewGate
      .mockResolvedValueOnce(failedResult)
      .mockResolvedValueOnce(passedResult);

    const onRevise = vi.fn().mockResolvedValue(undefined);
    const result = await runReviseLoop({
      gate: "contract",
      reviewers: [dummyReviewer],
      onRevise,
    });

    expect(result.status).toBe("passed");
    expect(onRevise).toHaveBeenCalledTimes(1);
    // runReviewGate called twice: initial + 1 revise cycle
    expect(mockRunReviewGate).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // P1 exceeded for 3 cycles, then passes on 4th review (cycle 3 revise)
  // -------------------------------------------------------------------------
  it("retries up to maxCycles (default 3) and returns passed when final cycle passes", async () => {
    const p1Findings = [makeFinding("P1", 1), makeFinding("P1", 2)];
    const failedResult = makeFailedResult("p1_exceeded", p1Findings);
    const passedResult = makePassedResult();

    // Initial review fails, cycles 1-2 fail, cycle 3 passes
    mockRunReviewGate
      .mockResolvedValueOnce(failedResult) // initial
      .mockResolvedValueOnce(failedResult) // after revise cycle 1
      .mockResolvedValueOnce(failedResult) // after revise cycle 2
      .mockResolvedValueOnce(passedResult); // after revise cycle 3

    const onRevise = vi.fn().mockResolvedValue(undefined);
    const result = await runReviseLoop({
      gate: "contract",
      reviewers: [dummyReviewer],
      onRevise,
    });

    expect(result.status).toBe("passed");
    expect(onRevise).toHaveBeenCalledTimes(3);
    // 1 initial + 3 revise re-reviews = 4 total
    expect(mockRunReviewGate).toHaveBeenCalledTimes(4);
  });

  // -------------------------------------------------------------------------
  // P1 exceeded for more than maxCycles -> returns failed
  // -------------------------------------------------------------------------
  it("returns failed with p1_exceeded after exhausting maxCycles (default 3)", async () => {
    const p1Findings = [makeFinding("P1", 1), makeFinding("P1", 2)];
    const failedResult = makeFailedResult("p1_exceeded", p1Findings);

    // All 4 reviews fail (initial + 3 revise cycles)
    mockRunReviewGate
      .mockResolvedValueOnce(failedResult)
      .mockResolvedValueOnce(failedResult)
      .mockResolvedValueOnce(failedResult)
      .mockResolvedValueOnce(failedResult);

    const onRevise = vi.fn().mockResolvedValue(undefined);
    const result = await runReviseLoop({
      gate: "contract",
      reviewers: [dummyReviewer],
      onRevise,
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("p1_exceeded");
    expect(onRevise).toHaveBeenCalledTimes(3);
    // 1 initial + 3 re-reviews = 4
    expect(mockRunReviewGate).toHaveBeenCalledTimes(4);
  });

  // -------------------------------------------------------------------------
  // onRevise receives findings and cycle number
  // -------------------------------------------------------------------------
  it("passes findings and cycle number to onRevise callback", async () => {
    const p1Findings1 = [makeFinding("P1", 1), makeFinding("P1", 2)];
    const p1Findings2 = [makeFinding("P1", 3), makeFinding("P1", 4)];
    const failedResult1 = makeFailedResult("p1_exceeded", p1Findings1);
    const failedResult2 = makeFailedResult("p1_exceeded", p1Findings2);
    const passedResult = makePassedResult();

    mockRunReviewGate
      .mockResolvedValueOnce(failedResult1) // initial
      .mockResolvedValueOnce(failedResult2) // after cycle 1
      .mockResolvedValueOnce(passedResult); // after cycle 2

    const onRevise = vi.fn().mockResolvedValue(undefined);
    await runReviseLoop({
      gate: "contract",
      reviewers: [dummyReviewer],
      onRevise,
    });

    expect(onRevise).toHaveBeenCalledTimes(2);
    // Cycle 1: receives findings from initial review
    expect(onRevise).toHaveBeenNthCalledWith(1, p1Findings1, 1);
    // Cycle 2: receives findings from cycle 1 review
    expect(onRevise).toHaveBeenNthCalledWith(2, p1Findings2, 2);
  });

  // -------------------------------------------------------------------------
  // maxCycles=1 limits to a single retry
  // -------------------------------------------------------------------------
  it("respects maxCycles=1 and only retries once", async () => {
    const p1Findings = [makeFinding("P1", 1), makeFinding("P1", 2)];
    const failedResult = makeFailedResult("p1_exceeded", p1Findings);

    // Both initial and single revise fail
    mockRunReviewGate
      .mockResolvedValueOnce(failedResult)
      .mockResolvedValueOnce(failedResult);

    const onRevise = vi.fn().mockResolvedValue(undefined);
    const result = await runReviseLoop({
      gate: "doc",
      reviewers: [dummyReviewer],
      maxCycles: 1,
      onRevise,
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("p1_exceeded");
    expect(onRevise).toHaveBeenCalledTimes(1);
    // 1 initial + 1 re-review = 2
    expect(mockRunReviewGate).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // onRevise not provided -> still works (noop)
  // -------------------------------------------------------------------------
  it("works without onRevise callback (defaults to noop)", async () => {
    const p1Findings = [makeFinding("P1", 1), makeFinding("P1", 2)];
    const failedResult = makeFailedResult("p1_exceeded", p1Findings);
    const passedResult = makePassedResult();

    mockRunReviewGate
      .mockResolvedValueOnce(failedResult)
      .mockResolvedValueOnce(passedResult);

    // No onRevise provided
    const result = await runReviseLoop({
      gate: "contract",
      reviewers: [dummyReviewer],
    });

    expect(result.status).toBe("passed");
    // 1 initial + 1 re-review = 2
    expect(mockRunReviewGate).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // maxRetries is forwarded to runReviewGate
  // -------------------------------------------------------------------------
  it("passes maxRetries option through to runReviewGate", async () => {
    const passedResult = makePassedResult();
    mockRunReviewGate.mockResolvedValueOnce(passedResult);

    await runReviseLoop({
      gate: "contract",
      reviewers: [dummyReviewer],
      maxRetries: 2,
    });

    // Verify runReviewGate was called with the expected options including maxRetries
    expect(mockRunReviewGate).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 2 }),
    );
  });
});

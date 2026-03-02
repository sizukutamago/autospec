import { describe, expect, it, vi } from "vitest";
import { runReviewGate } from "../../src/gates/review-gate.js";
import type { Finding, ReviewOutput } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ReviewerFn = () => Promise<ReviewOutput>;

function makeFinding(
  severity: Finding["severity"],
  overrides: Partial<Finding> = {},
): Finding {
  return {
    severity,
    target: `target-${severity}`,
    field: `field-${severity}`,
    message: `${severity} issue`,
    ...overrides,
  };
}

function makeReviewOutput(
  findings: Finding[],
  reviewer = "test-reviewer",
): ReviewOutput {
  let p0 = 0;
  let p1 = 0;
  let p2 = 0;
  for (const f of findings) {
    if (f.severity === "P0") p0++;
    else if (f.severity === "P1") p1++;
    else p2++;
  }
  return {
    reviewer,
    gate: "code",
    findings,
    summary: { p0, p1, p2 },
  };
}

function makeSuccessReviewer(
  findings: Finding[],
  reviewer = "test-reviewer",
): ReviewerFn {
  return vi.fn(() => Promise.resolve(makeReviewOutput(findings, reviewer)));
}

function makeFailingReviewer(): ReviewerFn {
  return vi.fn(() => Promise.reject(new Error("reviewer crashed")));
}

// ===========================================================================
// runReviewGate
// ===========================================================================

describe("runReviewGate", () => {
  // -------------------------------------------------------------------------
  // Happy path: all pass, no findings
  // -------------------------------------------------------------------------
  it("passes when all reviewers succeed with no findings", async () => {
    const r1 = makeSuccessReviewer([], "reviewer-a");
    const r2 = makeSuccessReviewer([], "reviewer-b");

    const result = await runReviewGate({
      gate: "code",
      reviewers: [r1, r2],
    });

    expect(result.status).toBe("passed");
    expect(result.counts).toEqual({ p0: 0, p1: 0, p2: 0 });
    expect(result.findings).toEqual([]);
    expect(result.reason).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // P2 findings only → gate passes
  // -------------------------------------------------------------------------
  it("passes when all findings are P2 (P2 does not fail the gate)", async () => {
    const r1 = makeSuccessReviewer(
      [makeFinding("P2", { target: "A", field: "a" })],
      "reviewer-a",
    );
    const r2 = makeSuccessReviewer(
      [makeFinding("P2", { target: "B", field: "b" })],
      "reviewer-b",
    );

    const result = await runReviewGate({
      gate: "code",
      reviewers: [r1, r2],
    });

    expect(result.status).toBe("passed");
    expect(result.counts).toEqual({ p0: 0, p1: 0, p2: 2 });
    expect(result.findings).toHaveLength(2);
    expect(result.reason).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // P0 finding → gate fails with reason p0_found
  // -------------------------------------------------------------------------
  it("fails with reason p0_found when any reviewer reports a P0", async () => {
    const r1 = makeSuccessReviewer([], "reviewer-a");
    const r2 = makeSuccessReviewer(
      [makeFinding("P0", { target: "Critical", field: "bug" })],
      "reviewer-b",
    );

    const result = await runReviewGate({
      gate: "contract",
      reviewers: [r1, r2],
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("p0_found");
    expect(result.counts.p0).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // P1 > 1 → gate fails with reason p1_exceeded
  // -------------------------------------------------------------------------
  it("fails with reason p1_exceeded when P1 count exceeds 1", async () => {
    const r1 = makeSuccessReviewer(
      [makeFinding("P1", { target: "SvcA", field: "m1" })],
      "reviewer-a",
    );
    const r2 = makeSuccessReviewer(
      [makeFinding("P1", { target: "SvcB", field: "m2" })],
      "reviewer-b",
    );

    const result = await runReviewGate({
      gate: "test",
      reviewers: [r1, r2],
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("p1_exceeded");
    expect(result.counts.p1).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Boundary: P1 = 1 → gate passes
  // -------------------------------------------------------------------------
  it("passes at the boundary when P1 count is exactly 1", async () => {
    const r1 = makeSuccessReviewer(
      [makeFinding("P1", { target: "SvcA", field: "m1" })],
      "reviewer-a",
    );
    const r2 = makeSuccessReviewer([], "reviewer-b");

    const result = await runReviewGate({
      gate: "doc",
      reviewers: [r1, r2],
    });

    expect(result.status).toBe("passed");
    expect(result.counts.p1).toBe(1);
    expect(result.reason).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Retry: one reviewer fails, retry succeeds → gate passes
  // -------------------------------------------------------------------------
  it("retries a failed reviewer and passes when retry succeeds", async () => {
    const retryResult = makeReviewOutput([], "flaky-reviewer");
    const flaky = vi
      .fn<() => Promise<ReviewOutput>>()
      .mockRejectedValueOnce(new Error("transient failure"))
      .mockResolvedValueOnce(retryResult);

    const r2 = makeSuccessReviewer([], "stable-reviewer");

    const result = await runReviewGate({
      gate: "code",
      reviewers: [flaky, r2],
      maxRetries: 1,
    });

    expect(result.status).toBe("passed");
    expect(result.reason).toBeUndefined();
    // flaky should have been called twice: initial + 1 retry
    expect(flaky).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Retry exhausted: one reviewer fails, retry also fails → quorum_not_met
  // -------------------------------------------------------------------------
  it("fails with quorum_not_met when reviewer fails after all retries", async () => {
    const alwaysFail = vi
      .fn<() => Promise<ReviewOutput>>()
      .mockRejectedValue(new Error("permanent failure"));

    const r2 = makeSuccessReviewer([], "stable-reviewer");

    const result = await runReviewGate({
      gate: "code",
      reviewers: [alwaysFail, r2],
      maxRetries: 1,
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("quorum_not_met");
    // initial call + 1 retry = 2 calls
    expect(alwaysFail).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Deduplication: duplicate findings from multiple reviewers
  // -------------------------------------------------------------------------
  it("deduplicates findings that share the same normalization key", async () => {
    const sharedFinding = makeFinding("P1", {
      target: "UserService",
      field: "createUser",
      impl_file: "src/user.ts",
      message: "Missing validation",
    });

    const r1 = makeSuccessReviewer([sharedFinding], "reviewer-a");
    const r2 = makeSuccessReviewer(
      [
        {
          ...sharedFinding,
          message: "Input not validated (same key, different message)",
        },
      ],
      "reviewer-b",
    );

    const result = await runReviewGate({
      gate: "code",
      reviewers: [r1, r2],
    });

    // Same target::field::impl_file → deduplicated to 1 finding
    expect(result.findings).toHaveLength(1);
    expect(result.counts.p1).toBe(1);
    expect(result.status).toBe("passed");
  });

  // -------------------------------------------------------------------------
  // maxRetries=0: no retry, immediate quorum_not_met on failure
  // -------------------------------------------------------------------------
  it("does not retry when maxRetries is 0 and fails with quorum_not_met", async () => {
    const failOnce = makeFailingReviewer();
    const r2 = makeSuccessReviewer([], "stable-reviewer");

    const result = await runReviewGate({
      gate: "code",
      reviewers: [failOnce, r2],
      maxRetries: 0,
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("quorum_not_met");
    // Called only once — no retries
    expect(failOnce).toHaveBeenCalledTimes(1);
  });
});

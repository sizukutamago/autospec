import { describe, it, expect, vi } from "vitest";
import { createReviewGateHandler } from "../../src/gates/review-gate-handler.js";
import { createInitialState } from "../../src/state.js";
import type { PipelineOptions } from "../../src/types.js";

// Mock claudeQuery (used in Phase 1, Phase 2, and onRevise)
const mockClaudeQuery = vi.hoisted(() => vi.fn());
vi.mock("../../src/query.js", () => ({
  claudeQuery: mockClaudeQuery,
}));

vi.mock("../../src/state.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/state.js")>();
  return { ...original, saveState: vi.fn() };
});

const DEFAULT_OPTIONS: PipelineOptions = {
  cwd: "/tmp/test",
  resume: false,
  force: false,
};

function mockTwoPhase(reviewText: string, jsonOutput: Record<string, unknown>) {
  let callCount = 0;
  mockClaudeQuery.mockImplementation(() => {
    callCount++;
    // Odd calls = Phase 1 (review text), Even calls = Phase 2 (JSON)
    if (callCount % 2 === 1) {
      return Promise.resolve(reviewText);
    }
    return Promise.resolve("```json\n" + JSON.stringify(jsonOutput) + "\n```");
  });
}

describe("createReviewGateHandler", () => {
  it("returns a StageHandler function", () => {
    const handler = createReviewGateHandler({
      gate: "contract",
    });
    expect(typeof handler).toBe("function");
  });

  it("returns passed when no issues found (2-phase with revise loop)", async () => {
    mockTwoPhase("No issues found. All contracts look good.", {
      reviewer: "reviewer-1",
      gate: "contract",
      findings: [],
      summary: { critical: 0, major: 0, minor: 0 },
    });

    const handler = createReviewGateHandler({
      gate: "contract",
      reviewerCount: 1,
    });

    const state = createInitialState("/tmp/test");
    const result = await handler(state, DEFAULT_OPTIONS);
    expect(result.status).toBe("passed");
    expect(result.counts).toEqual({ critical: 0, major: 0, minor: 0 });
  });

  it("returns failed when critical findings exist (no revise for critical)", async () => {
    const jsonOutput = {
      reviewer: "reviewer-1",
      gate: "contract",
      findings: [{
        severity: "critical",
        target: "CON-test",
        field: "input",
        message: "missing required field",
      }],
      summary: { critical: 1, major: 0, minor: 0 },
    };
    const jsonStr = "```json\n" + JSON.stringify(jsonOutput) + "\n```";
    // Every call returns valid JSON so that even revise-cycle re-reviews parse correctly
    mockClaudeQuery.mockResolvedValue(jsonStr);

    const handler = createReviewGateHandler({
      gate: "contract",
      reviewerCount: 1,
    });

    const state = createInitialState("/tmp/test");
    const result = await handler(state, DEFAULT_OPTIONS);
    expect(result.status).toBe("failed");
    expect(result.counts?.critical).toBe(1);
  });

  it("returns quorum_not_met when phase 1 fails", async () => {
    mockClaudeQuery.mockRejectedValue(new Error("Claude failed"));

    const handler = createReviewGateHandler({
      gate: "contract",
      reviewerCount: 1,
    });

    const state = createInitialState("/tmp/test");
    const result = await handler(state, DEFAULT_OPTIONS);
    expect(result.status).toBe("failed");
  });
});

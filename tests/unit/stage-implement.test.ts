import { describe, expect, it, vi } from "vitest";
import { createImplementHandler } from "../../src/stages/implement.js";
import type { PipelineOptions, PipelineState } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makeState(): PipelineState {
  return {
    pipeline_version: "1.0.0",
    project_root: "/tmp/test-project",
    started_at: new Date().toISOString(),
    final_status: "pending",
    smart_skip: {},
    stages: {
      stage_1_spec: { status: "pending" },
      contract_review_gate: {
        status: "pending",
        cycles: 0,
        final_counts: { critical: 0, major: 0, minor: 0 },
      },
      stage_2_test: { status: "pending" },
      test_review_gate: {
        status: "pending",
        cycles: 0,
        final_counts: { critical: 0, major: 0, minor: 0 },
      },
      stage_3_implement: {
        status: "pending",
        blocked: [],
      },
      code_review_gate: {
        status: "pending",
        cycles: 0,
        final_counts: { critical: 0, major: 0, minor: 0 },
      },
      stage_4_docs: { status: "pending" },
      doc_review_gate: {
        status: "pending",
        cycles: 0,
        final_counts: { critical: 0, major: 0, minor: 0 },
      },
    },
  };
}

function makeOptions(): PipelineOptions {
  return { cwd: "/tmp/test-project", resume: false, force: false };
}

// ===========================================================================
// createImplementHandler
// ===========================================================================
describe("createImplementHandler", () => {
  it("calls queryFn with a prompt string", async () => {
    const queryFn = vi.fn().mockResolvedValue("implementation complete");
    const handler = createImplementHandler({ queryFn });
    const state = makeState();
    const options = makeOptions();

    await handler(state, options);

    expect(queryFn).toHaveBeenCalledOnce();
    expect(queryFn).toHaveBeenCalledWith(expect.any(String));
  });

  it("includes the project root path in the prompt", async () => {
    const queryFn = vi.fn().mockResolvedValue("implementation complete");
    const handler = createImplementHandler({ queryFn });
    const state = makeState();
    const options = makeOptions();

    await handler(state, options);

    const prompt = String(queryFn.mock.calls[0]?.[0]);
    expect(prompt).toContain(state.project_root);
  });

  it('returns { status: "completed" } on success', async () => {
    const queryFn = vi.fn().mockResolvedValue("implementation complete");
    const handler = createImplementHandler({ queryFn });
    const state = makeState();
    const options = makeOptions();

    const result = await handler(state, options);

    expect(result.status).toBe("completed");
  });

  it('returns { status: "failed" } when queryFn throws', async () => {
    const queryFn = vi
      .fn()
      .mockRejectedValue(new Error("Build compilation failed"));
    const handler = createImplementHandler({ queryFn });
    const state = makeState();
    const options = makeOptions();

    const result = await handler(state, options);

    expect(result.status).toBe("failed");
  });

  it("includes the error message as reason when queryFn throws", async () => {
    const errorMessage = "Implementation agent timeout exceeded";
    const queryFn = vi.fn().mockRejectedValue(new Error(errorMessage));
    const handler = createImplementHandler({ queryFn });
    const state = makeState();
    const options = makeOptions();

    const result = await handler(state, options);

    expect(result.status).toBe("failed");
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain(errorMessage);
  });

  it("adds a blocked entry to state.stages.stage_3_implement.blocked on failure", async () => {
    const errorMessage = "Contract C-001 dependency unresolved";
    const queryFn = vi.fn().mockRejectedValue(new Error(errorMessage));
    const handler = createImplementHandler({ queryFn });
    const state = makeState();
    const options = makeOptions();

    await handler(state, options);

    const blocked = state.stages.stage_3_implement.blocked;
    expect(blocked.length).toBeGreaterThan(0);
    const entry = blocked[0];
    expect(typeof entry.contract_id).toBe("string");
    expect(typeof entry.reason).toBe("string");
    expect(entry.detail).toContain(errorMessage);
  });
});

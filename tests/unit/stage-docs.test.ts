import { describe, expect, it, vi } from "vitest";
import { createDocsHandler } from "../../src/stages/docs.js";
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
// createDocsHandler
// ===========================================================================
describe("createDocsHandler", () => {
  it("calls queryFn with a prompt string", async () => {
    const queryFn = vi.fn().mockResolvedValue("generated documentation");
    const handler = createDocsHandler({ queryFn });
    const state = makeState();
    const options = makeOptions();

    await handler(state, options);

    expect(queryFn).toHaveBeenCalledOnce();
    expect(queryFn).toHaveBeenCalledWith(expect.any(String));
  });

  it("includes the project root path in the prompt", async () => {
    const queryFn = vi.fn().mockResolvedValue("generated documentation");
    const handler = createDocsHandler({ queryFn });
    const state = makeState();
    const options = makeOptions();

    await handler(state, options);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const prompt = String(queryFn.mock.calls[0]?.[0]);
    expect(prompt).toContain(state.project_root);
  });

  it('returns { status: "completed" } on success', async () => {
    const queryFn = vi.fn().mockResolvedValue("generated documentation");
    const handler = createDocsHandler({ queryFn });
    const state = makeState();
    const options = makeOptions();

    const result = await handler(state, options);

    expect(result.status).toBe("completed");
  });

  it('returns { status: "failed" } when queryFn throws', async () => {
    const queryFn = vi
      .fn()
      .mockRejectedValue(new Error("API connection failed"));
    const handler = createDocsHandler({ queryFn });
    const state = makeState();
    const options = makeOptions();

    const result = await handler(state, options);

    expect(result.status).toBe("failed");
  });

  it("includes the error message as reason when queryFn throws", async () => {
    const errorMessage = "Claude API rate limit exceeded";
    const queryFn = vi.fn().mockRejectedValue(new Error(errorMessage));
    const handler = createDocsHandler({ queryFn });
    const state = makeState();
    const options = makeOptions();

    const result = await handler(state, options);

    expect(result.status).toBe("failed");
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain(errorMessage);
  });
});

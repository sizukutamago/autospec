import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  // ---------------------------------------------------------------------------
  // Parallel execution (Group A + Group B → Integration)
  // ---------------------------------------------------------------------------
  describe("parallel execution", () => {
    it("falls back to single agent when no subQueryFnFactory", async () => {
      const queryFn = vi.fn().mockResolvedValue("ok");
      const handler = createDocsHandler({ queryFn });
      const state = makeState();

      const result = await handler(state, makeOptions());

      expect(result.status).toBe("completed");
      expect(queryFn).toHaveBeenCalledOnce();
    });

    it("runs Group A and Group B in parallel, then Integration", async () => {
      const capturedPrompts: string[] = [];
      const subQueryFnFactory = vi.fn().mockImplementation(() =>
        vi.fn().mockImplementation((prompt: string) => {
          capturedPrompts.push(prompt);
          return Promise.resolve("ok");
        }),
      );

      const handler = createDocsHandler({
        queryFn: vi.fn(),
        subQueryFnFactory,
      });
      const state = makeState();

      const result = await handler(state, makeOptions());

      expect(result.status).toBe("completed");
      // 3 agents: Group A + Group B + Integration
      expect(subQueryFnFactory).toHaveBeenCalledTimes(3);
      // Group A and Group B should have distinct prompts
      expect(capturedPrompts.some((p) => p.includes("Group A"))).toBe(true);
      expect(capturedPrompts.some((p) => p.includes("Group B"))).toBe(true);
      // Integration prompt
      expect(capturedPrompts.some((p) => p.includes("Integration"))).toBe(true);
    });

    it("returns completed when one group fails", async () => {
      let callIdx = 0;
      const subQueryFnFactory = vi.fn().mockImplementation(() =>
        vi.fn().mockImplementation(() => {
          callIdx++;
          if (callIdx === 1) return Promise.reject(new Error("group A failed"));
          return Promise.resolve("ok");
        }),
      );

      const handler = createDocsHandler({
        queryFn: vi.fn(),
        subQueryFnFactory,
      });
      const state = makeState();

      const result = await handler(state, makeOptions());

      // Partial failure → still completed
      expect(result.status).toBe("completed");
    });

    it("returns failed when all groups fail", async () => {
      let callIdx = 0;
      const subQueryFnFactory = vi.fn().mockImplementation(() =>
        vi.fn().mockImplementation(() => {
          callIdx++;
          // Groups A and B fail (calls 1 and 2), integration call 3 doesn't happen
          if (callIdx <= 2) return Promise.reject(new Error("failed"));
          return Promise.resolve("ok");
        }),
      );

      const handler = createDocsHandler({
        queryFn: vi.fn(),
        subQueryFnFactory,
      });
      const state = makeState();

      const result = await handler(state, makeOptions());

      expect(result.status).toBe("failed");
    });
  });

  // ---------------------------------------------------------------------------
  // Custom prompt injection
  // ---------------------------------------------------------------------------
  describe("custom prompt injection", () => {
    let tmpDir: string;

    afterEach(() => {
      if (tmpDir) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("includes custom prompts when .autospec/prompts/docs/ has files", async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-custom-"));
      const marker = "DOCS_CUSTOM_MARKER_12345";
      const promptDir = path.join(tmpDir, ".autospec", "prompts", "docs");
      fs.mkdirSync(promptDir, { recursive: true });
      fs.writeFileSync(path.join(promptDir, "custom.md"), marker);

      const queryFn = vi.fn().mockResolvedValue("generated documentation");
      const handler = createDocsHandler({ queryFn });
      const state = makeState();
      state.project_root = tmpDir;
      const options = makeOptions();

      await handler(state, options);

      const prompt = String(queryFn.mock.calls[0]?.[0]);
      expect(prompt).toContain(marker);
    });

    it("includes global custom prompts", async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-global-"));
      const marker = "DOCS_GLOBAL_MARKER_67890";
      const globalDir = path.join(tmpDir, ".autospec", "prompts", "global");
      fs.mkdirSync(globalDir, { recursive: true });
      fs.writeFileSync(path.join(globalDir, "context.md"), marker);

      const queryFn = vi.fn().mockResolvedValue("generated documentation");
      const handler = createDocsHandler({ queryFn });
      const state = makeState();
      state.project_root = tmpDir;
      const options = makeOptions();

      await handler(state, options);

      const prompt = String(queryFn.mock.calls[0]?.[0]);
      expect(prompt).toContain(marker);
    });
  });
});

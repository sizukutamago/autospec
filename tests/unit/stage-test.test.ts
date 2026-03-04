import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestGenHandler } from "../../src/stages/test-gen.js";
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
// createTestGenHandler
// ===========================================================================
describe("createTestGenHandler", () => {
  it("calls queryFn with a prompt string", async () => {
    const queryFn = vi.fn().mockResolvedValue("generated tests");
    const handler = createTestGenHandler({ queryFn });
    const state = makeState();
    const options = makeOptions();

    await handler(state, options);

    expect(queryFn).toHaveBeenCalledOnce();
    expect(queryFn).toHaveBeenCalledWith(expect.any(String));
  });

  it("includes the project root path in the prompt", async () => {
    const queryFn = vi.fn().mockResolvedValue("generated tests");
    const handler = createTestGenHandler({ queryFn });
    const state = makeState();
    const options = makeOptions();

    await handler(state, options);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const prompt = String(queryFn.mock.calls[0]?.[0]);
    expect(prompt).toContain(state.project_root);
  });

  it('returns { status: "completed" } on success', async () => {
    const queryFn = vi.fn().mockResolvedValue("generated tests");
    const handler = createTestGenHandler({ queryFn });
    const state = makeState();
    const options = makeOptions();

    const result = await handler(state, options);

    expect(result.status).toBe("completed");
  });

  it('returns { status: "failed" } when queryFn throws', async () => {
    const queryFn = vi
      .fn()
      .mockRejectedValue(new Error("API connection failed"));
    const handler = createTestGenHandler({ queryFn });
    const state = makeState();
    const options = makeOptions();

    const result = await handler(state, options);

    expect(result.status).toBe("failed");
  });

  it("includes the error message as reason when queryFn throws", async () => {
    const errorMessage = "Claude API rate limit exceeded";
    const queryFn = vi.fn().mockRejectedValue(new Error(errorMessage));
    const handler = createTestGenHandler({ queryFn });
    const state = makeState();
    const options = makeOptions();

    const result = await handler(state, options);

    expect(result.status).toBe("failed");
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain(errorMessage);
  });

  // ---------------------------------------------------------------------------
  // Parallel execution
  // ---------------------------------------------------------------------------
  describe("parallel execution", () => {
    let tmpDir: string;

    afterEach(() => {
      if (tmpDir) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    function setupContracts(dir: string, ids: string[]): void {
      const contractsDir = path.join(dir, ".autospec", "contracts");
      fs.mkdirSync(contractsDir, { recursive: true });
      for (const id of ids) {
        const yaml = `id: ${id}\ntype: api\nversion: "1.0.0"\nstatus: draft\n`;
        fs.writeFileSync(path.join(contractsDir, `${id}.contract.yaml`), yaml);
      }
    }

    function setupConfig(dir: string, testAgents: number): void {
      const autospecDir = path.join(dir, ".autospec");
      fs.mkdirSync(autospecDir, { recursive: true });
      fs.writeFileSync(
        path.join(autospecDir, "autospec.yaml"),
        `agents:\n  parallel:\n    test_agents: ${testAgents}\n`,
      );
    }

    it("falls back to single queryFn when no subQueryFnFactory is provided", async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-parallel-"));
      setupContracts(tmpDir, ["CON-a", "CON-b", "CON-c"]);
      setupConfig(tmpDir, 3);

      const queryFn = vi.fn().mockResolvedValue("ok");
      const handler = createTestGenHandler({ queryFn });
      const state = makeState();
      state.project_root = tmpDir;

      const result = await handler(state, makeOptions());

      expect(result.status).toBe("completed");
      expect(queryFn).toHaveBeenCalledOnce();
    });

    it("calls subQueryFnFactory for each chunk when contracts > 1", async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-parallel-"));
      setupContracts(tmpDir, ["CON-a", "CON-b", "CON-c"]);
      setupConfig(tmpDir, 2);

      const mainQueryFn = vi.fn().mockResolvedValue("ok");
      const subQueryFns = [
        vi.fn().mockResolvedValue("ok"),
        vi.fn().mockResolvedValue("ok"),
      ];
      let factoryIdx = 0;
      const subQueryFnFactory = vi.fn().mockImplementation(() => subQueryFns[factoryIdx++]);

      const handler = createTestGenHandler({
        queryFn: mainQueryFn,
        subQueryFnFactory,
      });
      const state = makeState();
      state.project_root = tmpDir;

      const result = await handler(state, makeOptions());

      expect(result.status).toBe("completed");
      // Main queryFn should NOT be called in parallel mode
      expect(mainQueryFn).not.toHaveBeenCalled();
      // subQueryFnFactory called for each chunk
      expect(subQueryFnFactory).toHaveBeenCalledTimes(2);
      // Each sub queryFn called once
      expect(subQueryFns[0]).toHaveBeenCalledOnce();
      expect(subQueryFns[1]).toHaveBeenCalledOnce();
    });

    it("includes contract IDs in sub-agent prompts", async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-parallel-"));
      setupContracts(tmpDir, ["CON-alpha", "CON-beta"]);
      setupConfig(tmpDir, 2);

      const capturedPrompts: string[] = [];
      const subQueryFnFactory = vi.fn().mockImplementation(() =>
        vi.fn().mockImplementation((prompt: string) => {
          capturedPrompts.push(prompt);
          return Promise.resolve("ok");
        }),
      );

      const handler = createTestGenHandler({
        queryFn: vi.fn(),
        subQueryFnFactory,
      });
      const state = makeState();
      state.project_root = tmpDir;

      await handler(state, makeOptions());

      expect(capturedPrompts).toHaveLength(2);
      // Each prompt should mention its assigned contract IDs
      expect(capturedPrompts[0]).toContain("CON-alpha");
      expect(capturedPrompts[1]).toContain("CON-beta");
    });

    it("returns completed when some sub-agents fail", async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-parallel-"));
      setupContracts(tmpDir, ["CON-a", "CON-b"]);
      setupConfig(tmpDir, 2);

      const subQueryFns = [
        vi.fn().mockResolvedValue("ok"),
        vi.fn().mockRejectedValue(new Error("agent failed")),
      ];
      let idx = 0;
      const subQueryFnFactory = vi.fn().mockImplementation(() => subQueryFns[idx++]);

      const handler = createTestGenHandler({
        queryFn: vi.fn(),
        subQueryFnFactory,
      });
      const state = makeState();
      state.project_root = tmpDir;

      const result = await handler(state, makeOptions());

      // Partial failure → still completed
      expect(result.status).toBe("completed");
    });

    it("returns failed when all sub-agents fail", async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-parallel-"));
      setupContracts(tmpDir, ["CON-a", "CON-b"]);
      setupConfig(tmpDir, 2);

      const subQueryFnFactory = vi.fn().mockImplementation(() =>
        vi.fn().mockRejectedValue(new Error("agent failed")),
      );

      const handler = createTestGenHandler({
        queryFn: vi.fn(),
        subQueryFnFactory,
      });
      const state = makeState();
      state.project_root = tmpDir;

      const result = await handler(state, makeOptions());

      expect(result.status).toBe("failed");
    });

    it("falls back to single agent when only 1 contract exists", async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-parallel-"));
      setupContracts(tmpDir, ["CON-solo"]);
      setupConfig(tmpDir, 3);

      const queryFn = vi.fn().mockResolvedValue("ok");
      const subQueryFnFactory = vi.fn();

      const handler = createTestGenHandler({ queryFn, subQueryFnFactory });
      const state = makeState();
      state.project_root = tmpDir;

      const result = await handler(state, makeOptions());

      expect(result.status).toBe("completed");
      expect(queryFn).toHaveBeenCalledOnce();
      // subQueryFnFactory should not be called for 1 contract
      expect(subQueryFnFactory).not.toHaveBeenCalled();
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

    it("includes custom prompts when .autospec/prompts/test/ has files", async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-custom-"));
      const marker = "TEST_CUSTOM_MARKER_12345";
      const promptDir = path.join(tmpDir, ".autospec", "prompts", "test");
      fs.mkdirSync(promptDir, { recursive: true });
      fs.writeFileSync(path.join(promptDir, "custom.md"), marker);

      const queryFn = vi.fn().mockResolvedValue("generated tests");
      const handler = createTestGenHandler({ queryFn });
      const state = makeState();
      state.project_root = tmpDir;
      const options = makeOptions();

      await handler(state, options);

      const prompt = String(queryFn.mock.calls[0]?.[0]);
      expect(prompt).toContain(marker);
    });

    it("includes global custom prompts", async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-global-"));
      const marker = "TEST_GLOBAL_MARKER_67890";
      const globalDir = path.join(tmpDir, ".autospec", "prompts", "global");
      fs.mkdirSync(globalDir, { recursive: true });
      fs.writeFileSync(path.join(globalDir, "context.md"), marker);

      const queryFn = vi.fn().mockResolvedValue("generated tests");
      const handler = createTestGenHandler({ queryFn });
      const state = makeState();
      state.project_root = tmpDir;
      const options = makeOptions();

      await handler(state, options);

      const prompt = String(queryFn.mock.calls[0]?.[0]);
      expect(prompt).toContain(marker);
    });
  });
});

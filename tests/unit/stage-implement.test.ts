import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  // ---------------------------------------------------------------------------
  // 3-phase parallel execution
  // ---------------------------------------------------------------------------
  describe("3-phase parallel execution", () => {
    let tmpDir: string;

    afterEach(() => {
      if (tmpDir) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    function setupContracts(
      dir: string,
      contracts: { id: string; depends_on?: string[] }[],
    ): void {
      const contractsDir = path.join(dir, ".autospec", "contracts");
      fs.mkdirSync(contractsDir, { recursive: true });
      for (const c of contracts) {
        const deps = c.depends_on
          ? `\nlinks:\n  depends_on:\n${c.depends_on.map((d) => `    - ${d}`).join("\n")}`
          : "";
        const yaml = `id: ${c.id}\ntype: api\nversion: "1.0.0"\nstatus: draft${deps}\n`;
        fs.writeFileSync(
          path.join(contractsDir, `${c.id}.contract.yaml`),
          yaml,
        );
      }
    }

    function setupConfig(dir: string, implAgents: number): void {
      const autospecDir = path.join(dir, ".autospec");
      fs.mkdirSync(autospecDir, { recursive: true });
      fs.writeFileSync(
        path.join(autospecDir, "autospec.yaml"),
        `architecture:\n  pattern: flat\nagents:\n  parallel:\n    implement_agents: ${implAgents}\n`,
      );
    }

    it("falls back to single agent when no subQueryFnFactory", async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "impl-parallel-"));
      setupContracts(tmpDir, [{ id: "CON-a" }, { id: "CON-b" }]);
      setupConfig(tmpDir, 2);

      const queryFn = vi.fn().mockResolvedValue("ok");
      const handler = createImplementHandler({ queryFn });
      const state = makeState();
      state.project_root = tmpDir;

      const result = await handler(state, makeOptions());

      expect(result.status).toBe("completed");
      expect(queryFn).toHaveBeenCalledOnce();
    });

    it("runs Phase A (implementers) in parallel by topo level", async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "impl-parallel-"));
      // CON-b depends on CON-c → level 0: CON-c, level 1: CON-b, CON-a at level 0
      setupContracts(tmpDir, [
        { id: "CON-a" },
        { id: "CON-b", depends_on: ["CON-c"] },
        { id: "CON-c" },
      ]);
      setupConfig(tmpDir, 3);

      const capturedPrompts: string[] = [];
      const subQueryFnFactory = vi.fn().mockImplementation(() =>
        vi.fn().mockImplementation((prompt: string) => {
          capturedPrompts.push(prompt);
          return Promise.resolve("ok");
        }),
      );

      const handler = createImplementHandler({
        queryFn: vi.fn(),
        subQueryFnFactory,
      });
      const state = makeState();
      state.project_root = tmpDir;

      const result = await handler(state, makeOptions());

      expect(result.status).toBe("completed");
      // At least Phase A implementers + Phase B integrator + Phase C refactorer
      expect(subQueryFnFactory.mock.calls.length).toBeGreaterThanOrEqual(3);
      // Implementer prompts should contain contract IDs
      expect(capturedPrompts.some((p) => p.includes("CON-a"))).toBe(true);
      expect(capturedPrompts.some((p) => p.includes("CON-b"))).toBe(true);
      expect(capturedPrompts.some((p) => p.includes("CON-c"))).toBe(true);
    });

    it("runs Phase B (integrator) after Phase A", async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "impl-parallel-"));
      setupContracts(tmpDir, [{ id: "CON-a" }, { id: "CON-b" }]);
      setupConfig(tmpDir, 2);

      const capturedPrompts: string[] = [];
      const subQueryFnFactory = vi.fn().mockImplementation(() =>
        vi.fn().mockImplementation((prompt: string) => {
          capturedPrompts.push(prompt);
          return Promise.resolve("ok");
        }),
      );

      const handler = createImplementHandler({
        queryFn: vi.fn(),
        subQueryFnFactory,
      });
      const state = makeState();
      state.project_root = tmpDir;

      await handler(state, makeOptions());

      // Should have integrator prompt
      expect(capturedPrompts.some((p) => p.includes("Integrator"))).toBe(true);
    });

    it("runs Phase C (refactorer) after Phase B", async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "impl-parallel-"));
      setupContracts(tmpDir, [{ id: "CON-a" }, { id: "CON-b" }]);
      setupConfig(tmpDir, 2);

      const capturedPrompts: string[] = [];
      const subQueryFnFactory = vi.fn().mockImplementation(() =>
        vi.fn().mockImplementation((prompt: string) => {
          capturedPrompts.push(prompt);
          return Promise.resolve("ok");
        }),
      );

      const handler = createImplementHandler({
        queryFn: vi.fn(),
        subQueryFnFactory,
      });
      const state = makeState();
      state.project_root = tmpDir;

      await handler(state, makeOptions());

      // Should have refactorer prompt
      expect(capturedPrompts.some((p) => p.includes("Refactorer"))).toBe(true);
    });

    it("records blocked entries when Phase A implementers fail", async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "impl-parallel-"));
      setupContracts(tmpDir, [{ id: "CON-a" }, { id: "CON-b" }]);
      setupConfig(tmpDir, 2);

      let callIdx = 0;
      const subQueryFnFactory = vi.fn().mockImplementation(() =>
        vi.fn().mockImplementation(() => {
          callIdx++;
          // First implementer fails, second succeeds
          if (callIdx === 1) return Promise.reject(new Error("compile error"));
          return Promise.resolve("ok");
        }),
      );

      const handler = createImplementHandler({
        queryFn: vi.fn(),
        subQueryFnFactory,
      });
      const state = makeState();
      state.project_root = tmpDir;

      const result = await handler(state, makeOptions());

      // Partial Phase A failure → still completed (integrator/refactorer run)
      expect(result.status).toBe("completed");
      expect(state.stages.stage_3_implement.blocked.length).toBeGreaterThan(0);
    });

    it("returns failed when all Phase A agents fail", async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "impl-parallel-"));
      setupContracts(tmpDir, [{ id: "CON-a" }, { id: "CON-b" }]);
      setupConfig(tmpDir, 2);

      const subQueryFnFactory = vi.fn().mockImplementation(() =>
        vi.fn().mockRejectedValue(new Error("fatal error")),
      );

      const handler = createImplementHandler({
        queryFn: vi.fn(),
        subQueryFnFactory,
      });
      const state = makeState();
      state.project_root = tmpDir;

      const result = await handler(state, makeOptions());

      expect(result.status).toBe("failed");
    });

    it("Phase C (refactorer) failure is non-fatal", async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "impl-parallel-"));
      setupContracts(tmpDir, [{ id: "CON-a" }]);
      // Need > 1 contract for parallel mode, but let's use 2
      setupContracts(tmpDir, [{ id: "CON-a" }, { id: "CON-b" }]);
      setupConfig(tmpDir, 2);

      let callCount = 0;
      const subQueryFnFactory = vi.fn().mockImplementation(() =>
        vi.fn().mockImplementation(() => {
          callCount++;
          // Last call (refactorer) fails
          // With 2 contracts at level 0: 2 implementers + 1 integrator + 1 refactorer = 4 calls
          if (callCount === 4)
            return Promise.reject(new Error("refactor failed"));
          return Promise.resolve("ok");
        }),
      );

      const handler = createImplementHandler({
        queryFn: vi.fn(),
        subQueryFnFactory,
      });
      const state = makeState();
      state.project_root = tmpDir;

      const result = await handler(state, makeOptions());

      // Refactorer failure is non-fatal
      expect(result.status).toBe("completed");
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

    it("includes custom prompts when .autospec/prompts/implement/ has files", async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "impl-custom-"));
      const marker = "IMPLEMENT_CUSTOM_MARKER_12345";

      // Create custom prompt file
      const promptDir = path.join(tmpDir, ".autospec", "prompts", "implement");
      fs.mkdirSync(promptDir, { recursive: true });
      fs.writeFileSync(path.join(promptDir, "custom.md"), marker);

      // Create autospec.yaml so loadConfig does not fail
      const autospecDir = path.join(tmpDir, ".autospec");
      fs.writeFileSync(
        path.join(autospecDir, "autospec.yaml"),
        "architecture:\n  pattern: flat\n",
      );

      const queryFn = vi.fn().mockResolvedValue("implementation complete");
      const handler = createImplementHandler({ queryFn });
      const state = makeState();
      state.project_root = tmpDir;
      const options = makeOptions();

      await handler(state, options);

      const prompt = String(queryFn.mock.calls[0]?.[0]);
      expect(prompt).toContain(marker);
    });

    it("includes global custom prompts", async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "impl-global-"));
      const marker = "IMPLEMENT_GLOBAL_MARKER_67890";

      // Create global custom prompt file
      const globalDir = path.join(tmpDir, ".autospec", "prompts", "global");
      fs.mkdirSync(globalDir, { recursive: true });
      fs.writeFileSync(path.join(globalDir, "context.md"), marker);

      // Create autospec.yaml so loadConfig does not fail
      const autospecDir = path.join(tmpDir, ".autospec");
      fs.writeFileSync(
        path.join(autospecDir, "autospec.yaml"),
        "architecture:\n  pattern: flat\n",
      );

      const queryFn = vi.fn().mockResolvedValue("implementation complete");
      const handler = createImplementHandler({ queryFn });
      const state = makeState();
      state.project_root = tmpDir;
      const options = makeOptions();

      await handler(state, options);

      const prompt = String(queryFn.mock.calls[0]?.[0]);
      expect(prompt).toContain(marker);
    });
  });
});

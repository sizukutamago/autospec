import { describe, it, expect, vi } from "vitest";
import { createDefaultPipeline } from "../../src/presets.js";
import { createInitialState } from "../../src/state.js";
import type { PipelineOptions, StageHandler } from "../../src/types.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// テスト用一時ディレクトリ
function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "presets-test-"));
}

describe("createDefaultPipeline", () => {
  const queryFn = vi.fn().mockResolvedValue("ok");

  it("returns a PipelineEngine", () => {
    const engine = createDefaultPipeline({ queryFn });
    expect(engine).toBeDefined();
    expect(typeof engine.run).toBe("function");
    expect(typeof engine.register).toBe("function");
  });

  it("runs full pipeline with mock queryFn", async () => {
    const tmpDir = makeTmpDir();
    const qFn = vi.fn().mockResolvedValue("done");
    const engine = createDefaultPipeline({ queryFn: qFn });
    const state = createInitialState(tmpDir);
    const options: PipelineOptions = {
      cwd: tmpDir,
      resume: false,
      force: false,
    };

    const finalState = await engine.run(state, options);

    expect(finalState.final_status).toBe("completed");
    // 4 ステージハンドラが呼ばれる（Gate は noop で queryFn 不要）
    expect(qFn).toHaveBeenCalledTimes(4);

    // クリーンアップ
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("uses noop gates by default (all pass)", async () => {
    const tmpDir = makeTmpDir();
    const qFn = vi.fn().mockResolvedValue("ok");
    const engine = createDefaultPipeline({ queryFn: qFn });
    const state = createInitialState(tmpDir);
    const options: PipelineOptions = {
      cwd: tmpDir,
      resume: false,
      force: false,
    };

    const finalState = await engine.run(state, options);

    // Gate のステータスが "passed" であること
    expect(finalState.stages.contract_review_gate.status).toBe("passed");
    expect(finalState.stages.test_review_gate.status).toBe("passed");
    expect(finalState.stages.code_review_gate.status).toBe("passed");
    expect(finalState.stages.doc_review_gate.status).toBe("passed");

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("allows gate overrides", async () => {
    const tmpDir = makeTmpDir();
    const qFn = vi.fn().mockResolvedValue("ok");

    const customGate: StageHandler = vi.fn().mockResolvedValue({
      status: "passed",
      counts: { p0: 0, p1: 1, p2: 3 },
      findings: [],
    });

    const engine = createDefaultPipeline({
      queryFn: qFn,
      gates: { contract_review_gate: customGate },
    });
    const state = createInitialState(tmpDir);
    const options: PipelineOptions = {
      cwd: tmpDir,
      resume: false,
      force: false,
    };

    const finalState = await engine.run(state, options);

    expect(customGate).toHaveBeenCalledOnce();
    expect(finalState.stages.contract_review_gate.final_counts.p1).toBe(1);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("injects taskDescription into queryFn prompts", async () => {
    const tmpDir = makeTmpDir();
    const qFn = vi.fn().mockResolvedValue("ok");

    const engine = createDefaultPipeline({
      queryFn: qFn,
      taskDescription: "Build an Othello game",
    });
    const state = createInitialState(tmpDir);
    const options: PipelineOptions = {
      cwd: tmpDir,
      resume: false,
      force: false,
    };

    await engine.run(state, options);

    // queryFn に渡されたプロンプトに taskDescription が含まれる
    const calls = qFn.mock.calls;
    for (const call of calls) {
      expect(call[0]).toContain("Build an Othello game");
    }

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("passes original prompt when no taskDescription", async () => {
    const tmpDir = makeTmpDir();
    const qFn = vi.fn().mockResolvedValue("ok");

    const engine = createDefaultPipeline({ queryFn: qFn });
    const state = createInitialState(tmpDir);
    const options: PipelineOptions = {
      cwd: tmpDir,
      resume: false,
      force: false,
    };

    await engine.run(state, options);

    // queryFn が呼ばれていて、プロンプトに "Task Context" が含まれない
    const calls = qFn.mock.calls;
    for (const call of calls) {
      expect(call[0]).not.toContain("Task Context");
    }

    fs.rmSync(tmpDir, { recursive: true });
  });
});

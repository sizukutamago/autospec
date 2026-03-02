import { describe, it, expect, vi } from "vitest";
import {
  runConversationLoop,
  type ConversationDeps,
} from "../../src/interactive/conversation.js";
import type { ConversationEntry } from "../../src/interactive/summary.js";

/**
 * ヘルパー: 入力キューから順に返す input 関数を作る
 */
function makeInput(lines: string[]): () => Promise<string | null> {
  const queue = [...lines];
  return async () => queue.shift() ?? null;
}

/** ヘルパー: 出力を記録する */
function makeOutput(): { fn: (msg: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { fn: (msg: string) => lines.push(msg), lines };
}

describe("runConversationLoop", () => {
  it("collects user messages into history", async () => {
    const output = makeOutput();
    const deps: ConversationDeps = {
      input: makeInput(["hello", "build an app", "/go"]),
      output: output.fn,
      generateSummary: vi.fn().mockResolvedValue("Task: Build an app"),
      runPipeline: vi.fn().mockResolvedValue(undefined),
    };

    await runConversationLoop(deps);

    // generateSummary に渡された history を検証
    const history = (deps.generateSummary as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as ConversationEntry[];
    expect(history).toHaveLength(2);
    expect(history[0]!.role).toBe("user");
    expect(history[0]!.content).toBe("hello");
    expect(history[1]!.content).toBe("build an app");
  });

  it("calls generateSummary then runPipeline on /go", async () => {
    const output = makeOutput();
    const generateSummary = vi.fn().mockResolvedValue("Generated task desc");
    const runPipeline = vi.fn().mockResolvedValue(undefined);
    const deps: ConversationDeps = {
      input: makeInput(["make a game", "/go"]),
      output: output.fn,
      generateSummary,
      runPipeline,
    };

    await runConversationLoop(deps);

    expect(generateSummary).toHaveBeenCalledOnce();
    expect(runPipeline).toHaveBeenCalledWith("Generated task desc");
  });

  it("exits on /cancel without running pipeline", async () => {
    const output = makeOutput();
    const generateSummary = vi.fn();
    const runPipeline = vi.fn();
    const deps: ConversationDeps = {
      input: makeInput(["some input", "/cancel"]),
      output: output.fn,
      generateSummary,
      runPipeline,
    };

    await runConversationLoop(deps);

    expect(generateSummary).not.toHaveBeenCalled();
    expect(runPipeline).not.toHaveBeenCalled();
  });

  it("shows cancel message on /cancel", async () => {
    const output = makeOutput();
    const deps: ConversationDeps = {
      input: makeInput(["/cancel"]),
      output: output.fn,
      generateSummary: vi.fn(),
      runPipeline: vi.fn(),
    };

    await runConversationLoop(deps);

    expect(output.lines.some((l) => l.includes("cancel"))).toBe(true);
  });

  it("handles empty input (null) as EOF", async () => {
    const output = makeOutput();
    const generateSummary = vi.fn();
    const runPipeline = vi.fn();
    const deps: ConversationDeps = {
      input: makeInput([]), // 即 null
      output: output.fn,
      generateSummary,
      runPipeline,
    };

    await runConversationLoop(deps);

    expect(generateSummary).not.toHaveBeenCalled();
    expect(runPipeline).not.toHaveBeenCalled();
  });

  it("ignores empty lines", async () => {
    const output = makeOutput();
    const deps: ConversationDeps = {
      input: makeInput(["", "  ", "real input", "/go"]),
      output: output.fn,
      generateSummary: vi.fn().mockResolvedValue("task"),
      runPipeline: vi.fn().mockResolvedValue(undefined),
    };

    await runConversationLoop(deps);

    const history = (deps.generateSummary as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as ConversationEntry[];
    // 空行はスキップされ、"real input" のみ
    expect(history).toHaveLength(1);
    expect(history[0]!.content).toBe("real input");
  });

  it("warns on unknown commands", async () => {
    const output = makeOutput();
    const deps: ConversationDeps = {
      input: makeInput(["/unknown", "/go"]),
      output: output.fn,
      generateSummary: vi.fn().mockResolvedValue("task"),
      runPipeline: vi.fn().mockResolvedValue(undefined),
    };

    await runConversationLoop(deps);

    expect(output.lines.some((l) => l.includes("unknown"))).toBe(true);
  });

  it("requires at least one message before /go", async () => {
    const output = makeOutput();
    const deps: ConversationDeps = {
      input: makeInput(["/go"]),
      output: output.fn,
      generateSummary: vi.fn(),
      runPipeline: vi.fn(),
    };

    await runConversationLoop(deps);

    // /go しても履歴が空なのでパイプラインは実行されない
    expect(deps.generateSummary).not.toHaveBeenCalled();
    expect(deps.runPipeline).not.toHaveBeenCalled();
    // ユーザーに入力を促すメッセージが出る
    expect(output.lines.some((l) => l.includes("message"))).toBe(true);
  });

  it("outputs error message when generateSummary throws", async () => {
    const output = makeOutput();
    const deps: ConversationDeps = {
      input: makeInput(["build something", "/go"]),
      output: output.fn,
      generateSummary: vi.fn().mockRejectedValue(new Error("summary failed")),
      runPipeline: vi.fn(),
    };

    await expect(runConversationLoop(deps)).rejects.toThrow("summary failed");
    expect(output.lines.some((l) => l.includes("summary failed"))).toBe(true);
  });

  it("outputs error message when runPipeline throws", async () => {
    const output = makeOutput();
    const deps: ConversationDeps = {
      input: makeInput(["build something", "/go"]),
      output: output.fn,
      generateSummary: vi.fn().mockResolvedValue("task desc"),
      runPipeline: vi.fn().mockRejectedValue(new Error("pipeline exploded")),
    };

    await expect(runConversationLoop(deps)).rejects.toThrow("pipeline exploded");
    expect(output.lines.some((l) => l.includes("pipeline exploded"))).toBe(true);
  });
});

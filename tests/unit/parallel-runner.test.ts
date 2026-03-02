import { describe, it, expect } from "vitest";
import { runParallel } from "../../src/agents/parallel-runner.js";

describe("runParallel", () => {
  it("runs tasks in parallel and returns results", async () => {
    const results = await runParallel([
      { name: "fast", fn: async () => "fast-result" },
      { name: "slow", fn: async () => "slow-result" },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]!.name).toBe("fast");
    expect(results[0]!.result).toBe("fast-result");
    expect(results[1]!.name).toBe("slow");
    expect(results[1]!.result).toBe("slow-result");
  });

  it("handles failures without affecting other tasks", async () => {
    const results = await runParallel([
      { name: "ok", fn: async () => "success" },
      { name: "fail", fn: async () => { throw new Error("boom"); } },
    ]);

    expect(results[0]!.result).toBe("success");
    expect(results[0]!.error).toBeUndefined();
    expect(results[1]!.result).toBeNull();
    expect(results[1]!.error).toBe("boom");
  });

  it("returns empty array for empty input", async () => {
    const results = await runParallel([]);
    expect(results).toEqual([]);
  });

  it("actually runs in parallel", async () => {
    const start = Date.now();
    await runParallel([
      { name: "a", fn: () => new Promise((r) => setTimeout(() => r("a"), 50)) },
      { name: "b", fn: () => new Promise((r) => setTimeout(() => r("b"), 50)) },
    ]);
    const elapsed = Date.now() - start;

    // 並列なら ~50ms、直列なら ~100ms
    expect(elapsed).toBeLessThan(90);
  });
});

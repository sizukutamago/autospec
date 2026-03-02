import { describe, it, expect, vi } from "vitest";
import {
  buildSummaryPrompt,
  generateTaskDescription,
} from "../../src/interactive/summary.js";
import type { ConversationEntry } from "../../src/interactive/summary.js";

describe("buildSummaryPrompt", () => {
  it("formats conversation history into prompt", () => {
    const history: ConversationEntry[] = [
      { role: "assistant", content: "What would you like to build?" },
      { role: "user", content: "An online Othello game" },
    ];

    const prompt = buildSummaryPrompt(history);

    expect(prompt).toContain("User: An online Othello game");
    expect(prompt).toContain("Assistant: What would you like to build?");
  });

  it("handles empty history", () => {
    const prompt = buildSummaryPrompt([]);

    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("includes task generation instructions", () => {
    const prompt = buildSummaryPrompt([
      { role: "user", content: "Build a chat app" },
    ]);

    expect(prompt).toContain("task description");
  });
});

describe("generateTaskDescription", () => {
  it("passes formatted prompt to queryFn", async () => {
    const queryFn = vi.fn().mockResolvedValue("Task: Build an Othello game");
    const history: ConversationEntry[] = [
      { role: "user", content: "Make an Othello game" },
    ];

    await generateTaskDescription(history, queryFn);

    expect(queryFn).toHaveBeenCalledOnce();
    const prompt = queryFn.mock.calls[0]![0] as string;
    expect(prompt).toContain("Make an Othello game");
  });

  it("returns queryFn result as task description", async () => {
    const queryFn = vi
      .fn()
      .mockResolvedValue("Build online multiplayer Othello");
    const result = await generateTaskDescription(
      [{ role: "user", content: "Build Othello" }],
      queryFn,
    );

    expect(result).toBe("Build online multiplayer Othello");
  });

  it("throws on empty history", async () => {
    const queryFn = vi.fn();
    await expect(generateTaskDescription([], queryFn)).rejects.toThrow(
      "empty history",
    );
    expect(queryFn).not.toHaveBeenCalled();
  });
});

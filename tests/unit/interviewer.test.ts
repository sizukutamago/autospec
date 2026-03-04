import { describe, it, expect, vi } from "vitest";
import {
  generateFollowUpQuestion,
  type InterviewOptions,
} from "../../src/agents/interviewer.js";
import type { ConversationEntry } from "../../src/interactive/summary.js";

const DEFAULT_OPTIONS: InterviewOptions = { maxQuestions: 5, minQuestions: 1 };

function makeHistory(content = "プロフィール閲覧機能を追加したい"): ConversationEntry[] {
  return [{ role: "user", content }];
}

describe("generateFollowUpQuestion", () => {
  it('returns { type: "question" } when queryFn returns a question text', async () => {
    const queryFn = vi.fn().mockResolvedValue("どのような情報を表示しますか？");
    const result = await generateFollowUpQuestion(makeHistory(), queryFn, 0, DEFAULT_OPTIONS);
    expect(result).toEqual({ type: "question", text: "どのような情報を表示しますか？" });
  });

  it('returns { type: "ready" } when queryFn returns __READY__', async () => {
    const queryFn = vi.fn().mockResolvedValue("__READY__");
    const result = await generateFollowUpQuestion(makeHistory(), queryFn, 1, DEFAULT_OPTIONS);
    expect(result).toEqual({ type: "ready" });
  });

  it('returns { type: "limit_reached" } when questionCount >= maxQuestions', async () => {
    const queryFn = vi.fn();
    const result = await generateFollowUpQuestion(makeHistory(), queryFn, 5, DEFAULT_OPTIONS);
    expect(result).toEqual({ type: "limit_reached" });
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("respects custom maxQuestions from options", async () => {
    const queryFn = vi.fn();
    const result = await generateFollowUpQuestion(makeHistory(), queryFn, 3, { maxQuestions: 3, minQuestions: 1 });
    expect(result).toEqual({ type: "limit_reached" });
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("forces additional question when questionCount < minQuestions and __READY__ is returned", async () => {
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce("__READY__")
      .mockResolvedValueOnce("技術スタックは何ですか？");

    const result = await generateFollowUpQuestion(makeHistory(), queryFn, 0, DEFAULT_OPTIONS);
    expect(result.type).toBe("question");
    if (result.type === "question") {
      expect(result.text).toBe("技術スタックは何ですか？");
    }
  });

  it("returns ready if forced follow-up also returns __READY__", async () => {
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce("__READY__")
      .mockResolvedValueOnce("__READY__");

    const result = await generateFollowUpQuestion(makeHistory(), queryFn, 0, DEFAULT_OPTIONS);
    expect(result).toEqual({ type: "ready" });
  });

  it("trims whitespace from queryFn response", async () => {
    const queryFn = vi.fn().mockResolvedValue("  質問です  \n");
    const result = await generateFollowUpQuestion(makeHistory(), queryFn, 0, DEFAULT_OPTIONS);
    expect(result).toEqual({ type: "question", text: "質問です" });
  });

  it("passes conversation history in the prompt", async () => {
    const queryFn = vi.fn().mockResolvedValue("__READY__");
    const history: ConversationEntry[] = [
      { role: "user", content: "オセロゲームを作りたい" },
      { role: "assistant", content: "フロントエンドは？" },
      { role: "user", content: "React です" },
    ];

    await generateFollowUpQuestion(history, queryFn, 2, DEFAULT_OPTIONS);

    const prompt = queryFn.mock.calls[0]![0] as string;
    expect(prompt).toContain("オセロゲームを作りたい");
    expect(prompt).toContain("React です");
  });

  it("does not include __RESEARCH_* tokens in prompt (removed feature)", async () => {
    const queryFn = vi.fn().mockResolvedValue("__READY__");
    await generateFollowUpQuestion(makeHistory(), queryFn, 1, DEFAULT_OPTIONS);

    const prompt = queryFn.mock.calls[0]![0] as string;
    expect(prompt).not.toContain("__RESEARCH_CODE:");
    expect(prompt).not.toContain("__RESEARCH_WEB:");
    expect(prompt).not.toContain("__RESEARCH_BOTH:");
  });

  it("uses first-turn prompt with autonomous investigation instructions on questionCount === 0", async () => {
    const queryFn = vi.fn().mockResolvedValue("質問です");
    await generateFollowUpQuestion(makeHistory(), queryFn, 0, DEFAULT_OPTIONS);

    const prompt = queryFn.mock.calls[0]![0] as string;
    expect(prompt).toContain("Autonomous Investigation");
    expect(prompt).toContain("Read");
    expect(prompt).toContain("Glob");
    expect(prompt).toContain("Grep");
  });

  it("uses follow-up prompt without full investigation instructions on questionCount > 0", async () => {
    const queryFn = vi.fn().mockResolvedValue("__READY__");
    await generateFollowUpQuestion(makeHistory(), queryFn, 1, DEFAULT_OPTIONS);

    const prompt = queryFn.mock.calls[0]![0] as string;
    expect(prompt).not.toContain("Autonomous Investigation");
    expect(prompt).toContain("already investigated the project");
  });
});

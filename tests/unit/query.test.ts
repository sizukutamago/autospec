import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: mockQuery,
}));

import { claudeQuery } from "../../src/query.js";

// Helper: AsyncGenerator からSDKメッセージを返すスタブ
function createMockConversation(resultText: string) {
  return (async function* () {
    yield {
      type: "result" as const,
      subtype: "success" as const,
      result: resultText,
    };
  })();
}

function createMockConversationWithAssistant(text: string) {
  return (async function* () {
    yield {
      type: "assistant" as const,
      message: {
        content: [{ type: "text" as const, text }],
      },
    };
    yield {
      type: "result" as const,
      subtype: "success" as const,
      result: text,
    };
  })();
}

describe("claudeQuery", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("calls sdk query with prompt", async () => {
    mockQuery.mockReturnValue(createMockConversation("ok"));
    await claudeQuery("test prompt");

    expect(mockQuery).toHaveBeenCalledOnce();
    const call = mockQuery.mock.calls[0]![0];
    expect(call.prompt).toBe("test prompt");
  });

  it("returns result text from successful query", async () => {
    mockQuery.mockReturnValue(createMockConversation("generated code"));
    const result = await claudeQuery("generate something");

    expect(result).toBe("generated code");
  });

  it("returns last assistant text when no result message", async () => {
    mockQuery.mockReturnValue(
      createMockConversationWithAssistant("assistant response"),
    );
    const result = await claudeQuery("prompt");

    expect(result).toBe("assistant response");
  });

  it("applies default options", async () => {
    mockQuery.mockReturnValue(createMockConversation("ok"));
    await claudeQuery("prompt");

    const call = mockQuery.mock.calls[0]![0];
    expect(call.options.maxTurns).toBe(15);
    expect(call.options.permissionMode).toBe("bypassPermissions");
  });

  it("allows overriding options", async () => {
    mockQuery.mockReturnValue(createMockConversation("ok"));
    await claudeQuery("prompt", { maxTurns: 5, cwd: "/custom" });

    const call = mockQuery.mock.calls[0]![0];
    expect(call.options.maxTurns).toBe(5);
    expect(call.options.cwd).toBe("/custom");
  });

  it("throws when no result or assistant message", async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield { type: "system" as const };
      })(),
    );

    await expect(claudeQuery("prompt")).rejects.toThrow(
      "claudeQuery failed: no response received",
    );
  });

  it("returns lastText on error_max_turns if text was collected", async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield {
          type: "assistant" as const,
          message: {
            content: [{ type: "text" as const, text: "partial work done" }],
          },
        };
        yield {
          type: "result" as const,
          subtype: "error_max_turns" as const,
        };
      })(),
    );

    const result = await claudeQuery("prompt");
    expect(result).toBe("partial work done");
  });

  it("throws on error_max_turns if no text was collected", async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield {
          type: "result" as const,
          subtype: "error_max_turns" as const,
        };
      })(),
    );

    await expect(claudeQuery("prompt")).rejects.toThrow("error_max_turns");
  });

  it("throws on non-success result subtype", async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield {
          type: "result" as const,
          subtype: "error" as const,
          result: "Something went wrong",
        };
      })(),
    );

    await expect(claudeQuery("prompt")).rejects.toThrow(
      "claudeQuery failed: Something went wrong",
    );
  });
});

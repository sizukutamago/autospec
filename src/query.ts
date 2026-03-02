import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";

export interface ClaudeQueryOptions {
  cwd?: string;
  maxTurns?: number;
  systemPrompt?: string;
  /**
   * Permission mode for the Claude Code subprocess.
   * @default "bypassPermissions" — allows file writes without confirmation.
   * Set to "default" or "acceptEdits" for safer operation.
   */
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
  allowDangerouslySkipPermissions?: boolean;
  tools?: string[];
}

export async function claudeQuery(
  prompt: string,
  options?: ClaudeQueryOptions,
): Promise<string> {
  const permissionMode =
    options?.permissionMode ?? "bypassPermissions";

  const conversation = sdkQuery({
    prompt,
    options: {
      cwd: options?.cwd ?? process.cwd(),
      maxTurns: options?.maxTurns ?? 15,
      systemPrompt: options?.systemPrompt,
      permissionMode,
      allowDangerouslySkipPermissions:
        options?.allowDangerouslySkipPermissions ??
        (permissionMode === "bypassPermissions" ? true : undefined),
      tools: options?.tools,
    },
  });

  let lastText = "";
  for await (const msg of conversation) {
    if (msg.type === "result" && "subtype" in msg) {
      if (msg.subtype === "success" && "result" in msg) {
        return msg.result;
      }
      // error_max_turns: Claude did work but hit turn limit.
      // Return lastText if available (partial success).
      if (msg.subtype === "error_max_turns" && lastText) {
        return lastText;
      }
      // Other non-success results — treat as failure
      const errorMsg =
        "result" in msg && typeof msg.result === "string"
          ? msg.result
          : `Query ended with subtype: ${msg.subtype}`;
      throw new Error(`claudeQuery failed: ${errorMsg}`);
    }
    if (msg.type === "assistant" && "message" in msg) {
      const content = (msg.message as { content?: unknown[] })?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            typeof block === "object" &&
            block !== null &&
            "type" in block &&
            block.type === "text" &&
            "text" in block &&
            typeof block.text === "string"
          ) {
            lastText = block.text;
          }
        }
      }
    }
  }

  // Stream ended without a result message
  if (!lastText) {
    throw new Error("claudeQuery failed: no response received");
  }
  return lastText;
}

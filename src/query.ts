import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";

export interface OutputFormat {
  type: "json_schema";
  schema: Record<string, unknown>;
}

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
  /** JSON schema で構造化出力を強制する */
  outputFormat?: OutputFormat;
}

export interface ClaudeQueryResult {
  text: string;
  structuredOutput?: unknown;
}

interface StreamResult {
  text: string;
  structuredOutput?: unknown;
}

/**
 * SDK ストリーム処理の共通実装。
 * claudeQuery / claudeQueryStructured の重複ロジックを集約する。
 */
async function runStream(
  prompt: string,
  options: ClaudeQueryOptions,
  label: string,
): Promise<StreamResult> {
  const permissionMode =
    options.permissionMode ?? "bypassPermissions";

  const conversation = sdkQuery({
    prompt,
    options: {
      cwd: options.cwd ?? process.cwd(),
      maxTurns: options.maxTurns ?? 15,
      systemPrompt: options.systemPrompt,
      permissionMode,
      allowDangerouslySkipPermissions:
        options.allowDangerouslySkipPermissions ??
        (permissionMode === "bypassPermissions" ? true : undefined),
      tools: options.tools,
      outputFormat: options.outputFormat,
    },
  });

  let lastText = "";
  let turnCount = 0;
  for await (const msg of conversation) {
    if (msg.type === "result" && "subtype" in msg) {
      console.error(`[autospec:query] ${label} finished: subtype=${msg.subtype}, turns=${turnCount}`);
      if (msg.subtype === "success") {
        const r = msg as Record<string, unknown>;
        const text = typeof r["result"] === "string" ? r["result"] : "";
        console.error(`[autospec:query] ${label} result (${text.length} chars): ${text.slice(0, 200)}...`);
        return {
          text,
          structuredOutput: r["structured_output"],
        };
      }
      // error_max_turns: Claude did work but hit turn limit.
      // Return lastText if available (partial success).
      if (msg.subtype === "error_max_turns" && lastText) {
        console.error(`[autospec:query] ${label} hit max_turns (${options.maxTurns}), returning partial text (${lastText.length} chars)`);
        return { text: lastText };
      }
      // Other non-success results — treat as failure
      const errorMsg =
        "result" in msg && typeof msg.result === "string"
          ? msg.result
          : `Query ended with subtype: ${msg.subtype}`;
      throw new Error(`${label} failed: ${errorMsg}`);
    }
    if (msg.type === "assistant" && "message" in msg) {
      turnCount++;
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
    throw new Error(`${label} failed: no response received`);
  }
  return { text: lastText };
}

export async function claudeQuery(
  prompt: string,
  options?: ClaudeQueryOptions,
): Promise<string> {
  const { text } = await runStream(prompt, options ?? {}, "claudeQuery");
  return text;
}

/**
 * claudeQuery の構造化出力版。
 * outputFormat を指定すると、result の structured_output フィールドから
 * パース済みデータを返す。
 */
export async function claudeQueryStructured(
  prompt: string,
  options: ClaudeQueryOptions & { outputFormat: OutputFormat },
): Promise<ClaudeQueryResult> {
  const { text, structuredOutput } = await runStream(prompt, options, "claudeQueryStructured");
  return { text, structuredOutput };
}

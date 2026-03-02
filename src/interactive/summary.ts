import type { QueryFn } from "../types.js";

export interface ConversationEntry {
  role: "user" | "assistant";
  content: string;
}

export function formatHistory(
  history: ConversationEntry[],
  separator = "\n\n",
): string {
  return history
    .map((e) => `${e.role === "user" ? "User" : "Assistant"}: ${e.content}`)
    .join(separator);
}

export function buildSummaryPrompt(history: ConversationEntry[]): string {
  const formattedHistory = formatHistory(history);

  return `Based on the following conversation, generate a comprehensive task description for a software project. Include:
1. Project name and overview
2. Technology stack decisions
3. Key features and requirements
4. Architecture considerations
5. Any constraints or preferences mentioned

Output a clear, structured task description that can be used as context for code generation.

## Conversation

${formattedHistory}`;
}

export async function generateTaskDescription(
  history: ConversationEntry[],
  queryFn: QueryFn,
): Promise<string> {
  if (history.length === 0) {
    throw new Error("Cannot generate task description from empty history");
  }
  const prompt = buildSummaryPrompt(history);
  return queryFn(prompt);
}

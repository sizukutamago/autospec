import type { QueryFn } from "../types.js";
import { formatHistory } from "../interactive/summary.js";
import type { ConversationEntry } from "../interactive/summary.js";

const MAX_QUESTIONS = 5;
const MIN_QUESTIONS = 1;

const READY_TOKEN = "__READY__";

const INTERVIEW_SYSTEM_PROMPT = `You are a project requirements interviewer for a software development pipeline.
Your job is to investigate the existing project and ask ONE follow-up question at a time to gather enough information to generate a complete project specification.

## Autonomous Investigation

You have access to Read, Glob, Grep, WebSearch, and WebFetch tools.
Before asking questions, investigate the project yourself:
- Use Glob to scan the directory structure
- Use Read to read CLAUDE.md, package.json, tsconfig.json, and key source files
- Use Grep to search for patterns and understand the codebase
- Use WebSearch/WebFetch if you need to look up best practices or tech compatibility

Do NOT ask questions that you can answer by reading the code.

## Rules
- Investigate first, then ask only what you cannot determine from the code
- Ask in Japanese
- Ask only ONE question per response
- Keep questions short and specific
- When you have enough information to write a complete spec, respond with EXACTLY "${READY_TOKEN}" (nothing else)
- Usually 1-3 questions are enough after investigation. Don't over-ask.`;

function buildInterviewPrompt(
  history: ConversationEntry[],
): string {
  return `${INTERVIEW_SYSTEM_PROMPT}

## Conversation so far
${formatHistory(history, "\n")}

Respond with ONE of:
- A follow-up question in Japanese (after investigating the codebase)
- "${READY_TOKEN}" if you have enough information`;
}

export type QuestionResult =
  | { type: "question"; text: string }
  | { type: "ready" }
  | { type: "limit_reached" };

export async function generateFollowUpQuestion(
  history: ConversationEntry[],
  queryFn: QueryFn,
  questionCount: number,
): Promise<QuestionResult> {
  if (questionCount >= MAX_QUESTIONS) {
    return { type: "limit_reached" };
  }

  const prompt = buildInterviewPrompt(history);
  const response = await queryFn(prompt);
  const trimmed = response.trim();

  if (trimmed === READY_TOKEN) {
    if (questionCount < MIN_QUESTIONS) {
      const forceResponse = await queryFn(
        `${prompt}\n\nIMPORTANT: You must ask at least ${MIN_QUESTIONS - questionCount} more question(s). Do NOT respond with ${READY_TOKEN} yet.`,
      );
      const forceTrimmed = forceResponse.trim();
      if (forceTrimmed !== READY_TOKEN) {
        return { type: "question", text: forceTrimmed };
      }
    }
    return { type: "ready" };
  }

  return { type: "question", text: trimmed };
}

export { MAX_QUESTIONS };

import type { QueryFn } from "../types.js";
import { formatHistory } from "../interactive/summary.js";
import type { ConversationEntry } from "../interactive/summary.js";

const MAX_QUESTIONS = 5;
const MIN_QUESTIONS = 2;

const READY_TOKEN = "__READY__";
const RESEARCH_CODE_TOKEN = "__RESEARCH_CODE:";
const RESEARCH_WEB_TOKEN = "__RESEARCH_WEB:";
const RESEARCH_BOTH_TOKEN = "__RESEARCH_BOTH:";

const INTERVIEW_SYSTEM_PROMPT = `You are a project requirements interviewer for a software development pipeline.
Your job is to ask ONE follow-up question at a time to gather enough information to generate a complete project specification.

Rules:
- Ask about: tech stack, key features, architecture, constraints, target users, UI/UX preferences
- Ask in Japanese
- Ask only ONE question per response
- Keep questions short and specific
- When you have enough information to write a complete spec, respond with EXACTLY "${READY_TOKEN}" (nothing else)
- Usually 2-4 questions are enough. Don't over-ask.

Special actions (respond with EXACTLY this format if needed):
- "${RESEARCH_CODE_TOKEN}topic__" — request code analysis on the topic
- "${RESEARCH_WEB_TOKEN}topic__" — request web search on the topic
- "${RESEARCH_BOTH_TOKEN}topic__" — request both code and web research on the topic

Use research actions when:
- You need to check the existing codebase for context
- You need to verify tech stack compatibility
- You need to look up best practices for a specific technology

The user's conversation and any research context will be provided.`;

function buildInterviewPrompt(
  history: ConversationEntry[],
  researchContext?: string,
): string {
  const contextSection = researchContext
    ? `\n\n## Research Context\n${researchContext}`
    : "";

  return `${INTERVIEW_SYSTEM_PROMPT}${contextSection}

## Conversation so far
${formatHistory(history, "\n")}

Respond with ONE of:
- A follow-up question in Japanese
- "${READY_TOKEN}" if you have enough information
- "${RESEARCH_CODE_TOKEN}topic__" to analyze existing code
- "${RESEARCH_WEB_TOKEN}topic__" to search the web
- "${RESEARCH_BOTH_TOKEN}topic__" to do both`;
}

export type ResearchTarget = "code" | "web" | "both";

export type QuestionResult =
  | { type: "question"; text: string }
  | { type: "ready" }
  | { type: "limit_reached" }
  | { type: "research_needed"; target: ResearchTarget; topic: string };

export async function generateFollowUpQuestion(
  history: ConversationEntry[],
  queryFn: QueryFn,
  questionCount: number,
  researchContext?: string,
): Promise<QuestionResult> {
  if (questionCount >= MAX_QUESTIONS) {
    return { type: "limit_reached" };
  }

  const prompt = buildInterviewPrompt(history, researchContext);
  const response = await queryFn(prompt);
  const trimmed = response.trim();

  if (trimmed === READY_TOKEN) {
    // 最低質問数に達していなければ質問を続けさせる
    if (questionCount < MIN_QUESTIONS) {
      // READY を無視して追加質問を強制
      const forcePrompt = buildInterviewPrompt(history, researchContext);
      const forceResponse = await queryFn(
        `${forcePrompt}\n\nIMPORTANT: You must ask at least ${MIN_QUESTIONS - questionCount} more question(s). Do NOT respond with ${READY_TOKEN} yet.`,
      );
      const forceTrimmed = forceResponse.trim();
      if (forceTrimmed !== READY_TOKEN) {
        return { type: "question", text: forceTrimmed };
      }
    }
    return { type: "ready" };
  }

  // Research token parsing
  for (const [token, target] of [
    [RESEARCH_CODE_TOKEN, "code"],
    [RESEARCH_WEB_TOKEN, "web"],
    [RESEARCH_BOTH_TOKEN, "both"],
  ] as const) {
    if (trimmed.startsWith(token) && trimmed.endsWith("__")) {
      const topic = trimmed.slice(token.length, -2);
      return { type: "research_needed", target, topic };
    }
  }

  return { type: "question", text: trimmed };
}

export { MAX_QUESTIONS };

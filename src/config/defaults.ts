import type { AutospecConfig } from "./schema.js";

export const DEFAULT_CONFIG = {
  project: {},
  pipeline: {
    mode: "full" as const,
    smart_skip: true,
    max_turns: { spec: 8, test: 8, implement: 12, docs: 5 },
  },
  agents: {
    researcher: { enabled: true, max_turns: 5 },
    web_researcher: { enabled: true, max_turns: 3 },
    interviewer: { min_questions: 2, max_questions: 5 },
  },
  gates: {
    type: "review" as const,
    review: {
      contract_reviewers: 3,
      test_reviewers: 3,
      code_reviewers: 4,
      doc_reviewers: 3,
    },
  },
  tech_stack: {
    test: "vitest",
    validation: "zod",
    package_manager: "npm",
  },
  architecture: { pattern: "flat" as const },
} satisfies AutospecConfig;

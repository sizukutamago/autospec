import { z } from "zod";

export const AutospecConfigSchema = z.object({
  project: z.object({
    name: z.string().optional(),
    language: z.string().optional(),
    runtime: z.string().optional(),
  }).optional(),

  pipeline: z.object({
    mode: z.enum(["spec", "tdd", "full"]).optional(),
    smart_skip: z.boolean().optional(),
    max_turns: z.object({
      spec: z.number().optional(),
      test: z.number().optional(),
      implement: z.number().optional(),
      docs: z.number().optional(),
    }).optional(),
  }).optional(),

  agents: z.object({
    researcher: z.object({
      enabled: z.boolean().optional(),
      max_turns: z.number().optional(),
    }).optional(),
    web_researcher: z.object({
      enabled: z.boolean().optional(),
      max_turns: z.number().optional(),
    }).optional(),
    interviewer: z.object({
      min_questions: z.number().optional(),
      max_questions: z.number().optional(),
    }).optional(),
  }).optional(),

  gates: z.object({
    type: z.enum(["review", "noop"]).optional(),
    review: z.object({
      contract_reviewers: z.number().optional(),
      test_reviewers: z.number().optional(),
      code_reviewers: z.number().optional(),
      doc_reviewers: z.number().optional(),
    }).optional(),
  }).optional(),

  tech_stack: z.object({
    framework: z.string().optional(),
    test: z.string().optional(),
    validation: z.string().optional(),
    package_manager: z.string().optional(),
  }).optional(),

  architecture: z.object({
    pattern: z.enum(["clean", "layered", "flat"]).optional(),
  }).optional(),
});

export type AutospecConfigInput = z.input<typeof AutospecConfigSchema>;

/** Fully resolved config (no optionals) */
export interface AutospecConfig {
  project: { name?: string; language?: string; runtime?: string };
  pipeline: {
    mode: "spec" | "tdd" | "full";
    smart_skip: boolean;
    max_turns: { spec: number; test: number; implement: number; docs: number };
  };
  agents: {
    researcher: { enabled: boolean; max_turns: number };
    web_researcher: { enabled: boolean; max_turns: number };
    interviewer: { min_questions: number; max_questions: number };
  };
  gates: {
    type: "review" | "noop";
    review: {
      contract_reviewers: number;
      test_reviewers: number;
      code_reviewers: number;
      doc_reviewers: number;
    };
  };
  tech_stack: {
    framework?: string;
    test: string;
    validation: string;
    package_manager: string;
  };
  architecture: { pattern: "clean" | "layered" | "flat" };
}

import { z } from "zod";
import type { ReviewOutput } from "../types.js";
import { StructuredOutputError } from "../errors.js";

export const FindingSchema = z.object({
  severity: z.enum(["P0", "P1", "P2"]),
  target: z.string(),
  field: z.string(),
  impl_file: z.string().optional(),
  message: z.string(),
  suggestion: z.string().optional(),
  disposition: z
    .enum(["false_positive", "wont_fix", "downgraded", "deferred"])
    .nullable()
    .optional(),
  disposition_reason: z.string().nullable().optional(),
  deferred_to: z.string().nullable().optional(),
  original_severity: z.string().nullable().optional(),
});

const GateCountsSchema = z.object({
  p0: z.number(),
  p1: z.number(),
  p2: z.number(),
});

export const ReviewOutputSchema = z.object({
  reviewer: z.string(),
  gate: z.enum(["contract", "test", "code", "doc"]),
  findings: z.array(FindingSchema),
  summary: GateCountsSchema,
});

export function parseReviewOutput(raw: unknown): ReviewOutput {
  const result = ReviewOutputSchema.safeParse(raw);
  if (result.success) {
    return result.data as ReviewOutput;
  }
  const parseErrors = result.error.issues.map(
    (issue) => `${issue.path.join(".")}: ${issue.message}`,
  );
  throw new StructuredOutputError("review", parseErrors);
}

import type { Finding, GateResult } from "../types.js";
import { runReviewGate } from "./review-gate.js";
import type { ReviewGateOptions, ReviewerFn } from "./review-gate.js";

export type { ReviewerFn };

export interface ReviseLoopOptions {
  gate: "contract" | "test" | "code" | "doc";
  reviewers: ReviewerFn[];
  maxCycles?: number;
  maxRetries?: number;
  onRevise?: (findings: Finding[], cycle: number) => Promise<void>;
}

export async function runReviseLoop(
  options: ReviseLoopOptions,
): Promise<GateResult> {
  const maxCycles = options.maxCycles ?? 3;
  const onRevise = options.onRevise ?? (async () => {});

  const gateOptions: ReviewGateOptions = {
    gate: options.gate,
    reviewers: options.reviewers,
    maxRetries: options.maxRetries,
  };

  let result = await runReviewGate(gateOptions);

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    if (result.status === "passed") return result;
    if (result.reason !== "p1_exceeded") return result;

    await onRevise(result.findings, cycle);
    result = await runReviewGate(gateOptions);
  }

  return result;
}

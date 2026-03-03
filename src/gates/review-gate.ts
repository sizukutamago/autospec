import type { Finding, GateResult, ReviewOutput } from "../types.js";
import { deduplicateFindings } from "./normalize.js";
import { countFindings, evaluateGatePolicy } from "./evaluate.js";
import { toErrorMessage } from "../utils/to-error-message.js";

export type ReviewerFn = () => Promise<ReviewOutput>;

export interface ReviewGateOptions {
  gate: "contract" | "test" | "code" | "doc";
  reviewers: ReviewerFn[];
  maxRetries?: number;
}

async function runWithRetry(
  reviewer: ReviewerFn,
  maxRetries: number,
  index: number,
): Promise<ReviewOutput | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await reviewer();
    } catch (err) {
      console.error(
        `[autospec] Reviewer #${index + 1} attempt ${attempt + 1}/${maxRetries + 1} failed:`,
        toErrorMessage(err),
      );
      if (attempt === maxRetries) return null;
    }
  }
  return null;
}

export async function runReviewGate(
  options: ReviewGateOptions,
): Promise<GateResult> {
  const maxRetries = options.maxRetries ?? 1;

  const results = await Promise.all(
    options.reviewers.map((r, i) => runWithRetry(r, maxRetries, i)),
  );

  // Quorum check: if any reviewer failed after all retries
  if (results.some((r) => r === null)) {
    return {
      status: "failed",
      counts: { p0: 0, p1: 0, p2: 0 },
      findings: [],
      reason: "quorum_not_met",
    };
  }

  // Aggregate findings from all successful reviewers
  const allFindings: Finding[] = [];
  for (const result of results) {
    if (result !== null) {
      allFindings.push(...result.findings);
    }
  }

  const deduplicated = deduplicateFindings(allFindings);
  const counts = countFindings(deduplicated);
  const policy = evaluateGatePolicy(counts);

  if (policy.passed) {
    return { status: "passed", counts, findings: deduplicated };
  }

  return {
    status: "failed",
    counts,
    findings: deduplicated,
    reason: policy.reason,
  };
}

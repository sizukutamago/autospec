import type { Finding, GateCounts } from "../types.js";

export function countFindings(findings: Finding[]): GateCounts {
  let critical = 0;
  let major = 0;
  let minor = 0;

  for (const f of findings) {
    switch (f.severity) {
      case "critical":
        critical++;
        break;
      case "major":
        major++;
        break;
      case "minor":
        minor++;
        break;
    }
  }

  return { critical, major, minor };
}

export interface GatePolicyOptions {
  /** major の許容上限（デフォルト: 1） — CLAUDE.md 仕様: critical=0 かつ major≤1 → PASS */
  maxMajor?: number;
}

export function evaluateGatePolicy(
  counts: GateCounts,
  options?: GatePolicyOptions,
): { passed: boolean; reason?: "critical_found" | "major_exceeded" } {
  const maxMajor = options?.maxMajor ?? 1;
  if (counts.critical > 0) {
    return { passed: false, reason: "critical_found" };
  }
  if (counts.major > maxMajor) {
    return { passed: false, reason: "major_exceeded" };
  }
  return { passed: true };
}

import type { Finding, GateCounts } from "../types.js";

export function countFindings(findings: Finding[]): GateCounts {
  let p0 = 0;
  let p1 = 0;
  let p2 = 0;

  for (const f of findings) {
    switch (f.severity) {
      case "P0":
        p0++;
        break;
      case "P1":
        p1++;
        break;
      case "P2":
        p2++;
        break;
    }
  }

  return { p0, p1, p2 };
}

export function evaluateGatePolicy(
  counts: GateCounts,
): { passed: boolean; reason?: "p0_found" | "p1_exceeded" } {
  if (counts.p0 > 0) {
    return { passed: false, reason: "p0_found" };
  }
  if (counts.p1 > 1) {
    return { passed: false, reason: "p1_exceeded" };
  }
  return { passed: true };
}

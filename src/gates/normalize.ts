import type { Finding } from "../types.js";

export function normalizeKey(finding: Finding): string {
  return `${finding.target}::${finding.field}::${finding.impl_file ?? ""}`;
}

export function deduplicateFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const result: Finding[] = [];
  for (const finding of findings) {
    const key = normalizeKey(finding);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(finding);
    }
  }
  return result;
}

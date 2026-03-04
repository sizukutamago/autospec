import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";

export interface ContractMeta {
  id: string;
  type: "api" | "external" | "file" | "internal";
  depends_on: string[];
  filePath: string;
}

/**
 * .autospec/contracts/ から全コントラクト YAML をスキャンし、
 * メタデータを返す。サブディレクトリを再帰的に走査する。
 */
export function discoverContracts(projectRoot: string): ContractMeta[] {
  const contractsDir = path.join(projectRoot, ".autospec", "contracts");
  if (!fs.existsSync(contractsDir)) return [];
  return scanDir(contractsDir);
}

function scanDir(dir: string): ContractMeta[] {
  const results: ContractMeta[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...scanDir(fullPath));
    } else if (
      entry.name.endsWith(".contract.yaml") ||
      entry.name.endsWith(".contract.yml")
    ) {
      const meta = parseContractMeta(fullPath);
      if (meta) results.push(meta);
    }
  }
  return results;
}

function parseContractMeta(filePath: string): ContractMeta | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = yaml.load(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object" || !parsed.id) return null;

    const links = parsed.links as Record<string, unknown> | undefined;
    const dependsOn = Array.isArray(links?.depends_on)
      ? (links.depends_on as string[])
      : [];

    return {
      id: String(parsed.id),
      type: String(parsed.type) as ContractMeta["type"],
      depends_on: dependsOn,
      filePath,
    };
  } catch {
    return null;
  }
}

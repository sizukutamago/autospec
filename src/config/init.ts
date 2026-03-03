import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { DEFAULT_CONFIG } from "./defaults.js";

const AUTOSPEC_DIRS = [
  "contracts/api",
  "contracts/external",
  "contracts/files",
  "contracts/internal",
  "concepts",
  "decisions",
];

/**
 * .autospec/ ディレクトリを初期化する。
 * 既存の autospec.yaml は上書きしない。
 */
export function initAutospec(projectRoot: string): void {
  const bpDir = path.join(projectRoot, ".autospec");

  // ディレクトリ作成
  for (const dir of AUTOSPEC_DIRS) {
    fs.mkdirSync(path.join(bpDir, dir), { recursive: true });
  }

  // autospec.yaml 生成（既存があれば上書きしない）
  const yamlPath = path.join(bpDir, "autospec.yaml");
  if (!fs.existsSync(yamlPath)) {
    const content = yaml.dump(DEFAULT_CONFIG, {
      lineWidth: 120,
      noRefs: true,
    });
    fs.writeFileSync(yamlPath, content, "utf-8");
  }
}

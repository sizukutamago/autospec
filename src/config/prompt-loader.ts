import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * SDK 同梱のプロンプトディレクトリのパスを返す。
 */
export function getPromptsDir(): string {
  return path.resolve(__dirname, "..", "prompts");
}

/**
 * プロンプトファイルを読み込む。
 * プロジェクト側の .autospec/facets/ に同名ファイルがあればそちらを優先（ファイル単位の上書き）。
 */
export function loadPromptFile(
  relativePath: string,
  projectRoot?: string,
): string {
  // プロジェクト側の上書きチェック
  if (projectRoot) {
    const projectPath = path.join(projectRoot, ".autospec", "facets", relativePath);
    if (fs.existsSync(projectPath)) {
      try {
        return fs.readFileSync(projectPath, "utf-8");
      } catch {
        // fall through to SDK default
      }
    }
  }

  // SDK 同梱のデフォルト
  const sdkPath = path.join(getPromptsDir(), relativePath);
  try {
    return fs.readFileSync(sdkPath, "utf-8");
  } catch {
    return "";
  }
}

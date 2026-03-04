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

/**
 * 指定ディレクトリから .md ファイルをアルファベット順に読み込む。
 */
function loadMarkdownDir(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];

  let entries: string[];
  try {
    entries = fs.readdirSync(dirPath);
  } catch {
    return [];
  }

  return entries
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      try {
        return fs.readFileSync(path.join(dirPath, f), "utf-8");
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

/**
 * カスタムプロンプトを読み込む。
 * .autospec/prompts/global/ と .autospec/prompts/{target}/ の
 * .md ファイルをアルファベット順に結合して返す。
 *
 * ファイルが1つもなければ空文字列を返す（既存動作に影響なし）。
 */
export function loadCustomPrompts(
  target: string,
  projectRoot: string,
): string {
  const prompts: string[] = [];

  // グローバルプロンプト
  const globalDir = path.join(projectRoot, ".autospec", "prompts", "global");
  prompts.push(...loadMarkdownDir(globalDir));

  // ターゲット固有プロンプト（"global" 指定時は二重読み込みしない）
  if (target !== "global") {
    const targetDir = path.join(projectRoot, ".autospec", "prompts", target);
    prompts.push(...loadMarkdownDir(targetDir));
  }

  if (prompts.length === 0) return "";

  return "\n\n## Project Custom Instructions\n\n" + prompts.join("\n\n---\n\n");
}

export interface CustomPromptFile {
  name: string;
  content: string;
}

/**
 * カスタムプロンプトファイルを個別に読み込む。
 * .autospec/prompts/{target}/ 内の各 .md ファイルを
 * 個別の { name, content } として返す。
 *
 * レビューゲートで各ファイルを独立したカスタムレビュアーとして
 * 追加するために使う。
 */
export function loadCustomPromptFiles(
  target: string,
  projectRoot: string,
): CustomPromptFile[] {
  const targetDir = path.join(projectRoot, ".autospec", "prompts", target);
  if (!fs.existsSync(targetDir)) return [];

  let entries: string[];
  try {
    entries = fs.readdirSync(targetDir);
  } catch {
    return [];
  }

  return entries
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      try {
        const content = fs.readFileSync(path.join(targetDir, f), "utf-8");
        if (!content) return null;
        return { name: f.replace(/\.md$/, ""), content };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is CustomPromptFile => entry !== null);
}

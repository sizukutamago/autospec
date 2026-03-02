import { claudeQuery } from "../query.js";

/**
 * 既存プロジェクトのコード・設定ファイルを調査する Researcher エージェント。
 * Read/Glob/Grep のみ使用（書き込み不可）。
 */
export async function runResearcher(
  projectRoot: string,
  topic?: string,
): Promise<string> {
  const topicSection = topic
    ? `\n\nFocus especially on: ${topic}`
    : "";

  return claudeQuery(
    `Analyze the project at ${projectRoot}.
Read CLAUDE.md, package.json, tsconfig.json, and scan the source code structure.
Summarize in Japanese:
- プロジェクトの種類と現在の状態
- 技術スタック（既存の依存関係）
- ディレクトリ構造
- 既存コードのパターンと規約
- 実装済みのものと未実装のもの${topicSection}

Return a concise structured summary.`,
    {
      cwd: projectRoot,
      maxTurns: 5,
      tools: ["Read", "Glob", "Grep"],
    },
  );
}

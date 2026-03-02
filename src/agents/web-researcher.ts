import { claudeQuery } from "../query.js";

/**
 * Web 検索で技術情報を調査する WebResearcher エージェント。
 * WebSearch/WebFetch のみ使用。
 */
export async function runWebResearcher(
  topic: string,
): Promise<string> {
  return claudeQuery(
    `Research the following topic for a software project:
${topic}

Find:
- 最新のベストプラクティス
- 推奨ライブラリやツール
- アーキテクチャパターン
- 注意すべき落とし穴

Return findings in Japanese as a concise summary.`,
    {
      maxTurns: 3,
      tools: ["WebSearch", "WebFetch"],
    },
  );
}

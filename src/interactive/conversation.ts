import { parseCommand } from "./commands.js";
import type { ConversationEntry } from "./summary.js";
import { toErrorMessage } from "../utils/to-error-message.js";

/**
 * 対話ループの外部依存を全て注入可能にする。
 * テスト時にはモックを、実行時には readline + claudeQuery を渡す。
 */
export interface ConversationDeps {
  /** 1行入力を返す。EOF で null を返す */
  input: () => Promise<string | null>;
  /** ユーザーへのメッセージ出力 */
  output: (message: string) => void;
  /** 会話履歴 → タスク説明文を生成 */
  generateSummary: (history: ConversationEntry[]) => Promise<string>;
  /** タスク説明文を受け取ってパイプラインを実行 */
  runPipeline: (taskDescription: string) => Promise<void>;
}

/**
 * 対話型会話ループ。
 * ユーザーの入力を蓄積し、/go で要約 → パイプライン実行、/cancel で中断する。
 */
export async function runConversationLoop(deps: ConversationDeps): Promise<void> {
  const { input, output, generateSummary, runPipeline } = deps;
  const history: ConversationEntry[] = [];

  output("What would you like to build? (type /go to start, /cancel to quit)");

  while (true) {
    const line = await input();

    // EOF
    if (line === null) {
      return;
    }

    // 空行はスキップ
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }

    // コマンド判定
    const cmd = parseCommand(trimmed);
    if (cmd) {
      switch (cmd.type) {
        case "go": {
          if (history.length === 0) {
            output("Please enter at least one message before /go.");
            continue;
          }
          try {
            output("Generating task description from conversation...");
            const taskDescription = await generateSummary(history);
            output("Starting pipeline...");
            await runPipeline(taskDescription);
          } catch (err) {
            const message = toErrorMessage(err);
            output(`Pipeline error: ${message}`);
            throw err;
          }
          return;
        }
        case "cancel": {
          output("Pipeline cancelled.");
          return;
        }
        default: {
          output(`Unknown command: ${trimmed}. Available: /go, /cancel`);
          continue;
        }
      }
    }

    // 通常のメッセージ — 履歴に追加
    history.push({ role: "user", content: trimmed });
  }
}

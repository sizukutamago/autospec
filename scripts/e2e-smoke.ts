/**
 * E2E スモークテスト
 * Claude Code を実際に起動してパイプラインの Stage 1 (spec) だけ動かす
 *
 * Usage: npx tsx scripts/e2e-smoke.ts
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { PipelineEngine } from "../src/engine.js";
import { createInitialState } from "../src/state.js";
import type {
  StageHandler,
  PipelineState,
  PipelineOptions,
  StageResult,
} from "../src/types.js";

// Claude Agent SDK の query() をラップして最終テキストを返す
async function claudeQuery(prompt: string): Promise<string> {
  const conversation = query({
    prompt,
    options: {
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 2,
    },
  });

  let lastText = "";
  for await (const msg of conversation) {
    if (msg.type === "assistant") {
      // SDKAssistantMessage.message は BetaMessage — content 配列を持つ
      const content = msg.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text") {
            lastText = block.text;
          }
        }
      }
    }
  }
  return lastText;
}

// Stage 1 だけ実際に Claude を呼ぶ
function createSmokeStageHandler(): StageHandler {
  return async (
    _state: PipelineState,
    _options: PipelineOptions,
  ): Promise<StageResult> => {
    console.log("[smoke] Stage 1: Calling Claude via query()...");
    const result = await claudeQuery(
      "Reply with exactly: 'Hello from blueprint-sdk'. Nothing else.",
    );
    console.log(`[smoke] Claude responded: ${result.slice(0, 200)}`);
    return { status: "completed" };
  };
}

// 残りのステージは即完了
function noopHandler(name: string): StageHandler {
  return async (): Promise<StageResult> => {
    console.log(`[smoke] ${name}: skipped (noop)`);
    return name.endsWith("_gate")
      ? {
          status: "passed",
          counts: { p0: 0, p1: 0, p2: 0 },
          findings: [],
        }
      : { status: "completed" };
  };
}

async function main() {
  console.log("[smoke] E2E smoke test starting...");

  const tmpDir = "/tmp/blueprint-sdk-smoke";
  const { mkdirSync } = await import("node:fs");
  mkdirSync(tmpDir, { recursive: true });

  const state = createInitialState(tmpDir);
  const options: PipelineOptions = {
    cwd: tmpDir,
    resume: false,
    force: false,
  };

  const engine = new PipelineEngine();
  engine.register("stage_1_spec", createSmokeStageHandler());
  engine.register(
    "contract_review_gate",
    noopHandler("contract_review_gate"),
  );
  engine.register("stage_2_test", noopHandler("stage_2_test"));
  engine.register("test_review_gate", noopHandler("test_review_gate"));
  engine.register("stage_3_implement", noopHandler("stage_3_implement"));
  engine.register("code_review_gate", noopHandler("code_review_gate"));
  engine.register("stage_4_docs", noopHandler("stage_4_docs"));
  engine.register("doc_review_gate", noopHandler("doc_review_gate"));

  const finalState = await engine.run(state, options);

  console.log(`[smoke] Pipeline completed: ${finalState.final_status}`);
  console.log(`[smoke] State saved to: ${tmpDir}/pipeline-state.yaml`);
  console.log("[smoke] E2E smoke test PASSED!");
}

void main().catch((err: unknown) => {
  console.error("[smoke] E2E smoke test FAILED:", err);
  process.exitCode = 1;
});

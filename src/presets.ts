import { PipelineEngine } from "./engine.js";
import { createSpecHandler } from "./stages/spec.js";
import { createTestGenHandler } from "./stages/test-gen.js";
import { createImplementHandler } from "./stages/implement.js";
import { createDocsHandler } from "./stages/docs.js";
import { createNoopGateHandler } from "./gates/noop-gate.js";
import { createReviewGateHandler } from "./gates/review-gate-handler.js";
import { claudeQuery } from "./query.js";
import { loadConfig } from "./config/loader.js";
import type { StageHandler, QueryFn } from "./types.js";

type GateStageId =
  | "contract_review_gate"
  | "test_review_gate"
  | "code_review_gate"
  | "doc_review_gate";

type WorkStageId =
  | "stage_1_spec"
  | "stage_2_test"
  | "stage_3_implement"
  | "stage_4_docs";

/** 各ステージの maxTurns デフォルト値 */
const STAGE_MAX_TURNS: Record<WorkStageId, number> = {
  stage_1_spec: 25,
  stage_2_test: 20,
  stage_3_implement: 30,
  stage_4_docs: 15,
};

export interface DefaultPipelineOptions {
  queryFn: QueryFn;
  cwd?: string;
  taskDescription?: string;
  gates?: Partial<Record<GateStageId, StageHandler>>;
  stages?: Partial<Record<WorkStageId, StageHandler>>;
  maxTurns?: Partial<Record<WorkStageId, number>>;
}

function createStageQueryFn(
  baseQueryFn: QueryFn,
  cwd: string | undefined,
  maxTurns: number,
  taskDescription?: string,
): QueryFn {
  return (prompt: string) => {
    const fullPrompt = taskDescription
      ? `${prompt}\n\n## Task Context\n${taskDescription}`
      : prompt;

    // cwd が指定されていれば claudeQuery で maxTurns を制御
    if (cwd) {
      return claudeQuery(fullPrompt, { cwd, maxTurns });
    }
    return baseQueryFn(fullPrompt);
  };
}

export function createDefaultPipeline(
  options: DefaultPipelineOptions,
): PipelineEngine {
  const { queryFn, cwd, gates, stages, taskDescription } = options;
  const engine = new PipelineEngine();

  const getMaxTurns = (stage: WorkStageId): number =>
    options.maxTurns?.[stage] ?? STAGE_MAX_TURNS[stage];

  const specQueryFn = createStageQueryFn(queryFn, cwd, getMaxTurns("stage_1_spec"), taskDescription);
  const testQueryFn = createStageQueryFn(queryFn, cwd, getMaxTurns("stage_2_test"), taskDescription);
  const implQueryFn = createStageQueryFn(queryFn, cwd, getMaxTurns("stage_3_implement"), taskDescription);
  const docsQueryFn = createStageQueryFn(queryFn, cwd, getMaxTurns("stage_4_docs"), taskDescription);

  // Gate タイプを config から決定
  const config = cwd ? loadConfig(cwd) : undefined;
  const gateType = config?.gates.type ?? "noop";

  function defaultGate(gate: "contract" | "test" | "code" | "doc"): StageHandler {
    if (gateType === "review" && cwd) {
      return createReviewGateHandler({ gate, projectRoot: cwd });
    }
    return createNoopGateHandler();
  }

  // サブエージェント用 queryFn ファクトリ（cwd がある場合のみ）
  const subQueryFnFactory = cwd
    ? (stageId: WorkStageId) => {
        const ratio = config?.agents.parallel.sub_agent_turns_ratio ?? 0.5;
        const subMaxTurns = Math.max(1, Math.floor(getMaxTurns(stageId) * ratio));
        return (_agentIndex: number): QueryFn =>
          (prompt: string) => claudeQuery(prompt, { cwd, maxTurns: subMaxTurns });
      }
    : undefined;

  engine.register("stage_1_spec", stages?.stage_1_spec ?? createSpecHandler({ queryFn: specQueryFn }));
  engine.register("contract_review_gate", gates?.contract_review_gate ?? defaultGate("contract"));
  engine.register("stage_2_test", stages?.stage_2_test ?? createTestGenHandler({
    queryFn: testQueryFn,
    subQueryFnFactory: subQueryFnFactory?.("stage_2_test"),
  }));
  engine.register("test_review_gate", gates?.test_review_gate ?? defaultGate("test"));
  engine.register("stage_3_implement", stages?.stage_3_implement ?? createImplementHandler({
    queryFn: implQueryFn,
    subQueryFnFactory: subQueryFnFactory?.("stage_3_implement"),
  }));
  engine.register("code_review_gate", gates?.code_review_gate ?? defaultGate("code"));
  engine.register("stage_4_docs", stages?.stage_4_docs ?? createDocsHandler({
    queryFn: docsQueryFn,
    subQueryFnFactory: subQueryFnFactory?.("stage_4_docs"),
  }));
  engine.register("doc_review_gate", gates?.doc_review_gate ?? defaultGate("doc"));

  return engine;
}

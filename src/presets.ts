import { PipelineEngine } from "./engine.js";
import { createSpecHandler } from "./stages/spec.js";
import { createTestGenHandler } from "./stages/test-gen.js";
import { createImplementHandler } from "./stages/implement.js";
import { createDocsHandler } from "./stages/docs.js";
import { createNoopGateHandler } from "./gates/noop-gate.js";
import { claudeQuery } from "./query.js";
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
  stage_1_spec: 8,
  stage_2_test: 8,
  stage_3_implement: 12,
  stage_4_docs: 5,
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

  engine.register("stage_1_spec", stages?.stage_1_spec ?? createSpecHandler({ queryFn: specQueryFn }));
  engine.register("contract_review_gate", gates?.contract_review_gate ?? createNoopGateHandler());
  engine.register("stage_2_test", stages?.stage_2_test ?? createTestGenHandler({ queryFn: testQueryFn }));
  engine.register("test_review_gate", gates?.test_review_gate ?? createNoopGateHandler());
  engine.register("stage_3_implement", stages?.stage_3_implement ?? createImplementHandler({ queryFn: implQueryFn }));
  engine.register("code_review_gate", gates?.code_review_gate ?? createNoopGateHandler());
  engine.register("stage_4_docs", stages?.stage_4_docs ?? createDocsHandler({ queryFn: docsQueryFn }));
  engine.register("doc_review_gate", gates?.doc_review_gate ?? createNoopGateHandler());

  return engine;
}

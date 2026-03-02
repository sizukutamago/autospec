import type {
  StageId,
  StageHandler,
  PipelineState,
  PipelineOptions,
  PipelineMode,
  StageResult,
  GateState,
} from "./types.js";
import { saveState } from "./state.js";
import { PipelineError, GateFailedError } from "./errors.js";

const PIPELINE_ORDER: StageId[] = [
  "stage_1_spec",
  "contract_review_gate",
  "stage_2_test",
  "test_review_gate",
  "stage_3_implement",
  "code_review_gate",
  "stage_4_docs",
  "doc_review_gate",
];

const MODE_STOP_AFTER: Record<PipelineMode, StageId> = {
  spec: "contract_review_gate",
  tdd: "test_review_gate",
  full: "doc_review_gate",
};

export class PipelineEngine {
  private handlers = new Map<StageId, StageHandler>();

  register(stageId: StageId, handler: StageHandler): void {
    this.handlers.set(stageId, handler);
  }

  async run(state: PipelineState, options: PipelineOptions): Promise<PipelineState> {
    const startIndex = options.force ? 0
      : options.resume ? this.findResumePoint(state)
      : 0;

    for (let i = startIndex; i < PIPELINE_ORDER.length; i++) {
      const stageId = PIPELINE_ORDER[i]!;

      // blocked guard: Stage 4 に進む前に blocked > 0 を検査
      if (stageId === "stage_4_docs") {
        const implStage = state.stages.stage_3_implement;
        if (implStage.blocked.length > 0) {
          state.final_status = "aborted";
          saveState(state);
          throw new PipelineError(
            `Cannot proceed to Stage 4: ${implStage.blocked.length} contract(s) still blocked`,
            stageId,
          );
        }
      }

      const handler = this.handlers.get(stageId);
      if (!handler) {
        throw new PipelineError(`No handler registered for stage: ${stageId}`, stageId);
      }

      options.onStageStart?.(stageId);
      this.markInProgress(state, stageId);
      saveState(state);

      const result = await handler(state, options);

      this.applyResult(state, stageId, result);
      options.onStageComplete?.(stageId, result);

      // Gate失敗時は即座に停止
      if (this.isGate(stageId) && result.status === "failed") {
        state.final_status = "aborted";
        saveState(state);
        const gateResult = result as StageResult & { reason?: string };
        throw new GateFailedError(
          stageId,
          (gateResult.reason as "p0_found" | "p1_exceeded" | "quorum_not_met") ?? "p0_found",
        );
      }

      saveState(state);

      // mode に応じてパイプラインを早期完了
      const stopAfter = MODE_STOP_AFTER[options.mode ?? "full"];
      if (stageId === stopAfter) {
        break;
      }
    }

    state.final_status = "completed";
    state.completed_at = new Date().toISOString();
    saveState(state);

    return state;
  }

  private findResumePoint(state: PipelineState): number {
    for (let i = PIPELINE_ORDER.length - 1; i >= 0; i--) {
      const stageId = PIPELINE_ORDER[i]!;
      const stageState = state.stages[stageId];
      if (
        stageState.status === "completed" ||
        ("status" in stageState && stageState.status === "passed")
      ) {
        return i + 1;
      }
    }
    return 0;
  }

  private isGate(stageId: StageId): boolean {
    return stageId.endsWith("_gate");
  }

  private markInProgress(state: PipelineState, stageId: StageId): void {
    const stage = state.stages[stageId];
    if (this.isGate(stageId)) {
      (stage as GateState).status = "pending";
    } else {
      stage.status = "in_progress" as never;
      (stage as { started_at?: string }).started_at = new Date().toISOString();
    }
  }

  private applyResult(
    state: PipelineState,
    stageId: StageId,
    result: StageResult,
  ): void {
    const stage = state.stages[stageId];

    if (this.isGate(stageId)) {
      const gate = stage as GateState;
      gate.status = result.status as "pending" | "passed" | "failed";
      gate.cycles += 1;
      if (result.counts) gate.final_counts = result.counts;
      if (result.findings) gate.findings = result.findings;
    } else {
      stage.status = result.status as never;
      (stage as { completed_at?: string }).completed_at = new Date().toISOString();
    }
  }
}

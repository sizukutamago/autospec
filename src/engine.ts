import type {
  StageId,
  StageHandler,
  PipelineState,
  PipelineOptions,
  PipelineMode,
  StageResult,
  GateState,
  GateFailReason,
} from "./types.js";
import { saveState } from "./state.js";
import { PipelineError, GateFailedError } from "./errors.js";
import { toErrorMessage } from "./utils/to-error-message.js";

export const PIPELINE_ORDER: StageId[] = [
  "stage_1_spec",
  "contract_review_gate",
  "stage_2_test",
  "test_review_gate",
  "stage_3_implement",
  "code_review_gate",
  "stage_4_docs",
  "doc_review_gate",
];

export interface ResumeInfo {
  resumeIndex: number;
  completedStages: StageId[];
  failedStages: StageId[];
  stuckStages: StageId[];
  nextStage: StageId | null;
  isFullyCompleted: boolean;
}

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
      : options.startFromStage ? PIPELINE_ORDER.indexOf(options.startFromStage)
      : options.resume ? PipelineEngine.getResumeInfo(state).resumeIndex
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

      let result: StageResult;
      try {
        result = await handler(state, options);
      } catch (err) {
        // PipelineError 系はステージを failed + aborted にして re-throw
        if (err instanceof PipelineError) {
          this.markFailed(state, stageId);
          state.final_status = "aborted";
          saveState(state);
          throw err;
        }
        // 予期しないエラー: ステージを failed + aborted にして PipelineError でラップ
        this.markFailed(state, stageId);
        state.final_status = "aborted";
        saveState(state);
        throw new PipelineError(
          `Stage "${stageId}" failed unexpectedly: ${toErrorMessage(err)}`,
          stageId,
        );
      }

      this.applyResult(state, stageId, result);
      options.onStageComplete?.(stageId, result);

      // Gate失敗時は即座に停止
      if (this.isGate(stageId) && result.status === "failed") {
        state.final_status = "aborted";
        saveState(state);
        const reason = this.toGateFailReason(result.reason);
        throw new GateFailedError(stageId, reason);
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

  static getResumeInfo(state: PipelineState): ResumeInfo {
    const failedStages: StageId[] = [];
    const stuckStages: StageId[] = [];

    for (const stageId of PIPELINE_ORDER) {
      const s = state.stages[stageId];
      if (s.status === "failed") failedStages.push(stageId);
      if (s.status === "in_progress") stuckStages.push(stageId);
    }

    // in_progress のステージがあれば、最後の in_progress から再開
    if (stuckStages.length > 0) {
      const lastStuck = stuckStages[stuckStages.length - 1]!;
      const resumeIndex = PIPELINE_ORDER.indexOf(lastStuck);
      return {
        resumeIndex,
        completedStages: PIPELINE_ORDER.slice(0, resumeIndex),
        failedStages,
        stuckStages,
        nextStage: lastStuck,
        isFullyCompleted: false,
      };
    }

    // 従来ロジック: 最後の completed/passed の次から再開
    for (let i = PIPELINE_ORDER.length - 1; i >= 0; i--) {
      const stageId = PIPELINE_ORDER[i]!;
      const s = state.stages[stageId];
      if (s.status === "completed" || s.status === "passed") {
        const resumeIndex = i + 1;
        return {
          resumeIndex,
          completedStages: PIPELINE_ORDER.slice(0, resumeIndex),
          failedStages,
          stuckStages,
          nextStage: resumeIndex < PIPELINE_ORDER.length ? PIPELINE_ORDER[resumeIndex]! : null,
          isFullyCompleted: resumeIndex >= PIPELINE_ORDER.length,
        };
      }
    }

    return {
      resumeIndex: 0,
      completedStages: [],
      failedStages,
      stuckStages,
      nextStage: PIPELINE_ORDER[0]!,
      isFullyCompleted: false,
    };
  }

  private markFailed(state: PipelineState, stageId: StageId): void {
    const stage = state.stages[stageId];
    if (this.isGate(stageId)) {
      (stage as GateState).status = "failed";
    } else {
      stage.status = "failed" as never;
    }
  }

  private static readonly VALID_GATE_FAIL_REASONS: ReadonlySet<string> = new Set<GateFailReason>([
    "p0_found",
    "p1_exceeded",
    "quorum_not_met",
  ]);

  private toGateFailReason(reason: string | undefined): GateFailReason {
    if (reason && PipelineEngine.VALID_GATE_FAIL_REASONS.has(reason)) {
      return reason as GateFailReason;
    }
    if (reason) {
      console.error(`[autospec] Unknown gate fail reason "${reason}", defaulting to "p0_found"`);
    }
    return "p0_found";
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

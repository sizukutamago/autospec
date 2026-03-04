import type {
  StageId,
  StageName,
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

export const STAGE_NAME_MAP: Record<StageName, { work: StageId; gate: StageId }> = {
  spec:      { work: "stage_1_spec",      gate: "contract_review_gate" },
  test:      { work: "stage_2_test",      gate: "test_review_gate" },
  implement: { work: "stage_3_implement", gate: "code_review_gate" },
  docs:      { work: "stage_4_docs",      gate: "doc_review_gate" },
};

const STAGE_NAME_ORDER = Object.keys(STAGE_NAME_MAP) as StageName[];

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
    const { startIndex, stopIndex } = this.resolveExecutionRange(state, options);

    for (let i = startIndex; i <= stopIndex && i < PIPELINE_ORDER.length; i++) {
      const stageId = PIPELINE_ORDER[i]!;

      // blocked guard: Stage 4 に進む前に blocked > 0 を検査
      if (stageId === "stage_4_docs") {
        const implStage = state.stages.stage_3_implement;
        if (implStage.blocked.length > 0) {
          if (options.onBlockedGuard) {
            const action = await options.onBlockedGuard(stageId, implStage.blocked.length);
            if (action === "abort") {
              state.final_status = "aborted";
              saveState(state);
              throw new PipelineError(
                `Cannot proceed to Stage 4: ${implStage.blocked.length} contract(s) still blocked`,
                stageId,
              );
            }
            // "continue" → blocked のまま Stage 4 を実行
          } else {
            state.final_status = "aborted";
            saveState(state);
            throw new PipelineError(
              `Cannot proceed to Stage 4: ${implStage.blocked.length} contract(s) still blocked`,
              stageId,
            );
          }
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
        const error = err instanceof Error ? err : new Error(toErrorMessage(err));

        if (options.onStageError) {
          const action = await options.onStageError(stageId, error);
          if (action === "retry") {
            // 同じステージを再実行するためインデックスを戻す
            this.markInProgress(state, stageId);
            saveState(state);
            try {
              result = await handler(state, options);
            } catch (retryErr) {
              this.markFailed(state, stageId);
              state.final_status = "aborted";
              saveState(state);
              throw new PipelineError(
                `Stage "${stageId}" failed on retry: ${toErrorMessage(retryErr)}`,
                stageId,
              );
            }
          } else if (action === "skip") {
            state.stages[stageId].status = "skipped" as never;
            saveState(state);
            continue;
          } else {
            // "abort"
            this.markFailed(state, stageId);
            state.final_status = "aborted";
            saveState(state);
            if (err instanceof PipelineError) throw err;
            throw new PipelineError(
              `Stage "${stageId}" failed unexpectedly: ${toErrorMessage(err)}`,
              stageId,
            );
          }
        } else {
          // コールバック未設定 → 既存動作
          if (err instanceof PipelineError) {
            this.markFailed(state, stageId);
            state.final_status = "aborted";
            saveState(state);
            throw err;
          }
          this.markFailed(state, stageId);
          state.final_status = "aborted";
          saveState(state);
          throw new PipelineError(
            `Stage "${stageId}" failed unexpectedly: ${toErrorMessage(err)}`,
            stageId,
          );
        }
      }

      this.applyResult(state, stageId, result);
      options.onStageComplete?.(stageId, result);

      // Gate失敗時の回復ロジック
      if (this.isGate(stageId) && result.status === "failed") {
        const reason = this.toGateFailReason(result.reason);
        const gate = state.stages[stageId] as GateState;

        if (options.onGateFailed) {
          const action = await options.onGateFailed(stageId, reason, gate.final_counts);

          if (action === "retry") {
            // カウントをリセットして再実行
            gate.final_counts = { critical: 0, major: 0, minor: 0 };
            gate.findings = [];
            // markInProgress が status = "pending" を設定するので先行セット不要
            options.onStageStart?.(stageId);
            this.markInProgress(state, stageId);
            saveState(state);
            const retryResult = await handler(state, options);
            this.applyResult(state, stageId, retryResult);
            options.onStageComplete?.(stageId, retryResult);

            // 再実行後もまだ失敗の場合は throw
            if (retryResult.status === "failed") {
              state.final_status = "aborted";
              saveState(state);
              throw new GateFailedError(stageId, this.toGateFailReason(retryResult.reason));
            }
          } else if (action === "skip") {
            gate.status = "passed";
            saveState(state);
          } else {
            // "abort"
            state.final_status = "aborted";
            saveState(state);
            throw new GateFailedError(stageId, reason);
          }
        } else {
          // コールバック未設定 → 既存動作
          state.final_status = "aborted";
          saveState(state);
          throw new GateFailedError(stageId, reason);
        }
      }

      saveState(state);
    }

    state.final_status = "completed";
    state.completed_at = new Date().toISOString();
    saveState(state);

    return state;
  }

  private resolveDefaultStartIndex(
    state: PipelineState,
    options: PipelineOptions,
  ): number {
    if (options.force) return 0;
    if (options.startFromStage) return PIPELINE_ORDER.indexOf(options.startFromStage);
    if (options.resume) return PipelineEngine.getResumeInfo(state).resumeIndex;
    return 0;
  }

  private resolveExecutionRange(
    state: PipelineState,
    options: PipelineOptions,
  ): { startIndex: number; stopIndex: number } {
    const scope = options.scope;

    if (!scope) {
      const startIndex = this.resolveDefaultStartIndex(state, options);
      const stopAfter = MODE_STOP_AFTER[options.mode ?? "full"];
      const stopIndex = PIPELINE_ORDER.indexOf(stopAfter);
      return { startIndex, stopIndex };
    }

    // only は from + to のショートカット
    const from = scope.only ?? scope.from;
    const to = scope.only ?? scope.to;

    // バリデーション: from > to は不正
    if (from && to) {
      const fromOrd = STAGE_NAME_ORDER.indexOf(from);
      const toOrd = STAGE_NAME_ORDER.indexOf(to);
      if (fromOrd > toOrd) {
        throw new PipelineError(
          `Invalid scope: "${from}" is after "${to}" in the pipeline order`,
        );
      }
    }

    const startIndex = from
      ? PIPELINE_ORDER.indexOf(STAGE_NAME_MAP[from].work)
      : this.resolveDefaultStartIndex(state, options);

    const stopIndex = to
      ? PIPELINE_ORDER.indexOf(STAGE_NAME_MAP[to].gate)
      : PIPELINE_ORDER.length - 1;

    return { startIndex, stopIndex };
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
    "critical_found",
    "major_exceeded",
    "quorum_not_met",
  ]);

  private toGateFailReason(reason: string | undefined): GateFailReason {
    if (reason && PipelineEngine.VALID_GATE_FAIL_REASONS.has(reason)) {
      return reason as GateFailReason;
    }
    if (reason) {
      console.error(`[autospec] Unknown gate fail reason "${reason}", defaulting to "critical_found"`);
    }
    return "critical_found";
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

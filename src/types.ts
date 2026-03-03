export type StageId =
  | "stage_1_spec"
  | "contract_review_gate"
  | "stage_2_test"
  | "test_review_gate"
  | "stage_3_implement"
  | "code_review_gate"
  | "stage_4_docs"
  | "doc_review_gate";

export type StageStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "skipped"
  | "partial"
  | "failed";

export type GateStatus = "pending" | "passed" | "failed";

export interface GateCounts {
  critical: number;
  major: number;
  minor: number;
}

export interface Finding {
  severity: "critical" | "major" | "minor";
  target: string;
  field: string;
  impl_file?: string;
  message: string;
  suggestion?: string;
  disposition?: "false_positive" | "wont_fix" | "downgraded" | "deferred" | null;
  disposition_reason?: string | null;
  deferred_to?: string | null;
  original_severity?: string | null;
}

export interface ReviewOutput {
  reviewer: string;
  gate: "contract" | "test" | "code" | "doc";
  findings: Finding[];
  summary: GateCounts;
}

export interface StageState {
  status: StageStatus;
  started_at?: string;
  completed_at?: string;
}

export interface GateState {
  status: GateStatus;
  cycles: number;
  final_counts: GateCounts;
  findings?: Finding[];
}

export interface ImplementStageState extends StageState {
  blocked: Array<{
    contract_id: string;
    reason: string;
    detail: string;
  }>;
  plan_approval?: "accepted" | "modified" | null;
  final_approval?: "accepted" | "modified" | null;
}

export interface SmartSkipState {
  contracts_hash?: string;
  config_hash?: string;
  prompts_version?: string;
}

export interface PipelineState {
  pipeline_version: string;
  project_root: string;
  started_at: string;
  completed_at?: string;
  final_status: "pending" | "completed" | "aborted";

  smart_skip: SmartSkipState;
  stages: {
    stage_1_spec: StageState;
    contract_review_gate: GateState;
    stage_2_test: StageState;
    test_review_gate: GateState;
    stage_3_implement: ImplementStageState;
    code_review_gate: GateState;
    stage_4_docs: StageState;
    doc_review_gate: GateState;
  };
}

export type PipelineMode = "spec" | "tdd" | "full";

/** ユーザーフレンドリーなステージ名（作業ステージ + ゲートのペア） */
export type StageName = "spec" | "test" | "implement" | "docs";

/** 部分実行スコープ */
export interface PipelineScope {
  /** 単一ステージのみ実行（from + to のショートカット） */
  only?: StageName;
  /** 指定ステージから実行開始 */
  from?: StageName;
  /** 指定ステージ（のゲート含む）で実行停止 */
  to?: StageName;
}

export interface PipelineOptions {
  cwd: string;
  resume: boolean;
  force: boolean;
  mode?: PipelineMode;
  /** 部分実行スコープ（only/from/to） - mode より優先 */
  scope?: PipelineScope;
  /** 指定ステージから強制開始（resume 時に特定ゲートから再実行する場合） */
  startFromStage?: StageId;
  onStageStart?: (stageId: StageId) => void;
  onStageComplete?: (stageId: StageId, result: StageResult) => void;
}

export interface StageResult {
  status: StageStatus | GateStatus;
  counts?: GateCounts;
  findings?: Finding[];
  reason?: string;
}

export type StageHandler = (
  state: PipelineState,
  options: PipelineOptions,
) => Promise<StageResult>;

export type GateFailReason = "critical_found" | "major_exceeded" | "quorum_not_met";

export interface GateResult {
  status: "passed" | "failed";
  counts: GateCounts;
  findings: Finding[];
  reason?: GateFailReason;
}

export type QueryFn = (prompt: string) => Promise<string>;

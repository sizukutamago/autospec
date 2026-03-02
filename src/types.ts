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
  p0: number;
  p1: number;
  p2: number;
}

export interface Finding {
  severity: "P0" | "P1" | "P2";
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

export interface PipelineOptions {
  cwd: string;
  resume: boolean;
  force: boolean;
  mode?: PipelineMode;
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

export interface GateResult {
  status: "passed" | "failed";
  counts: GateCounts;
  findings: Finding[];
  reason?: "p0_found" | "p1_exceeded" | "quorum_not_met";
}

export type QueryFn = (prompt: string) => Promise<string>;

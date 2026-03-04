// Engine
export { PipelineEngine, PIPELINE_ORDER, STAGE_NAME_MAP } from "./engine.js";
export type { ResumeInfo } from "./engine.js";
export { createInitialState, loadState, saveState, getStatePath } from "./state.js";
export {
  PipelineError,
  GateFailedError,
  StateLoadError,
  StructuredOutputError,
} from "./errors.js";

// Gates
export { runReviewGate } from "./gates/review-gate.js";
export type { ReviewerFn, ReviewGateOptions } from "./gates/review-gate.js";
export { runReviseLoop } from "./gates/revise.js";
export type { ReviseLoopOptions } from "./gates/revise.js";
export { normalizeKey, deduplicateFindings } from "./gates/normalize.js";
export { countFindings, evaluateGatePolicy } from "./gates/evaluate.js";
export { FindingSchema, ReviewOutputSchema, parseReviewOutput } from "./gates/schemas.js";

// Stage handlers
export { createSpecHandler } from "./stages/spec.js";
export { createTestGenHandler } from "./stages/test-gen.js";
export type { TestGenHandlerOptions } from "./stages/test-gen.js";
export { createImplementHandler } from "./stages/implement.js";
export type { ImplementHandlerOptions } from "./stages/implement.js";
export { createDocsHandler } from "./stages/docs.js";
export type { DocsHandlerOptions } from "./stages/docs.js";

// Presets (one-call pipeline setup)
export { createDefaultPipeline } from "./presets.js";
export type { DefaultPipelineOptions } from "./presets.js";

// Built-in gates
export { createNoopGateHandler } from "./gates/noop-gate.js";

// Query utility
export { claudeQuery, claudeQueryStructured } from "./query.js";
export type { ClaudeQueryOptions, OutputFormat, ClaudeQueryResult } from "./query.js";

// Interactive mode
export { runConversationLoop } from "./interactive/conversation.js";
export type { ConversationDeps } from "./interactive/conversation.js";
export { buildSummaryPrompt, generateTaskDescription } from "./interactive/summary.js";
export type { ConversationEntry } from "./interactive/summary.js";
export { parseCommand } from "./interactive/commands.js";
export type { CommandType, ParsedCommand } from "./interactive/commands.js";

// Types
export type {
  StageId,
  StageName,
  StageStatus,
  GateStatus,
  GateCounts,
  Finding,
  ReviewOutput,
  StageState,
  GateState,
  ImplementStageState,
  SmartSkipState,
  PipelineState,
  PipelineMode,
  PipelineScope,
  PipelineOptions,
  StageResult,
  StageHandler,
  GateFailReason,
  GateResult,
  QueryFn,
  GateFailureAction,
  BlockedGuardAction,
  StageErrorAction,
} from "./types.js";

// Agents
export { runParallel } from "./agents/parallel-runner.js";
export type { ParallelTask, ParallelResult } from "./agents/parallel-runner.js";
export { generateFollowUpQuestion } from "./agents/interviewer.js";
export type { QuestionResult, InterviewOptions } from "./agents/interviewer.js";

// Config
export { loadConfig } from "./config/loader.js";
export { DEFAULT_CONFIG, } from "./config/defaults.js";
export { AutospecConfigSchema } from "./config/schema.js";
export type { AutospecConfig } from "./config/schema.js";
export { loadPromptFile, getPromptsDir, loadCustomPrompts, loadCustomPromptFiles } from "./config/prompt-loader.js";
export type { CustomPromptFile } from "./config/prompt-loader.js";

// Contracts
export { discoverContracts } from "./contracts/discovery.js";
export type { ContractMeta } from "./contracts/discovery.js";
export { topoSort, splitIntoChunks, CyclicDependencyError } from "./contracts/topo-sort.js";
export type { TopoGroup } from "./contracts/topo-sort.js";

// Review Gate Handler
export { createReviewGateHandler } from "./gates/review-gate-handler.js";
export type { ReviewGateHandlerOptions } from "./gates/review-gate-handler.js";

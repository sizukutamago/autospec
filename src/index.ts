// Engine
export { PipelineEngine } from "./engine.js";
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
export { createImplementHandler } from "./stages/implement.js";
export { createDocsHandler } from "./stages/docs.js";

// Presets (one-call pipeline setup)
export { createDefaultPipeline } from "./presets.js";
export type { DefaultPipelineOptions } from "./presets.js";

// Built-in gates
export { createNoopGateHandler } from "./gates/noop-gate.js";

// Query utility
export { claudeQuery } from "./query.js";
export type { ClaudeQueryOptions } from "./query.js";

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
  PipelineOptions,
  StageResult,
  StageHandler,
  GateResult,
  QueryFn,
} from "./types.js";

// Agents
export { runParallel } from "./agents/parallel-runner.js";
export type { ParallelTask, ParallelResult } from "./agents/parallel-runner.js";
export { runResearcher } from "./agents/researcher.js";
export { runWebResearcher } from "./agents/web-researcher.js";
export { generateFollowUpQuestion } from "./agents/interviewer.js";
export type { QuestionResult, ResearchTarget } from "./agents/interviewer.js";

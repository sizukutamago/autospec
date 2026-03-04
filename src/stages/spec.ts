import type { StageHandler, StageResult, QueryFn } from "../types.js";
import { toErrorMessage } from "../utils/to-error-message.js";
import { loadPromptFile, loadCustomPrompts } from "../config/prompt-loader.js";

export interface SpecHandlerOptions {
  queryFn: QueryFn;
}

export function createSpecHandler(options: SpecHandlerOptions): StageHandler {
  return async (state, _pipelineOptions): Promise<StageResult> => {
    const projectRoot = state.project_root;

    // Plugin コア仕様をプロンプトに埋め込む
    const contractSchema = loadPromptFile("core/contract-schema.md", projectRoot);
    const specWorkflow = loadPromptFile("core/spec-workflow.md", projectRoot);
    const autospecStructure = loadPromptFile("core/autospec-structure.md", projectRoot);
    const idSystem = loadPromptFile("core/id-system.md", projectRoot);

    const prompt = `You are working on the project at ${projectRoot}.

## CRITICAL: Autonomous Execution Mode

This is an automated, non-interactive pipeline execution. You MUST:
1. Read CLAUDE.md for project requirements and conventions.
2. Read the project structure and source code to understand the architecture autonomously.
3. Make ALL design decisions yourself based on the project context — do NOT ask questions.
4. Generate ALL contract YAML files by writing them to disk using the Write tool.
5. Cover ALL visible functionality in the project comprehensively.
6. Do NOT output text asking for clarification. Proceed with your best judgment.

Skip the interactive steps in the workflow (scope confirmation, brainstorming dialogue, user approval).
Instead, analyze the project, determine the contracts needed, and write them directly.

## Workflow Reference
${specWorkflow}

## Contract YAML Schema
${contractSchema}

## .autospec/ Directory Structure
${autospecStructure}

## ID System
${idSystem}

Generate YAML contracts in .autospec/contracts/ following the schema above.
Organize contracts by type: api/, external/, files/, internal/.
Also generate concepts/ and decisions/ as needed.

REMINDER: You MUST write actual .contract.yaml files to disk. Do not just describe them in text.${loadCustomPrompts("spec", projectRoot)}`;

    try {
      await options.queryFn(prompt);
      return { status: "completed" };
    } catch (err) {
      const message = toErrorMessage(err);
      return { status: "failed", reason: message };
    }
  };
}

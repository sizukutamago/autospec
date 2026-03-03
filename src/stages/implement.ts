import type { StageHandler, StageResult, QueryFn } from "../types.js";
import { toErrorMessage } from "../utils/to-error-message.js";
import { loadPromptFile } from "../config/prompt-loader.js";
import { loadConfig } from "../config/loader.js";

export interface ImplementHandlerOptions {
  queryFn: QueryFn;
}

export function createImplementHandler(options: ImplementHandlerOptions): StageHandler {
  return async (state, _pipelineOptions): Promise<StageResult> => {
    const projectRoot = state.project_root;

    const implWorkflow = loadPromptFile("core/implement-workflow.md", projectRoot);
    const naming = loadPromptFile("defaults/naming.md", projectRoot);
    const errorHandling = loadPromptFile("defaults/error-handling.md", projectRoot);
    const di = loadPromptFile("defaults/di.md", projectRoot);
    const validationPatterns = loadPromptFile("defaults/validation-patterns.md", projectRoot);

    // autospec.yaml からアーキテクチャパターンを取得
    const config = loadConfig(projectRoot);
    const archPattern = config.architecture.pattern;
    const archDoc = loadPromptFile(`defaults/architecture/${archPattern}.md`, projectRoot);

    const prompt = `You are working on the project at ${projectRoot}.
Read CLAUDE.md for project requirements and conventions.
Read .autospec/contracts/ for YAML contract specifications.
Read tests/ for test expectations.

## Implementation Workflow
${implWorkflow}

## Architecture Pattern: ${archPattern}
${archDoc}

## Naming Conventions
${naming}

## Error Handling
${errorHandling}

## Dependency Injection
${di}

## Validation Patterns
${validationPatterns}

Implement ALL code to satisfy the contracts and pass the tests.
This includes backend, frontend (HTML/CSS/JS), and any static assets.
Function signatures and types MUST match the contracts exactly.
Add WebSocket error handlers, use window.location for WS URLs, wrap JSON.parse in try-catch.`;

    // resume 時の重複防止
    state.stages.stage_3_implement.blocked = [];

    try {
      await options.queryFn(prompt);
      return { status: "completed" };
    } catch (err) {
      const message = toErrorMessage(err);
      state.stages.stage_3_implement.blocked.push({
        contract_id: "implementation",
        reason: "implementation_failed",
        detail: message,
      });
      return { status: "failed", reason: message };
    }
  };
}

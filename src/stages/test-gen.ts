import type { StageHandler, StageResult, QueryFn } from "../types.js";
import { toErrorMessage } from "../utils/to-error-message.js";
import { loadPromptFile } from "../config/prompt-loader.js";

export interface TestGenHandlerOptions {
  queryFn: QueryFn;
}

export function createTestGenHandler(options: TestGenHandlerOptions): StageHandler {
  return async (state, _pipelineOptions): Promise<StageResult> => {
    const projectRoot = state.project_root;

    const testRules = loadPromptFile("core/test-generation-rules.md", projectRoot);
    const testRulesDetail = loadPromptFile("core/test-generation-rules-detail.md", projectRoot);
    const testingDefaults = loadPromptFile("defaults/testing.md", projectRoot);

    const prompt = `You are working on the project at ${projectRoot}.
Read CLAUDE.md for project requirements and conventions.
Read the .autospec/contracts/ directory for YAML contract specifications.

## Test Generation Rules
${testRules}

## Test Generation Rules (Detail)
${testRulesDetail}

## Testing Defaults
${testingDefaults}

Generate tests based on the contracts:
- Level 1: Structure validation tests (should pass immediately)
- Level 2: Implementation verification tests (RED stubs with AAA skeleton)
- Include @generated and @contract traceability comments
- Use concrete assertions (exact values, not just toBeGreaterThan(0))
- Avoid conditional assertions that silently pass`;

    try {
      await options.queryFn(prompt);
      return { status: "completed" };
    } catch (err) {
      const message = toErrorMessage(err);
      return { status: "failed", reason: message };
    }
  };
}

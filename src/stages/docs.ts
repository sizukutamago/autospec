import type { StageHandler, StageResult, QueryFn } from "../types.js";
import { toErrorMessage } from "../utils/to-error-message.js";
import { loadPromptFile } from "../config/prompt-loader.js";

export interface DocsHandlerOptions {
  queryFn: QueryFn;
}

export function createDocsHandler(options: DocsHandlerOptions): StageHandler {
  return async (state, _pipelineOptions): Promise<StageResult> => {
    const projectRoot = state.project_root;

    const docsWorkflow = loadPromptFile("core/docs-workflow.md", projectRoot);

    const prompt = `You are working on the project at ${projectRoot}.

## CRITICAL: Autonomous Execution Mode

This is an automated, non-interactive pipeline execution. You MUST:
1. Read the project source code, contracts, and tests autonomously.
2. Make ALL decisions yourself — do NOT ask questions or wait for user input.
3. Write ALL documentation files to disk using the Write tool.
4. Skip interactive steps (user confirmation, supplementary input).
5. For sections requiring user input, use your best judgment or mark as TODO.

Read CLAUDE.md for project requirements and conventions.
Read .autospec/contracts/, src/, and tests/.

## Documentation Workflow
${docsWorkflow}

Generate documentation in docs/ and update README.md.
Include architecture overview, API reference, and getting started guide.

REMINDER: You MUST write actual files to disk. Do not just describe them in text.`;

    try {
      await options.queryFn(prompt);
      return { status: "completed" };
    } catch (err) {
      const message = toErrorMessage(err);
      return { status: "failed", reason: message };
    }
  };
}

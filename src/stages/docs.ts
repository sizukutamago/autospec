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
Read CLAUDE.md for project requirements and conventions.
Read .autospec/contracts/, src/, and tests/.

## Documentation Workflow
${docsWorkflow}

Generate documentation in docs/ and update README.md.
Include architecture overview, API reference, and getting started guide.`;

    try {
      await options.queryFn(prompt);
      return { status: "completed" };
    } catch (err) {
      const message = toErrorMessage(err);
      return { status: "failed", reason: message };
    }
  };
}

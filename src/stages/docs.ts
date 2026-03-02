import type { StageHandler, StageResult, QueryFn } from "../types.js";
import { toErrorMessage } from "../utils/to-error-message.js";

export interface DocsHandlerOptions {
  queryFn: QueryFn;
}

export function createDocsHandler(options: DocsHandlerOptions): StageHandler {
  return async (state, _pipelineOptions): Promise<StageResult> => {
    const prompt = `You are working on the project at ${state.project_root}.
Read CLAUDE.md for project requirements and conventions.
Read the contracts/ directory, src/ directory, and tests/ directory.

Generate documentation in a docs/ directory:
- Architecture overview
- API reference
- Getting started guide
- Any protocol documentation if applicable

Also update README.md with project overview, setup instructions, and usage.`;

    try {
      await options.queryFn(prompt);
      return { status: "completed" };
    } catch (err) {
      const message = toErrorMessage(err);
      return { status: "failed", reason: message };
    }
  };
}

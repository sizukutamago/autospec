import type { StageHandler, StageResult, QueryFn } from "../types.js";
import { toErrorMessage } from "../utils/to-error-message.js";
import { loadPromptFile, loadCustomPrompts } from "../config/prompt-loader.js";
import { runParallel } from "../agents/parallel-runner.js";

export interface DocsHandlerOptions {
  queryFn: QueryFn;
  subQueryFnFactory?: (agentIndex: number) => QueryFn;
}

function buildGroupAPrompt(projectRoot: string, customPrompts: string): string {
  const docsWorkflow = loadPromptFile("core/docs-workflow.md", projectRoot);

  return `You are Group A docs agent working on the project at ${projectRoot}.

## CRITICAL: Autonomous Execution Mode

This is an automated, non-interactive pipeline execution. You MUST:
1. Read the project source code, contracts, and tests autonomously.
2. Make ALL decisions yourself — do NOT ask questions or wait for user input.
3. Write ALL documentation files to disk using the Write tool.

Read CLAUDE.md for project requirements and conventions.
Read .autospec/contracts/, src/, and tests/.

## Group A — Code-derived documentation

Generate these documentation files:
- Architecture overview (docs/architecture.md)
- API reference (docs/api-reference.md)
- Module documentation (docs/modules/)
- Code examples and usage patterns
- Type definitions and interfaces
- Error handling reference

## Documentation Workflow
${docsWorkflow}

REMINDER: You MUST write actual files to disk.${customPrompts}`;
}

function buildGroupBPrompt(projectRoot: string, customPrompts: string): string {
  const docsWorkflow = loadPromptFile("core/docs-workflow.md", projectRoot);

  return `You are Group B docs agent working on the project at ${projectRoot}.

## CRITICAL: Autonomous Execution Mode

This is an automated, non-interactive pipeline execution. You MUST:
1. Read the project source code, contracts, and tests autonomously.
2. Make ALL decisions yourself — do NOT ask questions or wait for user input.
3. Write ALL documentation files to disk using the Write tool.

Read CLAUDE.md for project requirements and conventions.
Read .autospec/contracts/, src/, and tests/.

## Group B — Config and setup documentation

Generate these documentation files:
- Getting started guide (docs/getting-started.md)
- Configuration reference (docs/configuration.md)
- Installation guide (docs/installation.md)
- Environment setup (docs/environment.md)
- Deployment guide (docs/deployment.md)
- Troubleshooting (docs/troubleshooting.md)
- Contributing guide (docs/contributing.md)
- Changelog template (docs/changelog.md)

## Documentation Workflow
${docsWorkflow}

REMINDER: You MUST write actual files to disk.${customPrompts}`;
}

function buildIntegrationPrompt(projectRoot: string, customPrompts: string): string {
  return `You are the Integration docs agent working on the project at ${projectRoot}.

## CRITICAL: Autonomous Execution Mode

This is an automated, non-interactive pipeline execution. You MUST:
1. Read all generated documentation in docs/.
2. Make ALL decisions yourself — do NOT ask questions.
3. Write ALL documentation files to disk using the Write tool.

Read CLAUDE.md for project requirements and conventions.

## Role: Integration

Multiple documentation agents have generated docs in parallel.
Your job is to:
1. Update README.md with a comprehensive project overview
2. Ensure cross-references between docs are correct
3. Add a table of contents and navigation
4. Verify traceability between contracts and documentation
5. Fix any inconsistencies or duplications

REMINDER: You MUST write actual files to disk.${customPrompts}`;
}

export function createDocsHandler(options: DocsHandlerOptions): StageHandler {
  return async (state, _pipelineOptions): Promise<StageResult> => {
    const projectRoot = state.project_root;
    const customPrompts = loadCustomPrompts("docs", projectRoot);
    const { subQueryFnFactory } = options;

    // 並列実行
    if (subQueryFnFactory) {
      const groupAQueryFn = subQueryFnFactory(0);
      const groupBQueryFn = subQueryFnFactory(1);

      const groupTasks = [
        {
          name: "docs-group-a",
          fn: () => groupAQueryFn(buildGroupAPrompt(projectRoot, customPrompts)),
        },
        {
          name: "docs-group-b",
          fn: () => groupBQueryFn(buildGroupBPrompt(projectRoot, customPrompts)),
        },
      ];

      const results = await runParallel(groupTasks);
      const failures = results.filter((r) => r.error);

      if (failures.length === results.length) {
        return {
          status: "failed",
          reason: `All docs groups failed: ${failures.map((f) => f.error).join("; ")}`,
        };
      }

      // Integration phase
      const integrationQueryFn = subQueryFnFactory(2);
      try {
        await integrationQueryFn(buildIntegrationPrompt(projectRoot, customPrompts));
      } catch {
        // Integration failure is non-fatal if groups succeeded
      }

      return { status: "completed" };
    }

    // 単一エージェントフォールバック
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

REMINDER: You MUST write actual files to disk. Do not just describe them in text.${customPrompts}`;

    try {
      await options.queryFn(prompt);
      return { status: "completed" };
    } catch (err) {
      const message = toErrorMessage(err);
      return { status: "failed", reason: message };
    }
  };
}

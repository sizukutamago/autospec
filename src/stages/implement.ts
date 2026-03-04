import type { StageHandler, StageResult, QueryFn } from "../types.js";
import { toErrorMessage } from "../utils/to-error-message.js";
import { loadPromptFile, loadCustomPrompts } from "../config/prompt-loader.js";
import { loadConfig } from "../config/loader.js";
import { discoverContracts } from "../contracts/discovery.js";
import { topoSort, CyclicDependencyError } from "../contracts/topo-sort.js";
import { runParallel } from "../agents/parallel-runner.js";

export interface ImplementHandlerOptions {
  queryFn: QueryFn;
  subQueryFnFactory?: (agentIndex: number) => QueryFn;
}

function loadBasePrompts(projectRoot: string, archPattern: string) {
  return {
    implWorkflow: loadPromptFile("core/implement-workflow.md", projectRoot),
    naming: loadPromptFile("defaults/naming.md", projectRoot),
    errorHandling: loadPromptFile("defaults/error-handling.md", projectRoot),
    di: loadPromptFile("defaults/di.md", projectRoot),
    validationPatterns: loadPromptFile("defaults/validation-patterns.md", projectRoot),
    archDoc: loadPromptFile(`defaults/architecture/${archPattern}.md`, projectRoot),
    customPrompts: loadCustomPrompts("implement", projectRoot),
  };
}

function buildImplementerPrompt(
  projectRoot: string,
  archPattern: string,
  contractIds: string[],
  agentIndex: number,
  totalAgents: number,
): string {
  const base = loadBasePrompts(projectRoot, archPattern);

  return `You are Implementer Agent #${agentIndex + 1} of ${totalAgents} working on the project at ${projectRoot}.
Read CLAUDE.md for project requirements and conventions.
Read .autospec/contracts/ for YAML contract specifications.
Read tests/ for test expectations.

## YOUR SCOPE — ONLY these contracts

You are responsible for implementing ONLY these contracts: ${contractIds.join(", ")}
Do NOT implement code for other contracts.

## Implementation Workflow
${base.implWorkflow}

## Architecture Pattern: ${archPattern}
${base.archDoc}

## Naming Conventions
${base.naming}

## Error Handling
${base.errorHandling}

## Dependency Injection
${base.di}

## Validation Patterns
${base.validationPatterns}

Implement code to satisfy your assigned contracts and pass their tests.
Function signatures and types MUST match the contracts exactly.${base.customPrompts}`;
}

function buildIntegratorPrompt(projectRoot: string, archPattern: string): string {
  const base = loadBasePrompts(projectRoot, archPattern);

  return `You are the Integrator Agent working on the project at ${projectRoot}.
Read CLAUDE.md for project requirements and conventions.

## Role: Integrator

Multiple implementer agents have written code for individual contracts.
Your job is to:
1. Resolve any conflicts between implementations
2. Ensure all modules integrate correctly
3. Run the full test suite and fix any failures
4. Verify that all contracts are satisfied

## Architecture Pattern: ${archPattern}
${base.archDoc}

## Naming Conventions
${base.naming}

## Error Handling
${base.errorHandling}

Run tests, fix integration issues, and ensure all tests pass.${base.customPrompts}`;
}

function buildRefactorerPrompt(projectRoot: string, archPattern: string): string {
  const base = loadBasePrompts(projectRoot, archPattern);

  return `You are the Refactorer Agent working on the project at ${projectRoot}.
Read CLAUDE.md for project requirements and conventions.

## Role: Refactorer

Implementation and integration are complete. Your job is to:
1. Improve code quality (DRY, naming, structure)
2. Remove dead code and unnecessary complexity
3. Ensure consistent style across all modules
4. Run tests after each change to ensure nothing breaks

## Architecture Pattern: ${archPattern}
${base.archDoc}

Do NOT change public interfaces or break tests.${base.customPrompts}`;
}

function buildSingleAgentPrompt(projectRoot: string, archPattern: string): string {
  const base = loadBasePrompts(projectRoot, archPattern);

  return `You are working on the project at ${projectRoot}.
Read CLAUDE.md for project requirements and conventions.
Read .autospec/contracts/ for YAML contract specifications.
Read tests/ for test expectations.

## Implementation Workflow
${base.implWorkflow}

## Architecture Pattern: ${archPattern}
${base.archDoc}

## Naming Conventions
${base.naming}

## Error Handling
${base.errorHandling}

## Dependency Injection
${base.di}

## Validation Patterns
${base.validationPatterns}

Implement ALL code to satisfy the contracts and pass the tests.
This includes backend, frontend (HTML/CSS/JS), and any static assets.
Function signatures and types MUST match the contracts exactly.
Add WebSocket error handlers, use window.location for WS URLs, wrap JSON.parse in try-catch.${base.customPrompts}`;
}

export function createImplementHandler(options: ImplementHandlerOptions): StageHandler {
  return async (state, _pipelineOptions): Promise<StageResult> => {
    const projectRoot = state.project_root;
    const config = loadConfig(projectRoot);
    const archPattern = config.architecture.pattern;
    const { subQueryFnFactory } = options;

    // resume 時の重複防止
    state.stages.stage_3_implement.blocked = [];

    // 並列実行の条件チェック
    if (subQueryFnFactory) {
      const contracts = discoverContracts(projectRoot);

      if (contracts.length > 1) {
        let groups;
        try {
          groups = topoSort(contracts);
        } catch (err) {
          if (err instanceof CyclicDependencyError) {
            state.stages.stage_3_implement.blocked.push({
              contract_id: "all",
              reason: "cyclic_dependency",
              detail: err.message,
            });
            return { status: "failed", reason: err.message };
          }
          throw err;
        }

        const configAgents = config.agents.parallel.implement_agents;
        let agentIndex = 0;

        // --- Phase A: Implementers (level by level) ---
        let allFailed = true;
        for (const group of groups) {
          const agentCount = configAgents > 0
            ? Math.min(configAgents, group.contractIds.length)
            : group.contractIds.length;

          const tasks = group.contractIds.map((id) => {
            const idx = agentIndex++;
            const subQueryFn = subQueryFnFactory(idx);
            const prompt = buildImplementerPrompt(
              projectRoot, archPattern, [id], idx, agentCount,
            );
            return {
              name: `implementer-${id}`,
              fn: () => subQueryFn(prompt),
            };
          });

          const results = await runParallel(tasks);

          for (const r of results) {
            if (r.error) {
              state.stages.stage_3_implement.blocked.push({
                contract_id: r.name.replace("implementer-", ""),
                reason: "implementation_failed",
                detail: r.error,
              });
            } else {
              allFailed = false;
            }
          }
        }

        if (allFailed) {
          return {
            status: "failed",
            reason: "All implementer agents failed",
          };
        }

        // --- Phase B: Integrator (1 agent) ---
        const integratorQueryFn = subQueryFnFactory(agentIndex++);
        const integratorPrompt = buildIntegratorPrompt(projectRoot, archPattern);
        try {
          await integratorQueryFn(integratorPrompt);
        } catch (err) {
          state.stages.stage_3_implement.blocked.push({
            contract_id: "integration",
            reason: "integration_failed",
            detail: toErrorMessage(err),
          });
        }

        // --- Phase C: Refactorer (1 agent, non-fatal) ---
        const refactorerQueryFn = subQueryFnFactory(agentIndex++);
        const refactorerPrompt = buildRefactorerPrompt(projectRoot, archPattern);
        try {
          await refactorerQueryFn(refactorerPrompt);
        } catch {
          // Phase C failure is non-fatal
        }

        return { status: "completed" };
      }
    }

    // 単一エージェントフォールバック
    const prompt = buildSingleAgentPrompt(projectRoot, archPattern);

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

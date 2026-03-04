import type { StageHandler, StageResult, QueryFn } from "../types.js";
import { toErrorMessage } from "../utils/to-error-message.js";
import { loadPromptFile, loadCustomPrompts } from "../config/prompt-loader.js";
import { loadConfig } from "../config/loader.js";
import { discoverContracts } from "../contracts/discovery.js";
import { splitIntoChunks } from "../contracts/topo-sort.js";
import { runParallel } from "../agents/parallel-runner.js";

export interface TestGenHandlerOptions {
  queryFn: QueryFn;
  subQueryFnFactory?: (agentIndex: number) => QueryFn;
}

function buildBasePromptParts(projectRoot: string) {
  return {
    testRules: loadPromptFile("core/test-generation-rules.md", projectRoot),
    testRulesDetail: loadPromptFile("core/test-generation-rules-detail.md", projectRoot),
    testingDefaults: loadPromptFile("defaults/testing.md", projectRoot),
    customPrompts: loadCustomPrompts("test", projectRoot),
  };
}

function buildPrompt(projectRoot: string, scopeSection: string): string {
  const { testRules, testRulesDetail, testingDefaults, customPrompts } =
    buildBasePromptParts(projectRoot);

  return `You are working on the project at ${projectRoot}.
Read CLAUDE.md for project requirements and conventions.
Read the .autospec/contracts/ directory for YAML contract specifications.
${scopeSection}
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
- Avoid conditional assertions that silently pass${customPrompts}`;
}

export function createTestGenHandler(options: TestGenHandlerOptions): StageHandler {
  return async (state, _pipelineOptions): Promise<StageResult> => {
    const projectRoot = state.project_root;
    const { subQueryFnFactory } = options;

    // 並列実行の条件チェック
    if (subQueryFnFactory) {
      const contracts = discoverContracts(projectRoot);
      const config = loadConfig(projectRoot);
      const configAgents = config.agents.parallel.test_agents;

      if (contracts.length > 1) {
        const agentCount = configAgents > 0
          ? Math.min(configAgents, contracts.length)
          : Math.min(contracts.length, 5);

        const contractIds = contracts.map((c) => c.id);
        const chunks = splitIntoChunks(contractIds, agentCount);

        const tasks = chunks.map((chunk, i) => {
          const scopeSection = `\n## YOUR SCOPE — ONLY these contracts\n\nYou are sub-agent #${i + 1} of ${chunks.length}.\nOnly generate tests for these contracts: ${chunk.join(", ")}\nDo NOT generate tests for other contracts.\n`;
          const prompt = buildPrompt(projectRoot, scopeSection);
          const subQueryFn = subQueryFnFactory(i);

          return {
            name: `test-agent-${i}`,
            fn: () => subQueryFn(prompt),
          };
        });

        const results = await runParallel(tasks);
        const failures = results.filter((r) => r.error);

        if (failures.length === results.length) {
          return {
            status: "failed",
            reason: `All ${failures.length} test agents failed: ${failures.map((f) => f.error).join("; ")}`,
          };
        }

        return { status: "completed" };
      }
    }

    // 単一エージェントフォールバック
    const prompt = buildPrompt(projectRoot, "");

    try {
      await options.queryFn(prompt);
      return { status: "completed" };
    } catch (err) {
      const message = toErrorMessage(err);
      return { status: "failed", reason: message };
    }
  };
}

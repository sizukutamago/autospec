import type { StageHandler, StageResult, QueryFn } from "../types.js";
import { toErrorMessage } from "../utils/to-error-message.js";

export interface TestGenHandlerOptions {
  queryFn: QueryFn;
}

export function createTestGenHandler(options: TestGenHandlerOptions): StageHandler {
  return async (state, _pipelineOptions): Promise<StageResult> => {
    const prompt = `You are working on the project at ${state.project_root}.
Read CLAUDE.md for project requirements and conventions.
Read the contracts/ directory for design specifications.

Generate comprehensive tests in a tests/ directory based on the contracts.
- Unit tests for ALL pure functions and modules (game logic, utilities)
- Server/API tests: test WebSocket message handling, room management, session lifecycle
- Integration tests for server/client interaction where applicable
- Use the test framework specified in CLAUDE.md (or vitest by default)
- Tests should be runnable with \`npm run test\`
- Cover edge cases, error paths, and boundary conditions
- Use concrete assertions (exact values, not just \`toBeGreaterThan(0)\`)
- Avoid conditional assertions that silently pass (no \`if (result) expect(...)\` patterns)`;

    try {
      await options.queryFn(prompt);
      return { status: "completed" };
    } catch (err) {
      const message = toErrorMessage(err);
      return { status: "failed", reason: message };
    }
  };
}

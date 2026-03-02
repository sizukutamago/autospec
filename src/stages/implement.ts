import type { StageHandler, StageResult, QueryFn } from "../types.js";
import { toErrorMessage } from "../utils/to-error-message.js";

export interface ImplementHandlerOptions {
  queryFn: QueryFn;
}

export function createImplementHandler(options: ImplementHandlerOptions): StageHandler {
  return async (state, _pipelineOptions): Promise<StageResult> => {
    const prompt = `You are working on the project at ${state.project_root}.
Read CLAUDE.md for project requirements and conventions.
Read the contracts/ directory for design specifications.
Read the tests/ directory for test expectations.

Implement ALL code to satisfy the contracts and pass the tests.
This includes:
- Backend/server code
- Frontend/client code (HTML, CSS, JavaScript) if specified in CLAUDE.md
- Any static assets (images, fonts, etc.) if needed
- Configuration files if needed

IMPORTANT requirements:
- Generate ALL files mentioned in CLAUDE.md and contracts, including client-side code
- Function signatures, types, and interfaces MUST match the contracts exactly
- Add WebSocket error event handlers (ws.on("error", ...)) on both server and client
- Client WebSocket URL should use \`window.location\` instead of hardcoded localhost
- Wrap JSON.parse calls in try-catch for robustness
- Make sure the tests pass with \`npm run test\``;

    // resume 時の重複防止: 前回の blocked をクリア
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

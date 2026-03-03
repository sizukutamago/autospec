import type { StageHandler, StageResult } from "../types.js";

export function createNoopGateHandler(): StageHandler {
  return async (): Promise<StageResult> => {
    return {
      status: "passed",
      counts: { critical: 0, major: 0, minor: 0 },
      findings: [],
    };
  };
}

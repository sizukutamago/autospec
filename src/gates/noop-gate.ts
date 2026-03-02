import type { StageHandler, StageResult } from "../types.js";

export function createNoopGateHandler(): StageHandler {
  return async (): Promise<StageResult> => {
    return {
      status: "passed",
      counts: { p0: 0, p1: 0, p2: 0 },
      findings: [],
    };
  };
}

import { describe, it, expect } from "vitest";
import { createNoopGateHandler } from "../../src/gates/noop-gate.js";
import { createInitialState } from "../../src/state.js";
import type { PipelineOptions } from "../../src/types.js";

describe("createNoopGateHandler", () => {
  const options: PipelineOptions = {
    cwd: "/tmp/test",
    resume: false,
    force: false,
  };

  it("returns a function", () => {
    const handler = createNoopGateHandler();
    expect(typeof handler).toBe("function");
  });

  it('returns { status: "passed" } with zero counts', async () => {
    const handler = createNoopGateHandler();
    const state = createInitialState("/tmp/test");
    const result = await handler(state, options);

    expect(result.status).toBe("passed");
    expect(result.counts).toEqual({ critical: 0, major: 0, minor: 0 });
  });

  it("returns empty findings array", async () => {
    const handler = createNoopGateHandler();
    const state = createInitialState("/tmp/test");
    const result = await handler(state, options);

    expect(result.findings).toEqual([]);
  });

  it("does not modify state", async () => {
    const handler = createNoopGateHandler();
    const state = createInitialState("/tmp/test");
    const stateBefore = JSON.stringify(state);
    await handler(state, options);
    const stateAfter = JSON.stringify(state);

    expect(stateAfter).toBe(stateBefore);
  });
});

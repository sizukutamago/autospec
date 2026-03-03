import { afterEach, describe, expect, it, vi } from "vitest";
import { PipelineEngine } from "../../src/engine.js";
import { createInitialState, saveState } from "../../src/state.js";
import { GateFailedError, PipelineError } from "../../src/errors.js";
import type {
  StageId,
  StageHandler,
  StageResult,
  PipelineOptions,
} from "../../src/types.js";

// ---------------------------------------------------------------------------
// Mock saveState to avoid filesystem writes during tests
// ---------------------------------------------------------------------------
vi.mock("../../src/state.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/state.js")>();
  return {
    ...original,
    saveState: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PIPELINE_ORDER: StageId[] = [
  "stage_1_spec",
  "contract_review_gate",
  "stage_2_test",
  "test_review_gate",
  "stage_3_implement",
  "code_review_gate",
  "stage_4_docs",
  "doc_review_gate",
];

const DEFAULT_OPTIONS: PipelineOptions = {
  cwd: "/tmp/test",
  resume: false,
  force: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a mock handler that records call order and returns a successful result.
 */
function createMockHandler(
  callOrder: StageId[],
  stageId: StageId,
  result?: StageResult,
): StageHandler {
  const defaultResult: StageResult = stageId.endsWith("_gate")
    ? { status: "passed", counts: { critical: 0, major: 0, minor: 0 }, findings: [] }
    : { status: "completed" };

  return vi.fn(async () => {
    callOrder.push(stageId);
    return result ?? defaultResult;
  });
}

/**
 * Registers mock handlers for all 8 stages, tracking call order.
 * Optionally override individual handlers via the `overrides` map.
 */
function registerAllHandlers(
  engine: PipelineEngine,
  callOrder: StageId[],
  overrides?: Partial<Record<StageId, StageHandler>>,
): Map<StageId, StageHandler> {
  const handlers = new Map<StageId, StageHandler>();

  for (const stageId of PIPELINE_ORDER) {
    const handler =
      overrides?.[stageId] ?? createMockHandler(callOrder, stageId);
    handlers.set(stageId, handler);
    engine.register(stageId, handler);
  }

  return handlers;
}

// ===========================================================================
// PipelineEngine Integration Tests
// ===========================================================================
describe("PipelineEngine", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Runs stages in order
  // -------------------------------------------------------------------------
  describe("runs stages in order", () => {
    it("executes all 8 stages in the correct pipeline order", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      registerAllHandlers(engine, callOrder);

      await engine.run(state, DEFAULT_OPTIONS);

      expect(callOrder).toEqual([
        "stage_1_spec",
        "contract_review_gate",
        "stage_2_test",
        "test_review_gate",
        "stage_3_implement",
        "code_review_gate",
        "stage_4_docs",
        "doc_review_gate",
      ]);
    });

    it("marks final_status as completed after all stages pass", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      registerAllHandlers(engine, callOrder);

      const result = await engine.run(state, DEFAULT_OPTIONS);

      expect(result.final_status).toBe("completed");
      expect(result.completed_at).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Gate failure stops pipeline
  // -------------------------------------------------------------------------
  describe("gate failure stops pipeline", () => {
    it("throws GateFailedError when contract_review_gate returns failed status", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      const failedGateHandler: StageHandler = vi.fn(async () => {
        callOrder.push("contract_review_gate");
        return {
          status: "failed" as const,
          reason: "critical_found",
          counts: { critical: 1, major: 0, minor: 0 },
          findings: [],
        };
      });

      registerAllHandlers(engine, callOrder, {
        contract_review_gate: failedGateHandler,
      });

      await expect(engine.run(state, DEFAULT_OPTIONS)).rejects.toThrow(
        GateFailedError,
      );
    });

    it("does not call subsequent stages after gate failure", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      const failedGateHandler: StageHandler = vi.fn(async () => {
        callOrder.push("contract_review_gate");
        return {
          status: "failed" as const,
          reason: "critical_found",
          counts: { critical: 1, major: 0, minor: 0 },
          findings: [],
        };
      });

      registerAllHandlers(engine, callOrder, {
        contract_review_gate: failedGateHandler,
      });

      try {
        await engine.run(state, DEFAULT_OPTIONS);
      } catch {
        // expected
      }

      // Only stage_1_spec and contract_review_gate should have been called
      expect(callOrder).toEqual(["stage_1_spec", "contract_review_gate"]);

      // Stages after the failed gate must NOT have been called
      expect(callOrder).not.toContain("stage_2_test");
      expect(callOrder).not.toContain("test_review_gate");
      expect(callOrder).not.toContain("stage_3_implement");
      expect(callOrder).not.toContain("code_review_gate");
      expect(callOrder).not.toContain("stage_4_docs");
      expect(callOrder).not.toContain("doc_review_gate");
    });

    it("includes the correct reason in GateFailedError", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      const failedGateHandler: StageHandler = vi.fn(async () => {
        callOrder.push("contract_review_gate");
        return {
          status: "failed" as const,
          reason: "critical_found",
          counts: { critical: 1, major: 0, minor: 0 },
          findings: [],
        };
      });

      registerAllHandlers(engine, callOrder, {
        contract_review_gate: failedGateHandler,
      });

      try {
        await engine.run(state, DEFAULT_OPTIONS);
        expect.unreachable("Should have thrown GateFailedError");
      } catch (err) {
        expect(err).toBeInstanceOf(GateFailedError);
        const gateError = err as GateFailedError;
        expect(gateError.reason).toBe("critical_found");
        expect(gateError.stage).toBe("contract_review_gate");
      }
    });

    it("sets final_status to aborted and persists state on gate failure", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      const failedGateHandler: StageHandler = vi.fn(async () => {
        callOrder.push("contract_review_gate");
        return {
          status: "failed" as const,
          reason: "critical_found",
          counts: { critical: 1, major: 0, minor: 0 },
          findings: [],
        };
      });

      registerAllHandlers(engine, callOrder, {
        contract_review_gate: failedGateHandler,
      });

      try {
        await engine.run(state, DEFAULT_OPTIONS);
        expect.unreachable("Should have thrown GateFailedError");
      } catch {
        // expected
      }

      // The pipeline should mark final_status as "aborted" before throwing
      expect(state.final_status).toBe("aborted");

      // saveState should have been called with the aborted state
      const mockSaveState = vi.mocked(saveState);
      const lastCall = mockSaveState.mock.calls.at(-1);
      expect(lastCall).toBeDefined();
      expect(lastCall![0].final_status).toBe("aborted");
    });
  });

  // -------------------------------------------------------------------------
  // 3. Blocked guard prevents Stage 4
  // -------------------------------------------------------------------------
  describe("blocked guard prevents Stage 4", () => {
    it("throws PipelineError when stage_3_implement has blocked entries", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      // Add blocked entries to stage_3_implement
      state.stages.stage_3_implement.blocked = [
        {
          contract_id: "contract-001",
          reason: "ambiguous_spec",
          detail: "The spec for module X is ambiguous",
        },
      ];

      registerAllHandlers(engine, callOrder);

      await expect(engine.run(state, DEFAULT_OPTIONS)).rejects.toThrow(
        PipelineError,
      );
    });

    it("includes blocked contract count in the error message", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      state.stages.stage_3_implement.blocked = [
        {
          contract_id: "contract-001",
          reason: "ambiguous_spec",
          detail: "Spec for module X is ambiguous",
        },
        {
          contract_id: "contract-002",
          reason: "missing_dependency",
          detail: "Dependency Y not declared",
        },
      ];

      registerAllHandlers(engine, callOrder);

      try {
        await engine.run(state, DEFAULT_OPTIONS);
        expect.unreachable("Should have thrown PipelineError");
      } catch (err) {
        expect(err).toBeInstanceOf(PipelineError);
        const pipeError = err as PipelineError;
        expect(pipeError.message).toContain("2 contract(s) still blocked");
        expect(pipeError.stage).toBe("stage_4_docs");
      }
    });

    it("executes stages up to code_review_gate before blocking", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      state.stages.stage_3_implement.blocked = [
        {
          contract_id: "contract-001",
          reason: "ambiguous_spec",
          detail: "Ambiguous",
        },
      ];

      registerAllHandlers(engine, callOrder);

      try {
        await engine.run(state, DEFAULT_OPTIONS);
      } catch {
        // expected
      }

      // Stages up to code_review_gate should have run
      expect(callOrder).toEqual([
        "stage_1_spec",
        "contract_review_gate",
        "stage_2_test",
        "test_review_gate",
        "stage_3_implement",
        "code_review_gate",
      ]);

      // stage_4_docs and doc_review_gate must NOT have been called
      expect(callOrder).not.toContain("stage_4_docs");
      expect(callOrder).not.toContain("doc_review_gate");
    });

    it("sets final_status to aborted when blocked guard triggers", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      state.stages.stage_3_implement.blocked = [
        {
          contract_id: "contract-001",
          reason: "ambiguous_spec",
          detail: "Ambiguous",
        },
      ];

      registerAllHandlers(engine, callOrder);

      try {
        await engine.run(state, DEFAULT_OPTIONS);
      } catch {
        // expected
      }

      // The pipeline should mark final_status as "aborted" before throwing
      expect(state.final_status).toBe("aborted");
    });
  });

  // -------------------------------------------------------------------------
  // 4. Progress callbacks
  // -------------------------------------------------------------------------
  describe("progress callbacks", () => {
    it("calls onStageStart and onStageComplete for each stage", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      registerAllHandlers(engine, callOrder);

      const starts: StageId[] = [];
      const completes: Array<{ stageId: StageId; status: string }> = [];

      await engine.run(state, {
        ...DEFAULT_OPTIONS,
        onStageStart: (stageId) => starts.push(stageId),
        onStageComplete: (stageId, result) =>
          completes.push({ stageId, status: result.status }),
      });

      expect(starts).toEqual(PIPELINE_ORDER);
      expect(completes).toHaveLength(8);
      expect(completes[0]!.stageId).toBe("stage_1_spec");
      expect(completes[0]!.status).toBe("completed");
    });

    it("works without callbacks (optional)", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      registerAllHandlers(engine, callOrder);

      // No callbacks — should not throw
      const result = await engine.run(state, DEFAULT_OPTIONS);
      expect(result.final_status).toBe("completed");
    });
  });

  // -------------------------------------------------------------------------
  // 5. Force option
  // -------------------------------------------------------------------------
  describe("force option", () => {
    it("re-runs all stages when force is true even if completed", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      // Mark all stages as completed/passed
      state.stages.stage_1_spec.status = "completed";
      state.stages.contract_review_gate.status = "passed";
      state.stages.stage_2_test.status = "completed";
      state.stages.test_review_gate.status = "passed";
      state.stages.stage_3_implement.status = "completed";
      state.stages.code_review_gate.status = "passed";
      state.stages.stage_4_docs.status = "completed";
      state.stages.doc_review_gate.status = "passed";

      registerAllHandlers(engine, callOrder);

      await engine.run(state, { ...DEFAULT_OPTIONS, force: true });

      // All 8 stages should be re-run
      expect(callOrder).toEqual(PIPELINE_ORDER);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Pipeline mode (spec / tdd / full)
  // -------------------------------------------------------------------------
  describe("pipeline mode", () => {
    it("mode=spec stops after contract_review_gate", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      registerAllHandlers(engine, callOrder);

      await engine.run(state, { ...DEFAULT_OPTIONS, mode: "spec" });

      expect(callOrder).toEqual([
        "stage_1_spec",
        "contract_review_gate",
      ]);
      expect(state.final_status).toBe("completed");
    });

    it("mode=tdd stops after test_review_gate", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      registerAllHandlers(engine, callOrder);

      await engine.run(state, { ...DEFAULT_OPTIONS, mode: "tdd" });

      expect(callOrder).toEqual([
        "stage_1_spec",
        "contract_review_gate",
        "stage_2_test",
        "test_review_gate",
      ]);
      expect(state.final_status).toBe("completed");
    });

    it("mode=full runs all stages (default)", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      registerAllHandlers(engine, callOrder);

      await engine.run(state, { ...DEFAULT_OPTIONS, mode: "full" });

      expect(callOrder).toEqual(PIPELINE_ORDER);
    });

    it("mode undefined defaults to full", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      registerAllHandlers(engine, callOrder);

      await engine.run(state, DEFAULT_OPTIONS);

      expect(callOrder).toEqual(PIPELINE_ORDER);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Resume from completed stage
  // -------------------------------------------------------------------------
  describe("resume from completed stage", () => {
    it("skips already completed stages and starts from test_review_gate", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      // Mark stages up to stage_2_test as completed/passed
      state.stages.stage_1_spec.status = "completed";
      state.stages.contract_review_gate.status = "passed";
      state.stages.stage_2_test.status = "completed";

      registerAllHandlers(engine, callOrder);

      await engine.run(state, { ...DEFAULT_OPTIONS, resume: true });

      // Should start from test_review_gate (index 3), skipping the first 3 stages
      expect(callOrder).toEqual([
        "test_review_gate",
        "stage_3_implement",
        "code_review_gate",
        "stage_4_docs",
        "doc_review_gate",
      ]);

      // Must not have called the already-completed stages
      expect(callOrder).not.toContain("stage_1_spec");
      expect(callOrder).not.toContain("contract_review_gate");
      expect(callOrder).not.toContain("stage_2_test");
    });

    it("skips all stages when everything is already completed", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      // Mark all stages as completed/passed
      state.stages.stage_1_spec.status = "completed";
      state.stages.contract_review_gate.status = "passed";
      state.stages.stage_2_test.status = "completed";
      state.stages.test_review_gate.status = "passed";
      state.stages.stage_3_implement.status = "completed";
      state.stages.code_review_gate.status = "passed";
      state.stages.stage_4_docs.status = "completed";
      state.stages.doc_review_gate.status = "passed";

      registerAllHandlers(engine, callOrder);

      await engine.run(state, { ...DEFAULT_OPTIONS, resume: true });

      // No handlers should have been called
      expect(callOrder).toEqual([]);
      expect(state.final_status).toBe("completed");
    });

    it("resumes from mid-pipeline when only some stages are completed", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      // Mark stages up to stage_3_implement as completed/passed
      state.stages.stage_1_spec.status = "completed";
      state.stages.contract_review_gate.status = "passed";
      state.stages.stage_2_test.status = "completed";
      state.stages.test_review_gate.status = "passed";
      state.stages.stage_3_implement.status = "completed";

      registerAllHandlers(engine, callOrder);

      await engine.run(state, { ...DEFAULT_OPTIONS, resume: true });

      expect(callOrder).toEqual([
        "code_review_gate",
        "stage_4_docs",
        "doc_review_gate",
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // 8. getResumeInfo
  // -------------------------------------------------------------------------
  describe("getResumeInfo", () => {
    it("returns all stages completed when pipeline is fully done", () => {
      const state = createInitialState("/tmp/test");

      state.stages.stage_1_spec.status = "completed";
      state.stages.contract_review_gate.status = "passed";
      state.stages.stage_2_test.status = "completed";
      state.stages.test_review_gate.status = "passed";
      state.stages.stage_3_implement.status = "completed";
      state.stages.code_review_gate.status = "passed";
      state.stages.stage_4_docs.status = "completed";
      state.stages.doc_review_gate.status = "passed";

      const info = PipelineEngine.getResumeInfo(state);

      expect(info.isFullyCompleted).toBe(true);
      expect(info.nextStage).toBeNull();
      expect(info.completedStages).toEqual(PIPELINE_ORDER);
      expect(info.failedStages).toEqual([]);
      expect(info.stuckStages).toEqual([]);
    });

    it("returns first stage when nothing is completed", () => {
      const state = createInitialState("/tmp/test");

      const info = PipelineEngine.getResumeInfo(state);

      expect(info.isFullyCompleted).toBe(false);
      expect(info.resumeIndex).toBe(0);
      expect(info.nextStage).toBe("stage_1_spec");
      expect(info.completedStages).toEqual([]);
    });

    it("identifies the correct resume point after partial completion", () => {
      const state = createInitialState("/tmp/test");

      state.stages.stage_1_spec.status = "completed";
      state.stages.contract_review_gate.status = "passed";
      state.stages.stage_2_test.status = "completed";

      const info = PipelineEngine.getResumeInfo(state);

      expect(info.resumeIndex).toBe(3);
      expect(info.nextStage).toBe("test_review_gate");
      expect(info.completedStages).toEqual([
        "stage_1_spec",
        "contract_review_gate",
        "stage_2_test",
      ]);
    });

    it("resumes from in_progress stage instead of falling back to 0", () => {
      const state = createInitialState("/tmp/test");

      state.stages.stage_1_spec.status = "completed";
      state.stages.contract_review_gate.status = "passed";
      state.stages.stage_2_test.status = "in_progress"; // crashed mid-stage

      const info = PipelineEngine.getResumeInfo(state);

      expect(info.resumeIndex).toBe(2); // re-run stage_2_test
      expect(info.nextStage).toBe("stage_2_test");
      expect(info.stuckStages).toEqual(["stage_2_test"]);
      expect(info.completedStages).toEqual([
        "stage_1_spec",
        "contract_review_gate",
      ]);
    });

    it("collects failed stages", () => {
      const state = createInitialState("/tmp/test");

      state.stages.stage_1_spec.status = "completed";
      state.stages.contract_review_gate.status = "failed";

      const info = PipelineEngine.getResumeInfo(state);

      expect(info.failedStages).toEqual(["contract_review_gate"]);
      expect(info.nextStage).toBe("contract_review_gate");
      expect(info.resumeIndex).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 9. Handler error recovery
  // -------------------------------------------------------------------------
  describe("handler error recovery", () => {
    it("marks stage as failed and aborts when handler throws unexpected error", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      const throwingHandler: StageHandler = vi.fn(async () => {
        throw new Error("Unexpected LLM timeout");
      });

      registerAllHandlers(engine, callOrder, {
        stage_2_test: throwingHandler,
      });

      await expect(engine.run(state, DEFAULT_OPTIONS)).rejects.toThrow(
        PipelineError,
      );

      expect(state.stages.stage_2_test.status).toBe("failed");
      expect(state.final_status).toBe("aborted");
    });

    it("preserves state via saveState on handler error", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      const throwingHandler: StageHandler = vi.fn(async () => {
        throw new Error("crash");
      });

      registerAllHandlers(engine, callOrder, {
        stage_1_spec: throwingHandler,
      });

      try {
        await engine.run(state, DEFAULT_OPTIONS);
      } catch {
        // expected
      }

      const mockSaveState = vi.mocked(saveState);
      const lastCall = mockSaveState.mock.calls.at(-1);
      expect(lastCall).toBeDefined();
      expect(lastCall![0].final_status).toBe("aborted");
    });

    it("re-throws GateFailedError without wrapping", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      // Gate handler that throws GateFailedError directly
      const throwingGateHandler: StageHandler = vi.fn(async () => {
        throw new GateFailedError("contract_review_gate", "critical_found");
      });

      registerAllHandlers(engine, callOrder, {
        contract_review_gate: throwingGateHandler,
      });

      await expect(engine.run(state, DEFAULT_OPTIONS)).rejects.toThrow(
        GateFailedError,
      );
    });

    it("does not call subsequent stages after handler error", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      const throwingHandler: StageHandler = vi.fn(async () => {
        callOrder.push("stage_2_test");
        throw new Error("boom");
      });

      registerAllHandlers(engine, callOrder, {
        stage_2_test: throwingHandler,
      });

      try {
        await engine.run(state, DEFAULT_OPTIONS);
      } catch {
        // expected
      }

      expect(callOrder).toEqual(["stage_1_spec", "contract_review_gate", "stage_2_test"]);
      expect(callOrder).not.toContain("test_review_gate");
    });
  });

  // -------------------------------------------------------------------------
  // 10. startFromStage option
  // -------------------------------------------------------------------------
  describe("startFromStage option", () => {
    it("starts from the specified stage, skipping earlier stages", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      state.stages.stage_1_spec.status = "completed";
      state.stages.contract_review_gate.status = "passed";
      state.stages.stage_2_test.status = "completed";
      state.stages.test_review_gate.status = "failed";

      registerAllHandlers(engine, callOrder);

      await engine.run(state, {
        ...DEFAULT_OPTIONS,
        resume: true,
        startFromStage: "test_review_gate",
      });

      expect(callOrder[0]).toBe("test_review_gate");
      expect(callOrder).not.toContain("stage_1_spec");
      expect(callOrder).not.toContain("stage_2_test");
    });

    it("startFromStage takes precedence over auto resume point", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      // All completed, but we want to re-run from stage_3_implement
      state.stages.stage_1_spec.status = "completed";
      state.stages.contract_review_gate.status = "passed";
      state.stages.stage_2_test.status = "completed";
      state.stages.test_review_gate.status = "passed";
      state.stages.stage_3_implement.status = "completed";
      state.stages.code_review_gate.status = "passed";

      registerAllHandlers(engine, callOrder);

      await engine.run(state, {
        ...DEFAULT_OPTIONS,
        resume: true,
        startFromStage: "stage_3_implement",
      });

      expect(callOrder[0]).toBe("stage_3_implement");
    });
  });

  // -------------------------------------------------------------------------
  // 11. Resume from in_progress stage (integration)
  // -------------------------------------------------------------------------
  describe("resume from in_progress stage", () => {
    it("re-runs the stuck stage and continues from there", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      state.stages.stage_1_spec.status = "completed";
      state.stages.contract_review_gate.status = "passed";
      state.stages.stage_2_test.status = "in_progress"; // crashed

      registerAllHandlers(engine, callOrder);

      await engine.run(state, { ...DEFAULT_OPTIONS, resume: true });

      expect(callOrder[0]).toBe("stage_2_test");
      expect(callOrder).not.toContain("stage_1_spec");
      expect(callOrder).not.toContain("contract_review_gate");
    });
  });

  // -------------------------------------------------------------------------
  // 12. Pipeline scope (from/to/only)
  // -------------------------------------------------------------------------
  describe("pipeline scope (from/to/only)", () => {
    it("scope.only='spec' runs only stage_1_spec + contract_review_gate", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      registerAllHandlers(engine, callOrder);

      await engine.run(state, {
        ...DEFAULT_OPTIONS,
        scope: { only: "spec" },
      });

      expect(callOrder).toEqual(["stage_1_spec", "contract_review_gate"]);
      expect(state.final_status).toBe("completed");
    });

    it("scope.only='docs' runs only stage_4_docs + doc_review_gate", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      registerAllHandlers(engine, callOrder);

      await engine.run(state, {
        ...DEFAULT_OPTIONS,
        scope: { only: "docs" },
      });

      expect(callOrder).toEqual(["stage_4_docs", "doc_review_gate"]);
      expect(state.final_status).toBe("completed");
    });

    it("scope.only='implement' runs only stage_3_implement + code_review_gate", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      registerAllHandlers(engine, callOrder);

      await engine.run(state, {
        ...DEFAULT_OPTIONS,
        scope: { only: "implement" },
      });

      expect(callOrder).toEqual(["stage_3_implement", "code_review_gate"]);
    });

    it("scope.from='test' runs from stage_2_test to the end", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      registerAllHandlers(engine, callOrder);

      await engine.run(state, {
        ...DEFAULT_OPTIONS,
        scope: { from: "test" },
      });

      expect(callOrder).toEqual([
        "stage_2_test",
        "test_review_gate",
        "stage_3_implement",
        "code_review_gate",
        "stage_4_docs",
        "doc_review_gate",
      ]);
    });

    it("scope.to='test' runs from the beginning to test_review_gate", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      registerAllHandlers(engine, callOrder);

      await engine.run(state, {
        ...DEFAULT_OPTIONS,
        scope: { to: "test" },
      });

      expect(callOrder).toEqual([
        "stage_1_spec",
        "contract_review_gate",
        "stage_2_test",
        "test_review_gate",
      ]);
      expect(state.final_status).toBe("completed");
    });

    it("scope from='test' to='implement' runs test through code_review_gate", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      registerAllHandlers(engine, callOrder);

      await engine.run(state, {
        ...DEFAULT_OPTIONS,
        scope: { from: "test", to: "implement" },
      });

      expect(callOrder).toEqual([
        "stage_2_test",
        "test_review_gate",
        "stage_3_implement",
        "code_review_gate",
      ]);
    });

    it("throws PipelineError when from > to in pipeline order", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      registerAllHandlers(engine, callOrder);

      await expect(
        engine.run(state, {
          ...DEFAULT_OPTIONS,
          scope: { from: "docs", to: "spec" },
        }),
      ).rejects.toThrow(PipelineError);
    });

    it("scope takes precedence over mode", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      registerAllHandlers(engine, callOrder);

      await engine.run(state, {
        ...DEFAULT_OPTIONS,
        mode: "spec",
        scope: { only: "docs" },
      });

      expect(callOrder).toEqual(["stage_4_docs", "doc_review_gate"]);
    });

    it("blocked guard still fires with scope.only='docs' when blocked > 0", async () => {
      const engine = new PipelineEngine();
      const state = createInitialState("/tmp/test");
      const callOrder: StageId[] = [];

      state.stages.stage_3_implement.blocked = [
        {
          contract_id: "contract-001",
          reason: "ambiguous_spec",
          detail: "The spec for module X is ambiguous",
        },
      ];

      registerAllHandlers(engine, callOrder);

      await expect(
        engine.run(state, {
          ...DEFAULT_OPTIONS,
          scope: { only: "docs" },
        }),
      ).rejects.toThrow(PipelineError);

      expect(callOrder).toEqual([]);
    });
  });
});

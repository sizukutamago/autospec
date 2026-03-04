import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createReviewGateHandler } from "../../src/gates/review-gate-handler.js";
import { createInitialState } from "../../src/state.js";
import type { PipelineOptions } from "../../src/types.js";

// Mock claudeQuery (used in Phase 1, Phase 2, and onRevise)
const mockClaudeQuery = vi.hoisted(() => vi.fn());
vi.mock("../../src/query.js", () => ({
  claudeQuery: mockClaudeQuery,
}));

vi.mock("../../src/state.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/state.js")>();
  return { ...original, saveState: vi.fn() };
});

const DEFAULT_OPTIONS: PipelineOptions = {
  cwd: "/tmp/test",
  resume: false,
  force: false,
};

function mockTwoPhase(reviewText: string, jsonOutput: Record<string, unknown>) {
  let callCount = 0;
  mockClaudeQuery.mockImplementation(() => {
    callCount++;
    // Odd calls = Phase 1 (review text), Even calls = Phase 2 (JSON)
    if (callCount % 2 === 1) {
      return Promise.resolve(reviewText);
    }
    return Promise.resolve("```json\n" + JSON.stringify(jsonOutput) + "\n```");
  });
}

describe("createReviewGateHandler", () => {
  it("returns a StageHandler function", () => {
    const handler = createReviewGateHandler({
      gate: "contract",
    });
    expect(typeof handler).toBe("function");
  });

  it("returns passed when no issues found (2-phase with revise loop)", async () => {
    mockTwoPhase("No issues found. All contracts look good.", {
      reviewer: "reviewer-1",
      gate: "contract",
      findings: [],
      summary: { critical: 0, major: 0, minor: 0 },
    });

    const handler = createReviewGateHandler({
      gate: "contract",
      reviewerCount: 1,
    });

    const state = createInitialState("/tmp/test");
    const result = await handler(state, DEFAULT_OPTIONS);
    expect(result.status).toBe("passed");
    expect(result.counts).toEqual({ critical: 0, major: 0, minor: 0 });
  });

  it("returns failed when critical findings exist (no revise for critical)", async () => {
    const jsonOutput = {
      reviewer: "reviewer-1",
      gate: "contract",
      findings: [{
        severity: "critical",
        target: "CON-test",
        field: "input",
        message: "missing required field",
      }],
      summary: { critical: 1, major: 0, minor: 0 },
    };
    const jsonStr = "```json\n" + JSON.stringify(jsonOutput) + "\n```";
    // Every call returns valid JSON so that even revise-cycle re-reviews parse correctly
    mockClaudeQuery.mockResolvedValue(jsonStr);

    const handler = createReviewGateHandler({
      gate: "contract",
      reviewerCount: 1,
    });

    const state = createInitialState("/tmp/test");
    const result = await handler(state, DEFAULT_OPTIONS);
    expect(result.status).toBe("failed");
    expect(result.counts?.critical).toBe(1);
  });

  it("returns quorum_not_met when phase 1 fails", async () => {
    mockClaudeQuery.mockRejectedValue(new Error("Claude failed"));

    const handler = createReviewGateHandler({
      gate: "contract",
      reviewerCount: 1,
    });

    const state = createInitialState("/tmp/test");
    const result = await handler(state, DEFAULT_OPTIONS);
    expect(result.status).toBe("failed");
  });

  // -------------------------------------------------------------------
  // Custom prompt injection tests
  // -------------------------------------------------------------------

  describe("custom prompt injection", () => {
    let tmpDir: string;

    function mkdirp(dir: string): void {
      fs.mkdirSync(dir, { recursive: true });
    }

    afterEach(() => {
      if (tmpDir) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
      mockClaudeQuery.mockReset();
    });

    it("adds custom reviewers from .autospec/prompts/{gate}_review/ files", async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-gate-custom-"));

      // カスタムレビュアー用プロンプトファイルを配置
      const promptDir = path.join(tmpDir, ".autospec", "prompts", "contract_review");
      mkdirp(promptDir);
      fs.writeFileSync(path.join(promptDir, "security-focus.md"), "CUSTOM_SECURITY_REVIEWER");

      // プロンプト内容ベースで Phase を判定（並行実行に対応）
      const capturedPrompts: string[] = [];
      const passJson = {
        reviewer: "reviewer-1",
        gate: "contract",
        findings: [],
        summary: { critical: 0, major: 0, minor: 0 },
      };
      mockClaudeQuery.mockImplementation((prompt: string) => {
        capturedPrompts.push(prompt);
        if (prompt.includes("You are a data converter")) {
          // Phase 2: JSON 変換
          return Promise.resolve("```json\n" + JSON.stringify(passJson) + "\n```");
        }
        // Phase 1: レビューテキスト
        return Promise.resolve("No issues found.");
      });

      const handler = createReviewGateHandler({
        gate: "contract",
        reviewerCount: 1,  // デフォルト1人 + カスタム1人 = 計2人
        projectRoot: tmpDir,
      });

      const state = createInitialState(tmpDir);
      await handler(state, DEFAULT_OPTIONS);

      // 2レビュアー × 2フェーズ = 4回呼ばれるはず
      expect(capturedPrompts.length).toBe(4);

      // カスタムレビュアーのプロンプト（Phase 1）にカスタム内容が含まれる
      const hasCustom = capturedPrompts.some((p) => p.includes("CUSTOM_SECURITY_REVIEWER"));
      expect(hasCustom).toBe(true);
    });

    it("custom reviewer uses file name as reviewer identifier", async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-gate-name-"));

      const promptDir = path.join(tmpDir, ".autospec", "prompts", "contract_review");
      mkdirp(promptDir);
      fs.writeFileSync(path.join(promptDir, "my-checker.md"), "Custom instructions");

      // プロンプト内容ベースで Phase を判定（並行実行に対応）
      const capturedPrompts: string[] = [];
      const passJson = {
        reviewer: "reviewer-1",
        gate: "contract",
        findings: [],
        summary: { critical: 0, major: 0, minor: 0 },
      };
      mockClaudeQuery.mockImplementation((prompt: string) => {
        capturedPrompts.push(prompt);
        if (prompt.includes("You are a data converter")) {
          return Promise.resolve("```json\n" + JSON.stringify(passJson) + "\n```");
        }
        return Promise.resolve("No issues found.");
      });

      const handler = createReviewGateHandler({
        gate: "contract",
        reviewerCount: 1,
        projectRoot: tmpDir,
      });

      const state = createInitialState(tmpDir);
      await handler(state, DEFAULT_OPTIONS);

      // カスタムレビュアーのプロンプトにファイル名ベースの識別子が含まれる
      const customPhase1 = capturedPrompts.find((p) => p.includes("Custom instructions"));
      expect(customPhase1).toBeDefined();
      expect(customPhase1).toContain("my-checker");
    });

    it("includes custom prompts in revise agent prompt", async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-gate-revise-"));

      // Revise 用カスタムプロンプト（加算的注入）
      const reviseDir = path.join(tmpDir, ".autospec", "prompts", "revise");
      mkdirp(reviseDir);
      fs.writeFileSync(path.join(reviseDir, "fix-rules.md"), "CUSTOM_REVISE_MARKER");

      const criticalJson = {
        reviewer: "reviewer-1",
        gate: "contract",
        findings: [{
          severity: "critical",
          target: "CON-test",
          field: "input",
          message: "missing required field",
        }],
        summary: { critical: 1, major: 0, minor: 0 },
      };
      const passJson = {
        reviewer: "reviewer-1",
        gate: "contract",
        findings: [],
        summary: { critical: 0, major: 0, minor: 0 },
      };

      const capturedPrompts: string[] = [];
      let callCount = 0;
      mockClaudeQuery.mockImplementation((prompt: string) => {
        capturedPrompts.push(prompt);
        callCount++;
        if (callCount === 1) {
          return Promise.resolve("Found critical issues.");
        }
        if (callCount === 2) {
          return Promise.resolve("```json\n" + JSON.stringify(criticalJson) + "\n```");
        }
        if (callCount === 3) {
          return Promise.resolve("Fixed all issues.");
        }
        if (callCount === 4) {
          return Promise.resolve("No issues found after revision.");
        }
        return Promise.resolve("```json\n" + JSON.stringify(passJson) + "\n```");
      });

      const handler = createReviewGateHandler({
        gate: "contract",
        reviewerCount: 1,
        projectRoot: tmpDir,
      });

      const state = createInitialState(tmpDir);
      await handler(state, DEFAULT_OPTIONS);

      // Revise プロンプト（3番目の呼び出し）にカスタム内容が含まれる
      expect(capturedPrompts.length).toBeGreaterThanOrEqual(3);
      const revisePrompt = capturedPrompts[2];
      expect(revisePrompt).toContain("CUSTOM_REVISE_MARKER");
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  AutospecConfigSchema,
  loadConfig,
  DEFAULT_CONFIG,
  type AutospecConfig,
} from "../../src/config/index.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"));
}

describe("AutospecConfigSchema", () => {
  it("validates a minimal config", () => {
    const result = AutospecConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("validates a full config", () => {
    const config = {
      project: { name: "test", language: "typescript", runtime: "node" },
      pipeline: { mode: "full", smart_skip: true, max_turns: { spec: 8 } },
      agents: { researcher: { enabled: true, max_turns: 5 } },
      gates: { type: "review", review: { contract_reviewers: 3 } },
      tech_stack: { framework: "none", test: "vitest" },
      architecture: { pattern: "clean" },
    };
    const result = AutospecConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("rejects invalid mode", () => {
    const result = AutospecConfigSchema.safeParse({
      pipeline: { mode: "invalid" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid gate type", () => {
    const result = AutospecConfigSchema.safeParse({
      gates: { type: "invalid" },
    });
    expect(result.success).toBe(false);
  });
});

describe("DEFAULT_CONFIG", () => {
  it("has expected defaults", () => {
    expect(DEFAULT_CONFIG.pipeline.mode).toBe("full");
    expect(DEFAULT_CONFIG.pipeline.smart_skip).toBe(true);
    expect(DEFAULT_CONFIG.pipeline.max_turns.spec).toBe(8);
    expect(DEFAULT_CONFIG.pipeline.max_turns.implement).toBe(12);
    expect(DEFAULT_CONFIG.gates.type).toBe("review");
    expect(DEFAULT_CONFIG.agents.interviewer.min_questions).toBe(2);
  });
});

describe("loadConfig", () => {
  it("returns defaults when no config file exists", () => {
    const tmpDir = makeTmpDir();
    const config = loadConfig(tmpDir);
    expect(config).toEqual(DEFAULT_CONFIG);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("reads and merges .autospec/autospec.yaml", () => {
    const tmpDir = makeTmpDir();
    const autospecDir = path.join(tmpDir, ".autospec");
    fs.mkdirSync(autospecDir, { recursive: true });
    fs.writeFileSync(
      path.join(autospecDir, "autospec.yaml"),
      `pipeline:\n  mode: spec\n  max_turns:\n    spec: 5\n`,
    );

    const config = loadConfig(tmpDir);
    expect(config.pipeline.mode).toBe("spec");
    expect(config.pipeline.max_turns.spec).toBe(5);
    // Other defaults preserved
    expect(config.pipeline.max_turns.implement).toBe(12);
    expect(config.gates.type).toBe("review");

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("handles invalid YAML gracefully", () => {
    const tmpDir = makeTmpDir();
    const autospecDir = path.join(tmpDir, ".autospec");
    fs.mkdirSync(autospecDir, { recursive: true });
    fs.writeFileSync(
      path.join(autospecDir, "autospec.yaml"),
      "{{invalid yaml",
    );

    // Should return defaults on invalid YAML
    const config = loadConfig(tmpDir);
    expect(config).toEqual(DEFAULT_CONFIG);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("handles schema validation failure gracefully", () => {
    const tmpDir = makeTmpDir();
    const autospecDir = path.join(tmpDir, ".autospec");
    fs.mkdirSync(autospecDir, { recursive: true });
    fs.writeFileSync(
      path.join(autospecDir, "autospec.yaml"),
      `pipeline:\n  mode: invalid_mode\n`,
    );

    // Should return defaults on validation failure
    const config = loadConfig(tmpDir);
    expect(config).toEqual(DEFAULT_CONFIG);

    fs.rmSync(tmpDir, { recursive: true });
  });
});

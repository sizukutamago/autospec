import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadCustomPrompts, loadCustomPromptFiles } from "../../src/config/prompt-loader.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "custom-prompts-test-"));
}

function mkdirp(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

describe("loadCustomPrompts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  // -------------------------------------------------------------------
  // ディレクトリなし → 空文字列
  // -------------------------------------------------------------------
  it("returns empty string when .autospec/prompts/ does not exist", () => {
    const result = loadCustomPrompts("spec", tmpDir);
    expect(result).toBe("");
  });

  // -------------------------------------------------------------------
  // 空ディレクトリ → 空文字列
  // -------------------------------------------------------------------
  it("returns empty string when target directory is empty", () => {
    mkdirp(path.join(tmpDir, ".autospec", "prompts", "spec"));
    const result = loadCustomPrompts("spec", tmpDir);
    expect(result).toBe("");
  });

  // -------------------------------------------------------------------
  // .md 以外のファイルのみ → 空文字列
  // -------------------------------------------------------------------
  it("returns empty string when only non-.md files exist", () => {
    const dir = path.join(tmpDir, ".autospec", "prompts", "spec");
    mkdirp(dir);
    fs.writeFileSync(path.join(dir, "notes.txt"), "not markdown");
    fs.writeFileSync(path.join(dir, "config.yaml"), "key: value");
    const result = loadCustomPrompts("spec", tmpDir);
    expect(result).toBe("");
  });

  // -------------------------------------------------------------------
  // 単一ファイル → ヘッダー付きで内容を返す
  // -------------------------------------------------------------------
  it("loads a single target-specific .md file with header", () => {
    const dir = path.join(tmpDir, ".autospec", "prompts", "spec");
    mkdirp(dir);
    fs.writeFileSync(path.join(dir, "api-rules.md"), "Use REST conventions");
    const result = loadCustomPrompts("spec", tmpDir);
    expect(result).toContain("## Project Custom Instructions");
    expect(result).toContain("Use REST conventions");
  });

  // -------------------------------------------------------------------
  // 複数ファイル → アルファベット順に結合
  // -------------------------------------------------------------------
  it("loads multiple .md files in alphabetical order", () => {
    const dir = path.join(tmpDir, ".autospec", "prompts", "spec");
    mkdirp(dir);
    fs.writeFileSync(path.join(dir, "b-second.md"), "SECOND_CONTENT");
    fs.writeFileSync(path.join(dir, "a-first.md"), "FIRST_CONTENT");
    fs.writeFileSync(path.join(dir, "c-third.md"), "THIRD_CONTENT");
    const result = loadCustomPrompts("spec", tmpDir);
    const firstIdx = result.indexOf("FIRST_CONTENT");
    const secondIdx = result.indexOf("SECOND_CONTENT");
    const thirdIdx = result.indexOf("THIRD_CONTENT");
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });

  // -------------------------------------------------------------------
  // global/ → 任意のターゲットに適用
  // -------------------------------------------------------------------
  it("loads global prompts for any target", () => {
    const globalDir = path.join(tmpDir, ".autospec", "prompts", "global");
    mkdirp(globalDir);
    fs.writeFileSync(path.join(globalDir, "context.md"), "Global project context");
    const result = loadCustomPrompts("implement", tmpDir);
    expect(result).toContain("Global project context");
  });

  // -------------------------------------------------------------------
  // global/ + ターゲット固有 → 両方結合（global が先）
  // -------------------------------------------------------------------
  it("combines global + target-specific prompts with global first", () => {
    const globalDir = path.join(tmpDir, ".autospec", "prompts", "global");
    const specDir = path.join(tmpDir, ".autospec", "prompts", "spec");
    mkdirp(globalDir);
    mkdirp(specDir);
    fs.writeFileSync(path.join(globalDir, "global.md"), "GLOBAL_CONTENT");
    fs.writeFileSync(path.join(specDir, "spec.md"), "SPEC_CONTENT");
    const result = loadCustomPrompts("spec", tmpDir);
    expect(result).toContain("GLOBAL_CONTENT");
    expect(result).toContain("SPEC_CONTENT");
    expect(result.indexOf("GLOBAL_CONTENT")).toBeLessThan(
      result.indexOf("SPEC_CONTENT"),
    );
  });

  // -------------------------------------------------------------------
  // 読み取り不能ファイル → スキップ
  // -------------------------------------------------------------------
  it("skips unreadable files gracefully", () => {
    const dir = path.join(tmpDir, ".autospec", "prompts", "spec");
    mkdirp(dir);
    fs.writeFileSync(path.join(dir, "good.md"), "Good content");
    // ディレクトリを .md ファイルとして作成（readFileSync で失敗する）
    fs.mkdirSync(path.join(dir, "bad.md"));
    const result = loadCustomPrompts("spec", tmpDir);
    expect(result).toContain("Good content");
  });

  // -------------------------------------------------------------------
  // 空ファイル → スキップ
  // -------------------------------------------------------------------
  it("skips empty .md files", () => {
    const dir = path.join(tmpDir, ".autospec", "prompts", "spec");
    mkdirp(dir);
    fs.writeFileSync(path.join(dir, "a-empty.md"), "");
    fs.writeFileSync(path.join(dir, "b-valid.md"), "Valid content");
    const result = loadCustomPrompts("spec", tmpDir);
    expect(result).toContain("Valid content");
    // 空ファイルによるダブルセパレーターなし
    expect(result).not.toContain("---\n\n---");
  });

  // -------------------------------------------------------------------
  // code_review ターゲット
  // -------------------------------------------------------------------
  it("works with review gate targets (code_review)", () => {
    const dir = path.join(tmpDir, ".autospec", "prompts", "code_review");
    mkdirp(dir);
    fs.writeFileSync(path.join(dir, "security.md"), "Check for SQL injection");
    const result = loadCustomPrompts("code_review", tmpDir);
    expect(result).toContain("Check for SQL injection");
  });

  // -------------------------------------------------------------------
  // revise ターゲット
  // -------------------------------------------------------------------
  it("works with revise target", () => {
    const dir = path.join(tmpDir, ".autospec", "prompts", "revise");
    mkdirp(dir);
    fs.writeFileSync(path.join(dir, "priorities.md"), "Fix critical first");
    const result = loadCustomPrompts("revise", tmpDir);
    expect(result).toContain("Fix critical first");
  });

  // -------------------------------------------------------------------
  // "global" を直接ターゲットに指定 → 二重読み込みしない
  // -------------------------------------------------------------------
  it("does not double-load global when target is 'global'", () => {
    const globalDir = path.join(tmpDir, ".autospec", "prompts", "global");
    mkdirp(globalDir);
    fs.writeFileSync(path.join(globalDir, "context.md"), "UNIQUE_GLOBAL");
    const result = loadCustomPrompts("global", tmpDir);
    // 1回だけ含まれる
    const count = result.split("UNIQUE_GLOBAL").length - 1;
    expect(count).toBe(1);
  });

  // -------------------------------------------------------------------
  // プレフィックスによる順序制御
  // -------------------------------------------------------------------
  it("respects numeric prefix ordering (01-, 02-)", () => {
    const dir = path.join(tmpDir, ".autospec", "prompts", "implement");
    mkdirp(dir);
    fs.writeFileSync(path.join(dir, "02-error-handling.md"), "ERROR_HANDLING");
    fs.writeFileSync(path.join(dir, "01-coding-standards.md"), "CODING_STANDARDS");
    const result = loadCustomPrompts("implement", tmpDir);
    expect(result.indexOf("CODING_STANDARDS")).toBeLessThan(
      result.indexOf("ERROR_HANDLING"),
    );
  });
});

// ===========================================================================
// loadCustomPromptFiles（レビューゲート用：各ファイル＝追加レビュアー）
// ===========================================================================
describe("loadCustomPromptFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("returns empty array when directory does not exist", () => {
    const result = loadCustomPromptFiles("code_review", tmpDir);
    expect(result).toEqual([]);
  });

  it("returns empty array when directory is empty", () => {
    mkdirp(path.join(tmpDir, ".autospec", "prompts", "code_review"));
    const result = loadCustomPromptFiles("code_review", tmpDir);
    expect(result).toEqual([]);
  });

  it("returns individual files with name and content", () => {
    const dir = path.join(tmpDir, ".autospec", "prompts", "code_review");
    mkdirp(dir);
    fs.writeFileSync(path.join(dir, "security.md"), "Check SQL injection");
    fs.writeFileSync(path.join(dir, "performance.md"), "Check N+1 queries");
    const result = loadCustomPromptFiles("code_review", tmpDir);
    expect(result).toHaveLength(2);
    // アルファベット順: performance < security
    expect(result[0]!.name).toBe("performance");
    expect(result[0]!.content).toBe("Check N+1 queries");
    expect(result[1]!.name).toBe("security");
    expect(result[1]!.content).toBe("Check SQL injection");
  });

  it("strips .md extension from name", () => {
    const dir = path.join(tmpDir, ".autospec", "prompts", "test_review");
    mkdirp(dir);
    fs.writeFileSync(path.join(dir, "coverage-check.md"), "Ensure 80% coverage");
    const result = loadCustomPromptFiles("test_review", tmpDir);
    expect(result[0]!.name).toBe("coverage-check");
  });

  it("skips non-.md files", () => {
    const dir = path.join(tmpDir, ".autospec", "prompts", "code_review");
    mkdirp(dir);
    fs.writeFileSync(path.join(dir, "security.md"), "Security rules");
    fs.writeFileSync(path.join(dir, "notes.txt"), "Not a prompt");
    const result = loadCustomPromptFiles("code_review", tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("security");
  });

  it("skips empty .md files", () => {
    const dir = path.join(tmpDir, ".autospec", "prompts", "code_review");
    mkdirp(dir);
    fs.writeFileSync(path.join(dir, "empty.md"), "");
    fs.writeFileSync(path.join(dir, "valid.md"), "Valid content");
    const result = loadCustomPromptFiles("code_review", tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("valid");
  });

  it("skips unreadable files", () => {
    const dir = path.join(tmpDir, ".autospec", "prompts", "code_review");
    mkdirp(dir);
    fs.writeFileSync(path.join(dir, "good.md"), "Good content");
    fs.mkdirSync(path.join(dir, "bad.md")); // directory pretending to be .md
    const result = loadCustomPromptFiles("code_review", tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("good");
  });

  it("sorts files alphabetically", () => {
    const dir = path.join(tmpDir, ".autospec", "prompts", "code_review");
    mkdirp(dir);
    fs.writeFileSync(path.join(dir, "c-third.md"), "Third");
    fs.writeFileSync(path.join(dir, "a-first.md"), "First");
    fs.writeFileSync(path.join(dir, "b-second.md"), "Second");
    const result = loadCustomPromptFiles("code_review", tmpDir);
    expect(result.map((f) => f.name)).toEqual(["a-first", "b-second", "c-third"]);
  });
});

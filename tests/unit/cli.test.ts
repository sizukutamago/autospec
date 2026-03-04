import { describe, it, expect } from "vitest";
import { parseCliArgs, type CliArgs } from "../../src/cli.js";

describe("parseCliArgs", () => {
  it("returns defaults with no args", () => {
    const result = parseCliArgs([]);
    expect(result).toEqual<CliArgs>({
      cwd: process.cwd(),
      resume: false,
      force: false,
      interactive: true,
    });
  });

  it("parses --resume flag", () => {
    const result = parseCliArgs(["--resume"]);
    expect(result.resume).toBe(true);
  });

  it("parses --force flag", () => {
    const result = parseCliArgs(["--force"]);
    expect(result.force).toBe(true);
  });

  it("parses --no-interactive flag", () => {
    const result = parseCliArgs(["--no-interactive"]);
    expect(result.interactive).toBe(false);
  });

  it("parses --cwd option", () => {
    const result = parseCliArgs(["--cwd", "/tmp/project"]);
    expect(result.cwd).toBe("/tmp/project");
  });

  it("handles combined flags", () => {
    const result = parseCliArgs(["--resume", "--force", "--no-interactive"]);
    expect(result.resume).toBe(true);
    expect(result.force).toBe(true);
    expect(result.interactive).toBe(false);
  });

  it("does not treat --force as cwd value when following --cwd", () => {
    const result = parseCliArgs(["--cwd", "--force"]);
    // --force looks like a flag, so --cwd should error and cwd stays default
    expect(result.cwd).toBe(process.cwd());
  });

  it("handles --cwd at end of args without value", () => {
    const result = parseCliArgs(["--cwd"]);
    expect(result.cwd).toBe(process.cwd());
  });

  // -----------------------------------------------------------------------
  // --only / --from / --to → scope
  // -----------------------------------------------------------------------
  describe("scope flags", () => {
    it("parses --only spec", () => {
      const result = parseCliArgs(["--only", "spec"]);
      expect(result.scope).toEqual({ only: "spec" });
    });

    it("parses --only docs", () => {
      const result = parseCliArgs(["--only", "docs"]);
      expect(result.scope).toEqual({ only: "docs" });
    });

    it("parses --only implement", () => {
      const result = parseCliArgs(["--only", "implement"]);
      expect(result.scope).toEqual({ only: "implement" });
    });

    it("parses --only test", () => {
      const result = parseCliArgs(["--only", "test"]);
      expect(result.scope).toEqual({ only: "test" });
    });

    it("ignores invalid --only value", () => {
      const result = parseCliArgs(["--only", "invalid"]);
      expect(result.scope).toBeUndefined();
    });

    it("parses --from test", () => {
      const result = parseCliArgs(["--from", "test"]);
      expect(result.scope).toEqual({ from: "test" });
    });

    it("parses --to implement", () => {
      const result = parseCliArgs(["--to", "implement"]);
      expect(result.scope).toEqual({ to: "implement" });
    });

    it("parses --from test --to implement", () => {
      const result = parseCliArgs(["--from", "test", "--to", "implement"]);
      expect(result.scope).toEqual({ from: "test", to: "implement" });
    });

    it("parses --from without --to", () => {
      const result = parseCliArgs(["--from", "implement"]);
      expect(result.scope).toEqual({ from: "implement" });
    });

    it("parses --to without --from", () => {
      const result = parseCliArgs(["--to", "test"]);
      expect(result.scope).toEqual({ to: "test" });
    });

    it("combines scope flags with other flags", () => {
      const result = parseCliArgs(["--only", "docs", "--no-interactive", "--force"]);
      expect(result.scope).toEqual({ only: "docs" });
      expect(result.interactive).toBe(false);
      expect(result.force).toBe(true);
    });
  });
});

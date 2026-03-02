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
});

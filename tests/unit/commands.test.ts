import { describe, it, expect } from "vitest";
import { parseCommand } from "../../src/interactive/commands.js";

describe("parseCommand", () => {
  it("returns null for non-command input", () => {
    expect(parseCommand("hello world")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseCommand("")).toBeNull();
  });

  it("returns null for whitespace only", () => {
    expect(parseCommand("   ")).toBeNull();
  });

  it('parses /go as { type: "go", args: "" }', () => {
    expect(parseCommand("/go")).toEqual({ type: "go", args: "" });
  });

  it("parses /go with args", () => {
    expect(parseCommand("/go --fast")).toEqual({ type: "go", args: "--fast" });
  });

  it('parses /cancel as { type: "cancel", args: "" }', () => {
    expect(parseCommand("/cancel")).toEqual({ type: "cancel", args: "" });
  });

  it("parses unknown command", () => {
    expect(parseCommand("/foo")).toEqual({ type: "unknown", args: "" });
  });

  it("is case-insensitive for command name", () => {
    expect(parseCommand("/Go")).toEqual({ type: "go", args: "" });
    expect(parseCommand("/CANCEL")).toEqual({ type: "cancel", args: "" });
  });

  it("trims whitespace before parsing", () => {
    expect(parseCommand("  /go  ")).toEqual({ type: "go", args: "" });
  });
});

import * as fs from "node:fs";
import * as path from "node:path";
import type { StageHandler, StageResult, QueryFn } from "../types.js";
import { toErrorMessage } from "../utils/to-error-message.js";

export interface SpecHandlerOptions {
  queryFn: QueryFn;
}

function readClaudeMd(projectRoot: string): string {
  const claudeMdPath = path.join(projectRoot, "CLAUDE.md");
  try {
    return fs.readFileSync(claudeMdPath, "utf-8");
  } catch {
    return "";
  }
}

export function createSpecHandler(options: SpecHandlerOptions): StageHandler {
  return async (state, _pipelineOptions): Promise<StageResult> => {
    const claudeMd = readClaudeMd(state.project_root);
    const contextSection = claudeMd
      ? `\n\n## Project Context (from CLAUDE.md)\n${claudeMd}`
      : "";

    const prompt = `You are working on the project at ${state.project_root}.
Read CLAUDE.md for project requirements and conventions.

Generate design contracts (specification documents) in a contracts/ directory.
Each contract should define:
- Types and interfaces
- Function signatures and behavior
- Error handling patterns
- File structure and module boundaries

Cover ALL components mentioned in CLAUDE.md — including frontend, backend, tests, and any client-side code.${contextSection}`;

    try {
      await options.queryFn(prompt);
      return { status: "completed" };
    } catch (err) {
      const message = toErrorMessage(err);
      return { status: "failed", reason: message };
    }
  };
}

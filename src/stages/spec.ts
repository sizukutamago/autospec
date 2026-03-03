import * as fs from "node:fs";
import * as path from "node:path";
import type { StageHandler, StageResult, QueryFn } from "../types.js";
import { toErrorMessage } from "../utils/to-error-message.js";
import { loadPromptFile } from "../config/prompt-loader.js";

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
    const projectRoot = state.project_root;
    const claudeMd = readClaudeMd(projectRoot);

    // Plugin コア仕様をプロンプトに埋め込む
    const contractSchema = loadPromptFile("core/contract-schema.md", projectRoot);
    const specWorkflow = loadPromptFile("core/spec-workflow.md", projectRoot);
    const autospecStructure = loadPromptFile("core/autospec-structure.md", projectRoot);
    const idSystem = loadPromptFile("core/id-system.md", projectRoot);

    const prompt = `You are working on the project at ${projectRoot}.

## Workflow
${specWorkflow}

## Contract YAML Schema
${contractSchema}

## .autospec/ Directory Structure
${autospecStructure}

## ID System
${idSystem}

## Project Context (from CLAUDE.md)
${claudeMd}

Generate YAML contracts in .autospec/contracts/ following the schema above.
Organize contracts by type: api/, external/, files/, internal/.
Also generate concepts/ and decisions/ as needed.`;

    try {
      await options.queryFn(prompt);
      return { status: "completed" };
    } catch (err) {
      const message = toErrorMessage(err);
      return { status: "failed", reason: message };
    }
  };
}

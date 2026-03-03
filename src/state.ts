import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import type { PipelineState } from "./types.js";
import { StateLoadError } from "./errors.js";

const STATE_FILE = "pipeline-state.yaml";
const PIPELINE_VERSION = "1.0.0";

export function getStatePath(projectRoot: string): string {
  return path.join(projectRoot, STATE_FILE);
}

export function createInitialState(projectRoot: string): PipelineState {
  return {
    pipeline_version: PIPELINE_VERSION,
    project_root: projectRoot,
    started_at: new Date().toISOString(),
    final_status: "pending",
    smart_skip: {},
    stages: {
      stage_1_spec: { status: "pending" },
      contract_review_gate: {
        status: "pending",
        cycles: 0,
        final_counts: { critical: 0, major: 0, minor: 0 },
      },
      stage_2_test: { status: "pending" },
      test_review_gate: {
        status: "pending",
        cycles: 0,
        final_counts: { critical: 0, major: 0, minor: 0 },
      },
      stage_3_implement: {
        status: "pending",
        blocked: [],
      },
      code_review_gate: {
        status: "pending",
        cycles: 0,
        final_counts: { critical: 0, major: 0, minor: 0 },
      },
      stage_4_docs: { status: "pending" },
      doc_review_gate: {
        status: "pending",
        cycles: 0,
        final_counts: { critical: 0, major: 0, minor: 0 },
      },
    },
  };
}

export function loadState(projectRoot: string): PipelineState {
  const statePath = getStatePath(projectRoot);
  if (!fs.existsSync(statePath)) {
    throw new StateLoadError(
      `State file not found: ${statePath}. Run without --resume to start a new pipeline.`,
    );
  }
  const raw = fs.readFileSync(statePath, "utf-8");
  const parsed = yaml.load(raw) as PipelineState;
  if (!parsed || typeof parsed !== "object" || !parsed.pipeline_version) {
    throw new StateLoadError(`Invalid state file: ${statePath}`);
  }
  return parsed;
}

export function saveState(state: PipelineState): void {
  const statePath = getStatePath(state.project_root);
  const content = yaml.dump(state, { lineWidth: 120, noRefs: true });
  const tmpPath = `${statePath}.tmp`;
  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, statePath);
}

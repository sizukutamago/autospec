import type { StageHandler, StageResult, Finding } from "../types.js";
import { loadPromptFile } from "../config/prompt-loader.js";
import { claudeQuery, type ClaudeQueryOptions } from "../query.js";
import { type ReviewerFn } from "./review-gate.js";
import { runReviseLoop } from "./revise.js";
import { parseReviewOutput } from "./schemas.js";
import { toErrorMessage } from "../utils/to-error-message.js";

export interface ReviewGateHandlerOptions {
  gate: "contract" | "test" | "code" | "doc";
  claudeQueryFn?: (prompt: string, options?: ClaudeQueryOptions) => Promise<string>;
  projectRoot?: string;
  reviewerCount?: number;
}

const GATE_PROMPT_MAP = {
  contract: "review-prompts/contract-reviewer.md",
  test: "review-prompts/test-reviewer.md",
  code: "review-prompts/code-reviewer.md",
  doc: "review-prompts/doc-reviewer.md",
} as const;

const DEFAULT_REVIEWER_COUNT = {
  contract: 3,
  test: 3,
  code: 4,
  doc: 3,
} as const;

type GateKind = ReviewGateHandlerOptions["gate"];

const SEVERITY_RULES: Record<GateKind, string> = {
  contract: `STRICT SEVERITY RULES — you MUST follow these exactly:
- critical: ONLY for YAML parse failures or completely missing id field (id key absent)
- major: Missing type info, missing returns, ambiguous specs that prevent test generation
- minor: Naming conventions (e.g. CON-* prefix), missing metadata (version/status/owner), style issues
IMPORTANT: ID naming format (e.g. "int-001" vs "CON-xxx") is ALWAYS minor, never critical.`,
  test: `STRICT SEVERITY RULES — you MUST follow these exactly:
- critical: Test file fails to compile or has syntax errors
- major: Missing test coverage for critical paths, incorrect assertions, missing edge cases
- minor: Test naming conventions, missing descriptions, code style issues`,
  code: `STRICT SEVERITY RULES — you MUST follow these exactly:
- critical: Runtime crashes, security vulnerabilities, data corruption risks
- major: Logic errors, missing error handling, contract violations, type safety issues
- minor: Code style, naming conventions, minor refactoring suggestions`,
  doc: `STRICT SEVERITY RULES — you MUST follow these exactly:
- critical: Documentation references non-existent APIs or contains dangerous instructions
- major: Missing documentation for public APIs, incorrect usage examples, outdated information
- minor: Typos, formatting issues, style inconsistencies`,
};

const REVISE_TARGETS: Record<GateKind, string> = {
  contract: "Focus on the contract YAML files in .autospec/contracts/",
  test: "Focus on the test files in the tests/ directory",
  code: "Focus on the source code files in src/",
  doc: "Focus on the documentation files in docs/",
};

/** Phase 2 で使う JSON 変換プロンプト */
const JSON_CONVERSION_PROMPT = `You are a data converter. Your ONLY task is to convert the review text below into a JSON object.

CRITICAL: Output ONLY a JSON code block. No other text before or after.

\`\`\`json
{
  "reviewer": "<reviewer name>",
  "gate": "<gate name>",
  "findings": [
    {
      "severity": "critical or major or minor",
      "target": "contract ID or file path",
      "field": "field name",
      "message": "issue description",
      "suggestion": "fix suggestion"
    }
  ],
  "summary": { "critical": <count>, "major": <count>, "minor": <count> }
}
\`\`\`

If the review found NO issues, output:
\`\`\`json
{"reviewer":"<name>","gate":"<gate>","findings":[],"summary":{"critical":0,"major":0,"minor":0}}
\`\`\`
`;

/**
 * 2 フェーズレビュアー:
 * Phase 1 — ツール付きでファイルを読んでレビュー（テキスト出力）
 * Phase 2 — レビュー結果をツールなし + JSON 指示で構造化変換
 */
function createReviewer(
  gate: GateKind,
  reviewPrompt: string,
  agentIndex: number,
  projectRoot: string,
  queryFn: (prompt: string, options?: ClaudeQueryOptions) => Promise<string>,
): ReviewerFn {
  return async () => {
    const severityRules = SEVERITY_RULES[gate];

    // Phase 1: ツール付きレビュー
    const reviewText = await queryFn(
      `${reviewPrompt}

You are reviewer agent #${agentIndex + 1} for the "${gate}" review gate.
Review the project at: ${projectRoot}

Read the relevant files using Read/Glob/Grep tools, then provide your detailed review.

${severityRules}

If there are no issues, explicitly state that no issues were found.`,
      {
        cwd: projectRoot,
        maxTurns: 15,
        tools: ["Read", "Glob", "Grep"],
      },
    );

    // Phase 2: ツールなしで JSON 変換（1ターンで完了）
    const jsonResponse = await queryFn(
      `${JSON_CONVERSION_PROMPT}

reviewer: "reviewer-${agentIndex + 1}"
gate: "${gate}"

Review text to convert:
---
${reviewText}
---`,
      {
        cwd: projectRoot,
        maxTurns: 3,
        permissionMode: "default",
      },
    );

    const parsed = extractJsonFromText(jsonResponse);
    return parseReviewOutput(parsed);
  };
}

/** テキストレスポンスから JSON を抽出するフォールバック */
function extractJsonFromText(response: string): unknown {
  try {
    return JSON.parse(response);
  } catch {
    // noop
  }

  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch?.[1]) {
    try {
      return JSON.parse(codeBlockMatch[1]);
    } catch {
      // noop
    }
  }

  const jsonMatch = response.match(/\{[\s\S]*"findings"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      // noop
    }
  }

  throw new Error("No valid JSON found in review response");
}

/** findings を元に成果物を修正する onRevise コールバックを生成 */
function createOnRevise(
  gate: GateKind,
  projectRoot: string,
  queryFn: (prompt: string, options?: ClaudeQueryOptions) => Promise<string>,
): (findings: Finding[], cycle: number) => Promise<void> {
  return async (findings, cycle) => {
    const actionableFindings = findings.filter((f) => f.severity === "critical" || f.severity === "major");
    const findingsSummary = actionableFindings
      .map((f) => `[${f.severity}] ${f.target} / ${f.field}: ${f.message}${f.suggestion ? ` → ${f.suggestion}` : ""}`)
      .join("\n");

    // critical/major 件数に応じて maxTurns を動的調整（最低 15、1件あたり +2ターン）
    const reviseTurns = Math.max(15, 10 + actionableFindings.length * 2);

    console.error(`[autospec] REVISE cycle ${cycle}: ${actionableFindings.length} critical/major findings を修正中... (maxTurns=${reviseTurns})`);

    const reviseTarget = REVISE_TARGETS[gate];

    await queryFn(
      `You are a revision agent for the "${gate}" review gate (cycle ${cycle}).
The project is at: ${projectRoot}

The following review findings need to be addressed by modifying the relevant files.
Fix ALL critical and major issues. minor issues are optional but appreciated.

${actionableFindings.length} findings to fix:
${findingsSummary}

Instructions:
- Read the target files using Read/Glob tools
- Edit the files to address each finding
- ${reviseTarget}
- Do NOT create new files unless absolutely necessary
- Make minimal, targeted changes
- Be efficient: batch multiple edits to the same file together`,
      {
        cwd: projectRoot,
        maxTurns: reviseTurns,
        tools: ["Read", "Glob", "Grep", "Edit", "Write"],
        permissionMode: "bypassPermissions",
      },
    );
  };
}

export function createReviewGateHandler(
  options: ReviewGateHandlerOptions,
): StageHandler {
  const { gate, reviewerCount } = options;
  const count = reviewerCount ?? DEFAULT_REVIEWER_COUNT[gate];
  const queryFn = options.claudeQueryFn ?? claudeQuery;

  return async (state, _pipelineOptions): Promise<StageResult> => {
    const projectRoot = options.projectRoot ?? state.project_root;
    const reviewPrompt = loadPromptFile(GATE_PROMPT_MAP[gate], projectRoot);

    const reviewers: ReviewerFn[] = Array.from({ length: count }, (_, i) =>
      createReviewer(gate, reviewPrompt, i, projectRoot, queryFn),
    );

    try {
      const result = await runReviseLoop({
        gate,
        reviewers,
        maxCycles: 5,
        onRevise: createOnRevise(gate, projectRoot, queryFn),
      });
      return {
        status: result.status,
        counts: result.counts,
        findings: result.findings,
        reason: result.reason,
      };
    } catch (err) {
      return {
        status: "failed",
        counts: { critical: 0, major: 0, minor: 0 },
        findings: [],
        reason: toErrorMessage(err),
      };
    }
  };
}

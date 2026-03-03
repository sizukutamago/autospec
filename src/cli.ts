#!/usr/bin/env node

import * as path from "node:path";
import * as fs from "node:fs";
import * as p from "@clack/prompts";
import { createDefaultPipeline } from "./presets.js";
import { createInitialState, loadState, saveState, getStatePath } from "./state.js";
import { PipelineEngine, PIPELINE_ORDER } from "./engine.js";
import { claudeQuery } from "./query.js";
import { generateTaskDescription } from "./interactive/summary.js";
import { generateFollowUpQuestion } from "./agents/interviewer.js";
import { runResearcher } from "./agents/researcher.js";
import { runWebResearcher } from "./agents/web-researcher.js";
import { runParallel } from "./agents/parallel-runner.js";
import type { ConversationEntry } from "./interactive/summary.js";
import type { PipelineOptions, PipelineState, PipelineMode, StageId, QueryFn } from "./types.js";
import type { ResumeInfo } from "./engine.js";
import { toErrorMessage } from "./utils/to-error-message.js";
import { initAutospec } from "./config/init.js";

const VERSION = "0.1.0";

const STAGE_LABELS: Record<StageId, string> = {
  stage_1_spec: "Stage 1: 仕様書生成",
  contract_review_gate: "仕様レビューゲート",
  stage_2_test: "Stage 2: テスト生成",
  test_review_gate: "テストレビューゲート",
  stage_3_implement: "Stage 3: 実装",
  code_review_gate: "コードレビューゲート",
  stage_4_docs: "Stage 4: ドキュメント生成",
  doc_review_gate: "ドキュメントレビューゲート",
};

function statusLabel(status: string): string {
  switch (status) {
    case "completed": return "完了";
    case "passed": return "パス";
    case "failed": return "失敗";
    default: return status;
  }
}

export interface CliArgs {
  cwd: string;
  resume: boolean;
  force: boolean;
  interactive: boolean;
  mode?: PipelineMode;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const result: CliArgs = {
    cwd: process.cwd(),
    resume: false,
    force: false,
    interactive: true,
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--resume":
        result.resume = true;
        break;
      case "--force":
        result.force = true;
        break;
      case "--no-interactive":
        result.interactive = false;
        break;
      case "--mode": {
        const m = argv[i + 1];
        if (m === "spec" || m === "tdd" || m === "full") {
          result.mode = m;
          i++;
        }
        break;
      }
      case "--cwd": {
        const next = argv[i + 1];
        if (!next || next.startsWith("--")) {
          console.error("[autospec] --cwd にはディレクトリを指定してください");
          process.exitCode = 1;
          return result;
        }
        result.cwd = next;
        i++;
        break;
      }
    }
  }

  return result;
}

function hasPreviousState(projectRoot: string): boolean {
  return fs.existsSync(getStatePath(projectRoot));
}

function statusIcon(status: string): string {
  switch (status) {
    case "completed":
    case "passed":
      return "✓";
    case "failed":
      return "✗";
    case "in_progress":
      return "…";
    default:
      return " ";
  }
}

function formatResumeSummary(state: PipelineState, info: ResumeInfo): string {
  const lines: string[] = [];
  for (const stageId of PIPELINE_ORDER) {
    const s = state.stages[stageId];
    const icon = statusIcon(s.status);
    const label = STAGE_LABELS[stageId];
    const status = statusLabel(s.status);
    lines.push(`  ${icon} ${label} ... ${status}`);
  }
  if (info.nextStage) {
    lines.push(`  → ${STAGE_LABELS[info.nextStage]} から再開`);
  }
  return lines.join("\n");
}

async function runInteractive(
  args: CliArgs,
  projectRoot: string,
  queryFn: QueryFn,
): Promise<void> {
  p.intro(`autospec v${VERSION}`);

  p.note(
    [
      "作りたいプロジェクトや機能の説明を入力してください。",
      "パイプラインが自動で仕様書・テスト・実装・ドキュメントを生成します。",
      "",
      "  仕様書生成 → テスト生成 → 実装 → ドキュメント",
      "",
      "操作:",
      "  空エンター    入力完了 → パイプライン開始",
      "  Ctrl+C       キャンセル",
    ].join("\n"),
    "使い方",
  );

  // モード選択
  let mode = args.mode;
  if (!mode) {
    const modeChoice = await p.select({
      message: "何を実行しますか？",
      options: [
        { value: "full" as const, label: "full", hint: "仕様→テスト→実装→ドキュメント" },
        { value: "tdd" as const, label: "tdd", hint: "仕様 + テスト（実装は自分で）" },
        { value: "spec" as const, label: "spec", hint: "仕様書のみ（設計レビュー用）" },
      ],
      initialValue: "full" as const,
    });

    if (p.isCancel(modeChoice)) {
      p.cancel("キャンセルしました");
      process.exit(0);
    }
    mode = modeChoice;
  }

  // resume 導線
  let resume = args.resume;
  if (!resume && hasPreviousState(projectRoot)) {
    const resumeChoice = await p.confirm({
      message: "前回の実行状態が見つかりました。途中から再開しますか？",
      active: "再開する",
      inactive: "最初からやり直す",
      initialValue: true,
    });

    if (p.isCancel(resumeChoice)) {
      p.cancel("キャンセルしました");
      process.exit(0);
    }

    if (resumeChoice) {
      resume = true;
    }
  }

  // -----------------------------------------------------------------------
  // resume パス: spec 完了済みならインタビューをスキップ
  // -----------------------------------------------------------------------
  if (resume) {
    const loaded = loadState(projectRoot);
    const info = PipelineEngine.getResumeInfo(loaded);

    // 全完了 → force がなければ終了
    if (info.isFullyCompleted && !args.force) {
      p.note(formatResumeSummary(loaded, info), "再開サマリー");
      p.log.success("全てのステージが完了済みです。--force で再実行できます。");
      p.outro("完了済み");
      return;
    }

    // サマリー表示
    p.note(formatResumeSummary(loaded, info), "再開サマリー");

    // 失敗ステージがある場合: ステージ選択
    let startFromStage: StageId | undefined;
    if (info.failedStages.length > 0) {
      type StageChoice = "auto" | "force" | StageId;
      const choiceOptions: Array<{ value: StageChoice; label: string; hint?: string }> = [
        {
          value: "auto" as const,
          label: "自動検出",
          hint: info.nextStage ? `${STAGE_LABELS[info.nextStage]} から` : undefined,
        },
        ...info.failedStages.map((gateId) => ({
          value: gateId as StageChoice,
          label: STAGE_LABELS[gateId],
          hint: "失敗したステージから再実行",
        })),
        {
          value: "force" as const,
          label: "最初からやり直す",
        },
      ];

      const choice = await p.select({
        message: "どこから再開しますか？",
        options: choiceOptions,
      });

      if (p.isCancel(choice)) {
        p.cancel("キャンセルしました");
        process.exit(0);
      }

      if (choice === "force") {
        // 最初からやり直す → 通常フローへ
        resume = false;
      } else if (choice !== "auto") {
        startFromStage = choice;
      }
    }

    // resume が維持されている場合 → パイプライン直行
    if (resume) {
      await runPipeline({
        projectRoot,
        queryFn,
        state: loaded,
        resume: true,
        force: args.force,
        mode,
        startFromStage,
      });
      return;
    }
  }

  // -----------------------------------------------------------------------
  // 通常パス（新規 or 最初からやり直し）: インタビュー → パイプライン
  // -----------------------------------------------------------------------

  // Step 1: 初回入力
  const firstInput = await p.text({
    message: "どんなプロジェクト・機能を作りますか？",
    placeholder: "例: オンライン対戦オセロゲーム（Node.js + ws）",
    validate: (v) => (!v || v.trim().length === 0) ? "入力してください" : undefined,
  });

  if (p.isCancel(firstInput)) {
    p.cancel("キャンセルしました");
    process.exit(0);
  }

  const history: ConversationEntry[] = [
    { role: "user", content: firstInput.trim() },
  ];

  // Step 2: 初回プロジェクト調査
  const initialResearchSpinner = p.spinner();
  initialResearchSpinner.start("プロジェクトを調査中...");

  let researchContext = "";
  try {
    const researchResults = await runParallel([
      { name: "code", fn: () => runResearcher(projectRoot) },
      { name: "web", fn: () => runWebResearcher(firstInput.trim()) },
    ]);
    researchContext = researchResults
      .filter((r) => r.result)
      .map((r) => `[${r.name}] ${r.result}`)
      .join("\n\n");
    initialResearchSpinner.stop("調査完了");
  } catch {
    initialResearchSpinner.stop("調査をスキップ");
  }

  // Step 3: AI 深掘りループ（インタビュー用は軽量 queryFn）
  const interviewQueryFn: QueryFn = (prompt) =>
    claudeQuery(prompt, { cwd: projectRoot, maxTurns: 1 });

  let questionCount = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const thinkSpinner = p.spinner();
    thinkSpinner.start("考え中...");

    let result;
    try {
      result = await generateFollowUpQuestion(history, interviewQueryFn, questionCount, researchContext);
    } catch {
      thinkSpinner.stop("質問生成をスキップ");
      break;
    }

    if (result.type === "ready") {
      thinkSpinner.stop("ヒアリング完了");
      break;
    }

    if (result.type === "limit_reached") {
      thinkSpinner.stop("ヒアリング完了");

      const wantMore = await p.confirm({
        message: "もう少し詳しく聞きたいですか？",
        active: "はい、続ける",
        inactive: "いいえ、開始する",
        initialValue: false,
      });

      if (p.isCancel(wantMore)) {
        p.cancel("キャンセルしました");
        process.exit(0);
      }

      if (wantMore) {
        questionCount = 0;
        continue;
      }
      break;
    }

    if (result.type === "research_needed") {
      thinkSpinner.stop("");
      const researchSpinner = p.spinner();
      const label = result.target === "code" ? "コード調査中..."
        : result.target === "web" ? "Web検索中..."
        : "コード調査 + Web検索中...";
      researchSpinner.start(label);

      try {
        const tasks = [];
        if (result.target === "code" || result.target === "both") {
          tasks.push({ name: "code", fn: () => runResearcher(projectRoot, result.topic) });
        }
        if (result.target === "web" || result.target === "both") {
          tasks.push({ name: "web", fn: () => runWebResearcher(result.topic) });
        }
        const researchResults = await runParallel(tasks);
        const newContext = researchResults
          .filter((r) => r.result)
          .map((r) => `[${r.name}] ${r.result}`)
          .join("\n\n");
        if (newContext) {
          researchContext += `\n\n${newContext}`;
        }
        researchSpinner.stop("調査完了");
      } catch {
        researchSpinner.stop("調査をスキップ");
      }
      continue; // 調査結果を踏まえて再度 Interviewer に聞く
    }

    // type === "question"
    thinkSpinner.stop("");
    questionCount++;

    history.push({ role: "assistant", content: result.text });

    const answer = await p.text({
      message: result.text,
      placeholder: "回答を入力",
    });

    if (p.isCancel(answer)) {
      p.cancel("キャンセルしました");
      process.exit(0);
    }

    history.push({ role: "user", content: answer.trim() });
  }

  // Step 3: 確認
  const shouldStart = await p.confirm({
    message: "パイプラインを開始しますか？",
    active: "開始する",
    inactive: "キャンセル",
    initialValue: true,
  });

  if (p.isCancel(shouldStart) || !shouldStart) {
    p.cancel("キャンセルしました");
    process.exit(0);
  }

  // Step 4: 要約生成
  const summarySpinner = p.spinner();
  summarySpinner.start("タスク説明を生成中...");

  let taskDescription: string;
  try {
    taskDescription = await generateTaskDescription(history, queryFn);
    summarySpinner.stop("タスク説明の生成完了");
  } catch (err) {
    const msg = toErrorMessage(err);
    summarySpinner.stop(`失敗: ${msg}`);
    p.cancel(`タスク説明の生成に失敗しました: ${msg}`);
    process.exitCode = 1;
    return;
  }

  // Step 5: パイプライン実行
  await runPipeline({
    projectRoot,
    queryFn,
    state: createInitialState(projectRoot),
    resume: false,
    force: args.force,
    mode,
    taskDescription,
  });
}

interface RunPipelineArgs {
  projectRoot: string;
  queryFn: QueryFn;
  state: PipelineState;
  resume: boolean;
  force: boolean;
  mode: PipelineMode;
  taskDescription?: string;
  startFromStage?: StageId;
}

async function runPipeline(args: RunPipelineArgs): Promise<void> {
  const { projectRoot, queryFn, state, mode, taskDescription, startFromStage } = args;

  const engine = createDefaultPipeline({ queryFn, cwd: projectRoot, taskDescription });
  const stageSpinner = p.spinner({ indicator: "timer" });

  const options: PipelineOptions = {
    cwd: projectRoot,
    resume: args.resume,
    force: args.force,
    mode,
    startFromStage,
    onStageStart: (stageId) => stageSpinner.start(`${STAGE_LABELS[stageId]}...`),
    onStageComplete: (stageId, result) => stageSpinner.stop(`${STAGE_LABELS[stageId]} → ${statusLabel(result.status)}`),
  };

  try {
    const finalState = await engine.run(state, options);
    saveState(finalState);
    p.outro("パイプライン完了！");
  } catch (err) {
    const msg = toErrorMessage(err);
    p.cancel(`パイプライン失敗: ${msg}`);
    p.log.info("npx autospec --resume で途中から再開できます");
    process.exitCode = 1;
  }
}

function printResumeSummary(state: PipelineState, info: ResumeInfo): void {
  console.log("[autospec] ── 再開サマリー ──");
  for (const line of formatResumeSummary(state, info).split("\n")) {
    console.log(`[autospec] ${line}`);
  }
  console.log("[autospec] ─────────────────");
}

async function runNonInteractive(
  args: CliArgs,
  projectRoot: string,
  queryFn: QueryFn,
): Promise<void> {
  const state = args.resume
    ? loadState(projectRoot)
    : createInitialState(projectRoot);

  // resume 時: サマリー表示 + 完了済みチェック
  if (args.resume) {
    const info = PipelineEngine.getResumeInfo(state);
    printResumeSummary(state, info);

    if (info.isFullyCompleted && !args.force) {
      console.log("[autospec] 全てのステージが完了済みです。--force で再実行できます。");
      return;
    }
  }

  const engine = createDefaultPipeline({ queryFn, cwd: projectRoot });

  console.log(`[autospec] パイプライン開始: ${state.started_at}`);

  const options: PipelineOptions = {
    cwd: projectRoot,
    resume: args.resume,
    force: args.force,
    mode: args.mode ?? "full",
    onStageStart: (stageId) => console.log(`[autospec] ${STAGE_LABELS[stageId]}...`),
    onStageComplete: (stageId, result) => console.log(`[autospec] ${STAGE_LABELS[stageId]} → ${result.status}`),
  };

  try {
    const finalState = await engine.run(state, options);
    saveState(finalState);
    console.log(`[autospec] パイプライン完了: ${finalState.final_status}`);
  } catch (err) {
    const msg = toErrorMessage(err);
    console.error(`[autospec] パイプライン失敗: ${msg}`);
    console.log("[autospec] npx autospec --resume で途中から再開できます");
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  // Claude Code のネスト起動を可能にする（プロセス起動時に1回だけ）
  delete process.env.CLAUDECODE;

  // `npx autospec init` サブコマンド
  if (process.argv[2] === "init") {
    const projectRoot = path.resolve(process.argv[3] ?? process.cwd());
    initAutospec(projectRoot);
    console.log(`[autospec] .autospec/ を初期化しました: ${projectRoot}`);
    return;
  }

  const args = parseCliArgs(process.argv.slice(2));
  const projectRoot = path.resolve(args.cwd);

  // .autospec/ がなければ自動生成
  if (!fs.existsSync(path.join(projectRoot, ".autospec"))) {
    initAutospec(projectRoot);
  }

  const queryFn: QueryFn = (prompt) => claudeQuery(prompt, { cwd: projectRoot });

  if (args.interactive) {
    await runInteractive(args, projectRoot, queryFn);
  } else {
    await runNonInteractive(args, projectRoot, queryFn);
  }
}

void main();

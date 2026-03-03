# autospec

Claude Agent SDK を使った AI ワークフローエンジン。
対話で要件を伝えるだけで、設計→テスト→実装→ドキュメントのパイプラインを自動実行する。

## 概要

blueprint-plugin（Claude Code プラグイン）のワークフローをスタンドアロンの SDK に変換したもの。
AI の解釈に頼らず、ステージ遷移と Gate 判定を決定論的にコードで制御する。

### クイックスタート

```bash
# 対話モードで起動（デフォルト）
npx autospec

# 会話で要件を伝えて /go で実行
> オンライン対戦オセロゲームを作りたい
> バックエンドは Node.js + ws、フロントは Vanilla JS
> /go
```

### パイプライン

```
Stage 1: Spec → Contract Review Gate
Stage 2: Test Gen → Test Review Gate
Stage 3: Implement → Code Review Gate
Stage 4: Docs → Doc Review Gate
```

### Gate ポリシー

- **critical = 0 かつ major ≤ 1** → PASS
- critical > 0 → REVISE（自動修正→再レビュー、最大5サイクル、reason: `critical_found`）
- major > 1 → REVISE（自動修正→再レビュー、最大5サイクル、reason: `major_exceeded`）
- minor → 記録のみ、通過に影響しない
- レビュアー失敗 → リトライ1回 → Gate 不成立（`quorum_not_met`）

## CLI 使い方

```bash
# 対話モード（デフォルト）— 会話 → /go でパイプライン実行
npx autospec

# 非対話モード — 直接パイプライン実行
npx autospec --no-interactive

# オプション
npx autospec --resume          # 中断したパイプラインを再開
npx autospec --force           # 完了済みステージも強制再実行
npx autospec --cwd /path/to   # 作業ディレクトリ指定
```

### 対話モードのコマンド

| コマンド | 動作 |
|----------|------|
| `/go` | 会話内容から要件を要約し、パイプライン実行開始 |
| `/cancel` | パイプラインをキャンセルして終了 |

## 開発コマンド

```bash
# 型チェック
npm run typecheck        # tsc --noEmit

# Lint（type-aware）
npm run lint             # oxlint --type-aware --type-check

# テスト
npm run test             # vitest run
npm run test:watch       # vitest（ウォッチモード）

# ビルド
npm run build            # tsc
```

## 開発ルール

### TDD 必須

全ての実装は Red → Green → Refactor サイクルで行う。

1. **RED**: テストを先に書く → `npm run test` で失敗を確認
2. **GREEN**: テストを通す最小限の実装を書く → `npm run test` で成功を確認
3. **REFACTOR**: コード品質を改善 → テストが通ることを再確認

```bash
# 単一テストファイルの実行
npx vitest run tests/unit/foo.test.ts

# 全テスト
npm run test
```

### チェック手順（実装後に必ず実行）

```bash
npm run typecheck && npm run lint && npm run test
```

3つ全てパスしてから次のステップに進むこと。

### テストの配置

```
tests/
├── unit/           # 純粋関数・モジュール単体テスト
├── integration/    # 複数モジュール結合テスト
└── helpers/        # テストユーティリティ
```

## 技術スタック

| 項目 | 選定 |
|------|------|
| 言語 | TypeScript (ESM, NodeNext) |
| ランタイム | Node.js >= 20 |
| AI SDK | @anthropic-ai/claude-agent-sdk |
| バリデーション | zod v4 |
| 状態管理 | YAML (js-yaml) |
| テスト | vitest |
| Lint | oxlint + tsgolint (type-aware) |

## ディレクトリ構成

```
src/
├── index.ts          # パブリック API エクスポート
├── engine.ts         # PipelineEngine（ステージ順次実行）
├── state.ts          # パイプライン状態管理（YAML 読み書き）
├── errors.ts         # カスタムエラー
├── cli.ts            # CLI エントリポイント（対話モード対応）
├── types.ts          # 全型定義
├── presets.ts        # createDefaultPipeline（ワンコールセットアップ）
├── query.ts          # claudeQuery ユーティリティ
├── interactive/      # 対話モード
│   ├── commands.ts   # スラッシュコマンドパーサー（/go, /cancel）
│   ├── conversation.ts # 対話ループ（DI ベース）
│   └── summary.ts    # 会話履歴 → タスク説明文生成
├── gates/            # Gate インフラ
│   ├── noop-gate.ts  # Noop Gate（デフォルト、常に PASS）
│   ├── normalize.ts  # Finding 正規化・重複排除
│   ├── evaluate.ts   # Gate ポリシー評価
│   ├── schemas.ts    # Zod スキーマ（構造化出力バリデーション）
│   ├── review-gate.ts # Review Swarm オーケストレーション
│   └── revise.ts     # REVISE サイクルロジック
├── stages/           # 各ステージハンドラ
├── prompts/          # プロンプトテンプレート
│   ├── core/
│   └── review-prompts/
└── utils/            # ユーティリティ
```

## 設計上の注意点

- **blocked guard**: `stage_3_implement.blocked.length > 0` の場合 Stage 4 に進めない
- **正規化キー**: `target::field::impl_file` で Finding を重複排除
- **アトミック書き込み**: 状態ファイルは tmp → rename で書き込み
- **fail-closed**: レビュアー失敗はリトライ1回、それでも失敗なら Gate 不成立
- **構造化出力**: Zod バリデーション + リトライで信頼性確保（StructuredOutputError）
- **Smart Skip**: 入力ハッシュ（contracts/config/prompts）で変更なしステージをスキップ
- **DI パターン**: `ConversationDeps` で readline/output/summary/pipeline を注入可能にし、テスタブルに
- **Noop Gate デフォルト**: Gate 未指定時は全 PASS。後から実 Gate に差し替え可能

## SDK としての使い方（ライブラリ利用）

```typescript
import { createDefaultPipeline, claudeQuery } from "@sizukutamago/autospec";
import { createInitialState } from "@sizukutamago/autospec";

// ワンコールでパイプラインセットアップ
const engine = createDefaultPipeline({
  queryFn: (prompt) => claudeQuery(prompt, { cwd: "./my-project" }),
  taskDescription: "Build an online Othello game",
});

const state = createInitialState("./my-project");
const result = await engine.run(state, { cwd: "./my-project", resume: false, force: false });
```

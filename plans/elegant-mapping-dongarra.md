# blueprint-sdk v3: Plugin コア仕様移植 + ファセット外部化 + 設定ファイル

## Context

ギャップ分析の結果、SDK は「パイプラインエンジン（制御フロー）」は機能するが、Plugin のコア仕様（Contract YAML スキーマ、テスト導出、Review プロンプト、実装規約等）がほぼ全て未移植。SDK は「空の器」状態。

## 設計判断

| 項目 | 決定 |
|------|------|
| ファセット配置 | **両方**（SDK 同梱がデフォルト、.blueprint/facets/ で上書き可能） |
| Gate デフォルト | **review**（AI レビュー。noop は blueprint.yaml で切替） |
| .blueprint/ 初期化 | **両方**（`npx blueprint init` + 自動生成） |
| エンジン | **固定8ステージ維持**（takt の YAML 遷移は採用しない） |
| 実装進行 | **Phase ごとに確認** |

## ディレクトリ構成

### SDK 側（src/prompts/ に同梱）

```
src/prompts/
├── core/
│   ├── contract-schema.md        # Contract YAML スキーマ定義
│   ├── spec-workflow.md          # Spec 7ステップワークフロー
│   ├── test-generation-rules.md  # Level1/Level2 テスト導出ルール
│   ├── implement-workflow.md     # 3フェーズ実装ワークフロー
│   ├── docs-workflow.md          # ドキュメント生成ワークフロー
│   ├── blueprint-structure.md    # .blueprint/ ディレクトリ構造
│   └── id-system.md             # ID 採番規約
├── defaults/
│   ├── naming.md
│   ├── error-handling.md
│   ├── di.md
│   ├── testing.md
│   ├── validation-patterns.md
│   └── architecture/
│       ├── clean.md
│       ├── layered.md
│       └── flat.md
├── review-prompts/
│   ├── contract-reviewer.md      # 3エージェント
│   ├── test-reviewer.md          # 3エージェント
│   ├── code-reviewer.md          # 4エージェント
│   └── doc-reviewer.md           # 3エージェント
└── templates/
    ├── contract-api.yaml
    ├── contract-external.yaml
    ├── contract-file.yaml
    ├── concept.md
    └── decision.md
```

### プロジェクト側（.blueprint/）

```
.blueprint/
├── blueprint.yaml              # 設定ファイル
├── pipeline-state.yaml         # パイプライン状態
├── contracts/
│   ├── api/                    # CON-{name}.contract.yaml
│   ├── external/
│   ├── files/
│   └── internal/
├── concepts/                   # CONCEPT-{name}.md
├── decisions/                  # DEC-{NNN}-{name}.md
└── facets/                     # ユーザーカスタマイズ（オプション）
    ├── personas/
    ├── instructions/
    └── ...
```

### blueprint.yaml

```yaml
project:
  name: "othello-online"
  language: typescript
  runtime: node

pipeline:
  mode: full
  smart_skip: true
  max_turns:
    spec: 8
    test: 8
    implement: 12
    docs: 5

agents:
  researcher:
    enabled: true
    max_turns: 5
  web_researcher:
    enabled: true
    max_turns: 3
  interviewer:
    min_questions: 2
    max_questions: 5

gates:
  type: review                  # review | noop
  review:                       # review 時の設定
    contract_reviewers: 3
    test_reviewers: 3
    code_reviewers: 4
    doc_reviewers: 3

tech_stack:
  framework: none
  test: vitest
  validation: zod
  package_manager: npm

architecture:
  pattern: flat
```

### 設計レビューで確定した方針

- **ファセット上書き**: ファイル単位の全体置換（セクションマージはしない）
- **Gate テスト**: テスト内は noop 維持。review Gate はモックまたは統合テストで検証
- **init コマンド**: 非対話形式から開始（テンプレートを静的コピー）。TUI 対話は後から追加
- **package.json files**: `src/prompts` を追加してnpmパッケージにプロンプトファイルを同梱

## 実装フェーズ

### Phase 1: prompts/ ファイルコピー

Plugin の core/ + defaults/ + review-prompts/ + templates/ を SDK の src/prompts/ にコピー。
SDK 固有の修正は最小限（パスの調整程度）。

**対象ファイル数**: 約25ファイル（全て Markdown/YAML）
**変更コード**: なし（ファイルコピーのみ）
**検証**: ビルドに影響なし（プロンプトファイルは `files` に含めて npm パッケージに同梱）

### Phase 2: blueprint.yaml + config loader

- `src/config/schema.ts` — Zod スキーマ
- `src/config/loader.ts` — .blueprint/blueprint.yaml 読み込み + SDK 同梱デフォルトとマージ
- `src/config/defaults.ts` — デフォルト値

**検証**: テスト追加 + 型チェック

### Phase 3: Stage Handler プロンプト刷新

各 Stage Handler が src/prompts/ のファイルを読んでプロンプトに埋め込む。

- `spec.ts`: contract-schema.md + spec-workflow.md + id-system.md + blueprint-structure.md
- `test-gen.ts`: test-generation-rules.md + testing.md
- `implement.ts`: implement-workflow.md + defaults/*.md + architecture パターン
- `docs.ts`: docs-workflow.md + output-structure

**検証**: 既存テスト通過 + トライアル実行

### Phase 3.5: 接続確認チェックポイント

Phase 3 完了後、Phase 4 着手前に Stage 1 出力が Contract レビュープロンプトに渡せる形式かを確認。
othello-online で `npx blueprint --mode spec` を実行し、`.blueprint/contracts/` に YAML が生成されることを検証。

### Phase 4: Review Gate 実装

review-prompts/ のプロンプトを使って実際の AI レビューを実装。テスト内は noop 維持。
- contract-reviewer: 3エージェント並列
- test-reviewer: 3エージェント並列
- code-reviewer: 4エージェント並列
- doc-reviewer: 3エージェント並列

既存の `runReviewGate` インフラを活用。

**検証**: Gate テスト + トライアル

### Phase 5: `npx blueprint init` + 自動生成

- `init` サブコマンドで `.blueprint/` を TUI で対話的に生成
- 実行時に `.blueprint/` がなければ自動で init フローを起動

**検証**: init フロー動作確認

### Phase 6: 統合トライアル + Codex レビュー

othello-online で全フロー実行。Contract が YAML で生成されるか確認。

## 検証方法

各 Phase 完了時:
```bash
npm run typecheck && npm run test && npm run build
```

最終検証:
```bash
cd ../othello-online
npx blueprint init                    # .blueprint/ 生成
npx blueprint                         # フル実行
ls .blueprint/contracts/api/          # YAML contracts
cat .blueprint/pipeline-state.yaml    # 全ステージ completed
```

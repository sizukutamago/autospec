# Generate Docs Workflow

実装済みコードから設計書を `docs/` 配下に後追い生成するワークフロー。

> **前提**: `core/autospec-structure.md` と `core/doc-format-standards.md` を品質基準として参照。

## ワークフロー（5 ステップ）

### Step 1: プロジェクト分析

プロジェクトの全体像を把握する。

```
実行内容:
1. git root 検出
2. tech stack 推定
   - package.json / go.mod / Cargo.toml / requirements.txt 等
   - フレームワーク特定（React, Next.js, Hono, Express, etc.）
   - ORM 特定（Prisma, Drizzle, TypeORM, etc.）
   - テストフレームワーク特定（Vitest, Jest, pytest, etc.）
3. .autospec/ 読み込み
   - contracts → I/O 境界の把握
   - concepts → ドメイン理解
   - decisions → 設計判断の把握
4. ソースコード構造スキャン
   - ディレクトリ構造
   - エントリーポイント
   - 主要モジュール
```

**出力**: プロジェクトプロファイル（tech stack, 規模, 構成）

### Step 2: 自動抽出フェーズ（グループ A → B）

コードから設計情報を抽出し、docs/ 配下にファイルを生成する。

#### グループ A: コードから直接抽出（7 ファイル）

| # | 出力ファイル | 抽出元 | 抽出方法 |
|---|------------|--------|---------|
| 1 | `03_architecture/architecture.md` | package.json, ディレクトリ構造, import グラフ | 依存分析、レイヤー構成推定 |
| 2 | `03_architecture/adr.md` | `.autospec/decisions/*.md` | 集約・フォーマット変換 |
| 3 | `04_data_structure/data_structure.md` | ORM モデル, migration, schema | モデル定義抽出、ER 図生成 |
| 4 | `05_api_design/api_design.md` | ルート定義, コントローラ, OpenAPI spec | エンドポイント一覧抽出 |
| 5 | `05_api_design/integration.md` | 外部 API クライアント, `.autospec/contracts/external/` | 外部連携仕様集約 |
| 6 | `07_implementation/coding_standards.md` | biome/eslint 設定, コードパターン | 規約抽出、パターン分析 |
| 7 | `07_implementation/environment.md` | docker-compose, .env.example, CI | 環境構成抽出 |

#### グループ B: コード + 設定から抽出（8 ファイル）

| # | 出力ファイル | 抽出元 | 抽出方法 |
|---|------------|--------|---------|
| 8 | `03_architecture/security.md` | 認証/認可コード, helmet/cors | セキュリティ層分析 |
| 9 | `03_architecture/infrastructure.md` | IaC, Dockerfile, k8s manifests | インフラ構成抽出 |
| 10 | `03_architecture/cache_strategy.md` | Redis 設定, キャッシュコード | キャッシュ構成分析 |
| 11 | `07_implementation/test_strategy.md` | テストファイル構成, テスト設定 | テスト構造分析 |
| 12 | `07_implementation/test_plan.md` | 既存テストケース | テストケース一覧抽出 |
| 13 | `07_implementation/traceability_matrix.md` | Contract links + テスト | FR→テストマッピング |
| 14 | `07_implementation/nonfunctional_test_plan.md` | 負荷テスト設定 | NFR テスト抽出 |
| 15 | `07_implementation/operations.md` + `observability_design.md` | SLI/SLO, モニタリング設定 | 運用情報抽出 |

**確信度システム**:

各セクションに確信度を付与する:
- **high**: コードから確実に抽出（例: package.json の依存関係）
- **medium**: 推定を含む（例: ディレクトリ構造からのレイヤー推定）
- **low**: 情報不足で TODO（例: 設定ファイルが見つからない）

low 確信度のセクションは `<!-- TODO: 要確認 -->` マーカーを付ける。

### Step 3: 補足入力フェーズ（グループ C）

コードだけでは抽出困難な情報をユーザーに確認する。

| # | 出力ファイル | 必要な補足入力 |
|---|------------|---------------|
| 16 | `06_screen_design/screen_list.md` | コンポーネント一覧提示 → 画面名・用途の確認 |
| 17 | `06_screen_design/screen_transition.md` | ルーティング抽出結果 → 遷移図のレビュー |
| 18 | `06_screen_design/component_catalog.md` | 共通コンポーネント一覧（自動抽出可能な場合あり） |
| 19 | `06_screen_design/details/screen_detail_SC-XXX.md` | 各画面の意図・レイアウト確認 |
| 20 | `06_screen_design/error_patterns.md` | エラーハンドリングコード（自動抽出可能な場合あり） |
| 21 | `07_implementation/incident_response.md` | エスカレーションパスの確認 |

**対話方針**:
- フロントエンドがない場合（API のみ）は画面系ファイルをスキップ
- 運用設定が見つからない場合は TODO セクションとして生成
- ユーザーが「スキップ」した項目は空のテンプレートとして出力

### Step 4: トレーサビリティ検証

生成した設計書間の整合性を検証する。

```
検証項目:
1. Contract → テスト → 実装 の chain
   - 全 Contract ID がテストファイルで参照されているか
   - テスト対象の実装ファイルが存在するか

2. 設計書間の参照整合性
   - api_design.md の API が実際のルート定義と一致するか
   - data_structure.md のエンティティが ORM モデルと一致するか
   - architecture.md の技術スタックが package.json と一致するか

3. 孤児検出
   - 設計書に記載があるがコードに存在しない要素
   - コードに存在するが設計書に記載がない要素
```

**出力**: 不整合レポート（整合/不整合/TODO の 3 カテゴリ）

### Step 5: レビュー + サマリー

整合性チェックを実行し、サマリーを出力する。

```
レビューレベル:
- L1 (構造): 全ファイルが標準構造に準拠しているか
- L2 (整合性): ID 重複、参照先存在、用語統一
- L3 (完全性): TODO/プレースホルダーの残存数
- L4 (ファイル完全性): 必須ファイルが全て存在するか
- L5 (運用準備): SLI/SLO、テスト基準の定義（該当する場合）
```

**出力ファイル**:
- `08_review/consistency_check.md` — レビュー結果
- `08_review/project_completion.md` — 完了サマリー + 確信度レポート

```
## サマリー
- 生成ファイル数: N/M（M はスキップ含む全対象）
- 確信度分布: high: X, medium: Y, low: Z
- TODO 残数: N
- 不整合: N 件

## 確信度が low のセクション
- [ファイル:セクション] — 理由
```

## 入力ソースの tech stack 別ガイド

### Node.js / TypeScript
- package.json → 依存関係、スクリプト
- tsconfig.json → TypeScript 設定
- src/ or lib/ → ソースコード
- prisma/schema.prisma or drizzle/ → DB スキーマ
- routes/ or app/ → API ルート
- biome.json or .eslintrc → コーディング規約
- vitest.config.ts or jest.config.ts → テスト設定
- Dockerfile, docker-compose.yml → インフラ

### Python
- pyproject.toml or requirements.txt → 依存関係
- alembic/ → マイグレーション
- FastAPI/Django ルート定義 → API
- pytest.ini or conftest.py → テスト設定

### Go
- go.mod → 依存関係
- internal/ or pkg/ → ソースコード
- sqlc/ or ent/ → DB スキーマ

> 上記は代表例。実際のプロジェクト構成に応じて柔軟に対応する。

## 設計書フォーマット基準

各設計書のフォーマット・品質基準は `core/doc-format-standards.md` を参照する。

## 原則

| 原則 | 説明 |
|------|------|
| 事実を記録 | コードにないものを推測して書かない。不明な箇所は TODO にする |
| 確信度を明示 | 各セクションの情報源と確信度を明記する |
| 標準フォーマット | 出力フォーマットは docs/ 構造に準拠する |
| 段階的生成 | 全ファイルを一度に完成させなくてよい。TODO を残して次回に回せる |
| 対話で補完 | コードから不明な部分はユーザーに質問する |

## エラーハンドリング

| エラー | 対応 |
|--------|------|
| ソースコードなし | 対象ディレクトリの確認を促す |
| 未知の tech stack | 汎用的な抽出ルールを適用 + ユーザーに確認 |
| .autospec/ なし | Contract なしでも docs/ 生成は可能（トレーサビリティ検証がスキップされる） |
| フロントエンドなし | 画面系ファイル (06_screen_design/) をスキップ |

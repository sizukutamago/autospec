# Implement Workflow

Contract YAML + RED テストから実装コードを生成するワークフロー。
3 フェーズ（Implementers → Integrator → Refactorer）で段階的に実装し、
最後に /simplify でコード品質を仕上げる。

> **前提**: `contract-schema.md`、`test-from-contract.md`、`autospec-structure.md` を参照。

## ワークフロー（3 フェーズ + 7 ステップ）

### Step 1: コンテキスト読み込み

プロジェクトの状態を把握する。

```
実行内容:
1. .autospec/config.yaml を読み込み（tech stack、architecture pattern）
2. .autospec/contracts/ の全 Contract をスキャン
   - implementation セクションの有無を確認
   - links.depends_on を収集
3. tests/contracts/ の RED テスト（Level 2）を確認
4. 既存コードの構造を把握（brownfield の場合）
```

**config.yaml が存在しない場合**:
- エラー: 「/spec を先に実行して config.yaml を生成してください」
- config.yaml は `/spec` 実行時に生成される

**implementation セクションがない Contract**:
- 警告: 「CON-xxx に implementation セクションがありません。AI が処理フローを推定します」
- 可能な限り business_rules と depends_on から推定するが、精度は下がる

### Step 2: 実装計画の生成と承認

Contract の依存関係から実装順序を決定し、ユーザー承認を得る。

```
実行内容:
1. depends_on でトポロジカルソート
   - 循環依存を検出した場合はエラー（/spec で修正が必要）
2. 並列実行可能なグループを特定
   - 依存なし Contract は同一グループ（並列実行可能）
   - 依存あり Contract は依存先の完了後に実行
3. 必要な依存パッケージを特定
4. 実装計画をユーザーに提示

提示フォーマット:
| 順序 | Contract ID          | Type     | 依存先            | 並列グループ |
|------|---------------------|----------|------------------|------------|
| 1    | CON-stripe-payment  | external | なし              | A          |
| 2    | CON-order-create    | api      | CON-stripe-...   | B          |
| 3    | CON-product-import  | file     | なし              | A          |

追加パッケージ: hono, zod, drizzle-orm
インストールコマンド: pnpm add hono zod drizzle-orm

ユーザーの選択肢:
- 承認: 依存パッケージをインストールし Phase A に進む
- 修正: 計画を修正
- 中止: パイプラインを停止
```

## Phase A: Implementers（N エージェント、並列実行）

### Step 3: Contract 単位の実装

各 Implementer は 1 つの Contract を担当し、RED テストを GREEN にする。
ディレクトリ・ファイルの作成から実装まで全て Implementer が行う。

```
各 Implementer の実行内容:
1. 担当 Contract の implementation セクションを読み込み
2. core/defaults/ の規約を参照（naming, architecture-patterns, error-handling, di）
3. 対応する RED テスト（Level 2）を読み込み
4. 担当 Contract に必要な全ファイルを作成:
   a. 型定義（Contract input/output から導出）
   b. バリデーションスキーマ（Contract 制約 → スキーマ）
   c. ビジネスロジック（business_rules → TDD で実装）
   d. Repository interface + 実装（data_sources に基づく）
   e. ルートファイル（method + path からルート定義）
5. 担当テスト（Level 2）を実行して GREEN を確認
```

**Implementer の入力**:

| 入力 | 情報源 |
|------|-------|
| I/O 定義 | Contract YAML（input/output/errors） |
| 内部設計 | Contract YAML（implementation セクション） |
| 期待動作 | tests/contracts/ の RED テスト（Level 2） |
| tech stack | .autospec/config.yaml |
| 命名・構造規約 | core/defaults/ |

**business_rules の TDD**:

Contract の `business_rules` に対応するロジックは TDD で実装する。

```
TDD 対象の判断基準:
- Contract の business_rules に名前がついているロジック → TDD
- 単純な配線（ルーティング、DI、スキーマ定義）→ 直接実装

TDD 手順:
1. ビジネスロジックのユニットテストを先に書く（RED）
2. ロジックを実装（GREEN）
3. 次の flow ステップへ

ユニットテストの配置:
tests/
  contracts/          ← /test-from-contract 生成（触らない）
  unit/               ← Implementer が生成
    {entity}/
      {logic-name}.test.ts
```

**名前空間分離（並列実行ルール）**:

- 各 Implementer は自分の担当エンティティの名前空間のみ編集
  - 例: `domain/order/`, `usecase/order/`, `infra/order/`, `interface/order/`
- 共有ファイル（app entry, DI container）は作成しない → Integrator が担当
- トポロジカルソートの同一グループは並列実行可能
- 依存先が完了するまで待機

**Contract タイプ別の実装内容**:

| タイプ | 主な実装内容 |
|--------|------------|
| api | ルート定義、バリデーション、UseCase、Repository |
| external | API クライアント、リトライロジック、エラーハンドリング |
| file | パーサー、行バリデーション、バルク処理 |
| internal (service) | ドメインサービス、状態管理、副作用ロジック |
| internal (repository) | データ永続化、CRUD メソッド、ストレージアクセス |

**実装の進め方**:

- `implementation.flow` がある場合: flow のステップ順に実装
- `implementation.flow` がない場合: 一括実装（全ファイルを書いてからテスト実行）

### Step 3.5: ブロック処理

Implementer が実装できない場合の処理。

```
ブロック条件:
- DB スキーマが未定義で data_source.access: db の実装ができない
- 依存先 Contract がスキップされた
- 外部 API のモック情報が不足
- implementation セクションの情報が不足で推定も困難

失敗時の挙動:
1. テスト失敗 → 修正して再試行（回数制限なし）
2. 同じエラーが 3 回連続 → ユーザーに報告
   「CON-xxx のテスト X が GREEN にできません。エラー: ...」
   → ユーザーが指示（ヒント提供 / 手動修正 / スキップ判断）
3. 勝手にスキップしない
```

**ブロック記録フォーマット**:

```yaml
blocked:
  - contract_id: CON-xxx
    reason: "missing_schema"          # missing_schema | dependency_skipped | insufficient_info | mock_needed
    detail: "products テーブルのスキーマが未定義"
    required_input: "DB スキーマ定義 or Prisma/Drizzle のスキーマファイル"
```

## Phase B: Integrator（1 エージェント、逐次実行）

### Step 4: 統合検証

全 Implementer の成果を統合して品質を確認する。

```
実行内容:
1. app entry の結線
   - 各 Implementer が作成したルートファイルを app.ts にインポート・登録
   - DI container の構成（必要な場合）
   - 共通ミドルウェアの設定
2. 全テスト一括実行（Level 1 + Level 2 + Unit）
   - 失敗テストがあれば修正を試みる
   - 同じエラーが 3 回連続したらユーザーに報告
3. ブロックされた Contract のリスト提示
4. import 循環の検出（レイヤー違反チェック）
```

## Phase C: Refactorer（1 エージェント、コンテキスト非共有）

### Step 5: 構造リファクタリング

Implementer・Integrator とコンテキストを共有しない独立エージェントが、
フレッシュな視点でコード品質を改善する。

```
設計思想:
- Code Review Gate と同じ「コンテキスト非共有」の原則
- 書いた人の思考に引きずられず、構造の問題を発見する
- core/defaults/ を自分で読み、設計規約を把握する

実行内容:
1. core/defaults/ を読み込み（naming, architecture-patterns, error-handling, di）
2. 実装コード全体を読み込み
3. 構造改善:
   - Implementer 間で生まれた重複コードの排除
   - 共通ロジックの抽出（ユーティリティ化）
   - 命名の統一（core/defaults/naming.md 準拠）
   - レイヤー構造の整合性確認
4. 全テスト実行（リファクタで壊れていないことを確認）
```

### Step 6: コード簡素化

/simplify を実行し、コードの可読性・効率・再利用性を最終チェックする。

```
実行内容:
- 変更されたコードの品質レビュー
- 不要な複雑性の排除
- コードスタイルの統一
```

### Step 7: 承認 + pipeline-state 更新

ユーザーに実装結果を提示して承認を得る。

```
提示内容:
1. 実装サマリー:
   - 完了 Contract 数 / 全 Contract 数
   - 新規ファイル数、変更ファイル数
   - テスト結果（GREEN 数 / 全テスト数）
2. ブロックリスト（ある場合）:
   - 各 Contract のブロック理由と必要な入力
3. 品質レポート:
   - import 循環の有無
   - Refactorer の改善サマリー
   - /simplify の改善サマリー

ユーザーの選択肢:
- 承認: Code Review Gate に進む
- 修正: 具体的な修正指示を受けて再実行
- 中止: パイプラインを停止（成果物は保持）
```

**Stage 3 の終了状態**:

| 状態 | 条件 | 次のアクション |
|------|------|--------------|
| success | 全 Contract 完了 + 全テスト GREEN | Code Review Gate へ |
| partial | ブロックあり + 他は GREEN | ブロックリスト提示、ユーザー判断 |
| failed | テスト修正不能 | ユーザーに報告、手動修正後 --resume |

**pipeline-state 更新**:

```yaml
stage_3_implement:
  status: completed | partial | failed
  implementers:
    total_contracts: N
    completed: N
    blocked: [...]                  # ブロックリスト
    unit_tests_generated: N         # business_rules TDD で生成したテスト数
  integrator:
    app_entry_wired: true | false
    test_results: { pass: N, fail: N }
    circular_imports: N
  refactorer:
    duplicates_removed: N
    extractions: N
    naming_fixes: N
  simplify:
    improvements: N
  plan_approval: accepted | modified       # 実装計画承認
  final_approval: accepted | modified      # 実装完了承認
```

## エラーハンドリング

| エラー | 対処 |
|--------|------|
| config.yaml が存在しない | エラー停止: `/spec` を先に実行するよう案内 |
| Contract に implementation セクションがない | 警告 + AI 推定で続行 |
| 循環依存の検出 | エラー停止: `/spec` で依存関係を修正するよう案内 |
| テスト GREEN にできない（同一エラー 3 回連続） | ユーザーに報告、指示を仰ぐ |
| 依存パッケージのインストール失敗 | エラー表示 + 手動インストールを案内 |
| Implementer がタイムアウト | ユーザーに報告、指示を仰ぐ |

## config.yaml スキーマ

`/spec` の Step 2 で生成される。Implementer が参照する。

```yaml
# .autospec/config.yaml
project:
  name: "プロジェクト名"
  language: typescript | javascript       # 検出 or ユーザー指定
  runtime: node | deno | bun              # 検出 or ユーザー指定

architecture:
  pattern: clean | layered | flat          # ユーザー選択
  # pattern ごとのレイヤー定義は core/defaults/architecture-patterns/ を参照

tech_stack:
  framework: hono | express | fastify | next | none   # 検出 or 選択
  orm: drizzle | prisma | typeorm | none               # 検出 or 選択
  validation: zod | joi | yup | class-validator        # 検出 or 選択
  test: vitest | jest                                   # 検出 or 選択
  package_manager: pnpm | npm | yarn | bun             # 検出

quality:
  lint: biome | eslint | none              # 検出 or 選択
  format: biome | prettier | none          # 検出 or 選択
  type_check: true | false                 # tsconfig.json の存在で検出
  ci:
    enabled: true | false
    provider: github-actions | none        # .github/ の存在で検出
    pre_commit: [lint, type_check]         # オプション
    pr: [lint, type_check, test]           # オプション
```

**検出ロジック**（brownfield 対応）:

| 検出対象 | 検出方法 |
|---------|---------|
| language | `tsconfig.json` の存在 → typescript、なければ javascript |
| package_manager | `pnpm-lock.yaml` / `yarn.lock` / `package-lock.json` / `bun.lockb` |
| framework | `package.json` の dependencies キーワード |
| orm | `package.json` の dependencies + `prisma/schema.prisma` 等 |
| lint | `biome.json` / `.eslintrc*` の存在 |
| ci | `.github/workflows/` の存在 |

**手動オーバーライド**: config.yaml を直接編集すれば、検出結果を上書きできる。

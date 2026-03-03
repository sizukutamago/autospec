# Doc Review Swarm プロンプト

パイプライン Stage 4 後の Doc Review Gate で使用するレビュープロンプト。
3 エージェントが並列でレビューし、findings を返す。

## 共通入力

各エージェントに以下を渡す:
- `docs/` 配下の全設計書ファイルパスリスト
- `.autospec/contracts/` の Contract YAML（トレーサビリティ検証用）
- `tests/contracts/` のテストファイル（chain 検証用）
- `core/output-structure.md`（必須ファイル一覧参照）
- `core/review-criteria.md`（5 段階レビュー基準参照）
- `core/doc-format-standards.md`（設計書フォーマット・必須セクション基準）

## 共通出力フォーマット

```yaml
reviewer: "{エージェント名}"
gate: "doc"
findings:
  - severity: P0 | P1 | P2
    target: "docs/03_architecture/architecture.md"
    field: "セクション名 or 行番号"
    message: "問題の説明"
    suggestion: "修正提案"
summary:
  p0: 0
  p1: 0
  p2: 0
```

> **Note**: REVISE サイクルで severity を変更する場合は `core/review-criteria.md` の Severity ガバナンスルールに従い、`disposition` + `disposition_reason` + `original_severity` を記録すること。

---

## Agent 1: Structure Reviewer（L1-L2）

### 役割

設計書の構造的正当性と整合性を検証する。
`core/review-criteria.md` の Level 1（構造チェック）と Level 2（整合性チェック）に対応。

### チェック手順

```
Level 1: 構造チェック

1. 各設計書ファイルの基本構造:
   - Markdown 見出し階層が適切か（h1 → h2 → h3 の順序） → 違反: P2
   - テーブル形式が正しいか（列数の一貫性） → 崩れ: P2
   - コードブロックが閉じているか → 未閉鎖: P1

2. 必須セクションの存在:
   - architecture.md: 技術スタック、システム境界、NFR 方針 → 欠落: P1
   - data_structure.md: エンティティ一覧、ER 図 → 欠落: P1
   - api_design.md: エンドポイント一覧 → 欠落: P1
   - test_strategy.md: テスト方針、カバレッジ目標 → 欠落: P1
   - 各ファイルの必須セクションは core/doc-format-standards.md を参照

Level 2: 整合性チェック

3. ID 形式準拠:
   - FR-XXX, NFR-XXX, SC-XXX, API-XXX, ENT-{Name}, ADR-XXXX の形式
   → 形式違反: P2

4. ID 重複チェック:
   - 全ファイル横断で同一 ID が複数定義されていないか
   → 重複: P1

5. ID 参照チェック:
   - 参照先 ID が定義元のファイルに存在するか:
     - API-xxx → api_design.md
     - ENT-xxx → data_structure.md
     - SC-xxx → screen_list.md
     - FR-xxx → user-stories.md (docs/requirements/)
   → 参照先不在: P1

6. 用語統一:
   - 同じ概念に異なる用語が使われていないか
   → 不統一: P2
```

---

## Agent 2: Completeness Reviewer（L3-L5）

### 役割

設計書の完全性と運用準備状況を検証する。
`core/review-criteria.md` の Level 3（完全性）、Level 4（ファイル完全性）、Level 5（運用準備）に対応。

### チェック手順

```
Level 3: 完全性チェック

1. TODO / プレースホルダー残存:
   - `<!-- TODO: -->` コメントの数 → 5 件以上: P1, 1-4 件: P2
   - `{{xxx}}` プレースホルダーの残存 → 存在: P1
   - 「TBD」「未定」の記載 → 存在: P2

2. 必須項目の記入状況:
   - 各セクションが空でないか → 空セクション: P1
   - 受入基準が検証可能な形式か（数値基準、条件式等） → 曖昧: P2

3. 確信度チェック（generate-docs 固有）:
   - 確信度 low のセクション数 → 3 件以上: P1, 1-2 件: P2
   - high/medium/low の分布が妥当か（low > 50% → P1）

Level 4: ファイル完全性チェック

4. 必須ファイル存在:
   core/output-structure.md に定義された必須ファイルが全て存在するか:
   - docs/03_architecture/architecture.md → 欠落: P1
   - docs/03_architecture/adr.md → 欠落: P1
   - docs/04_data_structure/data_structure.md → 欠落: P1
   - docs/05_api_design/api_design.md → 欠落: P1
   - docs/07_implementation/coding_standards.md → 欠落: P2
   - docs/07_implementation/test_strategy.md → 欠落: P1
   - docs/07_implementation/test_plan.md → 欠落: P1
   - docs/07_implementation/traceability_matrix.md → 欠落: P1
   - docs/07_implementation/observability_design.md → 欠落: P1
   - docs/07_implementation/operations.md → 欠落: P1
   - docs/08_review/consistency_check.md → 欠落: P2
   - docs/08_review/project_completion.md → 欠落: P2

   条件付きファイル:
   - docs/06_screen_design/ → フロントエンドがある場合のみ必須
   - docs/07_implementation/backup_restore_dr.md → sla_tier != basic の場合
   - docs/07_implementation/migration_plan.md → has_migration = true の場合

Level 5: 運用準備チェック（review-criteria.md 参照）

5. SLI/SLO 定義:
   - observability_design.md に SLI/SLO が定義されているか → 未定義: P1
   - SLI が測定可能な指標か → 曖昧: P2

6. テスト完了基準:
   - test_plan.md にテスト完了基準が定量的に定義されているか → 未定義: P1
   - カバレッジ目標値が設定されているか → 未設定: P2

7. NFR 測定方法:
   - nonfunctional_test_plan.md に NFR ごとの測定方法と合否基準があるか → 未定義: P1

8. トレーサビリティマトリクス:
   - traceability_matrix.md が FR → 設計 → テスト の chain をカバーしているか → 不完全: P1

9. ロールバック手順:
   - operations.md にロールバック手順が定義されているか → 未定義: P1
```

---

## Agent 3: Accuracy Reviewer

### 役割

設計書の内容がソースコードの実態と一致しているかを検証する。
原則「事実を記録する」（generate-docs.md）に照らし、乖離を検出する。

### チェック手順

```
1. API 定義 ↔ ルート定義コードの一致:
   - api_design.md のエンドポイント一覧を取得
   - ソースコードのルート定義ファイル（routes/, app/, controllers/ 等）をスキャン
   - 設計書にあるがコードにないエンドポイント → P1
   - コードにあるが設計書にないエンドポイント → P1
   - メソッド（GET/POST/PUT/DELETE）の不一致 → P1
   - パスの不一致 → P1

2. エンティティ定義 ↔ ORM モデルの一致:
   - data_structure.md のエンティティ一覧を取得
   - ORM モデルファイル（prisma/schema.prisma, models/, entities/ 等）をスキャン
   - 設計書にあるがコードにないエンティティ → P1
   - コードにあるが設計書にないエンティティ → P2
   - フィールド型の不一致 → P2

3. 技術スタック ↔ package.json の一致:
   - architecture.md の技術スタック記載を取得
   - package.json / go.mod / pyproject.toml の依存関係と照合
   - 設計書に記載のフレームワークが依存関係に存在するか → 不在: P1
   - バージョンの大幅な乖離 → P2

4. Contract ↔ テスト ↔ docs のトレーサビリティ chain:
   - 全 Contract ID がテストファイルの @contract コメントに存在するか → 欠落: P1
   - 全 Contract ID が traceability_matrix.md に記載されているか → 欠落: P1
   - テストで参照されている FR-xxx が user-stories.md に存在するか → 不在: P1

5. セキュリティ設定の一致:
   - security.md の認証方式がコードの認証実装と一致するか
   → 不一致: P1（JWT と書いてあるが Session 実装等）
   - security.md のない場合はスキップ

6. 確信度 low セクションの実態チェック:
   - 確信度 low のセクションについて、実際にソースコードで情報が得られるか
   → 情報がある場合: P2（確信度を上げられる可能性）
   → 情報がない場合: そのまま（正しい判定）
```

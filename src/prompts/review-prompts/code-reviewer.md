# Code Review Swarm プロンプト

パイプライン Stage 3（実装）完了後、Stage 4 前に実行する Code Review Gate のレビュープロンプト。
Contract YAML に宣言された制約と実装コードの乖離、およびコード品質を 4 エージェントが並列で検出する。

**テスト GREEN チェックとの違い**:
- GREEN チェック: テストが PASS するか（動作の正しさ）
- Code Review Gate: Contract の宣言がコードに反映されているか（宣言の一致）
- 例: テストが GREEN でも、Zod スキーマに `max: 99` が欠落していれば Code Review Gate が検出

## 共通入力

各エージェントに以下を渡す:
- Contract YAML ファイル（`.autospec/contracts/**/*.contract.yaml`）
- ソースコード（`src/`, `app/`, `routes/` 等のメインコードディレクトリ）
- バリデーションスキーマ（Zod, Joi, Yup 等の定義ファイル）
- テストファイル（`tests/contracts/` — 参考情報として）
- `core/contract-schema.md` の内容（Contract フィールド定義参照）
- `core/review-criteria.md` の内容（critical/major/minor 定義、Gate 判定基準、Severity ガバナンスルール）

## 共通出力フォーマット

```yaml
reviewer: "{エージェント名}"
gate: "code"
findings:
  - severity: critical | major | minor
    target: "CON-xxx"
    field: "contract field path (e.g., input.body.quantity.max)"
    impl_file: "src/xxx.ts:42"
    message: "乖離の説明"
    suggestion: "修正提案"
    disposition: null          # null | false_positive | wont_fix | downgraded | deferred
    disposition_reason: null   # disposition が null でない場合は必須
    original_severity: null    # downgraded の場合、元の severity を記録
summary:
  critical: 0
  major: 0
  minor: 0
```

---

## Agent 1: Schema Compliance Checker

### 役割

Contract YAML のフィールド制約（type, required, min, max, pattern, enum, default）が
バリデーション層（Zod, Joi, class-validator 等）に正しく反映されているかを検証する。

### チェック手順

```
1. バリデーションスキーマの検出:

   以下のパターンでバリデーション定義を検索:
   - Zod: z.object / z.string / z.number 等の定義
   - Joi: Joi.object / Joi.string 等の定義
   - class-validator: @IsString / @IsNumber 等のデコレータ
   - Yup: yup.object / yup.string 等の定義
   - 未検出 → major（バリデーション層が存在しない）

2. Contract フィールドとの 1:1 対応チェック:

   各 Contract の input/request フィールドについて:
   a. 対応するバリデーション定義があるか → 欠落: major
   b. type が一致しているか:
      - Contract string → z.string() / Joi.string() 等
      - Contract integer → z.number().int() / Joi.number().integer() 等
      → 不一致: major
   c. required: true のフィールドがバリデーションで必須になっているか
      → .optional() が付いている: major
   d. min/max 制約がバリデーションに反映されているか:
      - Contract min: 1 → z.min(1) / Joi.min(1) 等
      - Contract max: 99 → z.max(99) / Joi.max(99) 等
      → 欠落: major、値の不一致: critical
   e. pattern 制約がバリデーションに反映されているか
      → 欠落: major、正規表現の不一致: critical
   f. enum 制約の値リストが一致しているか
      → 値の過不足: critical

3. 固定値フィールドの検証:

   Contract に value: "xxx" が定義されているフィールド:
   - 実装でハードコードされた値が一致しているか → 不一致: critical
   - 設定ファイル経由の場合、設定値が一致しているか → 不一致: major

4. default 値の検証:

   Contract に default が定義されているフィールド:
   - バリデーションまたはアプリケーション層でデフォルト値が設定されているか → 欠落: minor
   - デフォルト値が一致しているか → 不一致: major
```

---

## Agent 2: Route & Handler Checker

### 役割

api Contract の method/path と external Contract の endpoint/provider が
実装のルート定義・クライアント設定と一致しているかを検証する。

### チェック手順

```
1. api Contract のルート検証:

   各 api Contract について:
   a. method + path に対応するルート定義があるか:
      - Express: app.get/post/put/delete("/path", ...)
      - Hono: app.get/post/put/delete("/path", ...)
      - Fastify: fastify.get/post/put/delete("/path", ...)
      - Next.js: app/api/path/route.ts の export
      → 欠落: critical（API エンドポイントが未実装）
   b. method が一致しているか → 不一致: critical
   c. path パラメータが Contract と一致しているか → 不一致: major

2. external Contract の接続先検証:

   各 external Contract について:
   a. provider + endpoint に対応する HTTP クライアント設定があるか
      → 欠落: major
   b. endpoint URL が Contract と一致しているか → 不一致: critical
   c. 認証方式（auth フィールド）が実装と一致しているか → 不一致: major

3. エラーレスポンスの検証:

   各 Contract の errors 定義について:
   a. 定義された status code がレスポンスで使用されているか
      → 未使用の status code: major
   b. error code が実装のエラーレスポンスと一致しているか
      → 不一致: major（例: Contract "INSUFFICIENT_STOCK" vs 実装 "OUT_OF_STOCK"）
   c. エラーメッセージのフォーマットが一致しているか → 不一致: minor

4. レスポンス構造の検証:

   各 Contract の output/response 定義について:
   a. レスポンスフィールドが実装のレスポンスオブジェクトに存在するか
      → 欠落: major
   b. 型が一致しているか → 不一致: major
```

---

## Agent 3: Business Logic Checker

### 役割

Contract に定義された business_rules, state_transition, constraints が
実装のビジネスロジックに反映されているかを検証する。

### チェック手順

```
1. business_rules の実装確認:

   各 api Contract の business_rules について:
   a. BR-xxx の rule 記述に対応する実装ロジックが存在するか
      - ソースコード内に BR-xxx のコメント参照があるか
      - rule の内容に対応する条件分岐/バリデーションがあるか
      → 完全に欠落: critical
      → 部分的に実装: major（コメントで明記）
   b. ルールの条件値が Contract と一致しているか
      - 例: Contract "quantity は stock 以下" → 実装に stock チェックがあるか
      → 不一致: major

2. state_transition の実装確認:

   state_transition が定義されている Contract について:
   a. 状態遷移の初期状態（initial）が実装に反映されているか → 欠落: major
   b. 許可遷移（transitions の from → to）が実装されているか → 欠落: major
   c. 拒否遷移（未定義の from → to）が拒否されるか
      → ガードなし: major
   d. 遷移時のアクション（action フィールド）が実装されているか → 欠落: minor

3. constraints の実装確認（external Contract）:

   各 external Contract の constraints について:
   a. EC-xxx の rule 記述に対応する実装があるか:
      - 冪等性（idempotency）: リクエストにべき等キーを含む実装があるか
      - タイムアウト: HTTP クライアントにタイムアウト設定があるか
      - リトライ: リトライロジックが実装されているか
      → 欠落: major
   b. 制約値が Contract と一致しているか:
      - timeout: 30s → 実装のタイムアウト値が 30000ms か
      - max_retries: 3 → リトライ回数が 3 か
      → 不一致: major

4. processing_rules の実装確認（file Contract）:

   各 file Contract の processing_rules について:
   a. PR-xxx の rule 記述に対応する実装ロジックが存在するか → 欠落: major
   b. result 構造（success/error）が実装のレスポンスと一致しているか → 不一致: major
```

---

## Agent 4: Code Quality Checker

### 役割

実装コードの構造品質（レイヤー違反、重複、複雑度、命名規約）を検証する。
Contract との一致ではなく、`core/defaults/` の実装規約への準拠を確認する。

### チェック手順

```
1. レイヤー依存方向の検証:

   .autospec/config.yaml の architecture.pattern を確認し、
   core/defaults/architecture-patterns/{pattern}.md の依存方向ルールに基づいて:
   a. 禁止方向の import があるか:
      - Clean: domain → infra, domain → interface, usecase → infra（直接）
      - Layered: models → services, models → routes
      → 違反: major
   b. 循環 import があるか → 存在: major

2. 巨大関数の検出:

   関数/メソッドの行数を確認:
   a. 50 行超 → minor（分割を推奨）
   b. 100 行超 → major（分割が必要）
   ※ テストファイルは除外

3. 重複コードの検出:

   Contract 間で類似した実装パターンを検出:
   a. 10 行以上の同一/類似ブロック → minor（共通化を推奨）
   b. 同一ロジックが 3 箇所以上 → major（共通化が必要）

4. 命名規約の検証:

   core/defaults/naming.md の規約に基づいて:
   a. ファイル名が kebab-case + 正しいサフィックスか → 違反: minor
   b. エクスポート名が規約に従っているか → 違反: minor
   c. 変数名が camelCase / UPPER_SNAKE_CASE か → 違反: minor

5. エラーハンドリングの検証:

   core/defaults/error-handling.md の規約に基づいて:
   a. catch ブロックでエラーが握りつぶされていないか → 握りつぶし: major
   b. 外部 API エラーが AppError にラップされているか → 未ラップ: minor
   c. バリデーションエラーが ValidationError に変換されているか → 未変換: minor
```

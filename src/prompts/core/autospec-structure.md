# Autospec Structure

`.autospec/` ディレクトリの構造規約。
プロジェクトのドメイン知識・I/O 境界仕様・設計判断を管理する。

## ディレクトリ構造

```
.autospec/
├── contracts/           # I/O 境界仕様（テスト強制）
│   ├── api/             # 自社公開 API
│   ├── external/        # 外部 API 連携
│   ├── files/           # ファイル連携（CSV/バッチ等）
│   └── internal/        # 内部サービス・リポジトリ
├── concepts/            # ドメイン知識（Obsidian 風メモ）
└── decisions/           # 設計判断記録（ADR 形式）
```

## 3 レイヤーの役割

| レイヤー | 役割 | 厳密度 | テスト強制 |
|---------|------|--------|-----------|
| contracts/ | I/O 境界の機械可読仕様 | 高（YAML スキーマ準拠） | あり |
| concepts/ | ドメイン概念の説明・相互関係 | 中（テンプレート推奨） | なし |
| decisions/ | 設計判断の記録と根拠 | 中（ADR 形式推奨） | なし |

### contracts/
- **Contract YAML** 形式（詳細は `contract-schema.md` を参照）
- テストで仕様を強制（Level 1: 構造検証、Level 2: 実装検証）
- 変更は SemVer で管理、破壊的変更は承認フロー必須

### concepts/
- ドメイン概念を Obsidian 風の Markdown で記述
- frontmatter に `id` と `links` を必須で含む
- 本文中で `[[概念名]]` による相互リンクを推奨
- Contract 作成時の文脈情報として消費される

### decisions/
- ADR (Architecture Decision Record) 形式
- frontmatter に `id`, `status`, `date`, `links` を含む
- 本文: Context / Decision / Reason / Alternatives Considered / Consequences
- Contract の `decided_by` リンクから参照される

## ノード共通メタデータ

全ノード（contract, concept, decision）に必須:

```yaml
id: "{PREFIX}-{name}"      # 一意識別子
```

contract は追加で: `type`, `version`, `status`, `owner`, `updated_at`

## ID 体系

| プレフィックス | 用途 | 形式 | 例 |
|---------------|------|------|-----|
| CON- | Contract | CON-{name} | CON-order-create |
| CONCEPT- | Concept | CONCEPT-{name} | CONCEPT-order |
| DEC- | Decision | DEC-{NNN}-{name} | DEC-001-payment-provider |

## Link Types

ノード間の関係を frontmatter の `links` で表現する。

| タイプ | 意味 | 例 |
|--------|------|-----|
| implements | どの要件を実装するか | `implements: [FR-001]` |
| depends_on | 依存先ノード | `depends_on: [CON-stripe-payment-intent]` |
| decided_by | 関連する設計判断 | `decided_by: [DEC-001]` |
| impacts | 影響を与える先 | `impacts: [CON-order-create]` |

### links の記法

**Contract (YAML)**:
```yaml
links:
  implements: [FR-001, FR-002]
  depends_on: [CON-stripe-payment-intent]
  decided_by: [DEC-001]
  impacts: []
```

**Concept / Decision (frontmatter)**:
```yaml
---
id: CONCEPT-order
links:
  - type: depends_on
    target: CONCEPT-product
  - type: depends_on
    target: CONCEPT-payment
---
```

## 初期化

プロジェクトで初めて `.autospec/` を使う場合:

1. `.autospec/` ディレクトリと 3 つのサブディレクトリを作成
2. 最初の concept を 1 つ以上作成（ドメインの核となる概念）
3. 最初の contract を作成（`/spec` スキルが支援）

## AI コンテキスト取得パターン

AI がタスクを実行する際のコンテキスト取得順序:

1. **対象 Contract を特定**: タスクに最も関連する Contract を読む
2. **1-hop 依存**: `depends_on`, `decided_by` のノードを読む
3. **2-hop コンテキスト**: 必要に応じて依存先の依存先まで辿る
4. **concepts で補足**: ドメイン理解が不足していれば関連 concept を読む

> 全ノードを一括読み込みしない。対象 Contract 起点で必要な分だけ取得する。

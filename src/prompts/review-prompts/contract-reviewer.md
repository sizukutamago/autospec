# Contract Review プロンプト

Contract YAML の品質をレビューする。
3 エージェントが並列でレビューし、findings を返す。

## 重要: Severity 基準

- **critical**: YAML パース不可、テスト/実装ステージが完全に動作不能になる問題のみ
- **major**: テスト導出を妨げる曖昧さ、欠落した型情報、不整合
- **minor**: 命名規約、メタデータ欠落、推奨事項

> critical は「パイプラインが壊れる」問題に限定すること。スキーマ形式やスタイルは major/minor。

## チェック対象

`.autospec/contracts/` 配下の全 YAML ファイルを読み込んでレビューする。

---

## Agent 1: 構造チェック

1. YAML としてパース可能か → 不可: critical
2. `id` が存在するか → 欠落: critical
3. `type` が定義されているか → 欠落: major
4. 関数/メソッドの `returns` が定義されているか → 欠落: major
5. `depends_on` の参照先が実在するか → 実在しない: major
6. `constraints` が存在するか → 欠落: minor

---

## Agent 2: 完全性チェック

1. 各入力パラメータに `type` が定義されているか → 未定義: major
2. 数値パラメータに範囲制約（min/max）があるか → 未定義: major
3. 異常系の動作が定義されているか → 未定義: major
4. 戻り値の型と説明が明確か → 不明確: major
5. ID の命名形式（推奨: CON-*）→ 非準拠: minor
6. version/status/owner 等のメタデータ → 欠落: minor

---

## Agent 3: テスト可能性チェック

1. 各関数の invariants/constraints からテストケースを導出できるか
   → 曖昧で導出不可: major
2. 入力パラメータの境界値テストが導出可能か
   → 制約なしで導出不可: major
3. 曖昧表現（「適切に」「必要に応じて」等）がないか
   → 検出: minor
4. エラーケースの発生条件が明確か
   → 不明確: major

# blueprint-sdk ユーザー体験レビューノート

> othello-online サンプルプロジェクト構築時のフィードバック

## 良い点

### API の明快さ
- `PipelineEngine` + `register()` + `run()` の3ステップ API は直感的
- 「エンジン作って、ハンドラ登録して、走らせる」というメンタルモデルが分かりやすい

### 型安全性
- `StageId` がリテラル型で定義されているので、`register()` 時にタイポを検出できる
- `StageHandler` の型が `(state, options) => Promise<StageResult>` と明確

### 状態管理
- YAML ベースの pipeline-state.yaml は人間が読みやすく、デバッグしやすい
- アトミック書き込み（tmp → rename）で中途半端な状態を防止

### フェイルセーフ
- blocked guard: Stage 3 の失敗が Stage 4 に波及しない仕組みが安心
- Gate 失敗時に `final_status = "aborted"` が自動設定される

### Resume 機能
- `--resume` で途中再開できるのは実用的（パイプライン実行は時間がかかるため）

## 使いにくい点・改善提案

### 1. 全 8 ステージの手動登録が面倒
**現状**: 8 回 `engine.register()` を呼ぶ必要がある
```typescript
engine.register("stage_1_spec", handler1);
engine.register("contract_review_gate", handler2);
// ... 6 回繰り返し
```
**提案**: `engine.registerAll({ stage_1_spec: handler1, ... })` のようなバッチ登録 API

### 2. StageResult の型が曖昧
**現状**: `status: StageStatus | GateStatus` が union で、Stage と Gate の区別が型レベルで曖昧
**問題**: Gate ハンドラが `{ status: "completed" }` を返してもコンパイルエラーにならない
**提案**: `StageResult` と `GateResult` を分離し、`register()` をオーバーロードする

### 3. SDK 参照方法のドキュメント不足
**現状**: npm publish 前の `file://` 参照パターンがドキュメントにない
**提案**: CLAUDE.md か README に「ローカル開発時の使い方」セクションを追加

### 4. claudeQuery ラッパーの提供
**現状**: SDK ユーザーが毎回 `query()` → AsyncGenerator → テキスト抽出のボイラープレートを書く
**提案**: SDK 側で `claudeQuery(prompt, options) => Promise<string>` ユーティリティを提供

### 5. createInitialState の ImplementStageState.blocked
**現状**: `blocked: []` が初期値だが、Stage 3 以外のステージにも `blocked` プロパティが存在するかのような型に見える
**実態**: `ImplementStageState` は `stage_3_implement` だけの型だが、他のステージと混在する stages マップの中で少し分かりにくい

### 6. 【重大】デフォルトパイプラインが無い — ユーザーに不要な作業を強いている
**発覚**: othello-online サンプル構築時にユーザーから指摘
**現状**: SDK は「パーツ」を提供するだけで、組み立てはユーザー任せ
  - `PipelineEngine` を作る
  - 8 個のハンドラを `register()` する
  - `claudeQuery` ラッパーを自前で書く
  - noop Gate を自前で定義する
  - `run.ts` エントリポイントを自前で書く

**問題**: SDK にはステージハンドラ (`createSpecHandler` 等) が既にあるのに、ユーザーはそれを知らずにカスタムハンドラを書いてしまう。さらに CLAUDE.md にプロジェクト説明を書けば組み込みハンドラの汎用プロンプトで十分動くのに、わざわざプロンプトを書き直している。

**理想のユーザー体験**:
```bash
# ユーザーがやるべきことは:
# 1. CLAUDE.md にプロジェクトの説明を書く
# 2. 以下を実行するだけ
npx blueprint-sdk run
```

**提案**:
1. `createDefaultPipeline(queryFn)` — 組み込みハンドラ + noop Gate で 8 ステージ一括登録
2. `claudeQuery(prompt, options)` — SDK 組み込みユーティリティ
3. CLI (`npx blueprint-sdk run`) — `run.ts` すら書かなくて良い
4. Gate はオプション — 指定しなければ noop Gate をデフォルト適用

### 7. プロンプトのカスタマイズ手段が無い
**現状**: 組み込みハンドラのプロンプトは「Generate contracts for {root}」のような汎用文
**問題**: ユーザーがプロジェクト固有の指示を入れたい場合、ハンドラを丸ごと書き直すしかない
**提案**: `createSpecHandler({ queryFn, promptTemplate })` のようなテンプレート差し込み API、
または `blueprint.config.ts` のような設定ファイルでプロンプトをカスタマイズ

## takt との比較（nrslib/takt 調査結果）

### takt の概要
YAML 定義でAIエージェントのワークフローを宣言的に制御するオーケストレーションフレームワーク。
`takt run` だけで動く。blueprint-sdk と同じ領域だが成熟度が圧倒的に上。

### blueprint-sdk が劣っている点

| 観点 | takt | blueprint-sdk | 差 |
|------|------|---------------|-----|
| ワークフロー定義 | YAML 宣言的 | TypeScript 手続き的 | ユーザーの認知負荷が段違い |
| ステージ遷移 | ルール評価で動的分岐 | 固定8ステージ直列 | 柔軟性ゼロ |
| プロンプト管理 | ファセット分離（5関心分離） | ハンドラ内ベタ書き | 再利用不可 |
| 並列処理 | `parallel` 宣言 | なし | レビュアー並列しかできない |
| セッション | Phase間コンテキスト保持 | ステージ間で切れる | 情報ロスト |
| 組み込みワークフロー | 18+ ピース | なし | ゼロスタート |
| CLI | `takt` で即動く | `run.ts` 自前 | セットアップ工数 |
| プロバイダー | Claude/Codex/OpenCode/Cursor/Copilot | Claude のみ | ロックイン |

### takt の設計で参考にすべき点

1. **YAML 宣言的ワークフロー** — ユーザーにコードを書かせない
2. **ファセット分離** — persona/policy/knowledge/instruction/output-contract の5関心分離でプロンプト再利用
3. **ルール評価の段階的フォールバック** — タグ抽出 → AI判定の5段階
4. **組み込みピース** — すぐ使えるテンプレートが豊富
5. **セッション継続** — ステージ間でコンテキストが途切れない
6. **データ駆動処理 (arpeggio)** — CSV → テンプレート → バッチ実行

### 結論
blueprint-sdk は「パイプラインエンジンのパーツ」を提供しているだけで、
takt は「ユーザーが使えるプロダクト」を提供している。
SDK として使ってもらうには、takt のような宣言的設定 + CLI 体験が必要。

## 改善実施結果（Phase 1-6）

### 追加したモジュール

| ファイル | 目的 | テスト数 |
|----------|------|---------|
| `src/presets.ts` | `createDefaultPipeline()` — ワンコール8ステージ登録 | 6 |
| `src/query.ts` | `claudeQuery()` — SDK 組み込みユーティリティ | 6 |
| `src/gates/noop-gate.ts` | ビルトイン noop ゲート | 4 |
| `src/interactive/commands.ts` | スラッシュコマンドパーサー | 9 |
| `src/interactive/summary.ts` | 会話履歴 → タスク説明文生成 | 5 |
| `src/interactive/conversation.ts` | 対話ループ（DI ベース） | 8 |
| `src/cli.ts` | 対話モード対応 CLI（書き換え） | 6 |

**合計**: 既存 103 + 新規 44 = **147テスト全パス**

### 解消した問題

- **#4**: `claudeQuery` ラッパー SDK 組み込み化 → ユーザーがボイラープレートを書く必要なし
- **#6**: `createDefaultPipeline()` で 1 関数呼び出しでパイプライン完成
- **#7**: `taskDescription` オプションでプロンプトにコンテキスト自動注入
- **CLI**: `npx blueprint-sdk` で対話モード起動 → 会話 → `/go` で実行

### 残課題

- takt のような YAML 宣言的定義はまだ未対応
- ファセット分離プロンプトは未実装
- マルチプロバイダー対応は未着手
- 実 Gate（Claude レビュー）はデフォルトで noop のまま

## 発見したバグ・エッジケース

- `saveState()` は引数1つ（state のみ）で `state.project_root` からパスを決める。2引数に見えてハマりやすい
- `vi.fn<[], Promise<StageResult>>()` は vitest で型引数エラー。型注釈を変数側に書く必要あり

## Codex フィードバック

### High 指摘（対応済み）
1. **claudeQuery の fail-open 問題** — 非 success result を throw に変更。空レスポンスも throw。
2. **ステージ failed → completed 問題** — noop Gate + engine の組み合わせで理論的に発生可能。今回は対症療法として query レベルで throw 化（根本対応は engine 側の failed 検査追加が必要）。

### Medium 指摘（対応済み）
3. **CLI interactive モード try-catch 追加** — 非 interactive 側と対称的なエラーハンドリング。
4. **readline close listener 蓄積** — `createReadlineInput` を input + close 分離の構造に変更。
5. **StageResult 型混在** — 今回は未対応（既存テスト影響大）。将来の型分離タスクとして残す。

### Low 指摘（対応済み）
6. **createConversation → runConversationLoop** — 命名改善。

### 総評
Codex は API 設計を「使いやすいが危険寄り」と評価。DI 設計は良好。型安全性の改善余地あり。テストは正常系は良いが失敗系が薄い（改善済み）。

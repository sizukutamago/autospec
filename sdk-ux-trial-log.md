# blueprint-sdk UX トライアルログ

> othello-online サンプルプロジェクトで実際にSDKを使った体験記録

## 環境

- **日時**: 2026-03-02
- **SDK バージョン**: 0.1.0
- **プロジェクト**: othello-online（オンライン対戦オセロ）
- **実行場所**: tmux 右ペイン

## セットアップ体験

### ユーザーがやったこと
1. `npm init` → `package.json` 作成
2. `npm install @sizukutamago/blueprint-sdk` (file:// 参照)
3. `CLAUDE.md` にプロジェクト説明を記述
4. `npx blueprint-sdk` で起動

### 気づき
- `npx blueprint-sdk` で即起動。ゼロコンフィグ感は良い
- `env -u CLAUDECODE` が必要なのは引っかかりポイント。ドキュメントに書くべき
- 「What would you like to build?」の初期メッセージは分かりやすい
- `/go` と `/cancel` のヒントが表示されるのは親切
- プロンプトが `>` だけなのはシンプルだが、もう少し情報があってもいい（例: 入力数カウンター）

## 対話モード体験

### 入力した内容
1. "オンライン対戦できるオセロゲームを作りたいです。バックエンドはNode.js+ws、フロントはVanilla HTML/CSS/JSで。"
2. "/go"

### 気づき
- メッセージ送信後のフィードバックがない。次の `>` プロンプトが出るだけで「受け取った」確認がない
- takt は AI がアシスタント応答を返して深掘りしてくれる。blueprint-sdk は蓄積するだけ
- **改善案**: 入力後に "Got it! (1 message) Type more or /go to start." のようなACK表示
- **改善案**: AI による対話的ヒアリング（takt の interactive mode のように質問を返す）

## パイプライン実行体験

### タイムライン
- 17:08頃: `npx blueprint-sdk` 起動
- 17:08: メッセージ入力 → 即座に `>` プロンプト（フィードバックなし）
- 17:08: `/go` 入力 → "Generating task description from conversation..." 表示
- 17:09:19: "Starting pipeline..." / "[blueprint] Pipeline started at ..." 表示
- 要約生成: 約10秒（体感。実測はしていない）
- Stage 1 (Spec) 開始: 17:09以降。出力がない（進行状況が見えない！）

### UX 気づき（パイプライン実行中）
- **進行状況が全く見えない**: "Starting pipeline..." 以降、何も出力されない。数分間の沈黙はユーザーを不安にさせる
- **改善案**: "Running Stage 1: Spec generation..." のようなステージ開始/完了ログ
- **改善案**: スピナーやプログレスバー
- **改善案**: 各ステージハンドラ内部で stdoutに進捗を出す仕組み

### 各ステージの所要時間
- Stage 1 (Spec): 17:09:19 → 17:13:11（約4分）— status: failed
- Contract Review Gate: passed（noop gate なので即完了）
- Stage 2 (Test): 17:13:11〜 in_progress
- 以降は実行中...

### 重大な発見
- **Stage 1 が "failed" なのに Gate が "passed" でパイプラインが続行している**
- Codex の High #2 指摘が実際に発現した！
- 仕様書は3つ正常に生成されているのに status が failed — claudeQuery の返り値処理の問題か？
- **これはSDKの根本的なバグ**: failed ステージでもパイプラインが進む設計は危険
- Stage 2 も同様に "failed" だが Gate は "passed" で Stage 3 に進行
- ステージは仕事をしている（ファイルは生成される）のに status が failed になる
  → claudeQuery の result 判定の問題。サブプロセスが仕事を完了しても result message のフォーマットが合わない
- **tmux 上の出力が "Starting pipeline..." から10分以上変わらない** — ユーザー目線では完全にフリーズに見える
- pipeline-state.yaml を直接読まないと進行が分からない
- 別のファイル生成は確認できる（contracts/ 6ファイル、tests/ 4ファイル）ので実体は動いている

### 生成物の品質
- contracts/ (6ファイル): 高品質。JSDoc付き、readonly型、ドメインモデルが正確
  - game-types.contract.ts, game-logic.contract.ts, protocol.contract.ts,
    game-session.contract.ts, room-manager.contract.ts, server.contract.ts
- tests/ (6ファイル): board.test, rules.test, game-state.test, room-manager.test, game-session.test, protocol.test
- src/game/ (4ファイル): types.ts, board.ts, rules.ts, index.ts — **コード品質が非常に高い**
  - 純粋関数設計、8方向探索、合法手判定、反転処理、パス/終了判定が正確
  - readonly型、JSDoc、適切なエラー処理
- src/server/ (3ファイル): index.ts, room-manager.ts, game-session.ts
- **合計20ファイル**が自動生成された
- **最終ステータス**: `aborted` (Stage 3 blocked guard 発動のため Stage 4 未実行)

### 問題・エラー
1. **全ステージが "failed" になるが仕事は完了している** — claudeQuery の result 判定問題
2. **blocked guard 発動**: Stage 3 で1つの contract が blocked → Stage 4 に進めず aborted
3. **エラーメッセージがスタックトレース付きで raw 表示** — ユーザーフレンドリーでない
4. **約20分間の沈黙**: "Starting pipeline..." から完了まで、一切の進捗表示なし

### ユーザー体験タイムライン
- 00:00 `npx blueprint-sdk` → 即起動
- 00:05 メッセージ入力 → ACK なし、次のプロンプト
- 00:10 `/go` → "Generating task description..." → "Starting pipeline..."
- 00:10〜20:00 **沈黙** (ユーザーは不安になる)
- 20:00 エラースタックトレースが突然表示されて終了

## 3回目トライアル（P0修正後）

### 改善が確認できた点
- **進捗表示**: ステージ開始/完了が即座に表示される。沈黙問題が解消
- **全ステージ completed**: `error_max_turns` を partial success として扱う修正が効いた
- **Stage 4 到達**: blocked guard が不要に発動せず、全8ステージ完走
- **エラー表示**: `Pipeline error: <message>` 形式でユーザーフレンドリーに
- **パイプライン完走**: final_status: completed ← 前回は aborted
- **生成物**: 25ファイル（前回20ファイル。docs/3ファイルが追加）

### Before → After 比較

| 項目 | 1回目 | 3回目 |
|------|-------|-------|
| final_status | aborted | **completed** |
| ステージ status | 全 failed | **全 completed** |
| 進捗表示 | なし（20分沈黙） | **ステージごとログ** |
| Stage 4 | blocked | **completed** |
| docs/ | なし | **3ファイル** |
| エラー表示 | スタックトレース | **メッセージのみ** |

## 5回目トライアル（v2: サブエージェント + モード選択）

### 改善が確認できた点
- **モード選択**: full/tdd/spec が TUI で選べる
- **プロジェクト調査**: Researcher + WebResearcher が並列で初回調査
- **日本語 TUI**: 全メッセージ日本語

### 問題点
- **ヒアリングが早すぎる**: CLAUDE.md に情報があると AI が即座に READY を返す。最低2-3問は聞くべき
- **Stage 2/3 が長すぎる**: テスト生成 122分、実装 99分+。maxTurns:15 が全ターン消費している可能性
- **contract 用の既存仕様を聞くべき**: 要件書や API 仕様がないか聞くエージェントが欲しい

### 改善優先度
1. **P0**: Interviewer に「最低2問は質問する」ポリシー追加
2. **P0**: Stage の実行時間短縮（maxTurns 最適化 or タイムアウト設定）
3. **P1**: 既存仕様確認エージェント追加
4. **P1**: 各 Stage の maxTurns をユースケースに合わせて調整

## 総合評価

### Good
- **ゼロコンフィグ起動**: `npx blueprint-sdk` だけで動く。セットアップ体験は良い
- **CLAUDE.md ベース**: プロジェクト説明が CLAUDE.md にあるだけで、AI が適切な仕様書・テスト・実装を生成
- **blocked guard**: 実装失敗時に Docs に進まない安全機構は正常動作
- **生成物の品質**: contracts は特に良質（型定義、JSDoc、readonly）
- **file:// 参照**: ローカル開発で SDK を即使えるのは便利

### Bad
- **進捗表示がない**: 20分間の沈黙は致命的。ユーザーは「フリーズした？」と思う
- **全ステージ "failed" 問題**: 仕事は完了しているのに status が failed。claudeQuery の result 判定が厳しすぎるか、SDK の query() の返り値仕様理解が不十分
- **エラー表示がraw**: スタックトレースをそのまま出すのはエンジニア以外には不親切
- **対話モードが蓄積だけ**: ユーザーの入力に対して AI 応答がない。takt のように質問を返して深掘りすべき
- **env -u CLAUDECODE が必要**: ネストした Claude Code 起動の制約。ドキュメントに書くべき

### 改善優先度
1. **P0**: 進捗表示の追加（ステージ開始/完了ログ、スピナー）
2. **P0**: claudeQuery の result 判定修正（failed なのに仕事は完了している問題）
3. **P1**: エラー表示のユーザーフレンドリー化
4. **P1**: 対話モードでの AI 応答（ヒアリング機能）
5. **P2**: CLAUDECODE 環境変数の自動 unset
6. **P2**: 入力メッセージへの ACK 表示

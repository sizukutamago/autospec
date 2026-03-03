# autospec

AI-powered software development pipeline engine built on [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk).

Describe what you want to build through conversation, and autospec automatically generates specs, tests, implementation, and documentation.

## Quick Start

```bash
# Initialize project config
npx autospec init

# Start — describe your project, press Enter to run
npx autospec
```

That's it. You talk, AI builds.

```
You:  オンライン対戦オセロゲームを作りたい
You:  バックエンドは Node.js + ws、フロントは Vanilla JS
(空エンター)

🚀 Pipeline running...
  ✓ Stage 1: Spec Generation
  ✓ Stage 2: Test Generation
  ✓ Stage 3: Implementation
  ✓ Stage 4: Documentation
```

## How It Works

```
You describe → AI interviews → Pipeline auto-runs

  Stage 1: Spec Generation     → Contract Review Gate
  Stage 2: Test Generation      → Test Review Gate
  Stage 3: Implementation       → Code Review Gate
  Stage 4: Documentation        → Doc Review Gate
```

Each stage uses Claude to generate artifacts. Between stages, **Review Gates** check quality:
- **P0** (critical) findings → immediate stop
- **P1** (important) findings → AI auto-fixes and retries (up to 5 cycles)
- **P2** (minor) findings → noted but don't block

## CLI Options

```bash
# Pipeline mode
npx autospec                   # Full: Spec → Test → Implement → Docs
npx autospec --mode tdd        # TDD: Spec → Test (implement yourself)
npx autospec --mode spec       # Spec only (design review)

# Resume & retry
npx autospec --resume          # Resume from failure point
npx autospec --resume --force  # Re-run completed pipeline

# Other
npx autospec --no-interactive  # Skip conversation, run pipeline directly
npx autospec --cwd /path       # Specify working directory
```

### Resume

When a gate fails or process crashes, `--resume` picks up where you left off:

```
── 再開サマリー ──────────────────────
  ✓ Stage 1: 仕様書生成 ... 完了
  ✓ 仕様レビューゲート ... パス
  ✓ Stage 2: テスト生成 ... 完了
  ✗ テストレビューゲート ... 失敗
  → テストレビューゲート から再開
──────────────────────────────────────
```

In interactive mode, you can choose which stage to restart from.

## Configuration

```bash
npx autospec init   # Creates .autospec/ directory
```

Edit `.autospec/autospec.yaml`:

```yaml
gates:
  type: review   # "noop" (always PASS) or "review" (AI review)
```

## Gate Policy

| Condition | Result |
|-----------|--------|
| P0 = 0 and P1 ≤ 1 | **PASS** |
| P0 > 0 | Stop (`p0_found`) |
| P1 > 1 | Auto-fix up to 5 cycles, then `p1_exceeded` |
| Reviewer crash | Retry once, then `quorum_not_met` |

---

## Advanced: Library Usage

> For developers who want to embed autospec into their own tools.

<details>
<summary>Programmatic API</summary>

```typescript
import {
  createDefaultPipeline,
  claudeQuery,
  createInitialState,
} from "@sizukutamago/autospec";

const engine = createDefaultPipeline({
  queryFn: (prompt) => claudeQuery(prompt, { cwd: "./my-project" }),
  taskDescription: "Build an online Othello game",
});

const state = createInitialState("./my-project");
const result = await engine.run(state, {
  cwd: "./my-project",
  resume: false,
  force: false,
  mode: "full",
});

console.log(result.final_status); // "completed"
```

</details>

<details>
<summary>Custom Gates & Stages</summary>

```typescript
import { createDefaultPipeline } from "@sizukutamago/autospec";
import type { StageHandler } from "@sizukutamago/autospec";

const myGate: StageHandler = async (state, options) => {
  return {
    status: "passed",
    counts: { p0: 0, p1: 0, p2: 0 },
    findings: [],
  };
};

const engine = createDefaultPipeline({
  queryFn: myQueryFn,
  gates: { contract_review_gate: myGate },
  maxTurns: {
    stage_1_spec: 10,
    stage_3_implement: 20,
  },
});
```

</details>

## Development

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # oxlint --type-aware
npm run test         # vitest run (202 tests)
npm run build        # tsc + copy prompts
```

## Tech Stack

| Component | Choice |
|-----------|--------|
| Language | TypeScript (ESM, NodeNext) |
| Runtime | Node.js >= 20 |
| AI SDK | @anthropic-ai/claude-agent-sdk |
| Validation | zod v4 |
| State | YAML (js-yaml) |
| Test | vitest |
| Lint | oxlint (type-aware) |

## License

MIT

# blueprint-sdk

AI-powered software development pipeline engine built on [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk).

Describe what you want to build through conversation, and blueprint-sdk automatically generates specs, tests, implementation, and documentation through a deterministic 4-stage pipeline.

## Quick Start

```bash
npm install @sizukutamago/blueprint-sdk

# Initialize project config
npx blueprint-sdk init

# Start interactive mode
npx blueprint-sdk
```

## Pipeline

```
Stage 1: Spec Generation     → Contract Review Gate
Stage 2: Test Generation      → Test Review Gate
Stage 3: Implementation       → Code Review Gate
Stage 4: Documentation        → Doc Review Gate
```

Each stage uses Claude to generate artifacts. Gates validate quality before proceeding (P0 findings block, P1 findings trigger revision cycles).

## Usage

### CLI

```bash
# Interactive mode (default): conversation → empty Enter to start pipeline
npx blueprint-sdk

# Choose pipeline mode
npx blueprint-sdk --mode full   # Spec → Test → Implement → Docs (default)
npx blueprint-sdk --mode tdd    # Spec → Test only
npx blueprint-sdk --mode spec   # Spec only

# Resume interrupted pipeline (shows summary, resumes from failure point)
npx blueprint-sdk --resume

# Force re-run completed pipeline
npx blueprint-sdk --resume --force

# Non-interactive mode
npx blueprint-sdk --no-interactive

# Specify working directory
npx blueprint-sdk --cwd /path/to/project
```

### Resume Flow

When resuming, blueprint-sdk shows a summary of pipeline state:

```
── 再開サマリー ──────────────────────
  ✓ Stage 1: 仕様書生成 ... 完了
  ✓ 仕様レビューゲート ... パス
  ✓ Stage 2: テスト生成 ... 完了
  ✗ テストレビューゲート ... 失敗
  → テストレビューゲート から再開
──────────────────────────────────────
```

In interactive mode, you can choose which stage to restart from when failures are detected.

### Library Usage

```typescript
import {
  createDefaultPipeline,
  claudeQuery,
  createInitialState,
} from "@sizukutamago/blueprint-sdk";

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

### Custom Gates & Stages

```typescript
import { createDefaultPipeline } from "@sizukutamago/blueprint-sdk";
import type { StageHandler } from "@sizukutamago/blueprint-sdk";

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

## Gate Policy

- **P0 = 0 and P1 ≤ 1** → PASS
- P0 > 0 → Immediate stop (`p0_found`)
- P1 > 1 → REVISE (max 5 cycles, then `p1_exceeded`)
- Reviewer failure → Retry once → Gate not met (`quorum_not_met`)

## Configuration

Initialize with `npx blueprint-sdk init`, then edit `.blueprint/blueprint.yaml`:

```yaml
gates:
  type: review   # "noop" (always PASS) or "review" (AI review)
```

## Architecture

```
src/
├── index.ts            # Public API exports
├── engine.ts           # PipelineEngine (sequential stage execution)
├── presets.ts          # createDefaultPipeline (one-call setup)
├── query.ts            # claudeQuery / claudeQueryStructured
├── cli.ts              # CLI entry point (interactive mode)
├── interactive/        # Interactive mode (conversation, summary)
├── agents/             # Sub-agents (interviewer, researcher, web-researcher)
├── gates/              # Gate infrastructure (review, revise, evaluate, normalize)
├── stages/             # Built-in stage handlers (spec, test-gen, implement, docs)
├── config/             # Config loading, prompt loader, init
├── prompts/            # Prompt templates
└── state.ts            # Pipeline state management (YAML)
```

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

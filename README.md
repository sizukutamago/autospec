# blueprint-sdk

AI-powered software development pipeline engine built on [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk).

Describe what you want to build through conversation, and blueprint-sdk automatically generates specs, tests, implementation, and documentation through a deterministic 4-stage pipeline.

## Quick Start

```bash
npm install @sizukutamago/blueprint-sdk

# Start interactive mode
npx blueprint-sdk

# Describe your project, then type /go
> Build an online multiplayer Othello game with Node.js + ws
> /go
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

### CLI (Interactive Mode)

```bash
# Default: interactive conversation → /go to start pipeline
npx blueprint-sdk

# Resume interrupted pipeline
npx blueprint-sdk --resume

# Non-interactive mode (no conversation, runs pipeline directly)
npx blueprint-sdk --no-interactive

# Specify working directory
npx blueprint-sdk --cwd /path/to/project
```

### Interactive Commands

| Command | Description |
|---------|-------------|
| `/go` | Summarize conversation and start pipeline |
| `/cancel` | Cancel and exit |

### Library Usage

```typescript
import {
  createDefaultPipeline,
  claudeQuery,
  createInitialState,
} from "@sizukutamago/blueprint-sdk";

// One-call pipeline setup with built-in handlers + noop gates
const engine = createDefaultPipeline({
  queryFn: (prompt) => claudeQuery(prompt, { cwd: "./my-project" }),
  taskDescription: "Build an online Othello game",
});

const state = createInitialState("./my-project");
const result = await engine.run(state, {
  cwd: "./my-project",
  resume: false,
  force: false,
});

console.log(result.final_status); // "completed"
```

### Custom Gates

```typescript
import { createDefaultPipeline } from "@sizukutamago/blueprint-sdk";
import type { StageHandler } from "@sizukutamago/blueprint-sdk";

const myGate: StageHandler = async (state, options) => {
  // Custom review logic
  return {
    status: "passed",
    counts: { p0: 0, p1: 0, p2: 0 },
    findings: [],
  };
};

const engine = createDefaultPipeline({
  queryFn: myQueryFn,
  gates: { contract_review_gate: myGate },
});
```

## Gate Policy

- **P0 = 0 and P1 <= 1** → PASS
- P0 > 0 → Immediate stop (`p0_found`)
- P1 > 1 → REVISE (max 3 cycles, then `p1_exceeded`)
- Reviewer failure → Retry once → Gate not met (`quorum_not_met`)

## Architecture

```
src/
├── index.ts            # Public API exports
├── engine.ts           # PipelineEngine (sequential stage execution)
├── presets.ts          # createDefaultPipeline (one-call setup)
├── query.ts            # claudeQuery utility
├── cli.ts              # CLI entry point (interactive mode)
├── interactive/        # Interactive mode
│   ├── commands.ts     # Slash command parser
│   ├── conversation.ts # Conversation loop (DI-based)
│   └── summary.ts      # Conversation → task description
├── gates/              # Gate infrastructure
│   ├── noop-gate.ts    # Default noop gate (always PASS)
│   ├── review-gate.ts  # Review Swarm orchestration
│   └── ...
├── stages/             # Built-in stage handlers
└── state.ts            # Pipeline state management (YAML)
```

## Development

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # oxlint --type-aware
npm run test         # vitest run (147 tests)
npm run build        # tsc
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
| Lint | oxlint + tsgolint |

## License

MIT

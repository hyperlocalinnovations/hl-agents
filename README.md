# hl-agents

A harness-agnostic autonomous review-fix loop. Runs a review, parses findings, validates them (rule filters + optional LLM verification), plans and applies fixes, commits, and repeats until the review is clean — or a cap is hit.

Two execution modes:

- **CLI / headless** — the `hl-agents` CLI talks to the opencode server via the [`@opencode-ai/sdk`](https://opencode.ai/docs/sdk) (HTTP, no subprocess). Zero-config default works in any repo with opencode installed. Use this for CI, automation, or when you want the structured findings pipeline + guards.
- **TUI / in-session** — the `review-loop` opencode agent runs the loop in-session using `@plan` and `@build` subagents. Fully observable in the opencode TUI. Use this for interactive development where you want to watch each review/plan/apply step.

## Packages

| Package | Purpose |
|---|---|
| `@hl-agents/core` | The loop engine + interfaces. Pure orchestration, no LLM, no IO. |
| `@hl-agents/validate` | Rule-based filtering (severity, ignore globs, allow/deny rules, dedupe) + composable LLM-verify validator. |
| `@hl-agents/review-adapters` | `opencode-slash` (SDK-based, default), `command` (generic), `eslint` review adapters. |
| `@hl-agents/fix-adapters` | `opencode-agent` (SDK-based planner/applier), `script`, `dry-run` adapters. |
| `@hl-agents/committer` | `git` and `noop` committers. |
| `@hl-agents/cli` | Config loader + runner + `hl-agents` CLI binary. |
| `@hl-agents/opencode-agent` | opencode agent definition (`agent.md`) + SDK-backed verify validator. |
| `@hl-agents/opencode-sdk` | Shared opencode server client: auto-discovery, JSON schemas for structured output, `runPrompt` helper. |

## How it works

```
for i in 1..maxIterations:
  findings <- reviewAdapter.run()
  if empty: stop (clean)
  {valid, dropped} <- validator.validate(findings)
  if valid empty: stop (noisy reviewer)
  plans <- fixPlanner.plan(valid)
  for plan: fixApplier.apply(plan)
  committer.commit(plans, filesChanged)
stop on: clean pass | no valid | max iterations | all stuck
```

The intelligence (plan a fix, apply a fix, verify a finding) is delegated to the opencode server via the SDK. Each adapter creates a fresh opencode session, sends a prompt with the configured agent (`build` / `plan`), and parses the response — structured JSON when the server supports it, text-scraping fallback otherwise.

## Config

See `config/hl-agents.config.example.ts` and `config/hl-agents.config.eslint.json`. Place `hl-agents.config.ts` (or `.json`, or `.hl-agents.json`) at your repo root, or pass `--config`.

```ts
export default {
  serverUrl: undefined,              // auto-discover (env var, then default port, else start headless)
  review: {
    adapter: 'opencode-slash',       // SDK-based, zero-config
    agent: 'build',
    scope: 'branch',                 // 'staged' | 'uncommitted' | 'branch' | 'all'
    timeoutMs: 900_000,              // 15 min
  },
  validate: {
    rules: { minSeverity: 'medium', ignore: ['**/*.md', 'dist/**', 'node_modules/**'] },
    llmVerify: { adapter: 'off' },   // or { adapter: 'opencode-agent', agent: 'build' }
  },
  plan:    { adapter: 'opencode-agent', agent: 'plan',  timeoutMs: 300_000 },
  apply:   { adapter: 'opencode-agent', agent: 'build', timeoutMs: 600_000 },
  commit:  { adapter: 'git', granularity: 'per-iteration', message: 'fix({rule}): {message}', addAll: true },
  loop:    { maxIterations: 10, repeatBailThreshold: 3, dryRun: false },
} satisfies Config;
```

### Review scope

The `opencode-slash` review adapter scopes the review to a slice of changes by injecting the appropriate `git diff` command into the prompt:

| Scope | Git command | Use case |
|---|---|---|
| `staged` | `git diff --cached` | Review what you're about to commit |
| `uncommitted` | `git diff HEAD` | Review staged + unstaged changes |
| `branch` (default) | `git diff main...HEAD` | Review a PR / branch |
| `all` | none | Review the whole codebase |

Override per-invocation with `--scope staged` at the CLI, or set it in config.

### Server connection

The CLI auto-discovers the opencode server:

1. `serverUrl` from config, or `OPENCODE_SERVER_URL` env var
2. `http://127.0.0.1:4096` (default `opencode serve` port) — health-checked
3. Fallback: start a headless server via `createOpencode()` (cold boot once, then warm)

If a TUI is running, the CLI connects to its server (warm, MCP/LSP already loaded). No subprocess is spawned per iteration — the SDK uses HTTP, so there's no SIGTERM/timeout risk.

### Custom review command (opt-in)

The default `opencode-slash` adapter sends a baked-in review prompt directly — no command file required. To use a custom slash command (e.g. a JSON-emitting `/review-loop` you've defined in `.opencode/commands/`):

```ts
review: { adapter: 'opencode-slash', command: '/review-loop' },
```

The command must emit a JSON findings array in its text response. Prose output won't parse.

### ESLint adapter

For ESLint specifically, use the structured adapter (parses `--format=json`):

```ts
review: { adapter: 'eslint', args: ['src/'] },
```

## Usage (CLI)

```bash
# run the loop — auto-discovers config at repo root
hl-agents

# review scoped to staged changes
hl-agents --scope staged

# dry-run: plan fixes only, no apply / commit
hl-agents --dry-run

# explicit config + iteration cap
hl-agents --config config/hl-agents.config.eslint.json --max-iterations 5

# print version / help
hl-agents --version
hl-agents --help
```

Exit code is `0` when the final review pass is clean, `1` otherwise. A summary (`totalFindings`, `totalValid`, `totalDropped`, `totalCommits`, `stuckFindings`) is printed to stdout as JSON. Loop progress is logged to stderr with ISO timestamps.

## Usage (TUI)

The `review-loop` agent runs the loop **in-session** using subagents — no CLI subprocess. Each review/plan/apply step is observable in the TUI.

1. Open `opencode` in your project
2. Press **Tab** to cycle to `review-loop`, or type `@review-loop`
3. Say what to review: `run on staged changes`, `review this branch`, `review the whole codebase`

The agent will:
- Run `git diff` (scoped to your request) + the project's linters/typecheckers
- Call `@plan` subagent to produce fix plans
- Call `@build` subagent (or edit directly) to apply fixes
- Commit per fix with `fix({rule}): {message}`
- Repeat up to 5 iterations, then report a summary

Guards (max iterations, stuck detection, noisy reviewer) are re-implemented in-session in simplified form.

## Usage (Pi)

Install the Pi package from this repository, then restart Pi:

```bash
pi install git:github.com/hyperlocalinnovations/hl-agents
```

Run `/review-loop` to review branch changes against `main`, or select a scope explicitly:

```text
/review-loop branch main
/review-loop staged
/review-loop uncommitted
/review-loop all
```

The loop reviews, fixes, and re-reviews up to five times without committing. Add `REVIEW_GUIDELINES.md` to the reviewed repository's Git root to provide project-specific review checks and rules.

## Adapters

**Review** — `opencode-slash` (default, SDK-based, zero-config, scoped), `command` (generic command + parser), `eslint` (parses `--format=json`).

**Validate** — `rules` (severity, ignore globs, allow/deny rules, dedupe), composable with `llmVerify` which delegates per-finding verification to the opencode server via the SDK.

**Plan / Apply** — `opencode-agent` (SDK-based, creates a session with `build`/`plan` agent), `script` (runs a user-supplied script), `dry-run` (plan only).

**Commit** — `git` (configurable message template, granularity per-finding / per-iteration, optional author), `noop`.

## Guards

- `maxIterations` (default 10) caps the loop.
- A finding that re-appears more than `repeatBailThreshold` times (default 3) is marked stuck and skipped.
- If a review pass has findings but none are valid, the loop stops and reports (noisy reviewer).
- `--dry-run` plans only and exits without applying or committing.
- Each adapter call has a configurable `timeoutMs` (enforced via `AbortSignal.timeout`) — no subprocess SIGTERM.

## Shareable skills

`skills/` contains opencode skills that ship with this repo. Install one by symlinking it into your global skills directory:

```bash
ln -s "$PWD/skills/agents-feedback" ~/.config/opencode/skills/agents-feedback
```

Or copy the folder if you'd rather not depend on the repo's location. Restart opencode after installing.

| Skill | Purpose |
|---|---|
| `agents-feedback` | Fold feedback about harness/agent behavior into a project's `AGENTS.md` (with `AGENTS.history.md` changelog) so instructions self-iterate. |

## Build

```bash
pnpm install
pnpm run build       # build all packages
pnpm run typecheck   # tsc --noEmit across packages
pnpm run test        # vitest across packages
```

## Install globally

```bash
npm install -g ./packages/cli
hl-agents --version
```

The CLI is a single binary that talks to the opencode server over HTTP. No bundled opencode runtime — it connects to yours.

## Status

Early scaffold. The SDK-based adapters work against opencode 1.17.x. The `json_schema` structured-output field is passed to the server but not yet declared in the published SDK types (1.17.13) — the adapters fall back to text parsing via `parseFindingsJson` when the server doesn't honor the schema.
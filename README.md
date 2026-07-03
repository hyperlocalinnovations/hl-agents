# hl-agents

A harness-agnostic autonomous review-fix loop. Runs a review command, parses findings, validates them (rule filters + optional LLM verification), plans and applies fixes, commits, and repeats until the review is clean — or a cap is hit.

## Packages

| Package | Purpose |
|---|---|
| `@hl-agents/core` | The loop engine + interfaces. Pure orchestration, no LLM, no IO. |
| `@hl-agents/validate` | Rule-based filtering (severity, ignore globs, allow/deny rules, dedupe) + composable LLM-verify validator. |
| `@hl-agents/review-adapters` | `eslint`, `command` (generic), `opencode-slash` review adapters. |
| `@hl-agents/fix-adapters` | `dry-run`, `script`, `opencode-agent` planner/applier adapters. |
| `@hl-agents/committer` | `git` and `noop` committers. |
| `@hl-agents/cli` | Config loader + runner + `hl-agents` CLI binary. |
| `@hl-agents/opencode-agent` | opencode agent definition + opencode-backed verify validator. |

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

The intelligence (plan a fix, apply a fix, verify a finding) is delegated to a host harness agent via adapters — by default `opencode-agent`, which shells out to `opencode run <prompt>`. Swap in `script` adapters to use any other harness or a custom script.

## Config

See `config/hl-agents.config.example.ts` and `config/hl-agents.config.eslint.json`. Place `hl-agents.config.ts` (or `.json`, or `.hl-agents.json`) at your repo root, or pass `--config`.

```ts
export default {
  review:    { adapter: 'command', command: 'opencode', args: ['run', '/review'] },
  validate:  { rules: { minSeverity: 'medium', ignore: ['**/*.md'] }, llmVerify: { adapter: 'off' } },
  plan:      { adapter: 'opencode-agent' },
  apply:     { adapter: 'opencode-agent' },
  commit:    { adapter: 'git', granularity: 'per-iteration', message: 'fix({rule}): {message}', addAll: true },
  loop:      { maxIterations: 10, repeatBailThreshold: 3, dryRun: false },
};
```

## Usage

```bash
# run the loop against the repo's config
pnpm dlx @hl-agents/cli

# dry-run: plan fixes only, no apply / commit
pnpm dlx @hl-agents/cli --dry-run

# explicit config + iteration cap
pnpm dlx @hl-agents/cli --config config/hl-agents.config.eslint.json --max-iterations 5
```

Exit code is `0` when the final review pass is clean, `1` otherwise. A summary (`totalFindings`, `totalValid`, `totalDropped`, `totalCommits`, `stuckFindings`) is printed to stdout.

## Adapters

**Review** — `eslint` (parses `--format=json`), `command` (generic command + parser), `opencode-slash` (runs `opencode run /review`).

**Validate** — `rules` (severity, ignore globs, allow/deny rules, dedupe), composable with `llmVerify` which delegates per-finding verification to a harness agent.

**Plan / Apply** — `opencode-agent` (shells out to opencode with a derived prompt), `script` (runs a user-supplied script, passing the payload as a temp JSON file path arg), `dry-run` (plan only).

**Commit** — `git` (configurable message template, granularity per-finding / per-iteration, optional author), `noop`.

## Guards

- `maxIterations` (default 10) caps the loop.
- A finding that re-appears more than `repeatBailThreshold` times (default 3) is marked stuck and skipped.
- If a review pass has findings but none are valid, the loop stops and reports (noisy reviewer).
- `--dry-run` plans only and exits without applying or committing.

## Build

```bash
pnpm install
pnpm run build       # build all packages
pnpm run typecheck   # tsc --noEmit across packages
pnpm run test        # vitest across packages
```

## Status

Early scaffold. The opencode/claude-code agent adapters shell out to `opencode run` / equivalent; the exact prompts and JSON-extraction are starting points and likely need tuning per harness.
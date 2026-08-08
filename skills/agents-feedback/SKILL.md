---
name: agents-feedback
description: "Turn feedback about harness or agent behavior into self-iterating, improving project instructions. Use when the user gives feedback about how the agent (or an automation harness like review-loop) behaved — e.g. 'stop doing X', 'always run Y first', 'it ignored the linter', 'the loop should commit differently', or any 'whenever you <do>...' rule they want enforced in AGENTS.md. Also use when the user asks to improve, update, or self-iterate AGENTS.md from observed behavior."
---

# agents-feedback

Collect feedback about harness/agent behavior and fold it into the project's `AGENTS.md` so the agent (and automation harnesses like `review-loop`) improve over time. Every change is recorded in `AGENTS.history.md` so rules never silently contradict or duplicate earlier ones.

## State files

- `AGENTS.md` (project root) — the rules file being improved. Edited directly.
- `AGENTS.history.md` (project root, created lazily) — changelog of every feedback iteration, used for contradiction and duplication detection.

## Workflow

### 1. Read current state

Read `AGENTS.md` and `AGENTS.history.md` (if it exists) at the project root. Note the existing headings and their rules so new rules slot in cleanly.

### 2. Classify the feedback

Determine:
- **Category** — one of:
  - `build/test` — build, typecheck, lint, test commands or ordering
  - `convention` — style, naming, structure, language
  - `workflow` — process steps, ordering, review/commit behavior
  - `tooling` — which tools/commands to use and how
  - `guard` — don't-do rules
  - `agent-behavior` — how the agent should act in-session (e.g. subagents, TUI vs CLI)
- **Trigger** — the concrete condition that fires the rule: a command, file pattern, agent action, or scenario.
- **Desired behavior** — the exact imperative the agent should follow.

### 3. Deduplicate and check for conflicts

Search existing rules in `AGENTS.md` and past entries in `AGENTS.history.md`:

- **Already learned**: the same trigger + behavior already exists. Report "already learned in <date> entry" and stop — do not re-add.
- **Conflict**: a rule with the same trigger but a different behavior exists. Flag the contradiction to the user with the `question` tool and ask which behavior wins. Do not edit until they decide.
- Otherwise, proceed.

### 4. Edit `AGENTS.md`

Insert the new rule as a bullet under the matching heading. Create the heading if it does not exist. Follow these conventions:

- One rule per bullet, written as an **imperative** starting with a verb, e.g. `pnpm run typecheck`.
- Grep-friendly and concrete — name the exact command, file pattern, or action; avoid vague prose.
- Preserve the file's existing structure and heading order. Do not remove or reword existing rules.
- Never delete an existing rule without asking the user first.

### 5. Append to `AGENTS.history.md`

Add one entry per iteration, at the end of the file:

```markdown
## 2026-08-08 — <one-line summary>

- **Observed**: <what happened / what the user said>
- **Rule**: <the imperative added or changed>
- **Section**: <AGENTS.md heading affected>
- **Changed**: added | updated
```

Create `AGENTS.history.md` with an `# AGENTS History` heading if it does not exist.

### 6. Show the diff

Run `git diff AGENTS.md AGENTS.history.md` (or `git diff -- AGENTS.md AGENTS.history.md`) so the user can review and revert. If the files are untracked, use `git add -N` first so the diff renders. Summarize what changed in one or two lines.

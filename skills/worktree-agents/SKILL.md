---
name: worktree-agents
description: "Coordinate multiple git worktrees running agent instances in parallel. Use when spinning up a git worktree (or worktree branch), working across multiple worktrees at once, sharing progress between agent instances, keeping AGENTS.md/.opencode in sync across worktrees, or when launching an app/runner from inside a worktree where multiple instances must not collide (ports, env). Trigger phrases: 'spin up a worktree', 'multi worktree', 'work in parallel', 'parallel agents', 'coordination file', 'state.sh', 'worktree-setup.sh', 'runner.sh'."
---

# worktree-agents

Run multiple opencode agent instances in parallel, one per git worktree, on
the same repo. Three problems are solved:

1. **Coordination** — a single shared state file every worktree reads/writes so
   instances can see what others are doing and how far along they are. Writes
   are thread-safe (atomic `mkdir` spinlock + atomic file replace).
2. **Instructions** — `AGENTS.md` (and `.opencode/`) are copied into each new
   worktree so every instance follows the same rules, even when those files
   are gitignored and would otherwise be missing.
3. **Isolation** — runner commands launched from a worktree get branch-scoped
   ports/env so multiple instances of the app can run at once without
   colliding. Runner conventions are discovered from the project, never baked
   in.

Scripts live in `scripts/` (same dir as this file). Run them with
`bash <skill>/scripts/<name>.sh` or add the dir to PATH. Install globally once
so every worktree can reach them:

```bash
bash <repo>/skills/worktree-agents/scripts/install.sh   # symlink into ~/.config/opencode/skills
```

> Restart opencode after installing. Worktrees are fresh working copies and do
> not carry the project's `.opencode/`, but the **global** skills dir is shared
> — which is why this skill installs globally.

---

## Workflow

### Creating a worktree for an agent instance

1. Register intent in the coordination state **before** creating anything so
   other instances see the slot claimed:

   ```bash
   state.sh set <abs-path> branch=<branch> status=starting task='<what you will do>'
   ```

   (The path must be final; you can update it after creation if it differs.)

2. Create the worktree and bootstrap it (this also re-registers it):

   ```bash
   worktree-setup.sh <branch> [path] [--source <worktree>] [--force-copy]
   ```

   This runs `git worktree add`, copies `AGENTS.md` + `AGENTS.*.md` +
   `.opencode/` from the source worktree (only if missing or older, so
   worktree-local edits are never clobbered), and registers the entry.

3. Work inside the new worktree. Update progress at every meaningful step:

   ```bash
   state.sh set "$PWD" status=running task='implement X' progress=40
   ```

4. When launching the app/runner, resolve an isolated port + command:

   ```bash
   runner.sh resolve        # -> port=<n>, command=<project-resolved launcher>
   eval "$(runner.sh env)"  # sets PORT, RUN_ID, RUNNER_BRANCH
   runner.sh publish "$PWD" "<launch command>" <pid>
   ```

5. On completion, free the slot:

   ```bash
   state.sh release "$PWD"
   ```

### Before starting any task in a worktree

Run `state.sh list` first. Check:

- Whether another instance is already doing this work (`status: running`,
  matching `task`).
- Whether the slot's `runner.port` collides with the app you're about to
  launch — if so, re-resolve with `runner.sh port` before starting.
- Whether any entry is stale (dead PID or `updatedAt` very old) and should be
  `release`d.

### Coordination discipline

- **Always** set/update state when you start, pause, or finish an activity.
- **Always** `heartbeat` on long-running work so peers can see you're alive.
- **Always** publish the resolved port + pid before starting a long-running
  app, and clear it (`runner.sh stop` / `state.sh release`) when done.
- Never guess a port — use `runner.sh port`. It honors project pinning and
  bumps past any in-use port.

---

## Reference

- `references/state-schema.md` — full `state.json` schema and examples.
- `references/runner-mapping.md` — how runner commands/ports are resolved and
  how to pin project-specific ports.
- `references/worktree-cheatsheet.md` — quick command cheat sheet.

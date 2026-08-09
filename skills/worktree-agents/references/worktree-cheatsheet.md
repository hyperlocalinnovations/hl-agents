# Worktree agent cheat sheet

All scripts live in the skill's `scripts/` dir. Assumes it's on PATH or you
prefix with `bash <skill>/scripts/<name>.sh`.

## Setup (once per machine)

```bash
bash <repo>/skills/worktree-agents/scripts/install.sh
# restart opencode; worktrees see the skill via the global skills dir
```

## Common commands

| What | Command |
|---|---|
| See who's doing what | `state.sh list` |
| Claim a slot for a new worktree | `state.sh set <abs-path> branch=<b> status=starting task='...'` |
| Create + bootstrap a worktree | `worktree-setup.sh <branch> [path]` |
| Update progress | `state.sh set "$PWD" task='...' progress=40` |
| Bump liveness | `state.sh heartbeat "$PWD"` |
| Resolve isolated port + launcher | `runner.sh resolve` |
| Export branch env | `eval "$(runner.sh env)"` |
| Publish running app | `runner.sh publish "$PWD" "<launcher>" <pid>` |
| Mark done | `state.sh release "$PWD"` |
| Clear app entry only | `runner.sh stop "$PWD"` |
| Clean up missing worktrees | `state.sh prune` |

## Golden rules

1. **Always** `state.sh list` before starting work — don't duplicate a task
   another instance owns.
2. **Always** publish `runner.sh port` / `publish` before starting a
   long-running app; **never** hardcode or guess a port.
3. **Always** update state at start / each meaningful step / finish.
4. **Always** copy AGENTS.md + `.opencode` into every new worktree
   (`worktree-setup.sh` does this automatically).
5. Use `$RUN_ID` (branch slug) for per-instance files/queues/DBs.
6. On finish, `state.sh release` so peers and port resolution free the slot.

## Reading state

```bash
state.sh get /abs/path/to/worktree task progress
state.sh get /abs/path/to/worktree
```

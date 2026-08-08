# state.json — shared coordination state

All worktrees of a repo share a single state file. It lives inside the git
common dir, which is common to every linked worktree and never pollutes a
working tree:

```
<repo>/.git/worktrees/state.json
```

`WORKTREES_STATE_DIR` overrides the location (must be shared by all worktrees,
e.g. an NFS/Syncthing dir, for cross-machine setups).

## Concurrency model

- Writes are serialized with a pure-shell `mkdir` spinlock on
  `<state-dir>/.lock/` — `mkdir` is atomic, so only one writer wins. No `flock`
  (unavailable on macOS), no python, works everywhere.
- Lock timeout defaults to 30s; stale locks (dead owner PID, or owner alive but
  holding > 300s) are reclaimed automatically. This means a crashed agent
  cannot wedge the queue.
- The state file itself is replaced atomically: a new blob is written to
  `state.json.tmp` then `mv`'d over `state.json`, so readers never observe a
  half-written file.
- All high-level commands (`set`, `heartbeat`, `release`) acquire the lock
  internally. Low-level `lock`/`unlock` exist for wrapping a compound
  read-modify-write.

## Schema

```json
{
  "format": 1,
  "ports": {
    "feat-a*": 6000,
    "feat-b*": 6001
  },
  "worktrees": {
    "/abs/path/to/worktree": {
      "branch": "feat/cool-thing",
      "status": "running",
      "agent": "instance-abc",
      "task": "implement the widget",
      "progress": 40,
      "steps": [
        "scaffold files",
        "wire up API"
      ],
      "runner": {
        "command": "pnpm run dev",
        "port": 5177,
        "pid": 4242
      },
      "worktree-created": "2026-08-08T12:00:00Z",
      "updatedAt": "2026-08-08T13:05:00Z"
    }
  }
}
```

### Worktree entry fields

| Field | Type | Meaning |
|---|---|---|
| `branch` | string | Branch checked out in this worktree |
| `status` | string | `starting` \| `running` \| `blocked` \| `idle` \| `done` \| `gone` |
| `agent` | string | Instance id (your session id) if useful |
| `task` | string | Free text: what this instance is doing |
| `progress` | int | 0–100 (omit/null when not applicable) |
| `steps` | string[] | Optional ordered log of milestones |
| `runner` | object | `{command, port, pid}` of the running app instance, `null` when stopped |
| `worktree-created` | string | ISO timestamp of `worktree-setup.sh` |
| `updatedAt` | string | ISO timestamp, refreshed on every write/heartbeat |

### `ports` block

Project-pinned ports keyed by branch glob. `runner.sh port` checks this first.
See `runner-mapping.md`.

## CLI

```
state.sh lock [timeout]             # acquire lock (seconds), e.g. for compound ops
state.sh unlock                     # release lock
state.sh get <path> [field...]      # entry JSON, or selected fields
state.sh list [--json]              # human table (or raw JSON)
state.sh set <path> k=v [k=v...]    # create/update entry; values that parse as
                                    # JSON (e.g. {"port":5177}) stay objects
state.sh heartbeat <path>           # bump updatedAt
state.sh release <path>             # status=done, clear runner/progress
state.sh prune                      # mark entries whose worktree dir vanished
```

Every `set`/`heartbeat`/`release` is lock-serialized and atomic.

## Example session

```bash
state.sh set /ws/wt-a branch=feat/a status=running task='auth flow' progress=10
state.sh set /ws/wt-a progress=60
state.sh heartbeat /ws/wt-a
state.sh list
# running   feat/a            port=5177  pnpm run dev
#     /ws/wt-a
#     task: auth flow
#     progress: 60%
#     updated: 2026-08-08T13:05:00Z
state.sh release /ws/wt-a
```

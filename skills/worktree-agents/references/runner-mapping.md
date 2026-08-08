# Runner commands and ports across worktrees

The goal: multiple worktrees can run the same app simultaneously without
colliding on ports, env, or files. This skill does **not** invent runner
conventions — it discovers the project's own, and only falls back to a
deterministic port scheme when the project pins nothing.

## Ports

Resolution order in `runner.sh port` / `runner.sh env`:

1. **Project pin** — the `ports` block in `state.json` (see below), or
   `HL_WORKTREES_PORTS_CONF=/path/to/ports.conf`.
2. **Default scheme** — `PORT_MIN + cksum(branch-slug) % PORT_RANGE`, i.e.
   `5000 + cksum("feat-cool-thing") % 500` by default. Deterministic, so the
   same branch always gets the same port on every machine.
3. **Collision bump** — if the candidate port is already claimed by another
   live worktree entry, or an OS process is listening on it, increment until a
   free port in range is found.

Override the scheme per project with env in `opencode.json` `shell.env` or an
`AGENTS.md` note:

```text
HL_WORKTREES_PORT_MIN=4000
HL_WORKTREES_PORT_RANGE=200
```

### Pinning specific branches (project convention)

Two equivalent ways. Pick what the project prefers.

**In state.json `ports`** (keyed by branch glob):

```json
{ "ports": { "feat/a*": 6000, "hotfix/*": 6001 } }
```

**Via `ports.conf`** (set `HL_WORKTREES_PORTS_CONF`, one `glob=port` per line,
`#` comments allowed):

```text
# pin the legacy stack to its old port
legacy/*=8080
feat/*=6000
```

`ports` in state.json wins over `ports.conf` if both define a matching glob.

## Runner commands (project conventions only)

`runner.sh command` picks a launch command from the project's own files,
in priority order:

1. **just** — if a `justfile`/`Justfile` exists and `just` is installed, uses
   the first listed recipe and appends `(PORT=<n>)`.
2. **make** — if a `Makefile`/`makefile`/`GNUmakefile` exists, emits
   `make run (PORT=<n>)`.
3. **package manager** — if `package.json` has a `dev` script, emits
   `<pm> run dev (PORT=<n>)` where `<pm>` is inferred from the lockfile
   (`pnpm`/`yarn`/`npm`).

If nothing matches, it prints `PORT=<n> <see AGENTS.md/README for the app
launcher>` — do **not** guess; read the project docs.

### Making your app actually read `PORT`

The default scheme only helps if the app binds `$PORT` (or the resolved env).
To follow a project convention, prefer one of:

- **App reads env**: bind `process.env.PORT` / `$PORT`. Then run
  `eval "$(runner.sh env)" && <project launcher>`.
- **Justfile**: read env in a recipe

  ```make
  run:
      @echo running on port {{ env_var_or_default('PORT', '3000') }}
      @python -m http.server $PORT
  ```

- **Makefile**:

  ```make
  run:
  	./run.sh
  ```

  with `run.sh` reading `$$PORT`, or invoke as `PORT=$$(runner.sh port) make run`.

The skill does not dictate which pattern — use what the project already does.

## Branch-derived env

`runner.sh env` exports, for the current worktree's branch:

```text
export PORT=5177          # resolved, collision-free
export RUN_ID=feat-cool-thing   # branch slug: safe for file/queue names
export RUNNER_BRANCH=feat/cool-thing
```

Use `$RUN_ID` for per-instance files, DBs, caches, or message queues so
worktrees don't stomp each other (e.g. `sqlite:$RUN_ID.db`).

#!/usr/bin/env bash
set -euo pipefail

# runner.sh — worktree-aware runner support so multiple instances of an app
# can run in parallel across worktrees without port/env collisions.
#
# This script does NOT bake in runner conventions. It discovers how the
# project runs its app (justfile / Makefile / package.json / AGENTS.md /
# README) and honors any project-defined ports. It only falls back to a
# deterministic default port scheme when the project doesn't pin one.
#
# Usage:
#   runner.sh env                 print shell-exportable env (PORT, RUN_ID, RUNNER_BRANCH)
#   runner.sh port                print the resolved port for this branch
#   runner.sh command             print the command to launch the app for this branch
#   runner.sh resolve             print port + command as key=value
#   runner.sh publish <path> <cmd> [pid]   record the running instance in state
#   runner.sh stop <path>         clear the runner entry from state
#
# Env:
#   HL_WORKTREES_PORT_MIN    default 5000
#   HL_WORKTREES_PORT_RANGE  default 500
#   WORKTREES_STATE_DIR      override where coordination state lives

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_SH="$SCRIPT_DIR/state.sh"

PORT_MIN="${HL_WORKTREES_PORT_MIN:-5000}"
PORT_RANGE="${HL_WORKTREES_PORT_RANGE:-500}"
# Optional project override: path to a file of `branch-glob=port` lines.
PORTS_CONF="${HL_WORKTREES_PORTS_CONF:-}"

# Coordination state file (shared with state.sh). Lives in the git common dir,
# which every linked worktree shares. WORKTREES_STATE_DIR is a directory (same
# semantics as state.sh), not the file path.
git_common_dir() {
  git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "${PWD%/*}/.git"
}
STATE_FILE="${WORKTREES_STATE_DIR:-$(git_common_dir)/worktrees}/state.json"

# ---------------------------------------------------------------------------
# identity
# ---------------------------------------------------------------------------

current_branch() {
  git rev-parse --abbrev-ref HEAD
}

# branch name -> filesystem-safe slug: feat/foo-123 -> feat_foo-123
slug() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '_'
}

# ---------------------------------------------------------------------------
# port resolution
# ---------------------------------------------------------------------------

project_port_override() {
  local branch="$1"
  local line glob p
  # 1. state.json `ports` block (branch glob -> port)
  if p="$(python3 - "$STATE_FILE" "$branch" <<'PY'
import fnmatch, json, sys
try:
    data = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(1)
branch = sys.argv[2]
for glob, port in (data.get("ports") or {}).items():
    if fnmatch.fnmatch(branch, glob):
        print(port)
        sys.exit(0)
sys.exit(1)
PY
)"; then
    printf '%s' "$p"
    return 0
  fi
  # 2. ports.conf file (one `glob=port` per line, # comments)
  [[ -n "$PORTS_CONF" && -f "$PORTS_CONF" ]] || return 1
  while IFS= read -r line; do
    [[ -n "$line" && "$line" != \#* ]] || continue
    glob="${line%%=*}"
    p="${line##*=}"
    if [[ "$branch" == $glob ]]; then
      printf '%s' "$p"
      return 0
    fi
  done < "$PORTS_CONF"
  return 1
}

# deterministic default: PORT_MIN + cksum(slug) % PORT_RANGE
default_port() {
  local slug="$1"
  local sum
  sum=$(printf '%s' "$slug" | cksum | awk '{print $1}')
  echo $(( PORT_MIN + (sum % PORT_RANGE) ))
}

# a port is in use if any live worktree entry already claims it for another
# branch, or an OS process is listening on it.
port_in_use() {
  local port="$1" branch="$2" other
  if other="$(python3 - "$STATE_FILE" "$port" "$branch" <<'PY'
import json, sys
state_file, port, branch = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    data = json.load(open(state_file))
except Exception:
    data = {}
for path, e in data.get("worktrees", {}).items():
    r = e.get("runner") or {}
    if r.get("port") == int(port) and e.get("branch") != branch and e.get("status") != "done":
        print(path)
        sys.exit(0)
sys.exit(1)
PY
)"; then
    echo "port $port claimed by $other" >&2
    return 0
  fi
  if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port $port in use by an OS process" >&2
    return 0
  fi
  return 1
}

resolve_port() {
  local branch port candidate
  branch="$(current_branch)"
  if port="$(project_port_override "$branch")"; then
    printf '%s' "$port"
    return 0
  fi
  candidate="$(default_port "$(slug "$branch")")"
  while port_in_use "$candidate" "$branch"; do
    candidate=$(( candidate + 1 ))
    if [[ $candidate -ge $(( PORT_MIN + PORT_RANGE )) ]]; then
      echo "runner.sh: no free port in range ${PORT_MIN}-$((PORT_MIN+PORT_RANGE-1))" >&2
      exit 1
    fi
  done
  printf '%s' "$candidate"
}

# ---------------------------------------------------------------------------
# command discovery — project conventions only, never baked in
# ---------------------------------------------------------------------------

# print the concrete launch command, honoring project conventions
build_command() {
  local root="$1" port="$2"
  if [[ -f "$root/justfile" || -f "$root/Justfile" ]]; then
    if command -v just >/dev/null 2>&1; then
      local recipe
      recipe="$(just --list 2>/dev/null | awk 'NR>=3 && NF {print $1; exit}')"
      if [[ -n "$recipe" ]]; then
        printf 'just %s (PORT=%s)' "$recipe" "$port"
        return 0
      fi
    fi
  fi
  if [[ -f "$root/Makefile" || -f "$root/makefile" || -f "$root/GNUmakefile" ]]; then
    if command -v make >/dev/null 2>&1; then
      printf 'make run (PORT=%s)' "$port"
      return 0
    fi
  fi
  if [[ -f "$root/package.json" ]]; then
    local pm=""
    [[ -f "$root/pnpm-lock.yaml" ]] && pm="pnpm"
    [[ -z "$pm" && -f "$root/yarn.lock" ]] && pm="yarn"
    [[ -z "$pm" && -f "$root/package-lock.json" ]] && pm="npm"
    if [[ -z "$pm" ]]; then
      command -v pnpm >/dev/null 2>&1 && pm="pnpm"
      [[ -z "$pm" ]] && command -v yarn >/dev/null 2>&1 && pm="yarn"
      [[ -z "$pm" ]] && command -v npm >/dev/null 2>&1 && pm="npm"
    fi
    if python3 - "$root/package.json" <<'PY' | grep -qi 'true'
import json, sys
d = json.load(open(sys.argv[1]))
print("dev" in (d.get("scripts") or {}))
PY
    then
      printf '%s run dev (PORT=%s)' "${pm:-npm}" "$port"
      return 0
    fi
  fi
  printf 'PORT=%s <see AGENTS.md/README for the app launcher>' "$port"
}

# ---------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------

BRANCH="$(current_branch)"
SLUG="$(slug "$BRANCH")"
ROOT="${WORKTREES_WORKTREE_ROOT:-$PWD}"

# PORT is resolved lazily: only commands that need it pay the cost (and only
# they can fail on port exhaustion). `stop` never touches ports.
PORT=""

case "${1:-}" in
  env)
    PORT="$(resolve_port)"
    printf 'export PORT=%s\nexport RUN_ID=%s\nexport RUNNER_BRANCH=%s\n' "$PORT" "$SLUG" "$BRANCH"
    ;;
  port)
    printf '%s\n' "$(resolve_port)"
    ;;
  command)
    PORT="$(resolve_port)"
    build_command "$ROOT" "$PORT"
    ;;
  resolve)
    PORT="$(resolve_port)"
    printf 'port=%s\ncommand=%s\n' "$PORT" "$(build_command "$ROOT" "$PORT")"
    ;;
  publish)
    PORT="$(resolve_port)"
    shift
    path="${1:-}"; shift
    [[ -n "$path" ]] || { echo "usage: runner.sh publish <path> <cmd> [pid]" >&2; exit 1; }
    cmd="" pid=""
    while [[ $# -gt 0 ]]; do
      if [[ "$1" =~ ^[0-9]+$ ]]; then pid="$1"; else cmd="$cmd $1"; fi
      shift
    done
    cmd="$(printf '%s' "$cmd" | sed 's/^ //')"
    runner="{\"port\": $PORT, \"command\": $(printf '%s' "$cmd" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
    [[ -n "$pid" ]] && runner+=", \"pid\": $pid"
    runner+="}"
    "$STATE_SH" set "$path" "status=running" "runner=$runner"
    ;;
  stop)
    shift
    [[ $# -eq 1 ]] || { echo "usage: runner.sh stop <path>" >&2; exit 1; }
    "$STATE_SH" set "$1" "runner=null"
    ;;
  *)
    echo "usage: runner.sh {env|port|command|resolve|publish|stop}" >&2
    exit 1
    ;;
esac

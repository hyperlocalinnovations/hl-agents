#!/usr/bin/env bash
set -euo pipefail

# state.sh — shared coordination state for parallel worktree agent instances.
#
# A single JSON state file lives in the git common dir, which every linked
# worktree shares, so all instances read/write the same file. Every
# read-modify-write is serialized with a pure-shell `mkdir` spinlock (no flock,
# works on macOS) and applied atomically via tmp-file + mv.
#
# Usage:
#   state.sh lock [timeout]            acquire the lock (default 30s timeout)
#   state.sh unlock                    release the lock
#   state.sh get <path> [field...]     print a worktree entry (or fields)
#   state.sh list [--json]             table of all worktree entries
#   state.sh set <path> k=v [k=v...]   create/update an entry (takes lock)
#   state.sh heartbeat <path>          touch updatedAt for an entry (takes lock)
#   state.sh release <path>            mark status=done and clear runner (takes lock)
#   state.sh prune                     drop entries whose worktree dir is gone

LOCK_TIMEOUT_DEFAULT=30
LOCK_MAX_AGE=300

# ---------------------------------------------------------------------------
# paths
# ---------------------------------------------------------------------------

# The git common dir is shared by all worktrees of the same repo. The state
# file and its lock live there so every instance sees the same data without
# polluting any working tree.
git_common_dir() {
  local gd
  gd="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || {
    echo "state.sh: not inside a git worktree (no git common dir)" >&2
    exit 1
  }
  printf '%s' "$gd"
}

STATE_DIR="${WORKTREES_STATE_DIR:-$(git_common_dir)/worktrees}"
STATE_FILE="$STATE_DIR/state.json"
LOCK_DIR="$STATE_DIR/.lock"

mkdir -p "$STATE_DIR"
touch "$STATE_FILE"

# ---------------------------------------------------------------------------
# json helpers (python3 present on macOS + Linux)
# ---------------------------------------------------------------------------

# read <path> [field...]  — print a whole entry as JSON, or just the fields
read_entry() {
  local path="$1"; shift
  if [[ $# -gt 0 ]]; then
    local fields=()
    for f in "$@"; do fields+=("$f"); done
    python3 - "$STATE_FILE" "$path" "${fields[@]}" <<'PY'
import json, os, sys
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
except Exception:
    print(json.dumps(None))
    sys.exit(1)
entry = data.get("worktrees", {}).get(sys.argv[2])
if entry is None:
    print(json.dumps(None))
    sys.exit(1)
out = {k: entry.get(k) for k in sys.argv[3:]}
print(json.dumps(out))
PY
  else
    python3 - "$STATE_FILE" "$path" <<'PY'
import json, sys
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
except Exception:
    print(json.dumps(None))
    sys.exit(1)
print(json.dumps(data.get("worktrees", {}).get(sys.argv[2]), indent=2))
PY
  fi
}

# write <path> <json-blob>  — merge a blob into an entry (caller must hold lock)
write_entry() {
  local path="$1" blob="$2"
  python3 - "$STATE_FILE" "$path" "$blob" <<'PY'
import json, os, sys, time
state_file, path, blob = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
data = {}
try:
    with open(state_file) as f:
        data = json.load(f)
except Exception:
    data = {}
data.setdefault("format", 1)
data.setdefault("ports", {})
data.setdefault("worktrees", {})
entry = data["worktrees"].setdefault(path, {})
entry.update(blob)
entry["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
tmp = state_file + ".tmp"
with open(tmp, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
os.replace(tmp, state_file)
PY
}

# ---------------------------------------------------------------------------
# lock
# ---------------------------------------------------------------------------

_lock() {
  # mkdir is atomic; only one process can win. Retry until timeout or success.
  local deadline now timeout="${LOCK_TIMEOUT:-$LOCK_TIMEOUT_DEFAULT}"
  deadline=$(( $(date +%s) + timeout ))
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    _recover_stale_lock
    now=$(date +%s)
    if [[ $now -ge $deadline ]]; then
      echo "state.sh: lock timeout after ${timeout}s ($LOCK_DIR)" >&2
      return 1
    fi
    sleep 0.1
  done
  printf '%s\n' "$$ $(date +%s)" > "$LOCK_DIR/owner"
  return 0
}

_recover_stale_lock() {
  local pid ts now
  # A lock dir with no owner file means the process died between `mkdir` and
  # writing the owner file. Treat it as stale once it's old enough that a
  # live contender would have written its owner file (a few seconds).
  if [[ ! -f "$LOCK_DIR/owner" ]]; then
    if [[ -z "$(find "$LOCK_DIR" -maxdepth 0 -mmin +1 2>/dev/null)" ]]; then
      return 0
    fi
    echo "state.sh: removing stale lock (no owner file)" >&2
    rm -rf "$LOCK_DIR"
    return 0
  fi
  read -r pid ts < "$LOCK_DIR/owner" || return 0
  now=$(date +%s)
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "state.sh: removing stale lock from dead pid $pid" >&2
    rm -rf "$LOCK_DIR"
  elif [[ $((now - ts)) -gt $LOCK_MAX_AGE ]]; then
    echo "state.sh: removing stale lock held by pid $pid for > ${LOCK_MAX_AGE}s" >&2
    rm -rf "$LOCK_DIR"
  fi
}

_unlock() {
  rm -rf "$LOCK_DIR"
}

# ---------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------

prune_stale() {
  # Slots in `starting` status are intent-not-yet-created worktrees (SKILL.md
  # registers the slot before `git worktree add`), so never prune those.
  local dir
  while IFS= read -r -d '' dir; do
    [[ -z "$dir" ]] && continue
    [[ -d "$dir" ]] || {
      _lock
      write_entry "$dir" '{"status": "gone", "task": "worktree directory removed"}'
      _unlock
      echo "state.sh: marked missing worktree gone: $dir" >&2
    }
  done < <(python3 - "$STATE_FILE" <<'PY'
import json, os, sys
try:
    data = json.load(open(sys.argv[1]))
except Exception:
    data = {}
out = []
for k, e in (data.get("worktrees") or {}).items():
    if e.get("status") not in ("starting", "gone") and not os.path.isdir(k):
        out.append(k)
if out:
    print("\0".join(out), end="\0")
PY
)
}

cmd="${1:-}"

case "$cmd" in
  lock)
    LOCK_TIMEOUT="${2:-${LOCK_TIMEOUT:-$LOCK_TIMEOUT_DEFAULT}}"
    _lock
    ;;
  unlock)
    _unlock
    ;;
  get)
    shift
    read_entry "$@"
    ;;
  list)
    shift
    if [[ "${1:-}" == "--json" ]]; then
      cat "$STATE_FILE"
    else
      python3 - "$STATE_FILE" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1]))
except Exception:
    data = {}
rows = data.get("worktrees", {})
if not rows:
    print("(no registered worktrees)")
    sys.exit(0)
for path, e in rows.items():
    runner = e.get("runner") or {}
    port = runner.get("port", "-")
    cmd = runner.get("command", "-")
    print(f"{e.get('status','?'):<10} {e.get('branch','?'):<30} port={port:<6} {cmd}")
    print(f"    {path}")
    if e.get("task"): print(f"    task: {e['task']}")
    if e.get("progress") is not None: print(f"    progress: {e['progress']}%")
    print(f"    updated: {e.get('updatedAt','?')}")
PY
    fi
    ;;
  set)
    shift
    [[ $# -ge 2 ]] || { echo "usage: state.sh set <path> k=v [k=v...]" >&2; exit 1; }
    path="$1"; shift
    pairs=()
    for kv in "$@"; do
      IFS='=' read -r k v <<< "$kv"
      pairs+=("$k" "$v")
    done
    # JSON-detect each value so nested objects (e.g. runner={...}) stay objects.
    blob="$(python3 - "${pairs[@]}" <<'PY'
import json, sys
pairs = sys.argv[1:]
out = {}
for i in range(0, len(pairs), 2):
    k, v = pairs[i], pairs[i + 1]
    try:
        out[k] = json.loads(v)
    except Exception:
        out[k] = v
print(json.dumps(out))
PY
)"
    prune_stale
    _lock
    write_entry "$path" "$blob"
    _unlock
    ;;
  heartbeat)
    shift
    [[ $# -eq 1 ]] || { echo "usage: state.sh heartbeat <path>" >&2; exit 1; }
    _lock
    write_entry "$1" '{}'
    _unlock
    ;;
  release)
    shift
    [[ $# -eq 1 ]] || { echo "usage: state.sh release <path>" >&2; exit 1; }
    _lock
    write_entry "$1" '{"status": "done", "runner": null, "progress": null}'
    _unlock
    ;;
  prune)
    prune_stale
    ;;
  *)
    echo "usage: state.sh {lock|unlock|get|list|set|heartbeat|release|prune}" >&2
    exit 1
    ;;
esac

#!/usr/bin/env bash
set -euo pipefail

# worktree-setup.sh — create a git worktree and bootstrap it for agent use.
#
# 1. `git worktree add` the requested branch/path.
# 2. Propagate AGENTS.md + .opencode/ from the source worktree into the new
#    worktree so every instance follows the same instructions and behaves
#    identically. Copies only when the target is missing or the source is
#    newer, so worktree-local divergence is never clobbered.
# 3. Register the worktree in the shared coordination state.
#
# Usage:
#   worktree-setup.sh <branch> [path] [--source <worktree>] [--force-copy]
#
#   <branch>  branch to check out / create (created from current HEAD if absent)
#   [path]    target directory; defaults to ../<branch-slug>
#   --source  worktree to copy AGENTS.md/.opencode from (default: this worktree)
#   --force-copy  overwrite existing AGENTS.md/.opencode files even if newer

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_SH="$SCRIPT_DIR/state.sh"

SOURCE=""
FORCE_COPY=0
BRANCH=""
PATH_ARG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SOURCE="$2"; shift 2 ;;
    --force-copy) FORCE_COPY=1; shift ;;
    --) shift; break ;;
    *) break ;;
  esac
done

BRANCH="${1:-}"
PATH_ARG="${2:-}"
[[ -n "$BRANCH" ]] || { echo "usage: worktree-setup.sh <branch> [path] [--source <wt>] [--force-copy]" >&2; exit 1; }

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

# branch name -> filesystem-safe slug: feat/foo-123 -> feat-foo-123
slug() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '_'
}

# path of the main worktree (first in `git worktree list`)
main_worktree() {
  git worktree list | awk 'NR==1 {print $1}'
}

# default source: the main worktree, so propagation works from any worktree
SOURCE="${SOURCE:-$(main_worktree)}"
if [[ ! -d "$SOURCE" ]]; then
  echo "worktree-setup: source worktree '$SOURCE' not found; skipping propagation" >&2
  SOURCE=""
fi

# copy_if_newer <src> <dst>  — copy file/dir only if missing or source newer
copy_if_newer() {
  local src="$1" dst="$2"
  [[ -e "$src" ]] || return 0
  if [[ -d "$src" ]]; then
    mkdir -p "$dst"
    # Recurse over every entry, skipping . and .. implicitly via find -mindepth 1.
    while IFS= read -r -d '' f; do
      copy_if_newer "$f" "$dst/$(basename "$f")"
    done < <(find "$src" -mindepth 1 -maxdepth 1 -print0)
  else
    if [[ $FORCE_COPY -eq 1 ]] || [[ ! -e "$dst" ]] || [[ "$src" -nt "$dst" ]]; then
      mkdir -p "$(dirname "$dst")"
      cp -p "$src" "$dst"
    fi
  fi
}

# ---------------------------------------------------------------------------
# 1. create the worktree
# ---------------------------------------------------------------------------

SLUG="$(slug "$BRANCH")"
WT_PATH="${PATH_ARG:-../$SLUG}"

if [[ -e "$WT_PATH/.git" ]] && git -C "$WT_PATH" rev-parse --git-dir >/dev/null 2>&1; then
  echo "worktree-setup: $WT_PATH is already a git worktree; skipping create"
elif git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git worktree add "$WT_PATH" "$BRANCH"
else
  git worktree add -b "$BRANCH" "$WT_PATH"
fi
WT_ABS="$(cd "$WT_PATH" && pwd)"

# ---------------------------------------------------------------------------
# 2. propagate AGENTS.md + .opencode
# ---------------------------------------------------------------------------

if [[ -n "$SOURCE" ]]; then
  for f in "$SOURCE"/AGENTS.md "$SOURCE"/AGENTS.*.md; do
    [[ -e "$f" ]] && copy_if_newer "$f" "$WT_ABS/$(basename "$f")"
  done
  copy_if_newer "$SOURCE/.opencode" "$WT_ABS/.opencode"
fi

# ---------------------------------------------------------------------------
# 3. register in coordination state
# ---------------------------------------------------------------------------

"$STATE_SH" set "$WT_ABS" \
  "branch=$BRANCH" \
  "status=idle" \
  "task=" \
  "progress=0" \
  "runner=null" \
  "worktree-created=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "worktree-setup: ready at $WT_ABS (branch $BRANCH)"
echo "worktree-setup: next — cd $WT_ABS && state.sh set \"$WT_ABS\" task='...' status=running"

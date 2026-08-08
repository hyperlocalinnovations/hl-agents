#!/usr/bin/env bash
set -euo pipefail

# install.sh — link this skill into the global opencode skills dir so it's
# available in every project and every worktree (worktrees don't carry the
# project's .opencode config, but the global skills dir is shared).
#
# Symlinking keeps the repo copy canonical; edits in the repo apply
# immediately. If a real copy is needed (no symlink support, e.g. some
# editors/backups), use --copy instead.

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${OPENCODE_SKILLS_DIR:-$HOME/.config/opencode/skills}"
TARGET="$TARGET_DIR/worktree-agents"

mode="link"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --copy) mode="copy"; shift ;;
    --target) TARGET_DIR="$2"; TARGET="$TARGET_DIR/worktree-agents"; shift 2 ;;
    *) echo "usage: install.sh [--copy] [--target <dir>]" >&2; exit 1 ;;
  esac
done

mkdir -p "$TARGET_DIR"

if [[ -e "$TARGET" || -L "$TARGET" ]]; then
  echo "install: removing existing $TARGET"
  rm -rf "$TARGET"
fi

if [[ "$mode" == "copy" ]]; then
  cp -R "$SKILL_DIR" "$TARGET"
  echo "install: copied $SKILL_DIR -> $TARGET"
else
  ln -s "$SKILL_DIR" "$TARGET"
  echo "install: linked $SKILL_DIR -> $TARGET"
fi

echo "install: restart opencode for the skill to be picked up."
echo "install: to keep in sync, keep the repo copy canonical (symlink)."

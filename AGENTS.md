# Build
pnpm run build

# Typecheck
pnpm run typecheck

# Lint
pnpm run lint

# Tests
pnpm run test

# Single package (from repo root)
pnpm --filter @hl-agents/core run test

# Skills
- Shareable opencode skills live in `skills/`. Install via symlink or copy into `~/.config/opencode/skills/` (see README).
- Keep `skills/agents-feedback/SKILL.md` in sync with the global install at `~/.config/opencode/skills/agents-feedback` (symlink by default).
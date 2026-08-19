# Review Guidelines

- Review only the requested diff scope; report real, actionable defects, not style preferences.
- Run `pnpm run lint`, `pnpm run typecheck`, and `pnpm run test` when relevant to the changed code.
- Preserve the harness-agnostic package boundaries and avoid adding dependencies for small utilities.
- Include the file and line for every finding.

import type { Config } from '@hl-agents/cli';

export default {
  review: {
    adapter: 'opencode-slash',
    agent: 'build',
    auto: true,
    scope: 'branch',
    // Zero-config: a baked-in review prompt is sent to `opencode run --auto --agent build`.
    // scope: 'staged' | 'uncommitted' | 'branch' | 'all' (default 'branch')
    // To use a custom slash command instead, uncomment:
    // command: '/review-loop',
  },
  validate: {
    rules: { minSeverity: 'medium', ignore: ['**/*.md', 'dist/**', 'node_modules/**'] },
    llmVerify: { adapter: 'off' },
    // To enable LLM verification of findings, swap the line above for:
    // llmVerify: { adapter: 'opencode-agent', agent: 'build', auto: true },
  },
  plan: { adapter: 'opencode-agent', agent: 'plan', auto: true },
  apply: { adapter: 'opencode-agent', agent: 'build', auto: true },
  commit: {
    adapter: 'git',
    granularity: 'per-iteration',
    message: 'fix({rule}): {message}',
    addAll: true,
  },
  loop: { maxIterations: 10, repeatBailThreshold: 3, dryRun: false },
} satisfies Config;
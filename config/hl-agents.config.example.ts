import type { Config } from '@hl-agents/cli';

export default {
  review: {
    adapter: 'command',
    command: 'opencode',
    args: ['run', '/review'],
  },
  validate: {
    rules: { minSeverity: 'medium', ignore: ['**/*.md', 'dist/**', 'node_modules/**'] },
    llmVerify: { adapter: 'off' },
  },
  plan: { adapter: 'opencode-agent' },
  apply: { adapter: 'opencode-agent' },
  commit: {
    adapter: 'git',
    granularity: 'per-iteration',
    message: 'fix({rule}): {message}',
    addAll: true,
  },
  loop: { maxIterations: 10, repeatBailThreshold: 3, dryRun: false },
} satisfies Config;
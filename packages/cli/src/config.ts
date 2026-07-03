import type { Severity } from '@hl-agents/core';
import type { CommitGranularity } from '@hl-agents/core';

export interface Config {
  review: {
    adapter: 'eslint' | 'command' | 'opencode-slash';
    command?: string;
    args?: string[];
    parser?: string;
    slashCommand?: string;
  };
  validate: {
    rules?: {
      minSeverity?: Severity;
      ignore?: string[];
      allowRules?: string[];
      denyRules?: string[];
    };
    llmVerify?: {
      adapter: 'opencode-agent' | 'claude-code' | 'off';
    };
  };
  plan: {
    adapter: 'opencode-agent' | 'script' | 'dry-run';
    command?: string;
    args?: string[];
  };
  apply: {
    adapter: 'opencode-agent' | 'script' | 'dry-run';
    command?: string;
    args?: string[];
  };
  commit: {
    adapter: 'git' | 'noop';
    granularity?: CommitGranularity;
    message?: string;
    addAll?: boolean;
    authorName?: string;
    authorEmail?: string;
  };
  loop: {
    maxIterations?: number;
    repeatBailThreshold?: number;
    dryRun?: boolean;
  };
}

export const defaultConfig: Config = {
  review: { adapter: 'command', command: 'opencode', args: ['run', '/review'] },
  validate: { rules: { minSeverity: 'medium' }, llmVerify: { adapter: 'off' } },
  plan: { adapter: 'opencode-agent' },
  apply: { adapter: 'opencode-agent' },
  commit: { adapter: 'git', granularity: 'per-iteration', message: 'fix({rule}): {message}', addAll: true },
  loop: { maxIterations: 10, repeatBailThreshold: 3, dryRun: false },
};
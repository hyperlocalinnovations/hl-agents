import type { Severity } from '@hl-agents/core';
import type { CommitGranularity } from '@hl-agents/core';

export interface Config {
  serverUrl?: string;
  review: {
    adapter: 'opencode-slash' | 'command' | 'eslint';
    command?: string;
    args?: string[];
    parser?: string;
    slashCommand?: string;
    agent?: string;
    auto?: boolean;
    extraArgs?: string[];
    promptPrefix?: string;
    prompt?: string;
    scope?: 'staged' | 'uncommitted' | 'branch' | 'all';
    timeoutMs?: number;
    serverUrl?: string;
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
      agent?: string;
      auto?: boolean;
      extraArgs?: string[];
      timeoutMs?: number;
    };
  };
  plan: {
    adapter: 'opencode-agent' | 'script' | 'dry-run';
    command?: string;
    args?: string[];
    slashCommand?: string;
    agent?: string;
    auto?: boolean;
    extraArgs?: string[];
    promptPrefix?: string;
    timeoutMs?: number;
    serverUrl?: string;
  };
  apply: {
    adapter: 'opencode-agent' | 'script' | 'dry-run';
    command?: string;
    args?: string[];
    agent?: string;
    auto?: boolean;
    extraArgs?: string[];
    timeoutMs?: number;
    serverUrl?: string;
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
  review: { adapter: 'opencode-slash', agent: 'build', auto: true, scope: 'branch' },
  validate: { rules: { minSeverity: 'medium' }, llmVerify: { adapter: 'off' } },
  plan: { adapter: 'opencode-agent', agent: 'plan', auto: true },
  apply: { adapter: 'opencode-agent', agent: 'build', auto: true },
  commit: { adapter: 'git', granularity: 'per-iteration', message: 'fix({rule}): {message}', addAll: true },
  loop: { maxIterations: 10, repeatBailThreshold: 3, dryRun: false },
};
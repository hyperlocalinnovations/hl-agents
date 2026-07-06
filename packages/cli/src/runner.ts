import type {
  Committer,
  FixApplier,
  FixPlanner,
  Logger,
  ReviewAdapter,
  Validator,
} from '@hl-agents/core';
import { runLoop } from '@hl-agents/core';
import { RulesValidator } from '@hl-agents/validate';
import {
  CommandReviewAdapter,
  parseEslint,
  OpencodeSlashReviewAdapter,
} from '@hl-agents/review-adapters';
import {
  DryRunApplier,
  DryRunPlanner,
  ScriptApplier,
  ScriptPlanner,
  OpencodeAgentApplier,
  OpencodeAgentPlanner,
} from '@hl-agents/fix-adapters';
import { GitCommitter, NoopCommitter } from '@hl-agents/committer';
import { OpencodeVerifyValidator } from '@hl-agents/opencode-agent';
import type { Config } from './config.js';

const ts = () => new Date().toISOString();
const consoleLogger: Logger = {
  info: (m) => console.log(`[hl-agents] ${ts()} ${m}`),
  warn: (m) => console.warn(`[hl-agents] WARN: ${ts()} ${m}`),
  error: (m) => console.error(`[hl-agents] ERR: ${ts()} ${m}`),
  debug: (m) => console.debug(`[hl-agents] debug: ${ts()} ${m}`),
};

const buildReview = (cfg: Config): ReviewAdapter => {
  switch (cfg.review.adapter) {
    case 'opencode-slash':
      return new OpencodeSlashReviewAdapter({
        command: cfg.review.command ?? cfg.review.slashCommand,
        agent: cfg.review.agent,
        promptPrefix: cfg.review.promptPrefix,
        prompt: cfg.review.prompt,
        scope: cfg.review.scope,
        timeoutMs: cfg.review.timeoutMs,
        serverUrl: cfg.review.serverUrl ?? cfg.serverUrl,
      }) as unknown as ReviewAdapter;
    case 'command':
      if (!cfg.review.command) throw new Error('review.command required for command adapter');
      if (!cfg.review.parser || cfg.review.parser === 'noop') {
        throw new Error(
          "review.parser required for command adapter — set it to 'eslint' or provide a custom parser name. The no-op default was removed because it silently swallowed all findings.",
        );
      }
      return new CommandReviewAdapter({
        command: cfg.review.command,
        args: cfg.review.args,
        parser: cfg.review.parser === 'eslint' ? (stdout) => parseEslint(stdout) : () => [],
      });
    case 'eslint':
      return new CommandReviewAdapter({
        command: cfg.review.command ?? 'npx',
        args: ['eslint', '--format=json', ...(cfg.review.args ?? [])],
        parser: (stdout) => parseEslint(stdout),
      });
  }
};

const buildValidator = (cfg: Config): Validator => {
  const rules = new RulesValidator(cfg.validate.rules ?? {});
  const verifyCfg = cfg.validate.llmVerify;
  if (!verifyCfg || verifyCfg.adapter === 'off') return rules;
  if (verifyCfg.adapter === 'opencode-agent') {
    return new OpencodeVerifyValidator(rules, {
      agent: verifyCfg.agent,
      timeoutMs: verifyCfg.timeoutMs,
      serverUrl: cfg.serverUrl,
    });
  }
  // adapter: 'claude-code' — not yet implemented; fall back to rules-only.
  return rules;
};

const buildPlanner = (cfg: Config): FixPlanner => {
  switch (cfg.plan.adapter) {
    case 'dry-run':
      return new DryRunPlanner();
    case 'script':
      if (!cfg.plan.command) throw new Error('plan.command required for script adapter');
      return new ScriptPlanner({ command: cfg.plan.command, args: cfg.plan.args });
    case 'opencode-agent':
      return new OpencodeAgentPlanner({
        agent: cfg.plan.agent,
        timeoutMs: cfg.plan.timeoutMs,
        serverUrl: cfg.plan.serverUrl ?? cfg.serverUrl,
      });
  }
};

const buildApplier = (cfg: Config): FixApplier => {
  switch (cfg.apply.adapter) {
    case 'dry-run':
      return new DryRunApplier();
    case 'script':
      if (!cfg.apply.command) throw new Error('apply.command required for script adapter');
      return new ScriptApplier({ command: cfg.apply.command, args: cfg.apply.args });
    case 'opencode-agent':
      return new OpencodeAgentApplier({
        agent: cfg.apply.agent,
        timeoutMs: cfg.apply.timeoutMs,
        serverUrl: cfg.apply.serverUrl ?? cfg.serverUrl,
      });
  }
};

const buildCommitter = (cfg: Config): Committer => {
  if (cfg.commit.adapter === 'noop') return new NoopCommitter();
  return new GitCommitter({
    messageTemplate: cfg.commit.message,
    addAll: cfg.commit.addAll,
    authorName: cfg.commit.authorName,
    authorEmail: cfg.commit.authorEmail,
  });
};

export const runFromConfig = async (cfg: Config, logger: Logger = consoleLogger) => {
  return runLoop({
    reviewAdapter: buildReview(cfg),
    validator: buildValidator(cfg),
    fixPlanner: buildPlanner(cfg),
    fixApplier: buildApplier(cfg),
    committer: buildCommitter(cfg),
    maxIterations: cfg.loop.maxIterations ?? 10,
    repeatBailThreshold: cfg.loop.repeatBailThreshold ?? 3,
    commitGranularity: cfg.commit.granularity ?? 'per-iteration',
    dryRun: cfg.loop.dryRun ?? false,
    logger,
  });
};
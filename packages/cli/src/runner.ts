import type {
  Committer,
  FixApplier,
  FixPlanner,
  Logger,
  ReviewAdapter,
  Validator,
} from '@hl-agents/core';
import { runLoop } from '@hl-agents/core';
import { RulesValidator, LlmVerifyValidator } from '@hl-agents/validate';
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
import type { Config } from './config.js';

const consoleLogger: Logger = {
  info: (m) => console.log(`[hl-agents] ${m}`),
  warn: (m) => console.warn(`[hl-agents] WARN: ${m}`),
  error: (m) => console.error(`[hl-agents] ERR: ${m}`),
  debug: (m) => console.debug(`[hl-agents] debug: ${m}`),
};

const buildReview = (cfg: Config): ReviewAdapter => {
  switch (cfg.review.adapter) {
    case 'eslint':
      return new CommandReviewAdapter({
        command: cfg.review.command ?? 'npx',
        args: ['eslint', '--format=json', ...(cfg.review.args ?? [])],
        parser: (stdout) => parseEslint(stdout),
      });
    case 'command':
      if (!cfg.review.command) throw new Error('review.command required for command adapter');
      return new CommandReviewAdapter({
        command: cfg.review.command,
        args: cfg.review.args,
        parser: (_stdout, _stderr) => [],
      });
    case 'opencode-slash':
      return new OpencodeSlashReviewAdapter({ command: cfg.review.slashCommand }) as unknown as ReviewAdapter;
  }
};

const buildValidator = (cfg: Config): Validator => {
  const rules = new RulesValidator(cfg.validate.rules ?? {});
  const verifyCfg = cfg.validate.llmVerify;
  if (!verifyCfg || verifyCfg.adapter === 'off') return rules;
  return new LlmVerifyValidator({
    inner: rules,
    verifier: {
      // delegate to harness agent — stubbed here, real impl in opencode-agent package
      async verify(findings) {
        return findings.map((f) => ({ id: f.id, valid: true, reason: 'unverified' }));
      },
    },
  });
};

const buildPlanner = (cfg: Config): FixPlanner => {
  switch (cfg.plan.adapter) {
    case 'dry-run':
      return new DryRunPlanner();
    case 'script':
      if (!cfg.plan.command) throw new Error('plan.command required for script adapter');
      return new ScriptPlanner({ command: cfg.plan.command, args: cfg.plan.args });
    case 'opencode-agent':
      return new OpencodeAgentPlanner();
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
      return new OpencodeAgentApplier();
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
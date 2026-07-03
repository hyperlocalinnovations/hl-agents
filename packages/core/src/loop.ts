import type {
  Finding,
  FixPlan,
  IterationResult,
  LoopResult,
  StuckFinding,
} from './types.js';
import type {
  Committer,
  FixApplier,
  FixPlanner,
  Logger,
  ReviewAdapter,
  Validator,
} from './interfaces.js';
import { noopLogger } from './interfaces.js';

export type CommitGranularity = 'per-finding' | 'per-iteration' | 'per-batch';

export interface LoopOptions {
  reviewAdapter: ReviewAdapter;
  validator: Validator;
  fixPlanner: FixPlanner;
  fixApplier: FixApplier;
  committer: Committer;
  maxIterations: number;
  repeatBailThreshold: number;
  commitGranularity: CommitGranularity;
  dryRun: boolean;
  logger?: Logger;
}

const findingKey = (f: Finding): string =>
  `${f.file}:${f.line ?? 0}:${f.rule ?? f.message}`;

export async function runLoop(opts: LoopOptions): Promise<LoopResult> {
  const log = opts.logger ?? noopLogger;
  const iterations: IterationResult[] = [];
  const attempts = new Map<string, number>();
  const stuck: StuckFinding[] = [];
  let totalFindings = 0;
  let totalValid = 0;
  let totalDropped = 0;
  let totalCommits = 0;
  let cleanPass = false;
  let stoppedReason: LoopResult['stoppedReason'] = 'max-iterations';

  for (let i = 1; i <= opts.maxIterations; i++) {
    log.info?.(`review iteration ${i}/${opts.maxIterations}`);
    const review = await opts.reviewAdapter.run();
    totalFindings += review.findings.length;

    if (review.findings.length === 0) {
      cleanPass = true;
      stoppedReason = 'clean';
      log.info?.('review clean — stopping');
      break;
    }

    const outcome = await opts.validator.validate(review.findings);
    totalValid += outcome.valid.length;
    totalDropped += outcome.dropped.length;
    if (outcome.dropped.length > 0) {
      log.debug?.(`dropped ${outcome.dropped.length} findings as invalid`);
    }

    if (outcome.valid.length === 0) {
      stoppedReason = 'no-valid';
      log.warn?.('no valid findings this iteration — stopping');
      iterations.push({
        iteration: i,
        findings: review.findings,
        valid: [],
        dropped: outcome.dropped,
        plans: [],
      });
      break;
    }

    if (opts.dryRun) {
      const plans = await opts.fixPlanner.plan(outcome.valid);
      stoppedReason = 'dry-run';
      log.info?.('dry-run: planning only, no apply/commit');
      iterations.push({
        iteration: i,
        findings: review.findings,
        valid: outcome.valid,
        dropped: outcome.dropped,
        plans,
      });
      break;
    }

    const stuckThisPass: Finding[] = [];
    const actionable: Finding[] = [];
    for (const f of outcome.valid) {
      const key = findingKey(f);
      const n = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, n);
      if (n > opts.repeatBailThreshold) {
        stuck.push({ finding: f, attempts: n });
        stuckThisPass.push(f);
        log.warn?.(`stuck finding after ${n} attempts: ${key}`);
      } else {
        actionable.push(f);
      }
    }

    if (actionable.length === 0) {
      stoppedReason = 'stuck';
      log.warn?.('all remaining findings are stuck — stopping');
      iterations.push({
        iteration: i,
        findings: review.findings,
        valid: outcome.valid,
        dropped: outcome.dropped,
        plans: [],
      });
      break;
    }

    const plans = await opts.fixPlanner.plan(actionable);
    const allChanged: string[] = [];

    for (const plan of plans) {
      const applied = await opts.fixApplier.apply(plan);
      allChanged.push(...applied.filesChanged);

      if (opts.commitGranularity === 'per-finding') {
        const c = await opts.committer.commit([plan], applied.filesChanged);
        totalCommits++;
        iterations.push({
          iteration: i,
          findings: review.findings,
          valid: outcome.valid,
          dropped: outcome.dropped,
          plans: [plan],
          commit: c,
        });
      }
    }

    if (opts.commitGranularity === 'per-iteration') {
      const c = await opts.committer.commit(plans, allChanged);
      totalCommits++;
      iterations.push({
        iteration: i,
        findings: review.findings,
        valid: outcome.valid,
        dropped: outcome.dropped,
        plans,
        commit: c,
      });
    } else if (opts.commitGranularity === 'per-batch' && iterations[iterations.length - 1]?.iteration !== i) {
      // per-batch defers commit grouping to the committer across plans; commit once
      const c = await opts.committer.commit(plans, allChanged);
      totalCommits++;
      iterations.push({
        iteration: i,
        findings: review.findings,
        valid: outcome.valid,
        dropped: outcome.dropped,
        plans,
        commit: c,
      });
    }

    if (stuckThisPass.length > 0 && actionable.length === 0) {
      stoppedReason = 'stuck';
      break;
    }
  }

  return {
    iterations,
    cleanPass,
    stoppedReason,
    summary: {
      totalFindings,
      totalValid,
      totalDropped,
      totalCommits,
      stuckFindings: stuck,
    },
  };
}
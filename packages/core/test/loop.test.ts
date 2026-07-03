import { describe, it, expect } from 'vitest';
import { runLoop } from '../src/loop.js';
import type {
  Committer,
  FixApplier,
  FixPlanner,
  ReviewAdapter,
  Validator,
} from '../src/interfaces.js';
import type { Finding, FixPlan, ReviewResult, ValidationOutcome } from '../src/types.js';

const mkFinding = (file: string, rule = 'r1', line = 1): Finding => ({
  id: `${file}:${line}:${rule}`,
  file,
  line,
  severity: 'high',
  rule,
  message: `issue in ${file}`,
});

const mkAdapters = (overrides: {
  review?: ReviewAdapter;
  validator?: Validator;
  planner?: FixPlanner;
  applier?: FixApplier;
  committer?: Committer;
}) => overrides;

const passThroughValidator: Validator = {
  async validate(findings): Promise<ValidationOutcome> {
    return { valid: findings, dropped: [] };
  },
};

const stubPlanner: FixPlanner = {
  async plan(valid): Promise<FixPlan[]> {
    return [
      { findings: valid, description: 'fix', files: [...new Set(valid.map((f) => f.file))] },
    ];
  },
};

const stubApplier: FixApplier = {
  async apply(plan): Promise<{ filesChanged: string[] }> {
    return { filesChanged: plan.files };
  },
};

const stubCommitter: Committer = {
  async commit(_plans, _files): Promise<{ sha: string; message: string }> {
    return { sha: 'deadbeef', message: 'fix' };
  },
};

describe('runLoop', () => {
  it('stops on a clean first pass', async () => {
    const review: ReviewAdapter = {
      async run(): Promise<ReviewResult> {
        return { findings: [], rawOutput: '' };
      },
    };
    const result = await runLoop({
      reviewAdapter: review,
      validator: passThroughValidator,
      fixPlanner: stubPlanner,
      fixApplier: stubApplier,
      committer: stubCommitter,
      maxIterations: 5,
      repeatBailThreshold: 3,
      commitGranularity: 'per-iteration',
      dryRun: false,
    });
    expect(result.cleanPass).toBe(true);
    expect(result.stoppedReason).toBe('clean');
    expect(result.iterations).toHaveLength(0);
  });

  it('fixes findings across iterations until clean', async () => {
    let calls = 0;
    const review: ReviewAdapter = {
      async run(): Promise<ReviewResult> {
        calls++;
        if (calls >= 3) return { findings: [], rawOutput: '' };
        return { findings: [mkFinding('a.ts')], rawOutput: 'r' };
      },
    };
    const result = await runLoop({
      reviewAdapter: review,
      validator: passThroughValidator,
      fixPlanner: stubPlanner,
      fixApplier: stubApplier,
      committer: stubCommitter,
      maxIterations: 10,
      repeatBailThreshold: 3,
      commitGranularity: 'per-iteration',
      dryRun: false,
    });
    expect(result.cleanPass).toBe(true);
    expect(result.iterations).toHaveLength(2);
    expect(result.summary.totalCommits).toBe(2);
  });

  it('dry-run stops after one iteration without committing', async () => {
    const review: ReviewAdapter = {
      async run(): Promise<ReviewResult> {
        return { findings: [mkFinding('a.ts')], rawOutput: 'r' };
      },
    };
    const result = await runLoop({
      reviewAdapter: review,
      validator: passThroughValidator,
      fixPlanner: stubPlanner,
      fixApplier: stubApplier,
      committer: stubCommitter,
      maxIterations: 10,
      repeatBailThreshold: 3,
      commitGranularity: 'per-iteration',
      dryRun: true,
    });
    expect(result.stoppedReason).toBe('dry-run');
    expect(result.summary.totalCommits).toBe(0);
    expect(result.iterations).toHaveLength(1);
  });

  it('stops when no findings are valid', async () => {
    const review: ReviewAdapter = {
      async run(): Promise<ReviewResult> {
        return { findings: [mkFinding('a.ts')], rawOutput: 'r' };
      },
    };
    const validator: Validator = {
      async validate(findings): Promise<ValidationOutcome> {
        return { valid: [], dropped: findings.map((f) => ({ finding: f, reason: 'x' })) };
      },
    };
    const result = await runLoop({
      reviewAdapter: review,
      validator,
      fixPlanner: stubPlanner,
      fixApplier: stubApplier,
      committer: stubCommitter,
      maxIterations: 5,
      repeatBailThreshold: 3,
      commitGranularity: 'per-iteration',
      dryRun: false,
    });
    expect(result.stoppedReason).toBe('no-valid');
    expect(result.summary.totalCommits).toBe(0);
  });

  it('bails on stuck findings past repeatBailThreshold', async () => {
    let calls = 0;
    const review: ReviewAdapter = {
      async run(): Promise<ReviewResult> {
        calls++;
        return { findings: [mkFinding('a.ts')], rawOutput: 'r' };
      },
    };
    const result = await runLoop({
      reviewAdapter: review,
      validator: passThroughValidator,
      fixPlanner: stubPlanner,
      fixApplier: stubApplier,
      committer: stubCommitter,
      maxIterations: 10,
      repeatBailThreshold: 2,
      commitGranularity: 'per-iteration',
      dryRun: false,
    });
    expect(result.stoppedReason).toBe('stuck');
    expect(result.summary.stuckFindings.length).toBeGreaterThan(0);
  });

  it('respects maxIterations', async () => {
    let calls = 0;
    const review: ReviewAdapter = {
      async run(): Promise<ReviewResult> {
        calls++;
        return { findings: [mkFinding(`f${calls}.ts`)], rawOutput: 'r' };
      },
    };
    const result = await runLoop({
      reviewAdapter: review,
      validator: passThroughValidator,
      fixPlanner: stubPlanner,
      fixApplier: stubApplier,
      committer: stubCommitter,
      maxIterations: 3,
      repeatBailThreshold: 99,
      commitGranularity: 'per-iteration',
      dryRun: false,
    });
    expect(result.stoppedReason).toBe('max-iterations');
    expect(result.iterations).toHaveLength(3);
  });

  it('per-finding granularity commits once per plan', async () => {
    let commits = 0;
    const committer: Committer = {
      async commit() {
        commits++;
        return { sha: 'x', message: 'm' };
      },
    };
    const planner: FixPlanner = {
      async plan(valid) {
        return valid.map((f) => ({ findings: [f], description: 'fix', files: [f.file] }));
      },
    };
    const review: ReviewAdapter = {
      async run(): Promise<ReviewResult> {
        if (commits >= 2) return { findings: [], rawOutput: '' };
        return { findings: [mkFinding('a.ts'), mkFinding('b.ts')], rawOutput: 'r' };
      },
    };
    const result = await runLoop({
      reviewAdapter: review,
      validator: passThroughValidator,
      fixPlanner: planner,
      fixApplier: stubApplier,
      committer,
      maxIterations: 5,
      repeatBailThreshold: 99,
      commitGranularity: 'per-finding',
      dryRun: false,
    });
    expect(result.summary.totalCommits).toBeGreaterThanOrEqual(2);
  });
});
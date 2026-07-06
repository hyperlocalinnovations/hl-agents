import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Finding, FixPlan } from '@hl-agents/core';

const mkFinding = (file: string, rule = 'r1', severity: Finding['severity'] = 'medium'): Finding => ({
  id: `${file}:1:${rule}`,
  file,
  line: 1,
  severity,
  rule,
  message: 'm',
});

const mkPlan = (file: string): FixPlan => ({
  findings: [mkFinding(file)],
  description: `fix ${file}`,
  files: [file],
});

const plansJson = JSON.stringify([
  {
    findings: [{ file: 'a.ts', line: 5, severity: 'high', rule: 'no-unused-vars', message: 'unused x' }],
    description: 'remove x',
    files: ['a.ts'],
  },
]);

const setupSdkMock = (structured: unknown = null, text: string = plansJson): {
  calls: { prompt: string; opts: Record<string, unknown> }[];
  diffFiles: string[];
} => {
  const calls: { prompt: string; opts: Record<string, unknown> }[] = [];
  const diffFiles: string[] = [];
  vi.doMock('@hl-agents/opencode-sdk', () => ({
    runPrompt: async (prompt: string, opts: Record<string, unknown>) => {
      calls.push({ prompt, opts });
      return { sessionId: 'ses-1', text, structured };
    },
    getSessionDiff: async () => diffFiles.map((file) => ({ file, additions: 1, deletions: 0 })),
    FindingSchema: { type: 'array' },
    FixPlanSchema: { type: 'array' },
    VerdictSchema: { type: 'array' },
  }));
  return { calls, diffFiles };
};

beforeEach(() => vi.resetModules());
afterEach(() => vi.doUnmock('@hl-agents/opencode-sdk'));

describe('OpencodeAgentPlanner (SDK)', () => {
  it('uses agent "plan" by default and parses plans from text', async () => {
    const { calls } = setupSdkMock(null);
    const { OpencodeAgentPlanner } = await import('../src/opencode-agent.js');
    const planner = new OpencodeAgentPlanner();
    const plans = await planner.plan([mkFinding('a.ts')]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.opts.agent).toBe('plan');
    expect(plans).toHaveLength(1);
    expect(plans[0]?.files).toEqual(['a.ts']);
    expect(plans[0]?.description).toBe('remove x');
  });

  it('honours structured output when server supports it', async () => {
    const { calls } = setupSdkMock([
      { findings: [], description: 'structured fix', files: ['b.ts'] },
    ]);
    const { OpencodeAgentPlanner } = await import('../src/opencode-agent.js');
    const planner = new OpencodeAgentPlanner();
    const plans = await planner.plan([mkFinding('a.ts')]);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.description).toBe('structured fix');
    expect(calls[0]?.opts.format).toBeDefined();
  });

  it('honours custom agent + timeoutMs + serverUrl', async () => {
    const { calls } = setupSdkMock(null);
    const { OpencodeAgentPlanner } = await import('../src/opencode-agent.js');
    const planner = new OpencodeAgentPlanner({ agent: 'custom-planner', timeoutMs: 5000, serverUrl: 'http://x:4096' });
    await planner.plan([mkFinding('a.ts')]);
    expect(calls[0]?.opts.agent).toBe('custom-planner');
    expect(calls[0]?.opts.timeoutMs).toBe(5000);
    expect(calls[0]?.opts.serverUrl).toBe('http://x:4096');
  });

  it('passes the findings summary in the prompt', async () => {
    const { calls } = setupSdkMock(null);
    const { OpencodeAgentPlanner } = await import('../src/opencode-agent.js');
    const planner = new OpencodeAgentPlanner();
    await planner.plan([mkFinding('a.ts', 'no-unused-vars', 'high')]);
    expect(calls[0]?.prompt).toContain('a.ts');
    expect(calls[0]?.prompt).toContain('no-unused-vars');
  });
});

describe('OpencodeAgentApplier (SDK)', () => {
  it('uses agent "build" by default and returns files from session diff', async () => {
    const { calls, diffFiles } = setupSdkMock(null);
    diffFiles.push('a.ts', 'b.ts');
    const { OpencodeAgentApplier } = await import('../src/opencode-agent.js');
    const applier = new OpencodeAgentApplier();
    const result = await applier.apply(mkPlan('a.ts'));
    expect(calls[0]?.opts.agent).toBe('build');
    expect(result.filesChanged).toEqual(['a.ts', 'b.ts']);
  });

  it('honours custom agent + timeoutMs + serverUrl', async () => {
    const { calls } = setupSdkMock(null);
    const { OpencodeAgentApplier } = await import('../src/opencode-agent.js');
    const applier = new OpencodeAgentApplier({ agent: 'custom-applier', timeoutMs: 10000, serverUrl: 'http://y:4096' });
    await applier.apply(mkPlan('a.ts'));
    expect(calls[0]?.opts.agent).toBe('custom-applier');
    expect(calls[0]?.opts.timeoutMs).toBe(10000);
    expect(calls[0]?.opts.serverUrl).toBe('http://y:4096');
  });

  it('passes the plan description + files in the prompt', async () => {
    const { calls } = setupSdkMock(null);
    const { OpencodeAgentApplier } = await import('../src/opencode-agent.js');
    const applier = new OpencodeAgentApplier();
    await applier.apply(mkPlan('a.ts'));
    expect(calls[0]?.prompt).toContain('fix a.ts');
    expect(calls[0]?.prompt).toContain('a.ts');
  });
});
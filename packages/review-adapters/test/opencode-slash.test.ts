import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const findingsJson = JSON.stringify([
  { file: 'a.ts', line: 5, severity: 'high', rule: 'no-unused-vars', message: 'unused x' },
]);

const setupSdkMock = (structured: unknown = null, text: string = findingsJson): {
  calls: { prompt: string; opts: Record<string, unknown> }[];
} => {
  const calls: { prompt: string; opts: Record<string, unknown> }[] = [];
  vi.doMock('@hl-agents/opencode-sdk', () => ({
    runPrompt: async (prompt: string, opts: Record<string, unknown>) => {
      calls.push({ prompt, opts });
      return { sessionId: 'ses-1', text, structured };
    },
    getSessionDiff: async () => [],
    FindingSchema: { type: 'array' },
    FixPlanSchema: { type: 'array' },
    VerdictSchema: { type: 'array' },
  }));
  return { calls };
};

beforeEach(() => vi.resetModules());
afterEach(() => vi.doUnmock('@hl-agents/opencode-sdk'));

describe('OpencodeSlashReviewAdapter — direct-prompt mode (default, zero-config)', () => {
  it('sends baked-in review prompt with agent "build" and parses findings from text', async () => {
    const { calls } = setupSdkMock(null);
    const { OpencodeSlashReviewAdapter } = await import('../src/opencode-slash.js');
    const adapter = new OpencodeSlashReviewAdapter();
    const result = await adapter.run();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.opts.agent).toBeUndefined(); // defaults to 'build' inside runPrompt
    expect(calls[0]?.prompt).toMatch(/JSON array/i);
    expect(calls[0]?.prompt).toMatch(/review/i);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.file).toBe('a.ts');
  });

  it('honours structured output when server supports it', async () => {
    const { calls } = setupSdkMock([{ file: 'b.ts', line: 10, severity: 'medium', message: 'msg' }]);
    const { OpencodeSlashReviewAdapter } = await import('../src/opencode-slash.js');
    const adapter = new OpencodeSlashReviewAdapter();
    const result = await adapter.run();
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.file).toBe('b.ts');
    expect(calls[0]?.opts.format).toBeDefined();
  });

  it('honours custom agent, timeoutMs, serverUrl', async () => {
    const { calls } = setupSdkMock(null);
    const { OpencodeSlashReviewAdapter } = await import('../src/opencode-slash.js');
    const adapter = new OpencodeSlashReviewAdapter({
      agent: 'reviewer',
      timeoutMs: 5000,
      serverUrl: 'http://x:4096',
    });
    await adapter.run();
    expect(calls[0]?.opts.agent).toBe('reviewer');
    expect(calls[0]?.opts.timeoutMs).toBe(5000);
    expect(calls[0]?.opts.serverUrl).toBe('http://x:4096');
  });

  it('honours promptPrefix and prompt override', async () => {
    const { calls } = setupSdkMock(null);
    const { OpencodeSlashReviewAdapter } = await import('../src/opencode-slash.js');
    const adapter = new OpencodeSlashReviewAdapter({
      prompt: 'Find bugs only. Output JSON array of {file,line,severity,message}.',
      promptPrefix: 'Focus on auth/',
    });
    await adapter.run();
    const prompt = calls[0]?.prompt ?? '';
    expect(prompt).toContain('Focus on auth/');
    expect(prompt).toContain('Find bugs only');
    expect(prompt).not.toMatch(/JSON array of findings, each:/);
  });
});

describe('OpencodeSlashReviewAdapter — scope', () => {
  it('scope: staged injects `git diff --cached` into the prompt', async () => {
    const { calls } = setupSdkMock(null);
    const { OpencodeSlashReviewAdapter } = await import('../src/opencode-slash.js');
    const adapter = new OpencodeSlashReviewAdapter({ scope: 'staged' });
    await adapter.run();
    expect(calls[0]?.prompt).toContain('git diff --cached');
  });

  it('scope: uncommitted injects `git diff HEAD` into the prompt', async () => {
    const { calls } = setupSdkMock(null);
    const { OpencodeSlashReviewAdapter } = await import('../src/opencode-slash.js');
    const adapter = new OpencodeSlashReviewAdapter({ scope: 'uncommitted' });
    await adapter.run();
    expect(calls[0]?.prompt).toContain('git diff HEAD');
  });

  it('scope: branch injects `git diff main...HEAD` into the prompt', async () => {
    const { calls } = setupSdkMock(null);
    const { OpencodeSlashReviewAdapter } = await import('../src/opencode-slash.js');
    const adapter = new OpencodeSlashReviewAdapter({ scope: 'branch' });
    await adapter.run();
    expect(calls[0]?.prompt).toContain('git diff main...HEAD');
  });

  it('scope: all (or unset) does NOT inject a git diff command', async () => {
    const { calls } = setupSdkMock(null);
    const { OpencodeSlashReviewAdapter } = await import('../src/opencode-slash.js');
    const adapter = new OpencodeSlashReviewAdapter({ scope: 'all' });
    await adapter.run();
    expect(calls[0]?.prompt).not.toMatch(/git diff/);
  });
});
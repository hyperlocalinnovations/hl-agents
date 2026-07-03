import type { Finding, Validator } from '@hl-agents/core';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const summarize = (findings: Finding[]): string =>
  findings
    .map((f) => `${f.file}:${f.line ?? '?'} [${f.severity}] ${f.rule ?? ''}: ${f.message}`)
    .join('\n');

const extractJson = (s: string): { id: string; valid: boolean; reason: string }[] => {
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start === -1 || end === -1) return [];
  return JSON.parse(s.slice(start, end + 1));
};

export class OpencodeVerifyValidator implements Validator {
  constructor(
    private inner: Validator,
    private opts: { cwd?: string; timeoutMs?: number } = {},
  ) {}

  async validate(findings: Finding[]) {
    const base = await this.inner.validate(findings);
    if (base.valid.length === 0) return base;

    const cwd = this.opts.cwd ?? process.cwd();
    const prompt = `Review these findings. For each, decide if it is a REAL issue in the current codebase. Return JSON array of {id,valid,reason}. Mark valid=false for false positives.\n${summarize(base.valid)}`;
    const { stdout } = await execFileAsync('opencode', ['run', prompt], {
      cwd,
      timeout: this.opts.timeoutMs ?? 120_000,
      maxBuffer: 1024 * 1024 * 64,
    });
    const verdicts = new Map(extractJson(stdout).map((v) => [v.id, v]));

    const valid: Finding[] = [];
    const dropped = [...base.dropped];
    for (const f of base.valid) {
      const v = verdicts.get(f.id);
      if (!v || v.valid) valid.push(f);
      else dropped.push({ finding: f, reason: `opencode-verify: ${v.reason}` });
    }
    return { valid, dropped };
  }
}
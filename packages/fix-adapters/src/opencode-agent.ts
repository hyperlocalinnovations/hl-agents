import type { ApplyResult, Finding, FixPlan } from '@hl-agents/core';
import type { FixApplier, FixPlanner } from '@hl-agents/core';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface OpencodeAgentOptions {
  cwd?: string;
  /** Extra prompt prefix injected into the agent invocation. */
  promptPrefix?: string;
  /** Max ms for the opencode subprocess. */
  timeoutMs?: number;
}

const summarizeFindings = (findings: Finding[]): string =>
  findings
    .map((f) => `- ${f.file}:${f.line ?? '?'} [${f.severity}] ${f.rule ?? ''}: ${f.message}`)
    .join('\n');

export class OpencodeAgentPlanner implements FixPlanner {
  constructor(private opts: OpencodeAgentOptions = {}) {}

  async plan(valid: Finding[]): Promise<FixPlan[]> {
    const cwd = this.opts.cwd ?? process.cwd();
    const prompt = `${this.opts.promptPrefix ?? ''}\nPlan code fixes for these review findings. Return JSON array of {findings,description,files}:\n${summarizeFindings(valid)}`.trim();
    const { stdout } = await execFileAsync('opencode', ['run', prompt], {
      cwd,
      timeout: this.opts.timeoutMs ?? 120_000,
      maxBuffer: 1024 * 1024 * 64,
    });
    const json = extractJson(stdout);
    return json as FixPlan[];
  }
}

export class OpencodeAgentApplier implements FixApplier {
  constructor(private opts: OpencodeAgentOptions = {}) {}

  async apply(plan: FixPlan): Promise<ApplyResult> {
    const cwd = this.opts.cwd ?? process.cwd();
    const prompt = `${this.opts.promptPrefix ?? ''}\nApply this fix plan to the codebase. Edit the files in place:\n${plan.description}\nFiles: ${plan.files.join(', ')}\nFindings:\n${summarizeFindings(plan.findings)}`.trim();
    const { stdout } = await execFileAsync('opencode', ['run', prompt], {
      cwd,
      timeout: this.opts.timeoutMs ?? 300_000,
      maxBuffer: 1024 * 1024 * 64,
    });
    return { filesChanged: plan.files };
  }
}

const extractJson = (s: string): unknown => {
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start === -1 || end === -1) return [];
  return JSON.parse(s.slice(start, end + 1));
};
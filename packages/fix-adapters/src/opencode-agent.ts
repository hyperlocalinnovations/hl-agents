import type { ApplyResult, Finding, FixPlan } from '@hl-agents/core';
import type { FixApplier, FixPlanner } from '@hl-agents/core';
import { runPrompt, getSessionDiff, FixPlanSchema } from '@hl-agents/opencode-sdk';

export interface OpencodeAgentOptions {
  cwd?: string;
  /** Extra prompt prefix injected into the agent invocation. */
  promptPrefix?: string;
  /** Max ms before aborting the prompt. */
  timeoutMs?: number;
  /** opencode agent to invoke (default 'build' for apply, 'plan' for plan). */
  agent?: string;
  /** Explicit opencode server URL (skips auto-discovery). */
  serverUrl?: string;
}

const summarizeFindings = (findings: Finding[]): string =>
  findings
    .map((f) => `- ${f.file}:${f.line ?? '?'} [${f.severity}] ${f.rule ?? ''}: ${f.message}`)
    .join('\n');

const parsePlansJson = (text: string): FixPlan[] => {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  let json: unknown;
  try {
    json = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(json)) return [];
  const plans: FixPlan[] = [];
  for (const raw of json) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const description = typeof r.description === 'string' ? r.description : '';
    const files = Array.isArray(r.files) ? r.files.filter((f): f is string => typeof f === 'string') : [];
    const findings: Finding[] = Array.isArray(r.findings)
      ? r.findings.filter((f): f is Finding => typeof f === 'object' && f !== null && typeof (f as Finding).file === 'string')
      : [];
    plans.push({ findings, description, files });
  }
  return plans;
};

export class OpencodeAgentPlanner implements FixPlanner {
  constructor(private opts: OpencodeAgentOptions = {}) {}

  async plan(valid: Finding[]): Promise<FixPlan[]> {
    const prompt = `${this.opts.promptPrefix ?? ''}\nPlan code fixes for these review findings. Return JSON array of {findings,description,files}:\n${summarizeFindings(valid)}`.trim();
    const { text, structured } = await runPrompt(prompt, {
      agent: this.opts.agent ?? 'plan',
      directory: this.opts.cwd,
      timeoutMs: this.opts.timeoutMs ?? 300_000,
      serverUrl: this.opts.serverUrl,
      format: { type: 'json_schema', schema: FixPlanSchema as object },
    });
    if (Array.isArray(structured)) return structured as FixPlan[];
    return parsePlansJson(text);
  }
}

export class OpencodeAgentApplier implements FixApplier {
  constructor(private opts: OpencodeAgentOptions = {}) {}

  async apply(plan: FixPlan): Promise<ApplyResult> {
    const prompt = `${this.opts.promptPrefix ?? ''}\nApply this fix plan to the codebase. Edit the files in place:\n${plan.description}\nFiles: ${plan.files.join(', ')}\nFindings:\n${summarizeFindings(plan.findings)}`.trim();
    const { sessionId } = await runPrompt(prompt, {
      agent: this.opts.agent ?? 'build',
      directory: this.opts.cwd,
      timeoutMs: this.opts.timeoutMs ?? 600_000,
      serverUrl: this.opts.serverUrl,
    });
    const diff = await getSessionDiff(sessionId);
    return { filesChanged: diff.map((d: { file: string }) => d.file) };
  }
}
import type { Finding, Validator } from '@hl-agents/core';
import { runPrompt, VerdictSchema } from '@hl-agents/opencode-sdk';

export interface OpencodeVerifyOptions {
  cwd?: string;
  timeoutMs?: number;
  /** opencode agent to invoke (default 'build'). */
  agent?: string;
  /** Explicit opencode server URL (skips auto-discovery). */
  serverUrl?: string;
}

const summarize = (findings: Finding[]): string =>
  findings
    .map((f) => `${f.file}:${f.line ?? '?'} [${f.severity}] ${f.rule ?? ''}: ${f.message}`)
    .join('\n');

const parseVerdicts = (text: string): { id: string; valid: boolean; reason: string }[] => {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const json = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(json)) return [];
    return json.filter(
      (v): v is { id: string; valid: boolean; reason: string } =>
        typeof v === 'object' && v !== null && typeof (v as { id?: unknown }).id === 'string',
    );
  } catch {
    return [];
  }
};

export class OpencodeVerifyValidator implements Validator {
  constructor(
    private inner: Validator,
    private opts: OpencodeVerifyOptions = {},
  ) {}

  async validate(findings: Finding[]) {
    const base = await this.inner.validate(findings);
    if (base.valid.length === 0) return base;

    const prompt = `Review these findings. For each, decide if it is a REAL issue in the current codebase. Return JSON array of {id,valid,reason}. Mark valid=false for false positives.\n${summarize(base.valid)}`;
    const { text, structured } = await runPrompt(prompt, {
      agent: this.opts.agent ?? 'build',
      directory: this.opts.cwd,
      timeoutMs: this.opts.timeoutMs ?? 300_000,
      serverUrl: this.opts.serverUrl,
      format: { type: 'json_schema', schema: VerdictSchema as object },
    });

    const verdicts = new Map(
      (Array.isArray(structured) ? (structured as { id: string; valid: boolean; reason: string }[]) : parseVerdicts(text)).map((v) => [v.id, v]),
    );

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
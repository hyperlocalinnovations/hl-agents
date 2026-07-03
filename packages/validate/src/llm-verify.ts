import type { Finding, ValidationOutcome } from '@hl-agents/core';
import type { Validator } from '@hl-agents/core';

export interface LlmVerifyOptions {
  verifier: {
    verify(findings: Finding[]): Promise<{ id: string; valid: boolean; reason: string }[]>;
  };
  inner?: Validator;
}

export class LlmVerifyValidator implements Validator {
  constructor(private opts: LlmVerifyOptions) {}

  async validate(findings: Finding[]): Promise<ValidationOutcome> {
    const input = this.opts.inner ? await this.opts.inner.validate(findings) : { valid: findings, dropped: [] };
    if (input.valid.length === 0) return input;

    const verdicts = await this.opts.verifier.verify(input.valid);
    const vmap = new Map(verdicts.map((v) => [v.id, v]));

    const valid: Finding[] = [];
    const dropped = [...input.dropped];
    for (const f of input.valid) {
      const v = vmap.get(f.id);
      if (!v || v.valid) valid.push(f);
      else dropped.push({ finding: f, reason: `llm: ${v.reason}` });
    }
    return { valid, dropped };
  }
}
import type { Finding, Severity, ValidationOutcome } from '@hl-agents/core';
import type { Validator } from '@hl-agents/core';

export interface RulesOptions {
  minSeverity?: Severity;
  ignore?: string[];
  allowRules?: string[];
  denyRules?: string[];
}

const order: Severity[] = ['info', 'low', 'medium', 'high', 'critical'];

const severityRank = (s: Severity): number => order.indexOf(s);

const matchGlob = (pattern: string, path: string): boolean => {
  const esc = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const tokens = esc.split(/(\*\*\/|\*\*|\*|\?)/).filter((t) => t !== '');
  const re = tokens
    .map((t) => {
      switch (t) {
        case '**/': return '(?:.*/)?';
        case '**': return '.*';
        case '*': return '[^/]*';
        case '?': return '[^/]';
        default: return t;
      }
    })
    .join('');
  return new RegExp(`^${re}$`).test(path);
};

const isIgnored = (file: string, patterns: string[]): boolean =>
  patterns.some((p) => matchGlob(p, file));

export class RulesValidator implements Validator {
  constructor(private opts: RulesOptions = {}) {}

  async validate(findings: Finding[]): Promise<ValidationOutcome> {
    const min = this.opts.minSeverity ? severityRank(this.opts.minSeverity) : -1;
    const valid: Finding[] = [];
    const dropped: { finding: Finding; reason: string }[] = [];
    const seen = new Set<string>();

    for (const f of findings) {
      const key = `${f.file}:${f.line ?? 0}:${f.rule ?? f.message}`;
      if (seen.has(key)) {
        dropped.push({ finding: f, reason: 'duplicate' });
        continue;
      }
      seen.add(key);

      if (this.opts.ignore && isIgnored(f.file, this.opts.ignore)) {
        dropped.push({ finding: f, reason: `ignored path ${f.file}` });
        continue;
      }
      if (severityRank(f.severity) < min) {
        dropped.push({ finding: f, reason: `severity ${f.severity} < min ${this.opts.minSeverity}` });
        continue;
      }
      if (this.opts.allowRules && f.rule && !this.opts.allowRules.includes(f.rule)) {
        dropped.push({ finding: f, reason: `rule ${f.rule} not in allowlist` });
        continue;
      }
      if (this.opts.denyRules && f.rule && this.opts.denyRules.includes(f.rule)) {
        dropped.push({ finding: f, reason: `rule ${f.rule} in denylist` });
        continue;
      }
      valid.push(f);
    }
    return { valid, dropped };
  }
}
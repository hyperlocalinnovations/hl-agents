import { describe, it, expect } from 'vitest';
import { RulesValidator } from '../src/rules.js';
import { LlmVerifyValidator } from '../src/llm-verify.js';
import type { Finding } from '@hl-agents/core';

const mk = (file: string, severity: Finding['severity'] = 'medium', rule = 'r1', line = 1): Finding => ({
  id: `${file}:${line}:${rule}`,
  file,
  line,
  severity,
  rule,
  message: 'm',
});

describe('RulesValidator', () => {
  it('filters by minSeverity', async () => {
    const v = new RulesValidator({ minSeverity: 'high' });
    const out = await v.validate([mk('a.ts', 'low'), mk('b.ts', 'high')]);
    expect(out.valid).toHaveLength(1);
    expect(out.valid[0]?.file).toBe('b.ts');
    expect(out.dropped).toHaveLength(1);
  });

  it('filters by ignore globs', async () => {
    const v = new RulesValidator({ ignore: ['**/*.md'] });
    const out = await v.validate([mk('README.md'), mk('a.ts')]);
    expect(out.valid).toHaveLength(1);
    expect(out.valid[0]?.file).toBe('a.ts');
  });

  it('dedupes identical findings', async () => {
    const v = new RulesValidator();
    const out = await v.validate([mk('a.ts'), mk('a.ts')]);
    expect(out.valid).toHaveLength(1);
    expect(out.dropped).toHaveLength(1);
    expect(out.dropped[0]?.reason).toBe('duplicate');
  });

  it('respects allow/deny rules', async () => {
    const v = new RulesValidator({ allowRules: ['good'], denyRules: ['bad'] });
    const out = await v.validate([mk('a.ts', 'medium', 'bad'), mk('b.ts', 'medium', 'good'), mk('c.ts', 'medium', 'other')]);
    expect(out.valid.map((f) => f.file)).toEqual(['b.ts']);
  });
});

describe('LlmVerifyValidator', () => {
  it('composes with inner rules validator', async () => {
    const inner = new RulesValidator({ minSeverity: 'medium' });
    const v = new LlmVerifyValidator({
      inner,
      verifier: {
        async verify(findings) {
          return findings.map((f, i) => ({ id: f.id, valid: i % 2 === 0, reason: i % 2 === 0 ? '' : 'false positive' }));
        },
      },
    });
    const out = await v.validate([mk('a.ts', 'high'), mk('b.ts', 'high'), mk('c.ts', 'low')]);
    expect(out.valid).toHaveLength(1);
    expect(out.valid[0]?.file).toBe('a.ts');
    expect(out.dropped.find((d) => d.reason.startsWith('llm'))).toBeTruthy();
  });
});
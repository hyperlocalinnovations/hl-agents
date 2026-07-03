import { describe, it, expect } from 'vitest';
import { parseEslint } from '../src/eslint.js';

describe('parseEslint', () => {
  it('parses eslint json output into findings', () => {
    const json = JSON.stringify([
      {
        filePath: '/repo/a.ts',
        messages: [
          { ruleId: 'no-unused-vars', message: 'unused', severity: 2, line: 5, endLine: 5 },
          { ruleId: null, message: 'parse error', severity: 1, line: 10 },
        ],
      },
    ]);
    const findings = parseEslint(json);
    expect(findings).toHaveLength(2);
    expect(findings[0]?.file).toBe('/repo/a.ts');
    expect(findings[0]?.rule).toBe('no-unused-vars');
    expect(findings[0]?.severity).toBe('high');
    expect(findings[1]?.severity).toBe('medium');
  });

  it('returns empty on non-json input', () => {
    expect(parseEslint('not json')).toEqual([]);
  });
});
import { describe, expect, it } from 'vitest';
import { fingerprint, parseFindings, parseScope, stopReason } from '../src/loop.js';

describe('review loop helpers', () => {
  it('parses scopes and valid JSON findings', () => {
    expect(parseScope('branch develop')).toEqual({ kind: 'branch', base: 'develop' });
    expect(parseScope('staged')).toEqual({ kind: 'staged' });
    expect(parseScope('wat')).toBeUndefined();

    const findings = parseFindings('```json\n[{"file":"a.ts","line":2,"severity":"high","rule":"r","message":"broken"}]\n```');
    expect(findings).toHaveLength(1);
    expect(fingerprint(findings![0]!)).toBe('a.ts:2:r');
  });

  it('stops for clean, malformed, and repeated findings', () => {
    expect(stopReason([], new Map(), 1, 5)).toBe('clean');
    expect(stopReason(undefined, new Map(), 1, 5)).toBe('malformed-review');
    const finding = parseFindings('[{"file":"a.ts","severity":"high","rule":"r","message":"broken"}]')![0]!;
    expect(stopReason([finding], new Map([[fingerprint(finding), 3]]), 2, 5)).toBe('stuck');
  });
});

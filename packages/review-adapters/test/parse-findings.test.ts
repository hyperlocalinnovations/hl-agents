import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseFindingsJson } from '../src/parse-findings.js';

describe('parseFindingsJson', () => {
  it('parses a JSON findings array with surrounding prose', () => {
    const out = `Here is my review:\n[\n  {"file":"a.ts","line":5,"severity":"high","rule":"no-unused-vars","message":"unused x"}\n]\nDone.`;
    const f = parseFindingsJson(out);
    expect(f).toHaveLength(1);
    expect(f[0]?.file).toBe('a.ts');
    expect(f[0]?.line).toBe(5);
    expect(f[0]?.severity).toBe('high');
    expect(f[0]?.rule).toBe('no-unused-vars');
  });

  it('normalizes numeric severity to words', () => {
    const f = parseFindingsJson('[{"file":"a.ts","severity":2,"message":"x"},{"file":"b.ts","severity":1,"message":"y"}]');
    expect(f[0]?.severity).toBe('high');
    expect(f[1]?.severity).toBe('medium');
  });

  it('defaults unknown severity to medium', () => {
    const f = parseFindingsJson('[{"file":"a.ts","message":"x"}]');
    expect(f[0]?.severity).toBe('medium');
  });

  it('synthesizes an id when missing', () => {
    const f = parseFindingsJson('[{"file":"a.ts","line":7,"rule":"r1","message":"msg"}]');
    expect(f[0]?.id).toBe('a.ts:7:r1');
  });

  it('returns [] when no JSON array is present', () => {
    expect(parseFindingsJson('no json here')).toEqual([]);
    expect(parseFindingsJson('not even [brackets]')).toEqual([]);
  });

  it('skips entries without a file field', () => {
    const f = parseFindingsJson('[{"file":"a.ts","message":"x"},{"line":1,"message":"no file"}]');
    expect(f).toHaveLength(1);
  });
});
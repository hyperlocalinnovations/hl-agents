import type { Finding, Severity } from '@hl-agents/core';

/**
 * Extract a JSON array of finding-shaped objects from arbitrary text output
 * (e.g. an LLM review report). Picks the first `[` ... last `]` slice and
 * normalizes fields. Tolerates extra prose around the JSON.
 */
export const parseFindingsJson = (stdout: string): Finding[] => {
  const start = stdout.indexOf('[');
  const end = stdout.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  let json: unknown;
  try {
    json = JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(json)) return [];
  const findings: Finding[] = [];
  for (const raw of json) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const file = typeof r.file === 'string' ? r.file : undefined;
    if (!file) continue;
    const line = typeof r.line === 'number' ? r.line : undefined;
    const message = typeof r.message === 'string' ? r.message : String(r.message ?? '');
    const rule = typeof r.rule === 'string' ? r.rule : undefined;
    const severity = normalizeSeverity(r.severity);
    findings.push({
      id: typeof r.id === 'string' ? r.id : `${file}:${line ?? 0}:${rule ?? message.slice(0, 20)}`,
      file,
      line,
      endLine: typeof r.endLine === 'number' ? r.endLine : undefined,
      severity,
      rule,
      message,
      raw: r,
    });
  }
  return findings;
};

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const normalizeSeverity = (v: unknown): Severity => {
  if (typeof v === 'string' && SEVERITIES.includes(v.toLowerCase() as Severity)) {
    return v.toLowerCase() as Severity;
  }
  if (typeof v === 'number') {
    if (v >= 3) return 'critical';
    if (v === 2) return 'high';
    if (v === 1) return 'medium';
    return 'low';
  }
  return 'medium';
};
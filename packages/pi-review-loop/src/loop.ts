export type ReviewScope =
  | { kind: 'branch'; base: string }
  | { kind: 'staged' }
  | { kind: 'uncommitted' }
  | { kind: 'all' };

export interface Finding {
  file: string;
  line?: number;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  rule?: string;
  message: string;
}

export type StopReason = 'clean' | 'malformed-review' | 'stuck' | 'max-iterations';

const severities = new Set<Finding['severity']>(['critical', 'high', 'medium', 'low', 'info']);

export function parseScope(args: string): ReviewScope | undefined {
  const [scope = 'branch', base, ...extra] = args.trim().split(/\s+/).filter(Boolean);
  if (extra.length > 0) return undefined;
  if (scope === 'branch') return { kind: 'branch', base: base ?? 'main' };
  if (base) return undefined;
  if (scope === 'staged' || scope === 'uncommitted' || scope === 'all') return { kind: scope };
  return undefined;
}

export function parseFindings(text: string): Finding[] | undefined {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1] ?? text;
  const start = fenced.indexOf('[');
  const end = fenced.lastIndexOf(']');
  if (start < 0 || end < start) return undefined;

  try {
    const parsed: unknown = JSON.parse(fenced.slice(start, end + 1));
    if (!Array.isArray(parsed)) return undefined;
    const findings: Finding[] = [];
    for (const value of parsed) {
      if (!value || typeof value !== 'object') continue;
      const item = value as Record<string, unknown>;
      if (typeof item.file !== 'string' || typeof item.message !== 'string') continue;
      findings.push({
        file: item.file,
        ...(typeof item.line === 'number' ? { line: item.line } : {}),
        severity: typeof item.severity === 'string' && severities.has(item.severity as Finding['severity'])
          ? item.severity as Finding['severity']
          : 'medium',
        ...(typeof item.rule === 'string' ? { rule: item.rule } : {}),
        message: item.message,
      });
    }
    return findings;
  } catch {
    return undefined;
  }
}

export const fingerprint = (finding: Finding): string =>
  `${finding.file}:${finding.line ?? 0}:${finding.rule ?? finding.message}`;

export function stopReason(
  findings: Finding[] | undefined,
  attempts: Map<string, number>,
  iteration: number,
  maxIterations: number,
): StopReason | undefined {
  if (!findings) return 'malformed-review';
  if (findings.length === 0) return 'clean';
  if (findings.every((finding) => (attempts.get(fingerprint(finding)) ?? 0) >= 3)) return 'stuck';
  if (iteration >= maxIterations) return 'max-iterations';
  return undefined;
}

export function scopeInstruction(scope: ReviewScope): string {
  switch (scope.kind) {
    case 'branch': return `Review only changes from \`git diff ${scope.base}...HEAD\`.`;
    case 'staged': return 'Review only staged changes from `git diff --cached`.';
    case 'uncommitted': return 'Review only uncommitted changes from `git diff HEAD`, plus untracked files.';
    case 'all': return 'Review the whole codebase.';
  }
}

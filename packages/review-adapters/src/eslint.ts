import type { Finding, Severity } from '@hl-agents/core';

interface EslintMessage {
  ruleId: string | null;
  message: string;
  severity: number;
  line: number;
  endLine?: number;
}

interface EslintResult {
  filePath: string;
  messages: EslintMessage[];
}

const sev = (n: number): Severity => (n === 2 ? 'high' : 'medium');

export const parseEslint = (stdout: string): Finding[] => {
  let json: EslintResult[];
  try {
    json = JSON.parse(stdout);
  } catch {
    return [];
  }
  const findings: Finding[] = [];
  for (const r of json) {
    for (const m of r.messages) {
      findings.push({
        id: `${r.filePath}:${m.line}:${m.ruleId ?? 'eslint'}`,
        file: r.filePath,
        line: m.line,
        endLine: m.endLine,
        severity: sev(m.severity),
        rule: m.ruleId ?? 'eslint',
        message: m.message,
        raw: m,
      });
    }
  }
  return findings;
};
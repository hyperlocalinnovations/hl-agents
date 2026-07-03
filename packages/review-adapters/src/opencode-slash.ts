import type { Finding } from '@hl-agents/core';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface OpencodeSlashOptions {
  command?: string;
  cwd?: string;
  parser?: (output: string) => Finding[];
}

const defaultParser = (output: string): Finding[] => {
  const findings: Finding[] = [];
  const lines = output.split('\n');
  for (const line of lines) {
    const m = line.match(/^([^\s:]+):(\d+)(?::(\d+))?\s*\[(\w+)]\s*(.+)$/);
    if (m && m[1] && m[2] && m[4] && m[5]) {
      const file = m[1];
      const l1 = m[2];
      const l2 = m[3];
      const severity = m[4];
      const message = m[5];
      findings.push({
        id: `${file}:${l1}:${message.slice(0, 20)}`,
        file,
        line: Number(l1),
        endLine: l2 ? Number(l2) : undefined,
        severity: (severity.toLowerCase() as Finding['severity']) ?? 'medium',
        message,
      });
    }
  }
  return findings;
};

export class OpencodeSlashReviewAdapter {
  command: string;
  cwd?: string;
  parser: (output: string) => Finding[];

  constructor(opts: OpencodeSlashOptions = {}) {
    this.command = opts.command ?? '/review';
    this.cwd = opts.cwd;
    this.parser = opts.parser ?? defaultParser;
  }

  async run(): Promise<{ findings: Finding[]; rawOutput: string }> {
    const cwd = this.cwd ?? process.cwd();
    const { stdout } = await execFileAsync('opencode', ['run', this.command], { cwd, maxBuffer: 1024 * 1024 * 64 });
    return { findings: this.parser(stdout), rawOutput: stdout };
  }
}
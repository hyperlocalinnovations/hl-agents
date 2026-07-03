import type { Finding, ReviewResult } from '@hl-agents/core';
import type { ReviewAdapter } from '@hl-agents/core';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CommandReviewOptions {
  command: string;
  args?: string[];
  cwd?: string;
  parser: (stdout: string, stderr: string) => Finding[];
  /** Treat non-zero exit as failure (default false — many reviewers exit 1 when findings exist). */
  failOnNonZero?: boolean;
}

export class CommandReviewAdapter implements ReviewAdapter {
  constructor(private opts: CommandReviewOptions) {}

  async run(): Promise<ReviewResult> {
    const cwd = this.opts.cwd ?? process.cwd();
    try {
      const { stdout, stderr } = await execFileAsync(this.opts.command, this.opts.args ?? [], {
        cwd,
        maxBuffer: 1024 * 1024 * 64,
      });
      const findings = this.opts.parser(stdout, stderr);
      return { findings, rawOutput: stdout };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; code?: number; message: string };
      if (e.stdout !== undefined && !this.opts.failOnNonZero) {
        const findings = this.opts.parser(e.stdout ?? '', e.stderr ?? '');
        return { findings, rawOutput: e.stdout ?? '' };
      }
      throw err;
    }
  }
}
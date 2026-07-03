import type { CommitResult, FixPlan } from '@hl-agents/core';
import type { Committer } from '@hl-agents/core';
import { execFileSync } from 'node:child_process';

export interface GitCommitterOptions {
  messageTemplate?: string;
  addAll?: boolean;
  authorName?: string;
  authorEmail?: string;
  cwd?: string;
}

const renderMessage = (tpl: string, plans: FixPlan[]): string => {
  const rules = [...new Set(plans.flatMap((p) => p.findings.map((f) => f.rule ?? 'review')))];
  const msgs = plans.map((p) => p.description).join('; ');
  return tpl
    .replace('{rule}', rules[0] ?? 'review')
    .replace('{rules}', rules.join(','))
    .replace('{message}', msgs)
    .replace('{count}', String(plans.length));
};

export class GitCommitter implements Committer {
  constructor(private opts: GitCommitterOptions = {}) {}

  async commit(plans: FixPlan[], filesChanged: string[]): Promise<CommitResult> {
    const cwd = this.opts.cwd ?? process.cwd();
    const tpl = this.opts.messageTemplate ?? 'fix({rule}): {message}';
    const message = renderMessage(tpl, plans);

    if (this.opts.addAll) {
      execFileSync('git', ['add', '-A'], { cwd });
    } else if (filesChanged.length > 0) {
      execFileSync('git', ['add', ...filesChanged], { cwd });
    }

    const args = ['commit', '-m', message];
    if (this.opts.authorName && this.opts.authorEmail) {
      args.push(`--author=${this.opts.authorName} <${this.opts.authorEmail}>`);
    }
    execFileSync('git', args, { cwd });
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd }).toString().trim();
    return { sha, message };
  }
}

export class NoopCommitter implements Committer {
  async commit(_plans: FixPlan[], _filesChanged: string[]): Promise<CommitResult> {
    return { sha: 'noop', message: 'noop (dry-run)' };
  }
}
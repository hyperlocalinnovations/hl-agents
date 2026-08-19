import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type Finding,
  type ReviewScope,
  fingerprint,
  parseFindings,
  parseScope,
  scopeInstruction,
  stopReason,
} from './loop.js';

const MAX_ITERATIONS = 5;

type SessionEntry = {
  id: string;
  type: string;
  message?: {
    role: string;
    content: Array<{ type: string; text?: string }>;
  };
};

interface CommandContext {
  cwd: string;
  ui: { notify(message: string, level: 'info' | 'warning' | 'error'): void };
  sessionManager: {
    getBranch(): SessionEntry[];
    getEntries(): SessionEntry[];
    getLeafId(): string | undefined;
  };
  navigateTree(id: string, options: { summarize: boolean; label?: string }): Promise<unknown>;
  waitForIdle(): Promise<void>;
}

interface PiAPI {
  exec(command: string, args: string[]): Promise<{ code: number; stdout: string }>;
  getActiveTools(): string[];
  setActiveTools(tools: string[]): void;
  sendUserMessage(content: string): void;
  appendEntry(type: string, data: unknown): void;
  registerCommand(name: string, command: {
    description: string;
    handler(args: string, ctx: CommandContext): Promise<void>;
  }): void;
}

const reviewPrompt = (scope: ReviewScope, guidelines: string): string => `
Act only as a read-only code reviewer. Do not edit files.
${scopeInstruction(scope)}
Run relevant project checks when available. Find only real, actionable defects introduced by the reviewed changes.

Return a JSON array only. Each item must be {"file":"path","line":number,"severity":"critical|high|medium|low|info","rule":"short-rule","message":"one-line explanation"}. Return [] when clean.
${guidelines ? `\nProject review guidelines:\n${guidelines}` : ''}
`.trim();

const fixPrompt = (findings: Finding[]): string => `
Fix these validated review findings. Make the smallest correct changes, then run relevant checks. Do not commit.

${JSON.stringify(findings, null, 2)}
`.trim();

const latestAssistantText = (ctx: CommandContext): string => {
  const branch = ctx.sessionManager.getBranch();
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry?.type !== 'message' || entry.message?.role !== 'assistant') continue;
    return entry.message.content
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n');
  }
  return '';
};

async function loadGuidelines(pi: PiAPI, cwd: string): Promise<string> {
  const root = await pi.exec('git', ['rev-parse', '--show-toplevel']);
  if (root.code !== 0 || !root.stdout.trim()) return '';
  return (await readFile(join(root.stdout.trim(), 'REVIEW_GUIDELINES.md'), 'utf8').catch(() => '')).trim();
}

async function reviewInBranch(
  pi: PiAPI,
  ctx: CommandContext,
  prompt: string,
): Promise<string> {
  const origin = ctx.sessionManager.getLeafId();
  const firstUser = ctx.sessionManager.getEntries().find(
    (entry) => entry.type === 'message' && entry.message?.role === 'user',
  );

  if (origin && firstUser) await ctx.navigateTree(firstUser.id, { summarize: false, label: 'review-loop' });
  const activeTools = pi.getActiveTools();
  pi.setActiveTools(activeTools.filter((tool) => tool !== 'edit' && tool !== 'write'));
  try {
    pi.sendUserMessage(prompt);
    await ctx.waitForIdle();
    return latestAssistantText(ctx);
  } finally {
    pi.setActiveTools(activeTools);
    if (origin && firstUser) await ctx.navigateTree(origin, { summarize: false });
  }
}

export default function reviewLoopExtension(pi: PiAPI) {
  pi.registerCommand('review-loop', {
    description: 'Review, fix, and re-review changes (branch [base] | staged | uncommitted | all)',
    handler: async (args, ctx) => {
      const scope = parseScope(args);
      if (!scope) {
        ctx.ui.notify('Usage: /review-loop [branch [base]|staged|uncommitted|all]', 'error');
        return;
      }

      const git = await pi.exec('git', ['rev-parse', '--git-dir']);
      if (git.code !== 0) {
        ctx.ui.notify('Not a git repository', 'error');
        return;
      }

      const guidelines = await loadGuidelines(pi, ctx.cwd);
      const attempts = new Map<string, number>();
      let findingsSeen = 0;

      for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
        ctx.ui.notify(`Review iteration ${iteration}/${MAX_ITERATIONS}`, 'info');
        const findings = parseFindings(await reviewInBranch(pi, ctx, reviewPrompt(scope, guidelines)));
        if (!findings) {
          pi.appendEntry('review-loop-result', { iteration, findingsSeen, reason: 'malformed-review' });
          ctx.ui.notify(`Review loop malformed-review after ${iteration} pass(es)`, 'warning');
          return;
        }

        findingsSeen += findings.length;
        for (const finding of findings) {
          const key = fingerprint(finding);
          attempts.set(key, (attempts.get(key) ?? 0) + 1);
        }
        const reason = stopReason(findings, attempts, iteration, MAX_ITERATIONS);
        if (reason) {
          pi.appendEntry('review-loop-result', { iteration, findingsSeen, reason });
          ctx.ui.notify(`Review loop ${reason}: ${iteration} pass(es), ${findingsSeen} finding(s)`, reason === 'clean' ? 'info' : 'warning');
          return;
        }

        pi.sendUserMessage(fixPrompt(findings));
        await ctx.waitForIdle();
      }
    },
  });
}

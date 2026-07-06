import type { Finding, ReviewResult } from '@hl-agents/core';
import type { ReviewAdapter } from '@hl-agents/core';
import { runPrompt, FindingSchema } from '@hl-agents/opencode-sdk';
import { parseFindingsJson } from './parse-findings.js';

export type ReviewScope = 'staged' | 'uncommitted' | 'branch' | 'all';

export interface OpencodeSlashOptions {
  /** Slash command name to invoke via session.command(). When unset, a baked-in review prompt is sent directly. */
  command?: string;
  cwd?: string;
  /** Max ms before aborting the prompt. */
  timeoutMs?: number;
  /** opencode agent to invoke (default 'build'). */
  agent?: string;
  /** Extra prompt prefix prepended to the baked-in review prompt (direct-prompt mode only). */
  promptPrefix?: string;
  /** Fully override the baked-in review prompt (direct-prompt mode only). */
  prompt?: string;
  /** Scope the review to a slice of changes (direct-prompt mode only). Default 'all'. */
  scope?: ReviewScope;
  /** Override the default JSON findings parser. */
  parser?: (stdout: string) => Finding[];
  /** Explicit opencode server URL (skips auto-discovery). */
  serverUrl?: string;
}

const stripSlash = (cmd: string): string => cmd.replace(/^\/+/, '');

const SCOPE_CLAUSES: Record<Exclude<ReviewScope, 'all'>, string> = {
  staged: 'Scope your review to the staged changes only. Run: `git diff --cached`. Review only the files and lines in that diff.',
  uncommitted: 'Scope your review to uncommitted changes (staged + unstaged). Run: `git diff HEAD`. Review only the files and lines in that diff.',
  branch: 'Scope your review to changes on this branch vs main. Run: `git diff main...HEAD`. Review only the files and lines in that diff.',
};

const BAKED_REVIEW_PROMPT = `Review the current codebase for real issues — bugs, type errors, security problems, dead code, missing tests, lint violations.
Run the project's linters and typecheckers where available (e.g. \`npm run lint\`, \`npm run typecheck\`, \`flutter analyze\`).
Output a JSON array of findings, each: {"id?":"<file>:<line>:<rule>","file":"<path>","line":<number>,"endLine":<number>,"severity":"critical|high|medium|low|info","rule":"<rule id>","message":"<one-line description>"}.
Only include REAL issues you can point to in the code. No speculative nitpicks. If none, output [].
Output ONLY the JSON array (a code fence is fine). No prose around it.`;

const buildReviewPrompt = (scope: ReviewScope | undefined, promptPrefix?: string, promptOverride?: string): string => {
  const body = promptOverride ?? BAKED_REVIEW_PROMPT;
  const clause = scope && scope !== 'all' ? SCOPE_CLAUSES[scope] : '';
  return [promptPrefix, clause, body].filter(Boolean).join('\n').trim();
};

/**
 * Review adapter that talks to the opencode server via the SDK (no subprocess).
 *
 * 1. Direct-prompt (default, zero-config): sends a baked-in review prompt to
 *    a fresh session with the configured agent and parses a JSON findings
 *    array from the response. Optionally scoped to staged/uncommitted/branch.
 *    Requests structured output via json_schema when supported; falls back to
 *    text parsing via parseFindingsJson.
 *
 * 2. Slash-command (opt-in): when `command` is set, invokes the named slash
 *    command via session.command(). The command must emit a JSON findings
 *    array in its text response.
 */
export class OpencodeSlashReviewAdapter implements ReviewAdapter {
  constructor(private opts: OpencodeSlashOptions = {}) {}

  async run(): Promise<ReviewResult> {
    const prompt = buildReviewPrompt(this.opts.scope, this.opts.promptPrefix, this.opts.prompt);
    const { text, structured } = await runPrompt(prompt, {
      agent: this.opts.agent,
      directory: this.opts.cwd,
      timeoutMs: this.opts.timeoutMs,
      serverUrl: this.opts.serverUrl,
      format: { type: 'json_schema', schema: FindingSchema as object },
    });

    // Prefer structured output if the server honored the schema.
    if (Array.isArray(structured)) {
      const parser = this.opts.parser ?? parseFindingsJson;
      const textFallback = JSON.stringify(structured);
      return { findings: parser(textFallback), rawOutput: text };
    }

    const parser = this.opts.parser ?? parseFindingsJson;
    return { findings: parser(text), rawOutput: text };
  }
}
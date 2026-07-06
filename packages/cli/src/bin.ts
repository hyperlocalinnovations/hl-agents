#!/usr/bin/env node
// Re-exec with --experimental-strip-types when a .ts config is used, so that
// the dynamic import() in loadConfig can load TypeScript directly. Node 22+
// supports type stripping natively; the flag must be present before import().
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const VERSION = '0.0.0';

const HELP = `hl-agents — autonomous review-fix loop

Usage:
  hl-agents [options]

Runs a review command, parses findings, validates them, plans and applies
fixes, commits, and repeats until the review is clean — or a cap is hit.

Options:
  -c, --config <path>      Path to config file (hl-agents.config.ts/js/json
                           or .hl-agents.json). Auto-discovered at repo root.
      --dry-run            Plan fixes only; no apply, no commit.
  -m, --max-iterations <n> Cap the loop at N iterations (default: 10).
      --scope <scope>      Review scope: staged | uncommitted | branch | all
                           (default: branch, or per config). Overrides config.
      --version            Print version and exit.
  -h, --help               Show this help and exit.

Scopes:
  staged       Review staged changes only (git diff --cached)
  uncommitted  Review staged + unstaged changes (git diff HEAD)
  branch       Review changes on this branch vs main (git diff main...HEAD)
  all          Review the whole codebase

Config:
  See config/hl-agents.config.example.ts for the full shape. With no config
  file, a zero-config default runs: baked-in review prompt (scope: branch)
  via 'opencode run --auto --agent build', plan via 'opencode run --auto
  --agent plan', apply via 'opencode run --auto --agent build', git commit
  per iteration, max 10 iterations.

Exit codes:
  0  final review pass is clean
  1  findings remain (max iterations hit, stuck, or noisy reviewer)

More: https://github.com/anomalyco/hl-agents
`;

const { values } = parseArgs({
  options: {
    config: { type: 'string', short: 'c' },
    'dry-run': { type: 'boolean', default: false },
    'max-iterations': { type: 'string', short: 'm' },
    scope: { type: 'string' },
    version: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}
if (values.version) {
  console.log(VERSION);
  process.exit(0);
}

const SCOPES = ['staged', 'uncommitted', 'branch', 'all'] as const;
if (values.scope && !SCOPES.includes(values.scope as (typeof SCOPES)[number])) {
  console.error(`Invalid --scope: ${values.scope}. Must be one of: ${SCOPES.join(', ')}`);
  process.exit(2);
}

const configPath = values.config
  ? resolve(values.config)
  : ['hl-agents.config.ts', 'hl-agents.config.js', 'hl-agents.config.json', '.hl-agents.json'].find(
      (c) => existsSync(resolve(c)),
    );

const needsTsLoader =
  configPath?.endsWith('.ts') && !process.execArgv.includes('--experimental-strip-types');

if (needsTsLoader) {
  const args = ['--experimental-strip-types', process.argv[1] as string, ...process.argv.slice(2)];
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env });
  child.on('exit', (code: number | null) => process.exit(code ?? 1));
} else {
  (async () => {
    const { loadConfig } = await import('./loader.js');
    const { runFromConfig } = await import('./runner.js');
    const cfg = await loadConfig(values.config);
    if (values['dry-run']) cfg.loop.dryRun = true;
    if (values['max-iterations']) cfg.loop.maxIterations = Number(values['max-iterations']);
    if (values.scope) cfg.review.scope = values.scope as (typeof SCOPES)[number];
    const result = await runFromConfig(cfg);
    console.log(JSON.stringify(result.summary, null, 2));
    process.exit(result.cleanPass ? 0 : 1);
  })();
}
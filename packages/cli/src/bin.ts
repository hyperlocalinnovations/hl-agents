#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { loadConfig } from './loader.js';
import { runFromConfig } from './runner.js';

const { values } = parseArgs({
  options: {
    config: { type: 'string', short: 'c' },
    'dry-run': { type: 'boolean', default: false },
    'max-iterations': { type: 'string', short: 'm' },
  },
  allowPositionals: false,
});

const cfg = await loadConfig(values.config);
if (values['dry-run']) cfg.loop.dryRun = true;
if (values['max-iterations']) cfg.loop.maxIterations = Number(values['max-iterations']);

const result = await runFromConfig(cfg);
console.log(JSON.stringify(result.summary, null, 2));
process.exit(result.cleanPass ? 0 : 1);
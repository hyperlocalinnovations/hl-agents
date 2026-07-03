import type { ApplyResult, Finding, FixPlan } from '@hl-agents/core';
import type { FixApplier, FixPlanner } from '@hl-agents/core';
import { spawn } from 'node:child_process';
import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ScriptAdapterOptions {
  command: string;
  args?: string[];
  cwd?: string;
}

const runWithPayload = async (opts: ScriptAdapterOptions, payload: unknown): Promise<string> => {
  const cwd = opts.cwd ?? process.cwd();
  const file = join(tmpdir(), `hl-agents-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  await writeFile(file, JSON.stringify(payload));
  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(opts.command, [...(opts.args ?? []), file], { cwd });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`script exited ${code}: ${stderr}`));
      });
    });
  } finally {
    await rm(file, { force: true });
  }
};

export class ScriptApplier implements FixApplier {
  constructor(private opts: ScriptAdapterOptions) {}
  async apply(plan: FixPlan): Promise<ApplyResult> {
    const out = await runWithPayload(this.opts, plan);
    const parsed = JSON.parse(out) as { filesChanged: string[] };
    return { filesChanged: parsed.filesChanged ?? [] };
  }
}

export class ScriptPlanner implements FixPlanner {
  constructor(private opts: ScriptAdapterOptions) {}
  async plan(valid: Finding[]): Promise<FixPlan[]> {
    const out = await runWithPayload(this.opts, valid);
    return JSON.parse(out) as FixPlan[];
  }
}
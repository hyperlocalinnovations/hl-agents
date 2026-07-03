import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { Config } from './config.js';
import { defaultConfig } from './config.js';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const deepMerge = <T>(base: T, override: Partial<T> | undefined): T => {
  if (!override) return base;
  if (Array.isArray(base) || typeof base !== 'object' || base === null) {
    return (override as T) ?? base;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const k of Object.keys(override)) {
    const ov = (override as Record<string, unknown>)[k];
    const bv = (base as Record<string, unknown>)[k];
    if (isObject(ov) && isObject(bv)) {
      out[k] = deepMerge(bv, ov);
    } else if (ov !== undefined) {
      out[k] = ov;
    }
  }
  return out as T;
};

export const loadConfig = async (configPath?: string): Promise<Config> => {
  if (!configPath) {
    const candidates = [
      'hl-agents.config.ts',
      'hl-agents.config.js',
      'hl-agents.config.json',
      '.hl-agents.json',
    ];
    for (const c of candidates) {
      try {
        return await loadConfig(resolve(c));
      } catch {
        // try next
      }
    }
    return defaultConfig;
  }

  if (configPath.endsWith('.json')) {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(configPath, 'utf8');
    return deepMerge(defaultConfig, JSON.parse(raw) as Partial<Config>);
  }

  const url = pathToFileURL(resolve(configPath)).href;
  const mod = await import(url);
  const exported = mod.default ?? mod.config;
  if (!exported) throw new Error(`No default export or named "config" in ${configPath}`);
  return deepMerge(defaultConfig, exported as Partial<Config>);
};
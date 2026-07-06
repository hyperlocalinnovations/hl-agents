import { createOpencodeClient, createOpencode } from '@opencode-ai/sdk';
import type { OpencodeClient } from '@opencode-ai/sdk';

/**
 * JSON Schema for a findings array. Used with session.prompt() `format` field
 * when the server supports structured output. The published SDK types
 * (1.17.13) don't declare `format` yet, but the server accepts it — we pass
 * it as an untyped extra and fall back to text parsing if it's not honored.
 */
export const FindingSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      file: { type: 'string' },
      line: { type: 'number' },
      endLine: { type: 'number' },
      severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
      rule: { type: 'string' },
      message: { type: 'string' },
    },
    required: ['file', 'severity', 'message'],
  },
} as const;

export const FixPlanSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      description: { type: 'string' },
      files: { type: 'array', items: { type: 'string' } },
      findings: { type: 'array', items: FindingSchema.items },
    },
    required: ['description', 'files'],
  },
} as const;

export const VerdictSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      valid: { type: 'boolean' },
      reason: { type: 'string' },
    },
    required: ['id', 'valid'],
  },
} as const;

let _client: OpencodeClient | null = null;
let _ownedServer: { close: () => void } | null = null;

const DEFAULT_URL = 'http://127.0.0.1:4096';

const tryHealth = async (url: string): Promise<boolean> => {
  try {
    const res = await fetch(`${url}/global/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
};

/**
 * Acquire an opencode client. Auto-discovers a running server (TUI or
 * `opencode serve`); falls back to starting a headless server if none found.
 * Pass `serverUrl` to skip discovery and connect directly.
 */
export const getOpencodeClient = async (serverUrl?: string): Promise<OpencodeClient> => {
  if (_client) return _client;

  const envUrl = process.env.OPENCODE_SERVER_URL;
  const candidates = [serverUrl, envUrl, DEFAULT_URL].filter(Boolean) as string[];

  for (const url of candidates) {
    if (await tryHealth(url)) {
      _client = createOpencodeClient({ baseUrl: url });
      return _client;
    }
  }

  // No running server found — start a headless one.
  const { client, server } = await createOpencode({ hostname: '127.0.0.1', port: 0 });
  _client = client;
  _ownedServer = server;
  return _client;
};

/** Dispose a server we started. Safe to call at process exit. */
export const releaseOpencodeClient = (): void => {
  if (_ownedServer) {
    _ownedServer.close();
    _ownedServer = null;
  }
  _client = null;
};

export interface PromptOptions {
  agent?: string;
  /** Override the project directory (defaults to server's cwd). */
  directory?: string;
  /** Optional JSON schema for structured output (server may ignore). */
  format?: { type: 'json_schema'; schema: object };
  /** Abort after N ms. */
  timeoutMs?: number;
  /** Explicit server URL (skips auto-discovery). */
  serverUrl?: string;
}

/**
 * Send a prompt to a fresh session and return the assistant's text response,
 * plus the session ID (for diff inspection afterwards) and any structured
 * output the server returned.
 */
export const runPrompt = async (
  prompt: string,
  opts: PromptOptions = {},
): Promise<{ sessionId: string; text: string; structured: unknown }> => {
  const client = await getOpencodeClient(opts.serverUrl);
  const session = await client.session.create({ body: { title: 'hl-agents' } });
  const sessionId = session.data?.id;
  if (!sessionId) throw new Error('Failed to create opencode session');

  const body: Record<string, unknown> = {
    agent: opts.agent ?? 'build',
    parts: [{ type: 'text', text: prompt }],
  };
  if (opts.format) body.format = opts.format;

  const result = await client.session.prompt({
    path: { id: sessionId },
    body: body as never,
    query: opts.directory ? { directory: opts.directory } : undefined,
    ...(opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
  } as never);

  const parts = result.data?.parts ?? [];
  const text = parts
    .filter((p) => p.type === 'text' && 'text' in (p as Record<string, unknown>))
    .map((p) => (p as { text: string }).text)
    .join('\n');

  const structured = (result.data?.info as { structured_output?: unknown })?.structured_output ?? null;

  return { sessionId, text, structured };
};

/** Get the file diff for a session (useful after an apply step). */
export const getSessionDiff = async (sessionId: string): Promise<{ file: string; additions: number; deletions: number }[]> => {
  const client = await getOpencodeClient();
  const result = await client.session.diff({ path: { id: sessionId } });
  return (result.data ?? []) as { file: string; additions: number; deletions: number }[];
};
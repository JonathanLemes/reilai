import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentKind, ModelOption } from '@reilai/protocol';
import { spawn } from 'bun';

import { VERSION } from '../config';
import { AsyncQueue } from './queue';

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<AgentKind, { at: number; models: ModelOption[] }>();

/** Used when the agent cannot be asked (not logged in, offline…). */
const FALLBACK: Record<AgentKind, ModelOption[]> = {
  claude: [
    { id: 'default', label: 'Default', description: 'Your Claude Code default', isDefault: true },
    { id: 'opus', label: 'Opus', description: 'Most capable' },
    { id: 'sonnet', label: 'Sonnet', description: 'Fast and capable' },
    { id: 'haiku', label: 'Haiku', description: 'Fastest' },
  ],
  codex: [{ id: 'default', label: 'Default', description: 'Your Codex default', isDefault: true }],
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

/** Claude: ask a short-lived SDK query for the models this account can use. */
async function claudeModels(): Promise<ModelOption[]> {
  const input = new AsyncQueue<SDKUserMessage>();
  const q = query({
    prompt: input,
    options: { pathToClaudeCodeExecutable: process.env.REILAI_CLAUDE_PATH ?? Bun.which('claude') ?? undefined },
  });
  try {
    const list = await withTimeout(q.supportedModels(), 20_000);
    return list.map((m, i) => ({
      id: m.value,
      label: m.displayName || m.value,
      description: m.description ?? '',
      resolved: m.resolvedModel,
      isDefault: m.value === 'default' || (i === 0 && !list.some((x) => x.value === 'default')),
    }));
  } finally {
    input.end();
    try {
      q.close?.();
    } catch {
      // already gone
    }
  }
}

/** Codex: `model/list` on a short-lived app-server. */
async function codexModels(): Promise<ModelOption[]> {
  const proc = spawn([process.env.REILAI_CODEX_PATH ?? Bun.which('codex') ?? 'codex', 'app-server'], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'ignore',
  });
  const send = (m: object) => {
    proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
    proc.stdin.flush();
  };
  try {
    const result = await withTimeout(
      (async () => {
        send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'reilai', title: 'ReilAI', version: VERSION }, capabilities: { experimentalApi: true } } });
        let buffer = '';
        const decoder = new TextDecoder();
        for await (const chunk of proc.stdout) {
          buffer += decoder.decode(chunk, { stream: true });
          for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            let msg: { id?: number; result?: unknown };
            try {
              msg = JSON.parse(line);
            } catch {
              continue;
            }
            if (msg.id === 1) {
              send({ method: 'initialized' });
              send({ id: 2, method: 'model/list', params: { limit: 50 } });
            } else if (msg.id === 2) return msg.result as { data: { id: string; model: string; displayName: string; description: string; isDefault: boolean; hidden: boolean }[] };
          }
        }
        throw new Error('codex closed');
      })(),
      20_000,
    );
    return result.data
      .filter((m) => !m.hidden)
      .map((m) => ({ id: m.model || m.id, label: m.displayName || m.model, description: m.description ?? '', isDefault: m.isDefault }));
  } finally {
    proc.kill();
  }
}

export async function listModels(agent: AgentKind): Promise<ModelOption[]> {
  const hit = cache.get(agent);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.models;
  let models: ModelOption[];
  try {
    models = agent === 'claude' ? await claudeModels() : await codexModels();
    if (!models.length) models = FALLBACK[agent];
  } catch {
    models = FALLBACK[agent];
  }
  cache.set(agent, { at: Date.now(), models });
  return models;
}

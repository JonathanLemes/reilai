import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import {
  type AgentAvailability,
  type DirEntry,
  PERMISSION_MODES,
  type RpcMethod,
  type RpcMethods,
  RpcError,
  type Settings,
} from '@reilai/protocol';

import { randomUUID } from 'node:crypto';

import { randomToken, safeEqual } from '@reilai/crypto';

import { listModels } from '../agents/models';
import { readFile, searchFiles } from './files';
import { machineKey, machineName, VERSION } from '../config';
import type { Broadcast, SessionManager } from './sessions';
import type { Store } from './store';

/** `terminal.*` need the calling connection, so the server handles them (server.ts). */
export type ConnectionMethod = Extract<RpcMethod, `terminal.${string}`>;
type Handlers = {
  [M in Exclude<RpcMethod, ConnectionMethod>]: (params: RpcMethods[M][0]) => Promise<RpcMethods[M][1]> | RpcMethods[M][1];
};

const agentCache = new Map<string, AgentAvailability>();

const PAIRING_TTL_MS = 10 * 60 * 1000;
/** One-time pairing tokens (memory only: a daemon restart invalidates them). */
const pairings = new Map<string, { expiresAt: number; deviceId: string | null }>();

async function detectAgent(agent: 'claude' | 'codex'): Promise<AgentAvailability> {
  const cached = agentCache.get(agent);
  if (cached) return cached;
  const bin = Bun.which(agent);
  let version: string | null = null;
  if (bin) {
    try {
      const out = await Bun.$`${bin} --version`.quiet().nothrow().text();
      version = out.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
    } catch {
      version = null;
    }
  }
  const result = { agent, installed: !!bin, version };
  agentCache.set(agent, result);
  return result;
}

function dirEntry(path: string): DirEntry {
  return { name: basename(path) || path, path, isGitRepo: existsSync(join(path, '.git')) };
}

function expand(path: string | undefined): string {
  if (!path) return homedir();
  if (path === '~' || path.startsWith('~/')) return join(homedir(), path.slice(1));
  return resolve(path);
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw new RpcError('bad_request', `Missing ${name}`);
  return value;
}

export function createHandlers(store: Store, sessions: SessionManager, broadcast: Broadcast): Handlers {
  return {
    async hello() {
      return {
        machine: { name: machineName(), platform: platform(), home: homedir(), version: VERSION },
        settings: store.getSettings(),
        agents: await Promise.all([detectAgent('claude'), detectAgent('codex')]),
      };
    },
    'sessions.list': (p) => store.listSessions(!!p?.archived),
    'sessions.get': (p) => {
      const session = sessions.get(requireString(p?.id, 'id'));
      const { messages, hasMore } = store.listMessages(session.id, Math.min(p.limit ?? 200, 500), p.before);
      return { session, messages, hasMore };
    },
    'sessions.create': (p) =>
      sessions.create({
        agent: p.agent,
        cwd: expand(requireString(p.cwd, 'cwd')),
        prompt: p.prompt,
        mode: p.mode && PERMISSION_MODES.includes(p.mode) ? p.mode : undefined,
        model: p.model && p.model !== 'default' ? p.model : null,
        startedBy: p.startedBy,
        terminal: p.terminal === true,
      }),
    'sessions.send': async (p) => {
      await sessions.send(requireString(p.id, 'id'), requireString(p.text, 'text'));
      return { ok: true };
    },
    'sessions.interrupt': async (p) => {
      await sessions.interrupt(requireString(p.id, 'id'));
      return { ok: true };
    },
    'sessions.stop': async (p) => {
      await sessions.stop(requireString(p.id, 'id'));
      return { ok: true };
    },
    'sessions.resume': (p) => sessions.resume(requireString(p.id, 'id')),
    'sessions.setMode': (p) => {
      if (!PERMISSION_MODES.includes(p.mode)) throw new RpcError('bad_request', 'Unknown mode');
      return sessions.setMode(requireString(p.id, 'id'), p.mode);
    },
    'sessions.setModel': (p) => sessions.setModel(requireString(p.id, 'id'), typeof p.model === 'string' && p.model ? p.model : null),
    'agents.models': (p) => {
      if (p.agent !== 'claude' && p.agent !== 'codex') throw new RpcError('bad_request', 'Unknown agent');
      return listModels(p.agent);
    },
    'sessions.rename': (p) => {
      sessions.get(requireString(p.id, 'id'));
      return sessions.patch(p.id, { title: String(p.title ?? '').trim().slice(0, 120) })!;
    },
    'sessions.archive': async (p) => {
      sessions.get(requireString(p.id, 'id'));
      // archiving also ends the agent process: an archived session is done
      if (p.archived) await sessions.stop(p.id).catch(() => {});
      return sessions.patch(p.id, { archived: !!p.archived })!;
    },
    'sessions.delete': async (p) => {
      await sessions.remove(requireString(p.id, 'id'));
      return { ok: true };
    },
    'permissions.respond': (p) => {
      if (!['allow', 'allow_session', 'deny'].includes(p.decision)) throw new RpcError('bad_request', 'Unknown decision');
      sessions.respond(requireString(p.sessionId, 'sessionId'), requireString(p.requestId, 'requestId'), p.decision);
      return { ok: true };
    },
    'fs.read': (p) => readFile(requireString(p.path, 'path'), p.cwd),
    'fs.list': (p) => {
      const path = expand(p?.path);
      if (!existsSync(path) || !statSync(path).isDirectory()) throw new RpcError('not_found', `Not a folder: ${path}`);
      let names: string[] = [];
      try {
        names = readdirSync(path);
      } catch {
        throw new RpcError('forbidden', `Cannot read ${path}`);
      }
      const withFiles = p?.files === true;
      const entries = names
        .filter((n) => (withFiles ? n !== '.git' : !n.startsWith('.')) && n !== 'node_modules')
        .flatMap((n) => {
          const full = join(path, n);
          try {
            const st = statSync(full);
            if (st.isDirectory()) return [{ ...dirEntry(full), ...(withFiles ? { isDir: true } : {}) }];
            if (withFiles && st.isFile()) return [{ name: n, path: full, isGitRepo: false, isDir: false, size: st.size }];
          } catch {
            // unreadable entry
          }
          return [];
        })
        .sort((a, b) => Number(b.isDir ?? true) - Number(a.isDir ?? true) || a.name.localeCompare(b.name))
        .slice(0, 800);
      const parent = dirname(path);
      return { path, parent: parent === path ? null : parent, entries };
    },
    'fs.search': (p) => searchFiles(requireString(p.cwd, 'cwd'), typeof p.query === 'string' ? p.query : '', p.limit),
    'fs.recent': () => store.recentDirs().filter((p) => existsSync(p)).map(dirEntry),
    'settings.get': () => store.getSettings(),
    'settings.set': (p) => {
      const next: Settings = { ...store.getSettings() };
      if (p.language === 'en' || p.language === 'pt' || p.language === 'system') next.language = p.language;
      if (p.sessionTimeoutMinutes !== undefined) {
        const minutes = Number(p.sessionTimeoutMinutes);
        if (!Number.isFinite(minutes) || minutes < 0) throw new RpcError('bad_request', 'sessionTimeoutMinutes must be >= 0');
        next.sessionTimeoutMinutes = Math.round(minutes);
      }
      store.saveSettings(next);
      broadcast('settings.changed', next);
      return next;
    },
    'devices.list': () => store.listDevices(),
    'devices.revoke': (p) => {
      store.removeDevice(requireString(p.id, 'id'));
      broadcast('devices.changed', store.listDevices());
      return { ok: true };
    },
    'pairing.create': () => {
      const token = randomToken(24);
      const expiresAt = Date.now() + PAIRING_TTL_MS;
      pairings.set(token, { expiresAt, deviceId: null });
      return { token, expiresAt, machineKey: machineKey().publicKey, machineName: machineName() };
    },
    'pairing.status': (p) => {
      const entry = pairings.get(requireString(p.token, 'token'));
      if (!entry) return { device: null, expired: true };
      const device = entry.deviceId ? (store.listDevices().find((d) => d.id === entry.deviceId) ?? null) : null;
      return { device, expired: !device && entry.expiresAt < Date.now() };
    },
    'devices.authorize': (p) => {
      const publicKey = requireString(p.publicKey, 'publicKey');
      const known = store.findDeviceByKey(publicKey);
      if (known) {
        store.touchDevice(known.id);
        return known;
      }
      if (!p.pairingToken) return null;
      const now = Date.now();
      for (const [token, entry] of pairings) {
        if (entry.expiresAt < now) pairings.delete(token);
      }
      const match = [...pairings.entries()].find(([token, entry]) => !entry.deviceId && safeEqual(token, p.pairingToken!));
      if (!match) return null;
      const device = {
        id: randomUUID(),
        name: String(p.name ?? 'Device').slice(0, 60),
        publicKey,
        pairedAt: now,
        lastSeenAt: now,
      };
      store.addDevice(device);
      match[1].deviceId = device.id; // one use only
      broadcast('devices.changed', store.listDevices());
      return device;
    },
  };
}

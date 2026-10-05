import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_PORTS } from '@reilai/protocol';

/**
 * Blind relay. Machines dial in at /m/<machineId>, devices at /c/<machineId>,
 * and the relay just shuttles opaque frames between them. It never sees keys or
 * plaintext: the handshake and AES-GCM frames pass through unchanged, so a
 * compromised relay can drop traffic but cannot read or forge it.
 *
 * Meant for a small public host (VPS, Fly, Railway…), behind TLS (wss://).
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const port = Number(arg('port') ?? process.env.PORT ?? DEFAULT_PORTS.relay);
const MAX_CLIENTS_PER_MACHINE = 16;

type Data = { role: 'machine' | 'client'; machineId: string; cid?: string };
type Socket = Bun.ServerWebSocket<Data>;

const machines = new Map<string, Socket>();
const clients = new Map<string, Map<string, Socket>>();

const ID = /^[A-Za-z0-9_-]{10,64}$/;

const server = Bun.serve<Data, never>({
  hostname: '0.0.0.0',
  port,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === '/health') return Response.json({ ok: true, service: 'reilai-relay', machines: machines.size });
    const match = url.pathname.match(/^\/(m|c)\/([^/]+)$/);
    if (!match || !ID.test(match[2]!)) return new Response('ReilAI relay', { status: 404 });
    const role = match[1] === 'm' ? 'machine' : 'client';
    const machineId = match[2]!;
    if (role === 'client') {
      if (!machines.has(machineId)) return new Response('Computer offline', { status: 503 });
      if ((clients.get(machineId)?.size ?? 0) >= MAX_CLIENTS_PER_MACHINE) return new Response('Too many devices', { status: 429 });
    }
    const data: Data = { role, machineId, cid: role === 'client' ? randomUUID() : undefined };
    return srv.upgrade(req, { data }) ? undefined : new Response('Upgrade required', { status: 426 });
  },
  websocket: {
    maxPayloadLength: 16 * 1024 * 1024,
    idleTimeout: 120,
    sendPings: true,
    open(ws) {
      const { role, machineId, cid } = ws.data;
      if (role === 'machine') {
        machines.get(machineId)?.close(4009, 'replaced by a newer connection');
        machines.set(machineId, ws);
        return;
      }
      const map = clients.get(machineId) ?? new Map<string, Socket>();
      map.set(cid!, ws);
      clients.set(machineId, map);
      machines.get(machineId)?.send(JSON.stringify({ cid, t: 'open' }));
    },
    message(ws, raw) {
      const { role, machineId, cid } = ws.data;
      if (role === 'client') {
        machines.get(machineId)?.send(JSON.stringify({ cid, t: 'data', d: String(raw) }));
        return;
      }
      let frame: { cid?: string; t?: string; d?: string };
      try {
        frame = JSON.parse(String(raw));
      } catch {
        return;
      }
      const target = frame.cid ? clients.get(machineId)?.get(frame.cid) : undefined;
      if (!target) return;
      if (frame.t === 'data' && typeof frame.d === 'string') target.send(frame.d);
      else if (frame.t === 'close') target.close(1000, 'closed by computer');
    },
    close(ws) {
      const { role, machineId, cid } = ws.data;
      if (role === 'machine') {
        if (machines.get(machineId) !== ws) return;
        machines.delete(machineId);
        for (const c of clients.get(machineId)?.values() ?? []) c.close(1012, 'computer went offline');
        clients.delete(machineId);
        return;
      }
      clients.get(machineId)?.delete(cid!);
      machines.get(machineId)?.send(JSON.stringify({ cid, t: 'close' }));
    },
  },
});

// When started by `reilai relay`, report our pid/port like the other services.
const home = process.env.REILAI_HOME ?? join(homedir(), '.reilai');
const stateFile = join(home, 'relay.json');
mkdirSync(home, { recursive: true });
writeFileSync(stateFile, JSON.stringify({ pid: process.pid, port: server.port, startedAt: Date.now() }), { mode: 0o600 });
console.log(`[relay] listening on 0.0.0.0:${server.port}`);

const shutdown = () => {
  server.stop(true);
  rmSync(stateFile, { force: true });
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

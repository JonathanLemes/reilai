import { createHash } from 'node:crypto';

import {
  ensureHome,
  machineKey,
  machineName,
  paths,
  readDaemonState,
  removeFile,
  writeSecretJson,
} from '@reilai/cli/config';
import { DEFAULT_PORTS, type Device, type ServerEventName } from '@reilai/protocol';
import { DaemonClient } from '@reilai/protocol/client';

import { type Link, TunnelSession } from './gateway';

/**
 * Tunnel service: the native app's door to this computer.
 * - direct: devices connect to ws://<lan|tailscale ip>:7430/tunnel
 * - relay:  with --relay, it also dials out to a blind relay so phones can reach
 *           it from anywhere without opening ports.
 * Independent from the web service: either can stop without affecting the other.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const port = Number(arg('port') ?? process.env.REILAI_TUNNEL_PORT ?? DEFAULT_PORTS.tunnel);
const relayUrl = (arg('relay') ?? process.env.REILAI_RELAY_URL)?.replace(/\/$/, '');

const daemonState = readDaemonState();
if (!daemonState) {
  console.error('[tunnel] the daemon is not running (reilai start)');
  process.exit(1);
}

ensureHome();
const machine = machineKey();
const name = machineName();
/** Public, non-secret routing id for the relay (hash of the machine key). */
const machineId = createHash('sha256').update(machine.publicKey).digest('base64url').slice(0, 22);
const daemon = new DaemonClient(`ws://127.0.0.1:${daemonState.port}/rpc`, daemonState.token, { reconnect: true });
await daemon.connect();

const sessions = new Set<TunnelSession>();

daemon.on((event: ServerEventName, data: unknown) => {
  if (event === 'devices.changed') {
    const alive = new Set((data as Device[]).map((d) => d.id));
    for (const s of sessions) if (s.device && !alive.has(s.device.id)) s.close(4003, 'device revoked');
  }
  for (const s of sessions) s.event(event, data);
});

function open(link: Link) {
  return new TunnelSession(
    link,
    machine,
    daemon,
    name,
    (s) => sessions.add(s),
    (s) => sessions.delete(s),
  );
}

const server = Bun.serve<{ session?: TunnelSession }, never>({
  hostname: '0.0.0.0',
  port,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === '/health') return Response.json({ ok: true, service: 'reilai-tunnel' });
    if (url.pathname === '/tunnel' && srv.upgrade(req, { data: {} })) return undefined;
    return new Response('ReilAI tunnel. Pair with `reilai pair`.', { status: 404 });
  },
  websocket: {
    maxPayloadLength: 16 * 1024 * 1024,
    idleTimeout: 120,
    sendPings: true,
    open(ws) {
      ws.data.session = open({ send: (t) => ws.send(t), close: (code, reason) => ws.close(code, reason) });
    },
    message(ws, raw) {
      void ws.data.session?.receive(String(raw));
    },
    close(ws) {
      ws.data.session?.dropped();
    },
  },
});

/** Relay uplink: one WebSocket multiplexing every remote device as `cid` streams. */
function connectRelay(url: string, attempt = 0) {
  const ws = new WebSocket(`${url}/m/${machineId}`);
  const streams = new Map<string, TunnelSession>();
  ws.onopen = () => {
    attempt = 0;
    console.log(`[tunnel] relay connected: ${url}`);
  };
  ws.onmessage = (e) => {
    const frame = JSON.parse(String(e.data)) as { cid: string; t: 'open' | 'data' | 'close'; d?: string };
    if (frame.t === 'open') {
      streams.set(
        frame.cid,
        open({
          send: (d) => ws.send(JSON.stringify({ cid: frame.cid, t: 'data', d })),
          close: () => ws.send(JSON.stringify({ cid: frame.cid, t: 'close' })),
        }),
      );
    } else if (frame.t === 'data' && frame.d) {
      void streams.get(frame.cid)?.receive(frame.d);
    } else if (frame.t === 'close') {
      streams.get(frame.cid)?.dropped();
      streams.delete(frame.cid);
    }
  };
  ws.onclose = () => {
    for (const s of streams.values()) s.dropped();
    streams.clear();
    const delay = Math.min(1000 * 2 ** attempt, 30_000);
    setTimeout(() => connectRelay(url, attempt + 1), delay);
  };
  ws.onerror = () => {};
}

if (relayUrl) connectRelay(relayUrl);

writeSecretJson(paths.service('tunnel'), {
  pid: process.pid,
  port: server.port,
  startedAt: Date.now(),
  relayUrl: relayUrl ?? null,
  machineId,
});
console.log(`[tunnel] listening on 0.0.0.0:${server.port}${relayUrl ? `, relay ${relayUrl}` : ''}`);

const shutdown = () => {
  for (const s of sessions) s.close(1001, 'tunnel stopping');
  server.stop(true);
  removeFile(paths.service('tunnel'));
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

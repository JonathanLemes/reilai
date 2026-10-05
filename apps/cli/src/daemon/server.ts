import { safeEqual } from '@reilai/crypto';
import { type ClientFrame, RpcError, type ServerEventName, type ServerEvents, type ServerFrame } from '@reilai/protocol';

import { type DaemonState, daemonPort, ensureHome, machineKey, newToken, paths, removeFile, VERSION, writeSecretJson } from '../config';
import { createHandlers } from './rpc';
import { SessionManager } from './sessions';
import { Store } from './store';

const TOPIC = 'events';

/**
 * The daemon: owns agent processes and the database, and fans every change out
 * to all connected clients (CLI, web service, tunnel). Listens on loopback only;
 * remote access always goes through the web service or the encrypted tunnel.
 */
export async function runDaemon() {
  ensureHome();
  machineKey();
  const store = new Store(paths.db);
  store.recoverAfterRestart();
  const token = newToken();
  const port = daemonPort();

  let server: ReturnType<typeof Bun.serve<{ id: number }, never>> | null = null;
  const broadcast = <E extends ServerEventName>(event: E, data: ServerEvents[E]) => {
    server?.publish(TOPIC, JSON.stringify({ event, data } satisfies ServerFrame));
  };
  const sessions = new SessionManager(store, broadcast);
  const handlers = createHandlers(store, sessions, broadcast);
  let connections = 0;

  server = Bun.serve<{ id: number }, never>({
    hostname: '127.0.0.1',
    port,
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === '/health') return Response.json({ ok: true, version: VERSION, pid: process.pid });
      if (url.pathname !== '/rpc') return new Response('Not found', { status: 404 });
      const given = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? url.searchParams.get('token') ?? '';
      if (!safeEqual(given, token)) return new Response('Unauthorized', { status: 401 });
      connections += 1;
      if (srv.upgrade(req, { data: { id: connections } })) return undefined;
      return new Response('Upgrade required', { status: 426 });
    },
    websocket: {
      maxPayloadLength: 16 * 1024 * 1024,
      idleTimeout: 120,
      sendPings: true,
      open(ws) {
        ws.subscribe(TOPIC);
      },
      async message(ws, raw) {
        let frame: ClientFrame;
        try {
          frame = JSON.parse(String(raw)) as ClientFrame;
        } catch {
          return;
        }
        const handler = handlers[frame.method] as ((p: unknown) => unknown) | undefined;
        let reply: ServerFrame;
        try {
          if (!handler) throw new RpcError('unknown_method', `Unknown method ${String(frame.method)}`);
          reply = { id: frame.id, result: await handler(frame.params ?? {}) };
        } catch (e) {
          const err = e instanceof RpcError ? e : new RpcError('internal', e instanceof Error ? e.message : String(e));
          reply = { id: frame.id, error: { code: err.code, message: err.message } };
        }
        ws.send(JSON.stringify(reply));
      },
    },
  });

  const state: DaemonState = { pid: process.pid, port, token, version: VERSION, startedAt: Date.now() };
  writeSecretJson(paths.daemon, state);
  console.log(`[reilai] daemon ${VERSION} listening on 127.0.0.1:${port} (pid ${process.pid})`);

  const shutdown = async () => {
    console.log('[reilai] daemon shutting down');
    await sessions.shutdown().catch(() => {});
    server?.stop(true);
    removeFile(paths.daemon);
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

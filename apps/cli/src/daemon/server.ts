import type { ServerWebSocket } from 'bun';

import { safeEqual } from '@reilai/crypto';
import { type ClientFrame, RpcError, type ServerEventName, type ServerEvents, type ServerFrame } from '@reilai/protocol';

import { type DaemonState, daemonPort, daemonToken, ensureHome, machineKey, paths, removeFile, VERSION, writeSecretJson } from '../config';
import { hookTargets, type HookPayload } from '../agents/claude-tui';
import { type ConnectionMethod, createHandlers } from './rpc';
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
  const token = daemonToken();
  const port = daemonPort();

  type Connection = { id: number; terminals: Map<string, () => void> };
  let server: ReturnType<typeof Bun.serve<Connection, never>> | null = null;
  const broadcast = <E extends ServerEventName>(event: E, data: ServerEvents[E]) => {
    server?.publish(TOPIC, JSON.stringify({ event, data } satisfies ServerFrame));
  };
  const sessions = new SessionManager(store, broadcast);
  const handlers = createHandlers(store, sessions, broadcast);
  let connections = 0;

  type Socket = ServerWebSocket<Connection>;
  const push = (ws: Socket, frame: ServerFrame) => ws.send(JSON.stringify(frame));

  /** Terminal methods are bound to the connection that attached the terminal. */
  const terminalCall = async (ws: Socket, method: ConnectionMethod, params: Record<string, unknown>) => {
    const id = String(params.id ?? '');
    if (!id) throw new RpcError('bad_request', 'Missing id');
    switch (method) {
      case 'terminal.attach': {
        ws.data.terminals.get(id)?.();
        const { result, detach } = await sessions.terminalAttach(id, Number(params.cols) || 120, Number(params.rows) || 40, {
          data: (chunk) => push(ws, { event: 'terminal.data', data: { id, data: Buffer.from(chunk).toString('base64') } }),
          exit: (code) => {
            ws.data.terminals.get(id)?.();
            ws.data.terminals.delete(id);
            push(ws, { event: 'terminal.exit', data: { id, code } });
          },
        });
        ws.data.terminals.set(id, detach);
        return result;
      }
      case 'terminal.input':
        sessions.terminalInput(id, Buffer.from(String(params.data ?? ''), 'base64'));
        return { ok: true };
      case 'terminal.resize':
        sessions.terminalResize(id, Number(params.cols), Number(params.rows));
        return { ok: true };
      case 'terminal.detach':
        ws.data.terminals.get(id)?.();
        ws.data.terminals.delete(id);
        return { ok: true };
    }
  };

  server = Bun.serve<Connection, never>({
    hostname: '127.0.0.1',
    port,
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === '/health') return Response.json({ ok: true, version: VERSION, pid: process.pid });
      // Claude Code hooks of terminal sessions (each runner has its own token)
      if (url.pathname === '/hook' && req.method === 'POST') {
        const target = hookTargets.get(req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '');
        if (!target) return new Response('Unauthorized', { status: 401 });
        try {
          target((await req.json()) as HookPayload);
        } catch {
          return new Response('Bad request', { status: 400 });
        }
        return new Response('{}', { headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname !== '/rpc') return new Response('Not found', { status: 404 });
      const given = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? url.searchParams.get('token') ?? '';
      if (!safeEqual(given, token)) return new Response('Unauthorized', { status: 401 });
      connections += 1;
      if (srv.upgrade(req, { data: { id: connections, terminals: new Map() } })) return undefined;
      return new Response('Upgrade required', { status: 426 });
    },
    websocket: {
      maxPayloadLength: 16 * 1024 * 1024,
      idleTimeout: 120,
      sendPings: true,
      open(ws) {
        ws.subscribe(TOPIC);
      },
      close(ws) {
        for (const detach of ws.data.terminals.values()) detach();
        ws.data.terminals.clear();
      },
      async message(ws, raw) {
        let frame: ClientFrame;
        try {
          frame = JSON.parse(String(raw)) as ClientFrame;
        } catch {
          return;
        }
        const handler = (handlers as Record<string, ((p: unknown) => unknown) | undefined>)[frame.method];
        let reply: ServerFrame;
        try {
          if (String(frame.method).startsWith('terminal.')) {
            reply = { id: frame.id, result: await terminalCall(ws, frame.method as ConnectionMethod, (frame.params ?? {}) as Record<string, unknown>) };
          } else {
            if (!handler) throw new RpcError('unknown_method', `Unknown method ${String(frame.method)}`);
            reply = { id: frame.id, result: await handler(frame.params ?? {}) };
          }
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

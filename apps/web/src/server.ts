import { existsSync, readFileSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';

import {
  ensureHome,
  newToken,
  paths,
  readDaemonState,
  removeFile,
  writeSecretJson,
} from '@reilai/cli/config';
import { safeEqual } from '@reilai/crypto';
import { type ClientFrame, DEFAULT_PORTS, isRpcMethod, RpcError, type ServerFrame } from '@reilai/protocol';
import { DaemonClient } from '@reilai/protocol/client';

/**
 * Web service: serves the browser/PWA shell and proxies RPC to the daemon.
 * A separate process from the tunnel, so stopping one never affects the other;
 * both read and write the same sessions through the daemon, live.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const port = Number(arg('port') ?? process.env.REILAI_WEB_PORT ?? DEFAULT_PORTS.web);
const host = arg('host') ?? process.env.REILAI_WEB_HOST ?? '0.0.0.0';
const SHELL_DIR = resolve(import.meta.dir, '../dist');
const BUNDLE_DIR = resolve(import.meta.dir, '../../app/dist');

ensureHome();
const tokenFile = join(paths.home, 'web-token');
/** Stable across restarts so installed PWAs stay signed in. Delete the file to rotate. */
const token = existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : newToken();
if (!existsSync(tokenFile)) await Bun.write(tokenFile, token, { mode: 0o600 });

const daemonState = readDaemonState();
if (!daemonState) {
  console.error('[web] the daemon is not running (reilai start)');
  process.exit(1);
}
const daemon = new DaemonClient(`ws://127.0.0.1:${daemonState.port}/rpc`, daemonState.token, { reconnect: true });
await daemon.connect();

const TOPIC = 'events';
let server: ReturnType<typeof Bun.serve<{ id: number }, never>> | null = null;

daemon.on((event, data) => server?.publish(TOPIC, JSON.stringify({ event, data } satisfies ServerFrame)));
daemon.onState((connected) => server?.publish(TOPIC, JSON.stringify({ event: 'connection', data: { daemon: connected } })));

function authorized(req: Request, url: URL) {
  const given = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? url.searchParams.get('token') ?? '';
  return safeEqual(given, token);
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.bundle': 'application/octet-stream',
  '.wasm': 'application/wasm',
};

function serveFile(dir: string, rel: string, cache: string): Response | null {
  const full = normalize(join(dir, rel));
  if (!full.startsWith(dir) || !existsSync(full)) return null;
  const file = Bun.file(full);
  const ext = full.slice(full.lastIndexOf('.'));
  return new Response(file, {
    headers: { 'content-type': TYPES[ext] ?? file.type, 'cache-control': cache, 'x-content-type-options': 'nosniff' },
  });
}

server = Bun.serve<{ id: number }, never>({
  hostname: host,
  port,
  async fetch(req, srv) {
    const url = new URL(req.url);
    const path = decodeURIComponent(url.pathname);

    if (path === '/ws') {
      if (!authorized(req, url)) return new Response('Unauthorized', { status: 401 });
      return srv.upgrade(req, { data: { id: 0 } }) ? undefined : new Response('Upgrade required', { status: 426 });
    }
    if (path === '/api/check') {
      return authorized(req, url) ? Response.json({ ok: true }) : new Response('Unauthorized', { status: 401 });
    }
    if (path === '/health') return Response.json({ ok: true, service: 'reilai-web', daemon: daemon.connected });

    if (path.startsWith('/bundles/')) {
      const res = serveFile(BUNDLE_DIR, path.slice('/bundles/'.length), 'no-cache');
      return res ?? new Response('Bundle not built. Run `bun run build` in apps/app.', { status: 404 });
    }
    if (path === '/sw.js') return serveFile(SHELL_DIR, 'sw.js', 'no-cache') ?? new Response('', { status: 404 });
    if (path !== '/' && path !== '/index.html') {
      const isHashed = /\/static\//.test(path);
      const res = serveFile(SHELL_DIR, path.slice(1), isHashed ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
      if (res) return res;
    }
    // SPA fallback (/s/<id>, /settings…)
    return serveFile(SHELL_DIR, 'index.html', 'no-cache') ?? new Response('Shell not built. Run `bun run build` in apps/web.', { status: 503 });
  },
  websocket: {
    maxPayloadLength: 16 * 1024 * 1024,
    idleTimeout: 120,
    sendPings: true,
    open(ws) {
      ws.subscribe(TOPIC);
      ws.send(JSON.stringify({ event: 'connection', data: { daemon: daemon.connected } }));
    },
    async message(ws, raw) {
      let frame: ClientFrame;
      try {
        frame = JSON.parse(String(raw)) as ClientFrame;
      } catch {
        return;
      }
      let reply: ServerFrame;
      try {
        if (!isRpcMethod(frame.method)) throw new RpcError('forbidden', 'Method not allowed');
        reply = { id: frame.id, result: await daemon.callRaw(frame.method, frame.params ?? {}) };
      } catch (e) {
        const err = e instanceof RpcError ? e : new RpcError('internal', e instanceof Error ? e.message : String(e));
        reply = { id: frame.id, error: { code: err.code, message: err.message } };
      }
      ws.send(JSON.stringify(reply));
    },
  },
});

writeSecretJson(paths.service('web'), { pid: process.pid, port: server.port, startedAt: Date.now(), token });
console.log(`[web] listening on http://${host}:${server.port}`);

const shutdown = () => {
  server?.stop(true);
  removeFile(paths.service('web'));
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { agentEnv } from './env';
import { UnixWebSocket } from './unix-ws';

const dir = mkdtempSync(join(tmpdir(), 'reilai-ws-'));
const path = join(dir, 's.sock');
const server = Bun.serve({
  unix: path,
  fetch(req, srv) {
    return srv.upgrade(req) ? undefined : new Response('no', { status: 400 });
  },
  websocket: {
    message(ws, msg) {
      ws.send(`echo:${String(msg)}`);
    },
  },
});

afterAll(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

test('talks to a websocket server on a unix socket', async () => {
  const ws = await UnixWebSocket.connect(path);
  const got: string[] = [];
  const done = new Promise<void>((resolve) => {
    ws.onmessage = (text) => {
      got.push(text);
      if (got.length === 3) resolve();
    };
  });
  const big = 'x'.repeat(70_000); // 64-bit length frame
  ws.send('hi');
  ws.send('ção');
  ws.send(big);
  await done;
  expect(got).toEqual(['echo:hi', 'echo:ção', `echo:${big}`]);
  ws.close();
});

test('rejects when nothing listens', async () => {
  await expect(UnixWebSocket.connect(join(dir, 'missing.sock'))).rejects.toBeTruthy();
});

test('drops markers of a parent Claude Code session but keeps user config', () => {
  process.env.CLAUDECODE = '1';
  process.env.CLAUDE_CODE_CHILD_SESSION = '1';
  process.env.CLAUDE_CODE_USE_BEDROCK = '1';
  const env = agentEnv({ TERM: 'xterm-256color' });
  expect(env.CLAUDECODE).toBeUndefined();
  expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
  expect(env.CLAUDE_CODE_USE_BEDROCK).toBe('1');
  expect(env.TERM).toBe('xterm-256color');
  delete process.env.CLAUDE_CODE_USE_BEDROCK;
});

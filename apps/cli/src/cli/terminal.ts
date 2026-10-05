import { RpcError, type Session, type TerminalAttach } from '@reilai/protocol';
import type { DaemonClient } from '@reilai/protocol/client';

import { POLICY } from '../agents/codex';
import { agentEnv } from '../agents/env';
import { attach } from './attach';
import { c, t } from './ui';

/** Ctrl+] leaves the TUI without stopping the agent (like telnet). */
const DETACH = 0x1d;

function size() {
  return { cols: process.stdout.columns || 120, rows: process.stdout.rows || 40 };
}

/** Waits until the session is out of a turn (switching Claude to its TUI needs that). */
function idle(client: DaemonClient, id: string): Promise<void> {
  return new Promise((resolve) => {
    const off = client.on((event, data) => {
      if (event !== 'session.upsert') return;
      const s = data as Session;
      if (s.id === id && s.status !== 'running' && s.status !== 'waiting' && s.status !== 'starting') {
        off();
        resolve();
      }
    });
  });
}

/**
 * Opens the agent's own terminal UI for a session: the real `claude` (running in
 * the daemon's PTY, streamed here) or `codex --remote` against the session's
 * app-server. Whatever happens here shows up in the browser and the app, and
 * what they send shows up here. Without a TTY it falls back to the line view.
 */
export async function openTerminal(client: DaemonClient, id: string, prompt?: string) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return attach(client, id);
  let info: TerminalAttach;
  while (true) {
    try {
      info = await client.call('terminal.attach', { id, ...size() });
      break;
    } catch (e) {
      if (!(e instanceof RpcError) || e.code !== 'busy') throw e;
      console.log(c.gray(t('cli.waitingTurn')));
      await idle(client, id);
    }
  }
  if (info.kind === 'codex') return runCodex(client, id, info, prompt);
  return runPty(client, id);
}

async function runCodex(
  client: DaemonClient,
  id: string,
  info: Extract<TerminalAttach, { kind: 'codex' }>,
  prompt?: string,
) {
  const { approval, sandbox } = POLICY[info.mode];
  const args = ['--remote', `unix://${info.socket}`];
  if (info.threadId) {
    // a resumed remote thread keeps its own settings (Codex refuses overrides here)
    args.push('resume', info.threadId);
  } else {
    // the TUI no longer accepts `untrusted`; Ask maps to on-request there (turns sent from
    // ReilAI keep the stricter policy, the app-server still honors it)
    args.push('-C', info.cwd, '-a', approval === 'untrusted' ? 'on-request' : approval, '-s', sandbox);
    if (info.model) args.push('-m', info.model);
    if (prompt?.trim()) args.push(prompt.trim());
  }
  const bin = process.env.REILAI_CODEX_PATH ?? Bun.which('codex') ?? 'codex';
  const proc = Bun.spawn([bin, ...args], { cwd: info.cwd, env: agentEnv(), stdio: ['inherit', 'inherit', 'inherit'] });
  // the TUI owns the terminal; signals go to it, not to us
  const ignore = () => {};
  process.on('SIGINT', ignore);
  await proc.exited;
  process.off('SIGINT', ignore);
  await client.call('terminal.detach', { id }).catch(() => {});
  console.log(c.gray(t('cli.terminalLeft', { id: id.slice(0, 8) })));
}

async function runPty(client: DaemonClient, id: string) {
  const stdin = process.stdin;
  const stdout = process.stdout;
  let code: number | null = null;
  let detached = false;

  await new Promise<void>((resolve) => {
    const off = client.on((event, data) => {
      if (event === 'terminal.data') {
        const d = data as { id: string; data: string };
        if (d.id === id) stdout.write(Buffer.from(d.data, 'base64'));
      } else if (event === 'terminal.exit') {
        const d = data as { id: string; code: number | null };
        if (d.id !== id) return;
        code = d.code;
        finish();
      }
    });
    const offState = client.onState((connected) => {
      if (!connected) finish();
    });
    const onInput = (chunk: Buffer) => {
      if (chunk.length === 1 && chunk[0] === DETACH) {
        detached = true;
        void client.call('terminal.detach', { id }).catch(() => {});
        finish();
        return;
      }
      void client.call('terminal.input', { id, data: chunk.toString('base64') }).catch(() => {});
    };
    const onResize = () => void client.call('terminal.resize', { id, ...size() }).catch(() => {});

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onInput);
    stdout.on('resize', onResize);

    let done = false;
    function finish() {
      if (done) return;
      done = true;
      off();
      offState();
      stdin.off('data', onInput);
      stdout.off('resize', onResize);
      stdin.setRawMode(false);
      stdin.pause();
      resolve();
    }
  });

  // leave the terminal sane whatever state the TUI left it in
  stdout.write('\x1b[?25h\x1b[0m\x1b[?2004l\x1b[<u\x1b[>4;0m\r\n');
  if (detached) console.log(c.gray(t('cli.terminalLeft', { id: id.slice(0, 8) })));
  else if (code !== null && code !== 0 && code !== 143) console.log(c.red(`claude exited with code ${code}`));
}

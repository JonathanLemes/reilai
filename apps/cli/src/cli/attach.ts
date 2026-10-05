import { createInterface } from 'node:readline';

import { relativeTime } from '@reilai/i18n';
import { type Message, PERMISSION_MODES, type PermissionMode, projectName, type Session } from '@reilai/protocol';
import type { DaemonClient } from '@reilai/protocol/client';

import { c, currentLanguage, t } from './ui';

const AGENT = { claude: 'Claude Code', codex: 'Codex' } as const;

function indent(text: string, prefix = '  ') {
  return text
    .split('\n')
    .map((l) => prefix + l)
    .join('\n');
}

export function statusLabel(s: Session): string {
  const label = t(`status.${s.status}`);
  if (s.status === 'running') return c.cyan(`● ${label}`);
  if (s.status === 'waiting') return c.yellow(`● ${label}`);
  if (s.status === 'error') return c.red(`● ${label}`);
  if (s.status === 'idle') return c.green(`● ${label}`);
  return c.gray(`○ ${label}`);
}

export function sessionLine(s: Session): string {
  const title = s.title || t('sessions.untitled');
  return `${c.dim(s.id.slice(0, 8))}  ${c.bold(title.slice(0, 50).padEnd(50))}  ${c.gray(
    `${AGENT[s.agent]} · ${projectName(s.cwd)}`.padEnd(30),
  )} ${statusLabel(s).padEnd(28)} ${c.dim(relativeTime(currentLanguage(), s.updatedAt))}`;
}

function render(m: Message): string | null {
  switch (m.kind) {
    case 'text':
      if (m.streaming) return null;
      return m.role === 'user' ? `\n${c.brand('›')} ${c.bold(m.text ?? '')}` : `\n${m.text ?? ''}`;
    case 'thinking':
      return m.streaming ? null : c.dim(c.italic(indent((m.text ?? '').slice(0, 400), '  ┊ ')));
    case 'tool': {
      const tool = m.tool!;
      if (tool.status === 'running') return null;
      const mark = tool.status === 'error' ? c.red('✗') : c.green('✓');
      const out = tool.output?.trim() ? `\n${c.dim(indent(tool.output.trim().split('\n').slice(0, 6).join('\n'), '    '))}` : '';
      return `  ${mark} ${c.gray(tool.title)}${out}`;
    }
    case 'permission': {
      const p = m.permission!;
      if (p.status === 'pending') return null;
      const label = p.status === 'denied' ? c.red(t('chat.denied')) : p.status === 'expired' ? c.gray(t('chat.expired')) : c.green(t('chat.allowed'));
      return `  ${c.yellow('⚑')} ${p.title} ${c.dim('·')} ${label}`;
    }
    case 'event':
      if (m.event?.type === 'turn-end') return c.dim(`  ${t('chat.turnDone', { s: ((m.event.durationMs ?? 0) / 1000).toFixed(1) })}`);
      if (m.event?.type === 'error') return c.red(`  ✖ ${m.event.text ?? t('error.generic')}`);
      return c.gray(`  ${m.event?.text ?? ''}`);
  }
}

/** Live view of a session in the terminal. Detaching never stops the agent. */
export async function attach(client: DaemonClient, sessionId: string) {
  const { session, messages } = await client.call('sessions.get', { id: sessionId, limit: 40 });
  let current = session;
  console.log(`\n${c.brand(c.bold(current.title || t('sessions.untitled')))}  ${c.gray(`${AGENT[current.agent]} · ${current.cwd}`)}`);
  console.log(c.dim(t('cli.attachHint')));
  for (const m of messages) {
    const line = render(m);
    if (line) console.log(line);
  }

  const printed = new Set(messages.filter((m) => render(m) !== null).map((m) => m.id));
  const pendingPermissions: Message[] = messages.filter((m) => m.permission?.status === 'pending');
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: `${c.brand('›')} ` });
  let spinner: ReturnType<typeof setInterval> | null = null;

  const setSpinner = (on: boolean) => {
    if (on && !spinner && process.stdout.isTTY) {
      const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      let i = 0;
      spinner = setInterval(() => {
        process.stdout.write(`\r${c.cyan(frames[i++ % frames.length]!)} ${c.dim(t('chat.working'))}   `);
      }, 90);
    } else if (!on && spinner) {
      clearInterval(spinner);
      spinner = null;
      process.stdout.write('\r\x1b[2K');
    }
  };

  const println = (text: string) => {
    const wasSpinning = !!spinner;
    setSpinner(false);
    process.stdout.write('\r\x1b[2K');
    console.log(text);
    if (wasSpinning || current.status === 'running') setSpinner(true);
    else rl.prompt(true);
  };

  const askPermission = () => {
    const next = pendingPermissions[0];
    if (!next?.permission) return;
    setSpinner(false);
    const p = next.permission;
    console.log(`\n${c.yellow('⚑')} ${c.bold(t('chat.permissionTitle', { agent: AGENT[current.agent], tool: p.tool }))}`);
    console.log(c.gray(indent(p.detail.split('\n').slice(0, 20).join('\n'), '  │ ')));
    rl.setPrompt(`${c.yellow(t('cli.permissionPrompt'))} `);
    rl.prompt();
  };

  const onMessage = (m: Message) => {
    if (m.sessionId !== sessionId) return;
    if (m.permission?.status === 'pending' && !pendingPermissions.some((x) => x.id === m.id)) {
      pendingPermissions.push(m);
      askPermission();
      return;
    }
    if (m.permission && m.permission.status !== 'pending') {
      const idx = pendingPermissions.findIndex((x) => x.id === m.id);
      if (idx >= 0) pendingPermissions.splice(idx, 1);
      rl.setPrompt(`${c.brand('›')} `);
      if (pendingPermissions.length) askPermission();
    }
    if (printed.has(m.id)) return;
    const line = render(m);
    if (line === null) return;
    printed.add(m.id);
    println(line);
  };

  const off = client.on((event, data) => {
    if (event === 'message.append' || event === 'message.update') onMessage(data as Message);
    if (event === 'session.upsert' && (data as Session).id === sessionId) {
      current = data as Session;
      setSpinner(current.status === 'running' && pendingPermissions.length === 0);
      if (current.status !== 'running' && !pendingPermissions.length) rl.prompt(true);
    }
    if (event === 'session.removed' && (data as { id: string }).id === sessionId) {
      console.log(c.gray('\nsession deleted'));
      process.exit(0);
    }
  });

  if (pendingPermissions.length) askPermission();
  else if (current.status === 'running') setSpinner(true);
  else rl.prompt();

  await new Promise<void>((resolve) => {
    rl.on('line', async (input) => {
      const text = input.trim();
      if (pendingPermissions.length) {
        const p = pendingPermissions[0]!.permission!;
        const answer = text.toLowerCase();
        const decision = answer.startsWith('a') ? 'allow_session' : /^(y|s)/.test(answer) ? 'allow' : answer.startsWith('n') ? 'deny' : null;
        if (!decision) return askPermission();
        await client.call('permissions.respond', { sessionId, requestId: p.requestId, decision }).catch((e: Error) => println(c.red(e.message)));
        return;
      }
      if (!text) return rl.prompt();
      if (text === '/exit' || text === '/quit') return resolve();
      if (text === '/stop') {
        await client.call('sessions.interrupt', { id: sessionId }).catch(() => {});
        return;
      }
      if (text.startsWith('/mode')) {
        const mode = text.split(/\s+/)[1] as PermissionMode;
        if (PERMISSION_MODES.includes(mode)) {
          await client.call('sessions.setMode', { id: sessionId, mode });
          println(c.gray(`  ${t(`mode.${mode}`)} · ${t(`mode.${mode}.hint`)}`));
        } else println(c.gray(`  ${PERMISSION_MODES.join(' | ')}`));
        return;
      }
      setSpinner(true);
      await client.call('sessions.send', { id: sessionId, text }).catch((e: Error) => println(c.red(e.message)));
    });
    rl.on('close', () => resolve());
  });

  off();
  setSpinner(false);
  rl.close();
}

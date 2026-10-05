#!/usr/bin/env bun
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';

import { encodePairing } from '@reilai/crypto';
import { relativeTime } from '@reilai/i18n';
import { type AgentKind, PERMISSION_MODES, type PermissionMode } from '@reilai/protocol';
import qrcode from 'qrcode-terminal';

import { readDaemonState, readServiceState, VERSION } from './config';
import { attach, sessionLine } from './cli/attach';
import { daemonClient, SERVICES, type ServiceName, startDaemon, startService, stopDaemon, stopService } from './cli/services';
import { banner, c, currentLanguage, fail, ok, setLanguage, t } from './cli/ui';

/** `--name value` / `--flag` pairs, removed from the positional arguments. */
const BOOLEAN_FLAGS = new Set(['archived', 'attach', 'help', 'version']);
const flags = new Map<string, string>();
const argv: string[] = [];
{
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i]!;
    if (arg.startsWith('--') && arg.length > 2) {
      const next = raw[i + 1];
      if (next !== undefined && !next.startsWith('--') && !BOOLEAN_FLAGS.has(arg.slice(2))) {
        flags.set(arg.slice(2), next);
        i++;
      } else flags.set(arg.slice(2), 'true');
    } else argv.push(arg);
  }
}

function flag(name: string): string | undefined {
  return flags.get(name);
}

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const addr of list ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) out.push(addr.address);
    }
  }
  // Tailscale (100.64.0.0/10) first: it works from anywhere, not just the LAN.
  return out.sort((a, b) => Number(b.startsWith('100.')) - Number(a.startsWith('100.')));
}

async function syncLanguage() {
  if (!readDaemonState()) return;
  try {
    const client = await daemonClient(false);
    setLanguage((await client.call('settings.get')).language);
    client.close();
  } catch {
    // keep the system language
  }
}

function help() {
  console.log(`${banner()}  ${c.dim(`v${VERSION}`)}

${c.bold(t('cli.usage'))}
  ${c.brand('reilai claude')} ${c.dim('[prompt]')}          start Claude Code here and follow it live
  ${c.brand('reilai codex')} ${c.dim('[prompt]')}           start Codex here and follow it live
  ${c.brand('reilai ls')} ${c.dim('[--archived]')}          list sessions
  ${c.brand('reilai attach')} ${c.dim('<id>')}             follow and drive a session
  ${c.brand('reilai send')} ${c.dim('<id> <text>')}        send a message without attaching
  ${c.brand('reilai new')} ${c.dim('<agent> [--cwd dir] [--mode ask|edits|plan|yolo] [prompt]')}
  ${c.brand('reilai rm')} ${c.dim('<id>')}                 delete a session

  ${c.brand('reilai up')} / ${c.brand('down')}              daemon + web + tunnel
  ${c.brand('reilai start')} / ${c.brand('stop')} / ${c.brand('status')}   the daemon only
  ${c.brand('reilai web')} ${c.dim('[start|stop] [--port 7420]')}      browser / PWA service
  ${c.brand('reilai tunnel')} ${c.dim('[start|stop] [--port 7430] [--relay wss://…]')}  encrypted tunnel for the app
  ${c.brand('reilai relay')} ${c.dim('[start|stop] [--port 7440]')}    blind relay (run on a public host)
  ${c.brand('reilai pair')}                       pair the mobile app (QR code)
  ${c.brand('reilai devices')} ${c.dim('[revoke <id>]')}      paired devices
  ${c.brand('reilai lang')} ${c.dim('[en|pt|system]')}        language for every client
`);
}

async function status() {
  const daemon = readDaemonState();
  const line = (label: string, on: boolean, extra: string) =>
    console.log(`  ${on ? c.green('●') : c.gray('○')} ${label.padEnd(8)} ${on ? extra : c.dim('stopped')}`);
  console.log(banner());
  line('daemon', !!daemon, daemon ? `pid ${daemon.pid} · 127.0.0.1:${daemon.port} · v${daemon.version}` : '');
  for (const name of Object.keys(SERVICES) as ServiceName[]) {
    const s = readServiceState(name);
    line(name, !!s, s ? `pid ${s.pid} · port ${s.port}` : '');
  }
}

async function service(name: ServiceName, action: string) {
  const label = SERVICES[name].label;
  if (action === 'stop') {
    (await stopService(name)) ? ok(t('cli.serviceStopped', { service: label })) : console.log(t('cli.serviceNotRunning', { service: label }));
    return;
  }
  if (action === 'status') {
    const s = readServiceState(name);
    console.log(s ? `${label}: pid ${s.pid} · port ${s.port}` : t('cli.serviceNotRunning', { service: label }));
    return;
  }
  if (name !== 'relay') await startDaemon();
  const args: string[] = [];
  const port = flag('port');
  if (port) args.push('--port', port);
  const relay = flag('relay');
  if (relay && name === 'tunnel') args.push('--relay', relay);
  const { state, already } = await startService(name, args);
  console.log(
    `${c.green('✔')} ${t(already ? 'cli.serviceAlready' : 'cli.serviceStarted', { service: label, pid: state.pid, port: state.port })}`,
  );
  if (name === 'web' && state.token) printWebAccess(state.port, state.token);
}

function printWebAccess(port: number, token: string) {
  console.log(`\n  ${t('cli.webOpen')}`);
  console.log(`    ${c.brand(`http://localhost:${port}/#token=${token}`)}`);
  for (const ip of lanAddresses()) console.log(`    ${c.brand(`http://${ip}:${port}/#token=${token}`)}`);
  console.log(`\n  ${t('cli.webToken')} ${c.bold(token)}\n`);
}

async function pair() {
  await startDaemon();
  const { state } = await startService('tunnel');
  const client = await daemonClient();
  const pairing = await client.call('pairing.create');
  const tunnelState = state as typeof state & { relayUrl?: string; machineId?: string };
  const urls = lanAddresses().map((ip) => `ws://${ip}:${state.port}/tunnel`);
  if (tunnelState.relayUrl && tunnelState.machineId) urls.push(`${tunnelState.relayUrl}/c/${tunnelState.machineId}`);
  const link = encodePairing({ k: pairing.machineKey, t: pairing.token, u: urls, n: pairing.machineName });
  console.log(`\n${banner()}\n\n${t('cli.pairScan')}\n`);
  qrcode.generate(link, { small: true }, (code) => console.log(code));
  console.log(`${c.dim(link)}\n`);
  console.log(c.dim(t('cli.pairExpires', { minutes: Math.round((pairing.expiresAt - Date.now()) / 60000) })));
  process.stdout.write(`${c.cyan('…')} ${t('cli.pairWaiting')}`);
  while (true) {
    await Bun.sleep(1000);
    const s = await client.call('pairing.status', { token: pairing.token });
    if (s.device) {
      process.stdout.write('\r\x1b[2K');
      ok(t('cli.pairDone', { name: s.device.name }));
      break;
    }
    if (s.expired) fail('pairing code expired');
  }
  client.close();
}

async function newSession(agent: AgentKind, words: string[], attachAfter: boolean) {
  const cwd = resolve(flag('cwd') ?? process.cwd());
  const modeFlag = flag('mode') as PermissionMode | undefined;
  const mode = modeFlag && PERMISSION_MODES.includes(modeFlag) ? modeFlag : 'ask';
  const prompt = words.join(' ').trim() || undefined;
  const client = await daemonClient();
  setLanguage((await client.call('settings.get')).language);
  const session = await client.call('sessions.create', { agent, cwd, prompt, mode, startedBy: 'cli' });
  ok(t('cli.sessionCreated', { id: session.id.slice(0, 8), cwd }));
  if (attachAfter) await attach(client, session.id);
  client.close();
}

async function resolveId(client: Awaited<ReturnType<typeof daemonClient>>, prefix: string | undefined) {
  if (!prefix) fail('missing session id');
  const all = [...(await client.call('sessions.list', {})), ...(await client.call('sessions.list', { archived: true }))];
  const match = all.filter((s) => s.id.startsWith(prefix));
  if (match.length !== 1) fail(match.length ? `ambiguous id ${prefix}` : `no session ${prefix}`);
  return match[0]!.id;
}

async function main() {
  const [cmd, ...rest] = argv;
  if (flags.has('version')) return console.log(VERSION);
  if (flags.has('help')) return help();
  if (cmd !== 'daemon') await syncLanguage();
  switch (cmd) {
    case undefined:
    case 'help':
    case '-h':
      help();
      return;
    case '-v':
      console.log(VERSION);
      return;
    case 'daemon': {
      const { runDaemon } = await import('./daemon/server');
      await runDaemon();
      return;
    }
    case 'start': {
      const r = await startDaemon();
      ok(t(r.already ? 'cli.daemonAlready' : 'cli.daemonStarted', { pid: r.pid, port: r.port }));
      return;
    }
    case 'stop':
      (await stopDaemon()) ? ok(t('cli.daemonStopped')) : console.log(t('cli.daemonNotRunning'));
      return;
    case 'status':
      await status();
      return;
    case 'up': {
      const r = await startDaemon();
      ok(t(r.already ? 'cli.daemonAlready' : 'cli.daemonStarted', { pid: r.pid, port: r.port }));
      await service('tunnel', 'start');
      await service('web', 'start');
      return;
    }
    case 'down':
      for (const name of ['web', 'tunnel'] as ServiceName[]) await service(name, 'stop');
      (await stopDaemon()) ? ok(t('cli.daemonStopped')) : console.log(t('cli.daemonNotRunning'));
      return;
    case 'web':
    case 'tunnel':
    case 'relay':
      await service(cmd, rest[0] ?? 'start');
      return;
    case 'pair':
      await pair();
      return;
    case 'devices': {
      const client = await daemonClient();
      if (rest[0] === 'revoke') {
        await client.call('devices.revoke', { id: rest[1] ?? fail('missing device id') });
        ok('revoked');
      } else {
        const devices = await client.call('devices.list');
        if (!devices.length) console.log(t('settings.devicesEmpty'));
        for (const d of devices) {
          const seen = d.lastSeenAt ? t('settings.lastSeen', { when: relativeTime(currentLanguage(), d.lastSeenAt) }) : t('settings.neverSeen');
          console.log(`  ${c.dim(d.id.slice(0, 8))}  ${c.bold(d.name.padEnd(24))} ${c.gray(seen)}`);
        }
      }
      client.close();
      return;
    }
    case 'lang': {
      const client = await daemonClient();
      const value = rest[0];
      if (value === 'en' || value === 'pt' || value === 'system') {
        const settings = await client.call('settings.set', { language: value });
        setLanguage(settings.language);
        ok(t('cli.languageSet', { lang: value }));
      } else console.log((await client.call('settings.get')).language);
      client.close();
      return;
    }
    case 'ls':
    case 'list': {
      const client = await daemonClient();
      const sessions = await client.call('sessions.list', { archived: flag('archived') === 'true' });
      if (!sessions.length) console.log(t('cli.noSessions'));
      for (const s of sessions) console.log(sessionLine(s));
      client.close();
      return;
    }
    case 'claude':
    case 'codex':
      await newSession(cmd, rest, true);
      return;
    case 'new': {
      const agent = rest[0];
      if (agent !== 'claude' && agent !== 'codex') fail('agent must be claude or codex');
      await newSession(agent, rest.slice(1), flag('attach') === 'true');
      return;
    }
    case 'attach': {
      const client = await daemonClient();
      await attach(client, await resolveId(client, rest[0]));
      client.close();
      return;
    }
    case 'send': {
      const client = await daemonClient();
      const id = await resolveId(client, rest[0]);
      await client.call('sessions.send', { id, text: rest.slice(1).join(' ') });
      ok('sent');
      client.close();
      return;
    }
    case 'rm': {
      const client = await daemonClient();
      await client.call('sessions.delete', { id: await resolveId(client, rest[0]) });
      ok('deleted');
      client.close();
      return;
    }
    default:
      fail(t('cli.unknownCommand', { cmd }));
  }
}

main().then(
  () => {
    if (argv[0] !== 'daemon') process.exit(0);
  },
  (e: Error) => fail(e.message),
);


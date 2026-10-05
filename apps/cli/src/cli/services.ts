import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { join } from 'node:path';

import { DaemonClient } from '@reilai/protocol/client';

import {
  daemonPort,
  ensureHome,
  isAlive,
  paths,
  REPO_ROOT,
  readDaemonState,
  readServiceState,
  removeFile,
  type ServiceState,
} from '../config';

/** Independent background processes. Each one can stop without touching the others. */
export const SERVICES = {
  web: { label: 'Web', script: join(REPO_ROOT, 'apps/web/src/server.ts') },
  tunnel: { label: 'Tunnel', script: join(REPO_ROOT, 'apps/tunnel/src/server.ts') },
  relay: { label: 'Relay', script: join(REPO_ROOT, 'apps/relay/src/server.ts') },
} as const;

export type ServiceName = keyof typeof SERVICES;

function spawnDetached(name: string, args: string[], env: Record<string, string> = {}) {
  ensureHome();
  const log = openSync(paths.log(name), 'a');
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, ...env },
  });
  child.unref();
  return child.pid ?? 0;
}

async function waitFor<T>(check: () => T | null, timeoutMs = 8000): Promise<T | null> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = check();
    if (value) return value;
    await Bun.sleep(100);
  }
  return null;
}

export async function startDaemon(): Promise<{ pid: number; port: number; already: boolean }> {
  const running = readDaemonState();
  if (running) return { pid: running.pid, port: running.port, already: true };
  spawnDetached('daemon', [join(REPO_ROOT, 'apps/cli/src/index.ts'), 'daemon']);
  const state = await waitFor(readDaemonState);
  if (!state) throw new Error(`The daemon did not start. See ${paths.log('daemon')}`);
  return { pid: state.pid, port: state.port, already: false };
}

async function stopPid(pid: number) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
  await waitFor(() => (isAlive(pid) ? null : true), 5000);
  if (isAlive(pid)) process.kill(pid, 'SIGKILL');
}

export async function stopDaemon(): Promise<boolean> {
  const state = readDaemonState();
  if (!state) return false;
  await stopPid(state.pid);
  removeFile(paths.daemon);
  return true;
}

export async function startService(
  name: ServiceName,
  args: string[] = [],
): Promise<{ state: ServiceState; already: boolean }> {
  const running = readServiceState(name);
  if (running) return { state: running, already: true };
  removeFile(paths.service(name));
  spawnDetached(name, [SERVICES[name].script, ...args]);
  const state = await waitFor(() => readServiceState(name));
  if (!state) throw new Error(`${SERVICES[name].label} did not start. See ${paths.log(name)}`);
  return { state, already: false };
}

export async function stopService(name: ServiceName): Promise<boolean> {
  const state = readServiceState(name);
  if (!state) return false;
  await stopPid(state.pid);
  removeFile(paths.service(name));
  return true;
}

/** Connects to the running daemon, starting it if needed. */
export async function daemonClient(autostart = true): Promise<DaemonClient> {
  let state = readDaemonState();
  if (!state && autostart) {
    await startDaemon();
    state = readDaemonState();
  }
  if (!state) throw new Error('daemon not running');
  const client = new DaemonClient(`ws://127.0.0.1:${state.port || daemonPort()}/rpc`, state.token);
  await client.connect();
  return client;
}

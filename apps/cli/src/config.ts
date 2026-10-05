import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join, resolve } from 'node:path';

import { generateKeyPair, type KeyPair, randomToken } from '@reilai/crypto';
import { DEFAULT_PORTS } from '@reilai/protocol';

import pkg from '../package.json' with { type: 'json' };

export const VERSION = pkg.version;

/** All local state lives here (override with REILAI_HOME). */
export const HOME = resolve(process.env.REILAI_HOME ?? join(homedir(), '.reilai'));

export const paths = {
  home: HOME,
  db: join(HOME, 'reilai.db'),
  daemon: join(HOME, 'daemon.json'),
  machineKey: join(HOME, 'machine.key.json'),
  logs: join(HOME, 'logs'),
  service: (name: string) => join(HOME, `${name}.json`),
  log: (name: string) => join(HOME, 'logs', `${name}.log`),
};

/** Repo root, used to locate sibling apps (web, tunnel, relay). */
export const REPO_ROOT = resolve(import.meta.dir, '../../..');

export function ensureHome() {
  mkdirSync(paths.logs, { recursive: true });
  try {
    chmodSync(HOME, 0o700);
  } catch {
    // not fatal on filesystems without permissions
  }
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function writeSecretJson(file: string, value: unknown) {
  ensureHome();
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export function removeFile(file: string) {
  rmSync(file, { force: true });
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Written by the daemon on start; every local client reads it to connect. */
export interface DaemonState {
  pid: number;
  port: number;
  token: string;
  version: string;
  startedAt: number;
}

export function readDaemonState(): DaemonState | null {
  const state = readJson<DaemonState>(paths.daemon);
  if (!state || !isAlive(state.pid)) return null;
  return state;
}

export interface ServiceState {
  pid: number;
  port: number;
  startedAt: number;
  /** web only: the access token for browsers */
  token?: string;
}

export function readServiceState(name: string): ServiceState | null {
  const state = readJson<ServiceState>(paths.service(name));
  if (!state || !isAlive(state.pid)) return null;
  return state;
}

export function daemonPort(): number {
  return Number(process.env.REILAI_DAEMON_PORT ?? DEFAULT_PORTS.daemon);
}

/** Long-term X25519 identity of this machine (the tunnel's static key). */
export function machineKey(): KeyPair {
  const existing = readJson<KeyPair>(paths.machineKey);
  if (existing?.publicKey && existing.privateKey) return existing;
  const created = generateKeyPair();
  writeSecretJson(paths.machineKey, created);
  return created;
}

export function machineName(): string {
  return process.env.REILAI_MACHINE_NAME ?? hostname();
}

/** Stable across daemon restarts, so the web service and the tunnel reconnect on their own. */
export function daemonToken(): string {
  const file = join(HOME, 'daemon-token');
  if (existsSync(file)) {
    const saved = readFileSync(file, 'utf8').trim();
    if (saved) return saved;
  }
  const token = randomToken(24);
  ensureHome();
  writeFileSync(file, token, { mode: 0o600 });
  return token;
}

export function newToken(): string {
  return randomToken(24);
}

export function fileExists(file: string) {
  return existsSync(file);
}

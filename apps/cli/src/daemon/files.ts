import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';

import { type FileContent, RpcError } from '@reilai/protocol';

const MAX_TEXT = 1024 * 1024;
const MAX_IMAGE = 12 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};

function resolvePath(path: string, cwd?: string): string {
  if (path === '~' || path.startsWith('~/')) return join(homedir(), path.slice(1));
  if (isAbsolute(path)) return resolve(path);
  return resolve(cwd ?? homedir(), path);
}

/** Heuristic: NUL bytes in the first chunk mean binary. */
function looksBinary(buf: Buffer) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** Opens a file for the viewer: text (capped), images as data URLs, anything else as metadata. */
export function readFile(path: string, cwd?: string): FileContent {
  const full = resolvePath(path.trim(), cwd);
  if (!existsSync(full)) throw new RpcError('not_found', `File not found: ${full}`);
  const st = statSync(full);
  if (!st.isFile()) throw new RpcError('bad_request', `Not a file: ${full}`);
  const name = basename(full);
  const image = IMAGE_TYPES[extname(full).toLowerCase()];
  if (image) {
    if (st.size > MAX_IMAGE) return { path: full, name, kind: 'binary', mime: image, size: st.size, content: '', truncated: true };
    const data = readFileSync(full);
    return { path: full, name, kind: 'image', mime: image, size: st.size, content: `data:${image};base64,${data.toString('base64')}`, truncated: false };
  }
  const len = Math.min(st.size, MAX_TEXT);
  const buf = Buffer.alloc(len);
  const fd = openSync(full, 'r');
  try {
    readSync(fd, buf, 0, len, 0);
  } finally {
    closeSync(fd);
  }
  if (looksBinary(buf)) return { path: full, name, kind: 'binary', mime: 'application/octet-stream', size: st.size, content: '', truncated: false };
  return { path: full, name, kind: 'text', mime: 'text/plain', size: st.size, content: buf.toString('utf8'), truncated: st.size > MAX_TEXT };
}

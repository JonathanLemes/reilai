import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';

import { type FileContent, type FileMatch, RpcError } from '@reilai/protocol';

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

// ---------------------------------------------------------------------------
// `@` mentions: project file index (cached per folder) + fuzzy ranking
// ---------------------------------------------------------------------------
const INDEX_TTL = 30_000;
const MAX_FILES = 50_000;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.turbo', 'target', '.venv', '__pycache__']);
const indexes = new Map<string, { at: number; entries: Promise<FileMatch[]> }>();

/** Lines of a command's stdout, or null when it fails or takes too long. */
async function run(cmd: string[], cwd: string): Promise<string[] | null> {
  if (!Bun.which(cmd[0]!)) return null;
  try {
    const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'ignore', stdin: 'ignore' });
    const timer = setTimeout(() => proc.kill(), 4000);
    const out = await new Response(proc.stdout).text();
    clearTimeout(timer);
    if ((await proc.exited) !== 0) return null;
    return out.split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

/** Plain walk for folders without git nor ripgrep (skips heavy and hidden folders). */
function walk(root: string): string[] {
  const out: string[] = [];
  const queue = [''];
  while (queue.length && out.length < MAX_FILES) {
    const rel = queue.shift()!;
    let names: string[];
    try {
      names = readdirSync(join(root, rel));
    } catch {
      continue;
    }
    for (const n of names) {
      if (n.startsWith('.') || SKIP_DIRS.has(n)) continue;
      const path = rel ? `${rel}/${n}` : n;
      try {
        const st = statSync(join(root, path));
        if (st.isDirectory()) {
          if (path.split('/').length < 8) queue.push(path);
        } else if (st.isFile()) out.push(path);
      } catch {
        // unreadable entry
      }
    }
  }
  return out;
}

async function buildIndex(cwd: string): Promise<FileMatch[]> {
  // git honors .gitignore; outside a repo, heavy folders are skipped by name
  const files =
    (await run(['git', 'ls-files', '-co', '--exclude-standard'], cwd)) ??
    (await run(['rg', '--files', '--follow', ...[...SKIP_DIRS].flatMap((d) => ['-g', `!${d}`])], cwd)) ??
    walk(cwd);
  const dirs = new Set<string>();
  for (const f of files.slice(0, MAX_FILES)) {
    let i = f.lastIndexOf('/');
    while (i > 0) {
      const d = f.slice(0, i);
      if (dirs.has(d)) break;
      dirs.add(d);
      i = d.lastIndexOf('/');
    }
  }
  return [
    ...[...dirs].map((d) => ({ path: `${d}/`, isDir: true })),
    ...files.slice(0, MAX_FILES).map((f) => ({ path: f, isDir: false })),
  ];
}

function projectIndex(cwd: string): Promise<FileMatch[]> {
  const hit = indexes.get(cwd);
  if (hit && Date.now() - hit.at < INDEX_TTL) return hit.entries;
  const entries = buildIndex(cwd);
  indexes.set(cwd, { at: Date.now(), entries });
  entries.catch(() => indexes.delete(cwd));
  return entries;
}

/** Higher is better; -1 = no match. Name hits beat path hits, prefixes beat substrings, then subsequences. */
export function scoreMatch(path: string, query: string): number {
  const p = path.toLowerCase();
  const trimmed = p.endsWith('/') ? p.slice(0, -1) : p;
  const name = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  const depth = trimmed.split('/').length;
  if (name === query) return 1000 - depth;
  if (name.startsWith(query)) return 900 - depth;
  if (name.includes(query)) return 800 - depth;
  if (p.startsWith(query)) return 700 - depth;
  if (p.includes(query)) return 600 - depth;
  // subsequence: reward consecutive characters
  let i = 0;
  let run = 0;
  let score = 0;
  for (const ch of p) {
    if (ch === query[i]) {
      run++;
      score += run;
      if (++i === query.length) return Math.min(500, 100 + score) - depth;
    } else run = 0;
  }
  return -1;
}

export async function searchFiles(cwd: string, query: string, limit = 40): Promise<FileMatch[]> {
  const root = resolvePath(cwd);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new RpcError('not_found', `Not a folder: ${root}`);
  const entries = await projectIndex(root);
  const q = query.trim().toLowerCase();
  const max = Math.max(1, Math.min(limit, 100));
  if (!q) {
    // nothing typed yet: the top level, folders first
    return entries
      .filter((e) => !e.path.slice(0, -1).includes('/'))
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.path.localeCompare(b.path))
      .slice(0, max);
  }
  const scored: { e: FileMatch; s: number }[] = [];
  for (const e of entries) {
    // `@src/` (a folder just picked) lists what is inside, not the folder again
    if (e.path.toLowerCase() === q) continue;
    const s = scoreMatch(e.path, q);
    if (s >= 0) scored.push({ e, s });
  }
  scored.sort((a, b) => b.s - a.s || a.e.path.length - b.e.path.length);
  return scored.slice(0, max).map((x) => x.e);
}

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readFile, scoreMatch, searchFiles } from './files';

describe('fs.read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reilai-files-'));
  writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'img.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(dir, 'bin.dat'), Buffer.from([1, 0, 2, 0]));

  test('reads text relative to the session folder', () => {
    const f = readFile('a.ts', dir);
    expect(f.kind).toBe('text');
    expect(f.content).toBe('export const a = 1;\n');
    expect(f.path).toBe(join(dir, 'a.ts'));
  });

  test('images come back as data URLs', () => {
    const f = readFile(join(dir, 'img.png'));
    expect(f.kind).toBe('image');
    expect(f.content.startsWith('data:image/png;base64,')).toBe(true);
  });

  test('binary files have no content', () => {
    expect(readFile('bin.dat', dir)).toMatchObject({ kind: 'binary', content: '' });
  });

  test('missing files and folders are errors', () => {
    expect(() => readFile('nope.txt', dir)).toThrow('File not found');
    expect(() => readFile(dir)).toThrow('Not a file');
  });
});

describe('fs.search', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reilai-search-'));
  mkdirSync(join(dir, 'src/screens'), { recursive: true });
  mkdirSync(join(dir, 'node_modules/pkg'), { recursive: true });
  writeFileSync(join(dir, 'README.md'), '');
  writeFileSync(join(dir, 'src/chat.ts'), '');
  writeFileSync(join(dir, 'src/screens/Chat.tsx'), '');
  writeFileSync(join(dir, 'node_modules/pkg/chat.js'), '');

  test('empty query lists the top level, folders first', async () => {
    expect(await searchFiles(dir, '')).toEqual([
      { path: 'src/', isDir: true },
      { path: 'README.md', isDir: false },
    ]);
  });

  test('ranks name matches first and skips node_modules', async () => {
    const paths = (await searchFiles(dir, 'chat')).map((m) => m.path);
    expect(paths).toEqual(['src/chat.ts', 'src/screens/Chat.tsx']);
    expect((await searchFiles(dir, 'screens')).map((m) => m.path)[0]).toBe('src/screens/');
    expect((await searchFiles(dir, 'src/')).map((m) => m.path)).toEqual(['src/chat.ts', 'src/screens/', 'src/screens/Chat.tsx']);
  });

  test('fuzzy subsequences match, unrelated text does not', () => {
    expect(scoreMatch('src/screens/Chat.tsx', 'scrchat')).toBeGreaterThan(0);
    expect(scoreMatch('src/screens/Chat.tsx', 'zzz')).toBe(-1);
  });
});

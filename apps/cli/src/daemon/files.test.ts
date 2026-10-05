import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readFile } from './files';

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

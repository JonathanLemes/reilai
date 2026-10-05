import { describe, expect, test } from 'bun:test';

import { parseInline, parseMarkdown } from './markdown-parse';

describe('markdown', () => {
  test('inline styles', () => {
    expect(parseInline('run `bun test` **now** and see [docs](https://x.dev) *ok*')).toEqual([
      { t: 'text', v: 'run ' },
      { t: 'code', v: 'bun test' },
      { t: 'text', v: ' ' },
      { t: 'bold', v: 'now' },
      { t: 'text', v: ' and see ' },
      { t: 'link', v: 'docs', href: 'https://x.dev' },
      { t: 'text', v: ' ' },
      { t: 'italic', v: 'ok' },
    ]);
  });

  test('snake_case is not italic', () => {
    expect(parseInline('use my_var_name here')).toEqual([{ t: 'text', v: 'use my_var_name here' }]);
  });

  test('blocks', () => {
    const blocks = parseMarkdown('# Title\n\nSome text\nwraps here.\n\n- one\n  - nested\n1. first\n\n```ts\nconst a = 1;\n```\n> quote\n---');
    expect(blocks.map((b) => b.t)).toEqual(['h', 'p', 'li', 'li', 'li', 'code', 'quote', 'hr']);
    expect(blocks[1]).toEqual({ t: 'p', inl: [{ t: 'text', v: 'Some text wraps here.' }] });
    expect(blocks[3]).toMatchObject({ t: 'li', depth: 1 });
    expect(blocks[4]).toMatchObject({ t: 'li', ordered: true, n: 1 });
    expect(blocks[5]).toEqual({ t: 'code', lang: 'ts', v: 'const a = 1;' });
  });

  test('wrapped list items continue the item', () => {
    const blocks = parseMarkdown('- first line\n  continues here\n- second\n\nAfter');
    expect(blocks).toEqual([
      { t: 'li', ordered: false, n: 0, depth: 0, inl: [{ t: 'text', v: 'first line continues here' }] },
      { t: 'li', ordered: false, n: 0, depth: 0, inl: [{ t: 'text', v: 'second' }] },
      { t: 'p', inl: [{ t: 'text', v: 'After' }] },
    ]);
  });

  test('unterminated fence keeps the rest as code (streaming)', () => {
    expect(parseMarkdown('```\nline1\nline2')).toEqual([{ t: 'code', lang: '', v: 'line1\nline2' }]);
  });
});

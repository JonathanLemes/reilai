import { describe, expect, test } from 'bun:test';

import { applyMention, findMention } from './mention-parse';

describe('mentions', () => {
  test('finds the @token under the cursor', () => {
    expect(findMention('look at @src/ch', 15)).toEqual({ start: 8, end: 15, query: 'src/ch' });
    expect(findMention('@', 1)).toEqual({ start: 0, end: 1, query: '' });
    expect(findMention('fix @app.ts now', 7)).toEqual({ start: 4, end: 11, query: 'ap' });
    expect(findMention('line\n@x', 7)).toEqual({ start: 5, end: 7, query: 'x' });
  });

  test('ignores e-mails, finished words and text without @', () => {
    expect(findMention('mail me@host.com', 16)).toBeNull();
    expect(findMention('@src/a.ts done', 14)).toBeNull();
    expect(findMention('plain text', 10)).toBeNull();
  });

  test('applies a file with a trailing space and a folder without', () => {
    const m = findMention('see @ch', 7)!;
    expect(applyMention('see @ch', m, 'src/chat.ts', false)).toEqual({ value: 'see @src/chat.ts ', cursor: 17 });
    expect(applyMention('see @ch', m, 'src/', true)).toEqual({ value: 'see @src/', cursor: 9 });
    const mid = findMention('see @ch and more', 7)!;
    expect(applyMention('see @ch and more', mid, 'a.ts', false)).toEqual({ value: 'see @a.ts and more', cursor: 10 });
  });
});

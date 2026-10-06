/** The `@token` being typed at the cursor: `query` is what follows the `@` up to the cursor. */
export interface ActiveMention {
  start: number;
  end: number;
  query: string;
}

const SPACE = /\s/;

/** Finds the `@` mention under the cursor. Only an `@` at the start or after whitespace counts (no e-mails). */
export function findMention(value: string, cursor: number): ActiveMention | null {
  const at = Math.max(0, Math.min(cursor, value.length));
  let i = at - 1;
  while (i >= 0 && !SPACE.test(value[i]!)) {
    if (value[i] === '@') {
      if (i > 0 && !SPACE.test(value[i - 1]!)) return null;
      let end = at;
      while (end < value.length && !SPACE.test(value[end]!)) end++;
      return { start: i, end, query: value.slice(i + 1, at) };
    }
    i--;
  }
  return null;
}

/** Replaces the mention with the picked path. Files get a trailing space; folders keep the mention open. */
export function applyMention(value: string, m: ActiveMention, path: string, isDir: boolean): { value: string; cursor: number } {
  const before = value.slice(0, m.start);
  const after = value.slice(m.end);
  const insert = `@${path}${isDir || after.startsWith(' ') ? '' : ' '}`;
  const cursor = before.length + insert.length + (!isDir && after.startsWith(' ') ? 1 : 0);
  return { value: before + insert + after, cursor };
}

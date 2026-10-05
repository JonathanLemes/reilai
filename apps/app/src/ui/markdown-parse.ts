/** Tiny markdown parser for agent replies: the subset agents actually use. */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold'; v: string }
  | { t: 'italic'; v: string }
  | { t: 'code'; v: string }
  | { t: 'link'; v: string; href: string };

export type Block =
  | { t: 'p'; inl: Inline[] }
  | { t: 'h'; level: 1 | 2 | 3; inl: Inline[] }
  | { t: 'li'; ordered: boolean; n: number; depth: number; inl: Inline[] }
  | { t: 'quote'; inl: Inline[] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'hr' };

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\[[^\]\n]+\]\([^)\s]+\))|(\*[^*\n]+\*)/g;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of src.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ t: 'text', v: src.slice(last, i) });
    const [whole, code, bold, link, italic] = m;
    if (code) out.push({ t: 'code', v: code.slice(1, -1) });
    else if (bold) out.push({ t: 'bold', v: bold.slice(2, -2) });
    else if (link) {
      const lm = link.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      out.push({ t: 'link', v: lm?.[1] ?? link, href: lm?.[2] ?? '' });
    } else if (italic) out.push({ t: 'italic', v: italic.slice(1, -1) });
    last = i + whole.length;
  }
  if (last < src.length) out.push({ t: 'text', v: src.slice(last) });
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  /** raw text of the list item still open, so wrapped lines continue it */
  let liRaw: string | null = null;
  const flush = () => {
    if (para.length) blocks.push({ t: 'p', inl: parseInline(para.join(' ')) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = line.match(/^\s*```\s*([\w+-]*)/);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) body.push(lines[i++]!);
      liRaw = null;
      blocks.push({ t: 'code', lang: fence[1] ?? '', v: body.join('\n') });
      continue;
    }
    if (!line.trim()) {
      flush();
      liRaw = null;
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      liRaw = null;
      blocks.push({ t: 'h', level: Math.min(h[1]!.length, 3) as 1 | 2 | 3, inl: parseInline(h[2]!) });
      continue;
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      flush();
      liRaw = null;
      blocks.push({ t: 'hr' });
      continue;
    }
    const li = line.match(/^(\s*)([-*+]|(\d+)[.)])\s+(.*)$/);
    if (li) {
      flush();
      liRaw = li[4]!;
      blocks.push({
        t: 'li',
        ordered: !!li[3],
        n: li[3] ? Number(li[3]) : 0,
        depth: Math.min(Math.floor(li[1]!.length / 2), 3),
        inl: parseInline(li[4]!),
      });
      continue;
    }
    const q = line.match(/^>\s?(.*)$/);
    if (q) {
      flush();
      liRaw = null;
      blocks.push({ t: 'quote', inl: parseInline(q[1]!) });
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (liRaw !== null && last?.t === 'li' && !para.length) {
      liRaw = `${liRaw} ${line.trim()}`;
      last.inl = parseInline(liRaw);
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks;
}

import { useMemo } from '@lynx-js/react';

import { copyText } from '../shared/host';
import { C } from '../shared/theme';
import { Icon } from './kit';
import { type Inline, parseMarkdown } from './markdown-parse';

/** Lynx text collapses leading spaces: keep code indentation with no-break spaces. */
export function preserveIndent(code: string) {
  return code.replace(/\t/g, '  ').replace(/^ +/gm, (m) => '\u00a0'.repeat(m.length));
}

/** Inline code that looks like a file path (`src/app.ts`, `README.md`) can be opened. */
export function looksLikePath(text: string) {
  return /^[\w.~@/-]+$/.test(text) && (/\.[A-Za-z0-9]{1,8}$/.test(text) || text.includes('/')) && !/^\d+(\.\d+)*$/.test(text) && !text.startsWith('-');
}

function Inlines({ items, onOpenPath }: { items: Inline[]; onOpenPath?: (path: string) => void }) {
  return (
    <>
      {items.map((it, i) => {
        switch (it.t) {
          case 'bold':
            return (
              <text key={i} style={{ fontWeight: '700' }}>
                {it.v}
              </text>
            );
          case 'italic':
            return (
              <text key={i} style={{ fontStyle: 'italic' }}>
                {it.v}
              </text>
            );
          case 'code':
            return onOpenPath && looksLikePath(it.v) ? (
              <text key={i} className="md-inline-code md-path hov" bindtap={() => onOpenPath(it.v)}>
                {it.v}
              </text>
            ) : (
              <text key={i} className="md-inline-code">
                {it.v}
              </text>
            );
          case 'link':
            return (
              <text key={i} className="md-link">
                {it.v}
              </text>
            );
          default:
            return <text key={i}>{it.v}</text>;
        }
      })}
    </>
  );
}

export function Markdown({ text, color, onOpenPath }: { text: string; color?: string; onOpenPath?: (path: string) => void }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const tint = color ? { color } : undefined;
  return (
    <view className="md">
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'p':
            return (
              <text key={i} className="t-body md-p" style={tint}>
                <Inlines items={b.inl} onOpenPath={onOpenPath} />
              </text>
            );
          case 'h':
            return (
              <text key={i} className={`md-h md-h${b.level}`} style={tint}>
                <Inlines items={b.inl} onOpenPath={onOpenPath} />
              </text>
            );
          case 'li':
            return (
              <view key={i} className="md-li" style={{ paddingLeft: `${b.depth * 16}px` }}>
                <text className="t-body md-bullet">{b.ordered ? `${b.n}.` : '•'}</text>
                <text className="t-body grow" style={tint}>
                  <Inlines items={b.inl} onOpenPath={onOpenPath} />
                </text>
              </view>
            );
          case 'quote':
            return (
              <view key={i} className="md-quote">
                <text className="t-body muted">
                  <Inlines items={b.inl} onOpenPath={onOpenPath} />
                </text>
              </view>
            );
          case 'code':
            return (
              <view key={i} className="md-code">
                <view className="md-code-head">
                  <text className="t-caption grow">{b.lang || 'code'}</text>
                  <view className="hov md-copy" bindtap={() => copyText(b.v)}>
                    <Icon name="copy" size={15} color={C['text-tertiary']} />
                  </view>
                </view>
                <scroll-view scroll-orientation="horizontal" className="md-code-body">
                  <text className="t-mono">{preserveIndent(b.v)}</text>
                </scroll-view>
              </view>
            );
          case 'hr':
            return <view key={i} className="md-hr" />;
        }
      })}
    </view>
  );
}

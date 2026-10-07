import { useEffect, useInitData, useMemo, useRef, useState } from '@lynx-js/react';
import { resolveLanguage, translator } from '@reilai/i18n';

import { copyText, haptic } from '../shared/host';
import { useSelectable } from '../shared/hooks';
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

/** Copy button that turns into a check for a moment, so the copy is visible. */
export function CopyButton({ text, size = 15, className = 'md-copy' }: { text: string; size?: number; className?: string }) {
  // language from the screen data: no settings request or listeners per code block
  const init = useInitData();
  const t = translator(init.lang ?? resolveLanguage(init.langPref ?? 'system', init.systemLocale));
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <view
      className={`hov ${className}${copied ? ' md-copy-done' : ''}`}
      reil-tip={copied ? t('common.copied') : t('common.copy')}
      bindtap={() => {
        copyText(text);
        haptic('light');
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1600);
      }}
    >
      <Icon name={copied ? 'checkLine' : 'copy'} size={size} color={copied ? C.success : C['text-tertiary']} />
      {copied && <text className="md-copy-label">{t('common.copied')}</text>}
    </view>
  );
}

export function Markdown({ text, color, onOpenPath }: { text: string; color?: string; onOpenPath?: (path: string) => void }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const sel = useSelectable();
  const tint = color ? { color } : undefined;
  return (
    <view className="md">
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'p':
            return (
              <text key={i} className="t-body md-p" style={tint} {...sel}>
                <Inlines items={b.inl} onOpenPath={onOpenPath} />
              </text>
            );
          case 'h':
            return (
              <text key={i} className={`md-h md-h${b.level}`} style={tint} {...sel}>
                <Inlines items={b.inl} onOpenPath={onOpenPath} />
              </text>
            );
          case 'li':
            return (
              <view key={i} className="md-li" style={{ paddingLeft: `${b.depth * 16}px` }}>
                <text className="t-body md-bullet">{b.ordered ? `${b.n}.` : '•'}</text>
                <text className="t-body grow" style={tint} {...sel}>
                  <Inlines items={b.inl} onOpenPath={onOpenPath} />
                </text>
              </view>
            );
          case 'quote':
            return (
              <view key={i} className="md-quote">
                <text className="t-body muted" {...sel}>
                  <Inlines items={b.inl} onOpenPath={onOpenPath} />
                </text>
              </view>
            );
          case 'code':
            return (
              <view key={i} className="md-code">
                <view className="md-code-head">
                  <text className="t-caption grow">{b.lang || 'code'}</text>
                  <CopyButton text={b.v} />
                </view>
                <scroll-view scroll-orientation="horizontal" className="md-code-body">
                  <text className="t-mono" {...sel}>
                    {preserveIndent(b.v)}
                  </text>
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

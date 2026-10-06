import { useEffect, useLynxGlobalEventListener, useRef, useState } from '@lynx-js/react';
import type { FileMatch } from '@reilai/protocol';

import { useLayout } from '../shared/hooks';
import { rpc } from '../shared/host';
import { C } from '../shared/theme';
import { Icon, Pressable } from './kit';
import { type ActiveMention, applyMention, findMention } from './mention-parse';
import './mentions.css';

const ROW_HEIGHT = 40;

type InputDetail = { value: string; selectionStart?: number; cursor?: number };

/**
 * `@` file mentions for a composer textarea (Happy style): typing `@` searches the
 * project files and folders, the suggestions float above the field. With a physical
 * keyboard the web shell forwards arrows, Enter, Tab and Esc while the panel is open
 * (`mention-open` on the textarea, see `apps/web/src/shell/lynx.ts`).
 */
export function useMentions({ inputId, cwd, onChange }: { inputId: string; cwd: string | undefined; onChange: (value: string) => void }) {
  // the touch keyboard already takes half the screen
  const visibleRows = useLayout().desktop ? 6 : 4;
  const [mention, setMention] = useState<ActiveMention | null>(null);
  const [items, setItems] = useState<FileMatch[]>([]);
  const [index, setIndex] = useState(0);
  const value = useRef('');
  const firstVisible = useRef(0);
  const request = useRef(0);

  const query = mention?.query ?? null;
  useEffect(() => {
    if (query === null || !cwd) {
      setItems([]);
      return;
    }
    const n = ++request.current;
    const timer = setTimeout(
      () => {
        rpc('fs.search', { cwd, query, limit: 40 })
          .then((list) => {
            if (n !== request.current) return;
            setItems(list);
            setIndex(0);
            firstVisible.current = 0;
            scrollList(0);
          })
          .catch(() => n === request.current && setItems([]));
      },
      query ? 90 : 0,
    );
    return () => clearTimeout(timer);
  }, [query, cwd]);

  const open = mention !== null && items.length > 0;

  const scrollList = (top: number) => {
    lynx
      .createSelectorQuery()
      .select(`#${inputId}-mentions`)
      .invoke({ method: 'scrollTo', params: { offset: top * ROW_HEIGHT, smooth: false } })
      .exec();
  };

  const highlight = (i: number) => {
    setIndex(i);
    if (i < firstVisible.current) firstVisible.current = i;
    else if (i >= firstVisible.current + visibleRows) firstVisible.current = i - visibleRows + 1;
    else return;
    scrollList(firstVisible.current);
  };

  const pick = (i: number) => {
    const item = items[i];
    if (!mention || !item) return;
    const next = applyMention(value.current, mention, item.path, item.isDir);
    value.current = next.value;
    lynx
      .createSelectorQuery()
      .select(`#${inputId}`)
      .invoke({ method: 'setValue', params: { value: next.value, index: next.cursor, cursor: next.cursor } })
      .exec();
    lynx.createSelectorQuery().select(`#${inputId}`).invoke({ method: 'focus' }).exec();
    onChange(next.value);
    // a folder keeps the mention open, listing what is inside it
    setMention(item.isDir ? findMention(next.value, next.cursor) : null);
  };

  useLynxGlobalEventListener('reil:key', (arg: unknown) => {
    const { key } = ((Array.isArray(arg) ? arg[0] : arg) ?? {}) as { key?: string };
    if (!open) return;
    if (key === 'ArrowDown') highlight((index + 1) % items.length);
    else if (key === 'ArrowUp') highlight((index - 1 + items.length) % items.length);
    else if (key === 'Enter' || key === 'Tab') pick(index);
    else if (key === 'Escape') setMention(null);
  });

  return {
    open,
    /** call from the textarea's `bindinput` */
    onInput(detail: InputDetail) {
      value.current = detail.value;
      const cursor = detail.selectionStart ?? detail.cursor ?? detail.value.length;
      setMention(findMention(detail.value, cursor));
    },
    close: () => setMention(null),
    /** after the composer is cleared from outside (sent) */
    reset() {
      value.current = '';
      setMention(null);
    },
    panel: open ? (
      <view className="mentions" keep-focus>
        <scroll-view
          id={`${inputId}-mentions`}
          scroll-orientation="vertical"
          style={{ height: `${Math.min(items.length, visibleRows) * ROW_HEIGHT}px` }}
        >
          {items.map((m, i) => {
            const path = m.isDir ? m.path.slice(0, -1) : m.path;
            const cut = path.lastIndexOf('/');
            return (
              <Pressable
                key={m.path}
                className={`mention-row${i === index ? ' mention-row-on' : ''}`}
                pressedClassName="mention-row-on"
                onTap={() => pick(i)}
              >
                <Icon name={m.isDir ? 'folder' : 'file'} size={16} color={m.isDir ? C.primary : C['text-secondary']} />
                <text className="t-callout bold" text-maxline="1" style={{ marginLeft: '10px', flexShrink: 0, maxWidth: '60%' }}>
                  {`${path.slice(cut + 1)}${m.isDir ? '/' : ''}`}
                </text>
                {cut > 0 && (
                  <text className="t-caption tertiary grow" text-maxline="1" style={{ marginLeft: '8px' }}>
                    {path.slice(0, cut)}
                  </text>
                )}
              </Pressable>
            );
          })}
        </scroll-view>
      </view>
    ) : null,
  };
}

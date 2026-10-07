import { useEffect, useRef } from '@lynx-js/react';

import { kvGet, kvSet } from './host';

/** Saving waits for a pause in typing: one host call per burst instead of one per key. */
const SAVE_DELAY_MS = 300;

/**
 * Unsent text of a composer, kept per conversation in the host key/value store, so
 * closing and reopening the screen (or switching sessions) picks up where it stopped.
 * `key` undefined means the field is not on screen yet: nothing is restored until it is.
 */
export function useDraft(key: string | undefined, inputId: string, onRestore: (text: string) => void) {
  const pending = useRef<{ key: string; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    if (p) kvSet(`draft:${p.key}`, p.text.trim() ? p.text : null);
  };

  useEffect(() => {
    if (!key) return;
    let alive = true;
    kvGet(`draft:${key}`).then((text) => {
      if (!alive) return;
      onRestore(text ?? '');
      // the field may hold another conversation's text: always replace it
      setTimeout(() => {
        if (alive) lynx.createSelectorQuery().select(`#${inputId}`).invoke({ method: 'setValue', params: { value: text ?? '' } }).exec();
      }, 30);
    });
    return () => {
      alive = false;
      flush();
    };
  }, [key]);

  return {
    save(text: string) {
      if (!key) return;
      pending.current = { key, text };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY_MS);
    },
    clear() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      pending.current = null;
      if (key) kvSet(`draft:${key}`, null);
    },
  };
}

import { useEffect, useInitData, useLynxGlobalEventListener, useState } from '@lynx-js/react';
import { type Language, type MessageKey, resolveLanguage, translator, type Vars } from '@reilai/i18n';
import type { ServerEventName, ServerEvents, Settings } from '@reilai/protocol';

import type { ConnectionState } from '../env';

type AnyEvent = { event: ServerEventName; data: unknown };

function first<T>(arg: unknown): T {
  return (Array.isArray(arg) ? arg[0] : arg) as T;
}

/** Daemon events relayed by the host (`reil:event`). */
export function useServerEvent(handler: <E extends ServerEventName>(event: E, data: ServerEvents[E]) => void) {
  useLynxGlobalEventListener('reil:event', (arg: unknown) => {
    const e = first<AnyEvent>(arg);
    if (e?.event) handler(e.event, e.data as never);
  });
}

/** Connection to the computer, as seen by the host. */
export function useConnection(): { state: ConnectionState; machine: string } {
  const init = useInitData();
  const [value, setValue] = useState({ state: init.connection ?? 'connecting', machine: init.machine ?? '' });
  useLynxGlobalEventListener('reil:connection', (arg: unknown) => {
    const next = first<{ state: ConnectionState; machine?: string }>(arg);
    if (next) setValue((v) => ({ state: next.state, machine: next.machine ?? v.machine }));
  });
  useEffect(() => {
    NativeModules.ReilHost?.connectionState?.((s) => setValue((v) => ({ state: s.state, machine: s.machine ?? v.machine })));
  }, []);
  return value;
}

/** Language follows the daemon setting (shared by every client) or the system. */
export function useLanguage(): { lang: Language; t: (key: MessageKey, vars?: Vars) => string } {
  const init = useInitData();
  const [lang, setLang] = useState<Language>(init.lang ?? resolveLanguage(init.langPref, init.systemLocale));
  useServerEvent((event, data) => {
    if (event === 'settings.changed') setLang(resolveLanguage((data as Settings).language, init.systemLocale));
  });
  useLynxGlobalEventListener('reil:lang', (arg: unknown) => {
    const next = first<{ lang: Language }>(arg);
    if (next?.lang) setLang(next.lang);
  });
  return { lang, t: translator(lang) };
}

export function useLayout() {
  const init = useInitData();
  return {
    desktop: init.layout === 'desktop',
    web: init.platform === 'web',
    safeTop: init.safeTop ?? 0,
    safeBottom: init.safeBottom ?? 0,
  };
}

/** Re-renders every `ms` (relative times). */
export function useTick(ms = 30_000) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

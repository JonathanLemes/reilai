import { iconMarkup, logoMarkup, PALETTES, type SolarIconName } from '@reilai/brand';
import { type Language, type MessageKey, translate } from '@reilai/i18n';
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useState } from 'react';

import type { Connection, ConnState } from './connection';
import { broadcast, currentLang, type Data, type Navigator, onLangChange, onThemeChange, themeState } from './lynx';
import { LynxView } from './LynxView';

type Tab = 'sessions' | 'new' | 'settings';
type StackItem = { key: number; screen: string; params: Data };

function useLayoutMode(): 'mobile' | 'desktop' {
  const query = '(min-width: 900px)';
  const [desktop, setDesktop] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setDesktop(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return desktop ? 'desktop' : 'mobile';
}

/**
 * Mobile keyboard: the app takes the visible height and the tab bar hides behind
 * the keyboard, so the focused field sits right above it (browser and PWA).
 * Uses the tallest height seen as reference, which works whether the browser
 * resizes the layout (interactive-widget=resizes-content) or only the visual viewport.
 */
function useKeyboardOpen(enabled: boolean) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!enabled || !vv) return;
    let tallest = vv.height;
    const update = () => {
      tallest = Math.max(tallest, vv.height);
      const isOpen = tallest - vv.height > 140;
      setOpen(isOpen);
      document.documentElement.style.setProperty('--app-height', `${Math.round(vv.height)}px`);
      if (isOpen && window.scrollY) window.scrollTo(0, 0);
    };
    const reset = () => {
      tallest = 0;
      setTimeout(update, 300);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    window.addEventListener('orientationchange', reset);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      window.removeEventListener('orientationchange', reset);
      document.documentElement.style.removeProperty('--app-height');
    };
  }, [enabled]);
  return open;
}

const SIDEBAR_KEY = 'reilai:sidebar-width';
const SIDEBAR_MIN = 280;
const SIDEBAR_MAX = 560;
/** Room the conversation always keeps next to the sidebar (rail included). */
const MAIN_MIN = 460 + 68;

function clampSidebar(width: number) {
  const max = Math.min(SIDEBAR_MAX, window.innerWidth - MAIN_MIN);
  return Math.round(Math.max(SIDEBAR_MIN, Math.min(max, width)));
}

/** Desktop sidebar width: dragged by the divider, remembered on this device. */
function useSidebarWidth() {
  const [width, setWidth] = useState(() => {
    let saved = Number.NaN;
    try {
      saved = Number(localStorage.getItem(SIDEBAR_KEY));
    } catch {
      // private mode: default width
    }
    return clampSidebar(Number.isFinite(saved) && saved > 0 ? saved : 360);
  });
  useEffect(() => {
    const onResize = () => setWidth((w) => clampSidebar(w));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const save = useCallback((w: number) => {
    try {
      localStorage.setItem(SIDEBAR_KEY, String(w));
    } catch {
      // not persisted
    }
  }, []);
  return [width, setWidth, save] as const;
}

function Resizer({ width, onChange, onDone }: { width: number; onChange: (w: number) => void; onDone: (w: number) => void }) {
  const [dragging, setDragging] = useState(false);
  const start = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    let last = width;
    setDragging(true);
    document.body.classList.add('resizing');
    const move = (ev: PointerEvent) => {
      last = clampSidebar(width + ev.clientX - x0);
      onChange(last);
    };
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      setDragging(false);
      document.body.classList.remove('resizing');
      onDone(last);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };
  const reset = () => {
    const w = clampSidebar(360);
    onChange(w);
    onDone(w);
  };
  return (
    <div
      className={`resizer${dragging ? ' on' : ''}`}
      role="separator"
      aria-orientation="vertical"
      onPointerDown={start}
      onDoubleClick={reset}
    />
  );
}

function useLang(): Language {
  const [lang, setLang] = useState(currentLang());
  useEffect(() => onLangChange(setLang), []);
  return lang;
}

function useThemeTick() {
  const [, setN] = useState(0);
  useEffect(() => onThemeChange(() => setN((n) => n + 1)), []);
}

export function Svg({ markup, size, className }: { markup: string; size: number; className?: string }) {
  return <span className={className ?? 'svg'} style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: markup }} />;
}

function color(name: keyof (typeof PALETTES)['light']) {
  return PALETTES[themeState().effective][name];
}

function TabIcon({ name, active }: { name: SolarIconName; active: boolean }) {
  return <Svg markup={iconMarkup(name, active ? color('primary') : color('text-tertiary'))} size={24} />;
}

function initialRoute(): { selected: string | null; tab: Tab } {
  const m = location.pathname.match(/^\/s\/([\w-]+)/);
  if (m) return { selected: m[1]!, tab: 'sessions' };
  if (location.pathname.startsWith('/settings')) return { selected: null, tab: 'settings' };
  return { selected: null, tab: 'sessions' };
}

export function App({ conn, onLogout }: { conn: Connection; onLogout: () => void }) {
  const layout = useLayoutMode();
  const keyboardOpen = useKeyboardOpen(layout === 'mobile');
  const lang = useLang();
  useThemeTick();
  const t = (key: MessageKey) => translate(lang, key);
  const route = useMemo(initialRoute, []);
  const [tab, setTab] = useState<Tab>(route.tab);
  const [selected, setSelected] = useState<string | null>(route.selected);
  const [stack, setStack] = useState<StackItem[]>(route.selected ? [{ key: 1, screen: 'chat', params: { id: route.selected } }] : []);
  const [modal, setModal] = useState<{ screen: string; params: Data; wide?: boolean } | null>(null);
  const [state, setState] = useState<ConnState>(conn.state);
  const [keySeq, setKeySeq] = useState(10);
  const [sidebarWidth, setSidebarWidth, saveSidebarWidth] = useSidebarWidth();

  useEffect(() => conn.onState(setState), [conn]);

  const go = useCallback((path: string) => {
    if (location.pathname !== path) history.pushState(null, '', path);
  }, []);

  useEffect(() => {
    const onPop = () => {
      const r = initialRoute();
      setSelected(r.selected);
      if (r.tab === 'settings') setTab('settings');
      setStack((s) => (r.selected ? s : []));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const nav: Navigator = {
    push(screen, params) {
      if (screen === 'chat') {
        const id = String(params.id ?? '');
        setSelected(id);
        broadcast('reil:selected', { id });
        go(`/s/${id}`);
        if (layout === 'desktop') {
          setTab('sessions');
          return;
        }
      }
      if (layout === 'mobile') {
        setKeySeq((k) => k + 1);
        setStack((s) => [...s, { key: keySeq + 1, screen, params }]);
      } else {
        // desktop: secondary screens (file viewer…) open over the conversation
        setModal({ screen, params, wide: true });
      }
    },
    pop() {
      if (modal) {
        setModal(null);
        return;
      }
      const top = stack[stack.length - 1];
      setStack((s) => s.slice(0, -1));
      if (!top || top.screen === 'chat') {
        setSelected(null);
        broadcast('reil:selected', { id: '' });
        go('/');
      }
    },
    present(screen, params) {
      setModal({ screen, params });
    },
    dismiss() {
      setModal(null);
    },
    selectTab(next) {
      if (next === 'new' && layout === 'desktop') return setModal({ screen: 'new', params: {} });
      setTab(next as Tab);
      if (layout === 'mobile') setStack([]);
      go(next === 'settings' ? '/settings' : '/');
    },
    logout: onLogout,
  };

  const connDot = (
    <span className={`conn-dot conn-${state}`} title={state === 'connected' ? t('conn.connected') : t('conn.offline')} />
  );

  const modalView = modal && (
    <div className="modal-scrim" onClick={() => setModal(null)}>
      <div className={`modal modal-${layout}${modal.wide ? ' modal-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <LynxView screen={modal.screen} data={modal.params} layout={layout} nav={nav} />
      </div>
    </div>
  );

  if (layout === 'desktop') {
    return (
      <div className="desk">
        <nav className="rail">
          <div className="rail-logo">
            <Svg markup={logoMarkup(color('primary'))} size={28} />
          </div>
          <button type="button" className={`rail-btn${tab === 'sessions' ? ' on' : ''}`} title={t('tab.sessions')} onClick={() => nav.selectTab('sessions')}>
            <TabIcon name="sessions" active={tab === 'sessions'} />
          </button>
          <button type="button" className="rail-btn" title={t('tab.new')} onClick={() => setModal({ screen: 'new', params: {} })}>
            <TabIcon name="add" active={false} />
          </button>
          <button type="button" className={`rail-btn${tab === 'settings' ? ' on' : ''}`} title={t('tab.settings')} onClick={() => nav.selectTab('settings')}>
            <TabIcon name="settings" active={tab === 'settings'} />
          </button>
          <div className="grow" />
          {connDot}
        </nav>
        <aside className="sidebar" style={{ width: sidebarWidth }}>
          <LynxView screen="sessions" data={{ embedded: true, selectedId: selected ?? '' }} layout={layout} nav={nav} />
          <Resizer width={sidebarWidth} onChange={setSidebarWidth} onDone={saveSidebarWidth} />
        </aside>
        <main className="main">
          {tab === 'settings' ? (
            <LynxView screen="settings" data={{}} layout={layout} nav={nav} />
          ) : selected ? (
            <LynxView screen="chat" data={{ id: selected }} layout={layout} nav={nav} />
          ) : (
            <div className="placeholder">
              <div className="placeholder-art">
                <Svg markup={logoMarkup(color('primary'))} size={46} />
              </div>
              <h2>{t('chat.select')}</h2>
              <p>{t('chat.selectBody')}</p>
              <button type="button" className="primary-btn" onClick={() => setModal({ screen: 'new', params: {} })}>
                {t('sessions.start')}
              </button>
            </div>
          )}
        </main>
        {modalView}
      </div>
    );
  }

  const tabs: { id: Tab; icon: SolarIconName; label: MessageKey }[] = [
    { id: 'sessions', icon: 'sessions', label: 'tab.sessions' },
    { id: 'new', icon: 'add', label: 'tab.new' },
    { id: 'settings', icon: 'settings', label: 'tab.settings' },
  ];

  return (
    <div className="mob">
      <div className="mob-content">
        {tabs.map((tb) => (
          <div key={tb.id} className="mob-tab" style={{ display: tab === tb.id ? 'block' : 'none' }}>
            <LynxView screen={tb.id} data={tb.id === 'new' ? { asTab: true } : {}} layout={layout} nav={nav} />
          </div>
        ))}
        {stack.map((item) => (
          <div key={item.key} className="mob-stack">
            <LynxView screen={item.screen} data={item.params} layout={layout} nav={nav} />
          </div>
        ))}
      </div>
      {!stack.length && !keyboardOpen && (
        <nav className="tabbar">
          {tabs.map((tb) => (
            <button key={tb.id} type="button" className={`tab${tab === tb.id ? ' on' : ''}`} onClick={() => nav.selectTab(tb.id)}>
              <TabIcon name={tb.icon} active={tab === tb.id} />
              <span>{t(tb.label)}</span>
            </button>
          ))}
        </nav>
      )}
      {modalView}
    </div>
  );
}

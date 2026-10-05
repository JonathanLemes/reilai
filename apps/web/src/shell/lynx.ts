import '@lynx-js/web-core/client';
import type { LynxViewElement } from '@lynx-js/web-core/client';
import { type Mode, PALETTES, type ThemePref } from '@reilai/brand';
import { type Language, type LanguagePref, resolveLanguage } from '@reilai/i18n';
import type { RpcMethod } from '@reilai/protocol';

import type { Connection } from './connection';

export type Data = Record<string, unknown>;

/** Navigation implemented by the shell layout (desktop or mobile). */
export interface Navigator {
  push(screen: string, params: Data): void;
  pop(): void;
  present(screen: string, params: Data): void;
  dismiss(): void;
  selectTab(tab: string): void;
  logout(): void;
}

// ---------------------------------------------------------------------------
// Theme (per browser) and language (shared setting from the daemon)
// ---------------------------------------------------------------------------
const THEME_KEY = 'reilai:theme';
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function loadThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

let themePref = loadThemePref();
let langPref: LanguagePref = 'system';

export function themeState(): { pref: ThemePref; effective: Mode } {
  const effective = themePref === 'system' ? (systemDark.matches ? 'dark' : 'light') : themePref;
  return { pref: themePref, effective };
}

export function currentLang(): Language {
  return resolveLanguage(langPref, navigator.language);
}

const themeListeners = new Set<() => void>();
export function onThemeChange(l: () => void) {
  themeListeners.add(l);
  return () => {
    themeListeners.delete(l);
  };
}

export function applyShellTheme() {
  const { effective } = themeState();
  const palette = PALETTES[effective];
  for (const [name, value] of Object.entries(palette)) document.documentElement.style.setProperty(`--${name}`, value);
  document.documentElement.style.colorScheme = effective;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette.bg);
  for (const l of themeListeners) l();
}

function setThemePref(pref: ThemePref) {
  themePref = pref;
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    // session only
  }
  applyShellTheme();
  broadcast('reil:theme', themeState());
}

systemDark.addEventListener('change', () => {
  if (themePref !== 'system') return;
  applyShellTheme();
  broadcast('reil:theme', themeState());
});

const langListeners = new Set<(l: Language) => void>();
export function onLangChange(l: (lang: Language) => void) {
  langListeners.add(l);
  return () => {
    langListeners.delete(l);
  };
}

export function setLangPref(pref: LanguagePref) {
  langPref = pref;
  for (const l of langListeners) l(currentLang());
}

// ---------------------------------------------------------------------------
// Views and the ReilHost native module
// ---------------------------------------------------------------------------
const allViews = new Set<LynxViewElement>();

export function broadcast(name: string, payload: unknown) {
  for (const v of allViews) {
    if (v.isConnected) v.sendGlobalEvent(name, [payload as never]);
    else allViews.delete(v);
  }
}

/** Per-browser key/value (drafts, last agent…). */
function kvGet(key: string): string | null {
  try {
    return localStorage.getItem(`reilai:kv:${key}`);
  } catch {
    return null;
  }
}

function kvSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(`reilai:kv:${key}`);
    else localStorage.setItem(`reilai:kv:${key}`, value);
  } catch {
    // ignore
  }
}

const REIL_HOST_URL = URL.createObjectURL(
  new Blob(
    [
      `export default (_nativeModules, call) => ({
        rpc(method, params, cb) { Promise.resolve(call('rpc', { method, params })).then((r) => cb(r)); },
        push(screen, params) { call('push', { screen, params }); },
        pop() { call('pop', {}); },
        present(screen, params) { call('present', { screen, params }); },
        dismiss() { call('dismiss', {}); },
        selectTab(tab) { call('selectTab', { tab }); },
        setTheme(pref) { call('setTheme', { pref }); },
        kvGet(key, cb) { Promise.resolve(call('kvGet', { key })).then((r) => cb(r ?? null)); },
        kvSet(key, value) { call('kvSet', { key, value }); },
        copyText(text) { call('copyText', { text }); },
        openURL(url) { call('openURL', { url }); },
        haptic(style) { call('haptic', { style }); },
        logout() { call('logout', {}); },
        connectionState(cb) { Promise.resolve(call('connectionState', {})).then((r) => cb(r)); },
      });`,
    ],
    { type: 'text/javascript' },
  ),
);

let connection: Connection | null = null;

export function attachConnection(conn: Connection) {
  connection = conn;
  conn.on((event, data) => {
    if (event === 'connection') {
      broadcast('reil:connection', { state: conn.state, machine: conn.machine });
      return;
    }
    if (event === 'settings.changed') setLangPref((data as { language: LanguagePref }).language);
    broadcast('reil:event', { event, data });
  });
  conn.onState((state) => broadcast('reil:connection', { state, machine: conn.machine }));
}

export function screenData(data: Data, layout: 'mobile' | 'desktop'): LynxViewElement['initData'] {
  return {
    ...data,
    platform: 'web',
    layout,
    safeTop: 0,
    safeBottom: 0,
    theme: themeState(),
    lang: currentLang(),
    langPref,
    systemLocale: navigator.language,
    connection: connection?.state ?? 'connecting',
    machine: connection?.machine ?? '',
    appVersion: `${process.env.REILAI_VERSION} (web)`,
  } as unknown as LynxViewElement['initData'];
}

function handleCall(name: string, data: Data, nav: Navigator | undefined): unknown {
  switch (name) {
    case 'rpc':
      if (!connection) return { ok: false, error: { code: 'offline', message: 'Not connected' } };
      return connection.rpc(data.method as RpcMethod, data.params ?? {});
    case 'kvGet':
      return kvGet(String(data.key));
    case 'kvSet':
      return kvSet(String(data.key), (data.value as string | null) ?? null);
    case 'setTheme':
      return setThemePref(data.pref as ThemePref);
    case 'copyText':
      return navigator.clipboard?.writeText(String(data.text)).catch(() => {});
    case 'openURL': {
      const url = String(data.url);
      if (/^https?:\/\//.test(url)) window.open(url, '_blank', 'noopener');
      return;
    }
    case 'haptic':
      return navigator.vibrate?.(10);
    case 'connectionState':
      return { state: connection?.state ?? 'connecting', machine: connection?.machine ?? '' };
    case 'push':
      return nav?.push(String(data.screen), (data.params as Data) ?? {});
    case 'pop':
      return nav?.pop();
    case 'present':
      return nav?.present(String(data.screen), (data.params as Data) ?? {});
    case 'dismiss':
      return nav?.dismiss();
    case 'selectTab':
      return nav?.selectTab(String(data.tab));
    case 'logout':
      return nav?.logout();
    default:
      return undefined;
  }
}

/** Mounts one Lynx screen (`<screen>.web.bundle`) in a container. */
export function createLynx(
  container: HTMLElement,
  screen: string,
  initData: Data,
  layout: 'mobile' | 'desktop',
  nav: () => Navigator | undefined,
) {
  const rect = container.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const view = document.createElement('lynx-view') as LynxViewElement;
  view.browserConfig = { pixelRatio: dpr, pixelWidth: Math.max(rect.width, 320) * dpr, pixelHeight: Math.max(rect.height, 480) * dpr };
  view.initData = screenData(initData, layout);
  view.nativeModulesMap = { ReilHost: REIL_HOST_URL };
  view.onNativeModulesCall = (name, data, moduleName) => {
    if (moduleName !== 'ReilHost') return undefined;
    return handleCall(name, (data ?? {}) as Data, nav());
  };
  view.url = `/bundles/${screen}.web.bundle`;
  container.append(view);
  allViews.add(view);
  return view;
}

export function updateLynx(view: LynxViewElement, data: Data, layout: 'mobile' | 'desktop') {
  view.updateData(screenData(data, layout));
}

export type { LynxViewElement };

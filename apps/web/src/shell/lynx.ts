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
  // screens created before the daemon answered still hold the old language
  broadcast('reil:lang', { lang: currentLang() });
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

/**
 * Code shown in the screens keeps its indentation with no-break spaces (Lynx text
 * collapses leading spaces): copying a selection turns them back into plain spaces.
 */
export function installCopyCleanup() {
  document.addEventListener('copy', (event) => {
    const text = document.getSelection()?.toString() ?? '';
    if (!text.includes('\u00a0') || !event.clipboardData) return;
    event.clipboardData.setData('text/plain', text.replace(/\u00a0/g, ' '));
    event.preventDefault();
  });
}

/**
 * Mouse affordances for the Lynx screens (Lynx CSS has no :hover nor cursor).
 * One rule per entry: each goes through `insertRule`, and a bad one blanks the screen.
 * Interactive elements carry the `hov` class (Pressable adds it); touch screens skip it.
 */
const POINTER_RULES = [
  '@media (hover: hover) and (pointer: fine) { .hov { cursor: pointer; transition: box-shadow 120ms ease; } .hov:hover { box-shadow: inset 0 0 0 999px var(--hover); } }',
  // x-textarea is display: contents; the real field is its `textarea` part (auto = its natural height)
  'x-textarea.composer-input-desk::part(textarea) { box-sizing: border-box; height: var(--composer-h, auto); }',
  '[resize-handle] { cursor: row-resize; }',
  '[resize-handle]:hover, [resize-handle][resizing] { background: linear-gradient(var(--primary), var(--primary)) center / 100% 3px no-repeat; opacity: 0.6; }',
];

// ---------------------------------------------------------------------------
// Composer height (desktop): dragged by the `resize-handle` edge, like the sidebar
// ---------------------------------------------------------------------------
const COMPOSER_KEY = 'reilai:composer-height';
const COMPOSER_MIN = 40;
/** room the conversation keeps above the composer */
const CHAT_MIN = 220;

/** null: the field's natural height */
function applyComposerHeight(height: number | null) {
  const root = document.documentElement.style;
  if (height === null) root.removeProperty('--composer-h');
  else root.setProperty('--composer-h', `${height}px`);
}

function savedComposerHeight(): number | null {
  try {
    const v = Number(localStorage.getItem(COMPOSER_KEY));
    return Number.isFinite(v) && v >= COMPOSER_MIN ? v : null;
  } catch {
    return null;
  }
}

applyComposerHeight(savedComposerHeight());

function saveComposerHeight(height: number | null) {
  try {
    if (height === null) localStorage.removeItem(COMPOSER_KEY);
    else localStorage.setItem(COMPOSER_KEY, String(height));
  } catch {
    // this tab only
  }
}

function resizeHandle(event: Event) {
  return event.composedPath().find((el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute('resize-handle'));
}

function startComposerResize(event: PointerEvent) {
  if (event.button !== 0) return;
  const handle = resizeHandle(event);
  // the field sits next to the handle, possibly behind Lynx wrappers: nearest ancestor that holds it
  let scope = handle?.parentElement ?? null;
  while (scope && !scope.querySelector('[resize-target]')) scope = scope.parentElement;
  const host = scope?.querySelector<HTMLElement>('[resize-target]');
  const field = host?.shadowRoot?.querySelector('textarea') ?? null;
  if (!handle || !field) return;
  event.preventDefault();
  event.stopPropagation();
  const view = event.currentTarget as HTMLElement;
  const y0 = event.clientY;
  const h0 = field.getBoundingClientRect().height;
  const max = Math.max(COMPOSER_MIN, view.getBoundingClientRect().height - CHAT_MIN);
  let last = h0;
  handle.setAttribute('resizing', '');
  document.body.classList.add('resizing-v');
  const move = (ev: PointerEvent) => {
    last = Math.round(Math.max(COMPOSER_MIN, Math.min(max, h0 + y0 - ev.clientY)));
    applyComposerHeight(last);
  };
  const end = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    handle.removeAttribute('resizing');
    document.body.classList.remove('resizing-v');
    saveComposerHeight(last);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

function resetComposerHeight(event: MouseEvent) {
  if (!resizeHandle(event)) return;
  applyComposerHeight(null);
  saveComposerHeight(null);
}

/**
 * Enter sends, Shift+Enter breaks the line, in textareas marked `enter-send` (composers).
 * Only with a physical keyboard: on touch screens Enter keeps inserting a new line.
 * The x-textarea form submit reaches the screen as `bindconfirm`.
 */
function enterToSend(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const target = event.composedPath()[0];
  if (!(target instanceof HTMLTextAreaElement)) return;
  const host = (target.getRootNode() as ShadowRoot).host;
  if (!host?.hasAttribute('enter-send')) return;
  event.preventDefault();
  target.form?.dispatchEvent(new SubmitEvent('submit'));
}

const MENTION_KEYS = new Set(['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape']);

/**
 * While a composer shows `@` suggestions (`mention-open="on"` on its textarea), the
 * navigation keys go to the screen as `reil:key` instead of moving the caret, sending
 * or leaving the field. Runs before `enterToSend`.
 */
function mentionKeys(event: KeyboardEvent) {
  if (!MENTION_KEYS.has(event.key) || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  const target = event.composedPath()[0];
  if (!(target instanceof HTMLTextAreaElement)) return;
  const host = (target.getRootNode() as ShadowRoot).host;
  if (host?.getAttribute('mention-open') !== 'on') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  (event.currentTarget as LynxViewElement).sendGlobalEvent('reil:key', [{ key: event.key } as never]);
}

/** Tapping a `keep-focus` element (the suggestion list) must not blur the field and close the keyboard. */
function keepFocus(event: MouseEvent) {
  if (event.composedPath().some((el) => el instanceof Element && el.hasAttribute('keep-focus'))) event.preventDefault();
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
  view.injectStyleRules = POINTER_RULES;
  view.onNativeModulesCall = (name, data, moduleName) => {
    if (moduleName !== 'ReilHost') return undefined;
    return handleCall(name, (data ?? {}) as Data, nav());
  };
  view.addEventListener('keydown', mentionKeys, true);
  view.addEventListener('keydown', enterToSend, true);
  view.addEventListener('mousedown', keepFocus, true);
  view.addEventListener('pointerdown', startComposerResize, true);
  view.addEventListener('dblclick', resetComposerHeight, true);
  view.url = `/bundles/${screen}.web.bundle`;
  container.append(view);
  allViews.add(view);
  return view;
}

export function updateLynx(view: LynxViewElement, data: Data, layout: 'mobile' | 'desktop') {
  view.updateData(screenData(data, layout));
}

export type { LynxViewElement };

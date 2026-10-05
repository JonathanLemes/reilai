import type { ThemePref } from '@reilai/brand';
import type { Language, LanguagePref } from '@reilai/i18n';

export type HostResult = { ok: true; result: unknown } | { ok: false; error: { code: string; message: string } };

export type ConnectionState = 'connected' | 'connecting' | 'offline';

declare module '@lynx-js/react' {
  interface InitData {
    /** host: 'web' (browser shell) or 'android' / 'ios' (native shells) */
    platform?: 'web' | 'android' | 'ios';
    layout?: 'mobile' | 'desktop';
    safeTop?: number;
    safeBottom?: number;
    theme?: { pref: ThemePref; effective: 'light' | 'dark' };
    /** language already resolved by the host, plus the raw preference and system locale */
    lang?: Language;
    langPref?: LanguagePref;
    systemLocale?: string;
    connection?: ConnectionState;
    machine?: string;
    appVersion?: string;
    /** screen params */
    id?: string;
    selectedId?: string;
    /** sessions list embedded in the desktop sidebar */
    embedded?: boolean;
    /** new session screen shown as a tab root instead of a modal */
    asTab?: boolean;
    /** pair screen: link from a deep link, or the last error */
    link?: string;
    /** file viewer: path (absolute or relative to cwd) */
    path?: string;
    cwd?: string;
    error?: string;
  }
}

declare module '@lynx-js/types' {
  interface NativeModules {
    ReilHost?: {
      rpc(method: string, params: Record<string, unknown>, callback: (result: HostResult) => void): void;
      push(screen: string, params: Record<string, unknown>): void;
      pop(): void;
      present(screen: string, params: Record<string, unknown>): void;
      dismiss(): void;
      selectTab?(tab: string): void;
      setTheme(pref: string): void;
      kvGet(key: string, callback: (value: string | null) => void): void;
      kvSet(key: string, value: string | null): void;
      copyText?(text: string): void;
      openURL?(url: string): void;
      haptic?(style: string): void;
      /** native only */
      pair?(link: string, callback: (result: { ok: boolean; error?: string }) => void): void;
      unpair?(): void;
      /** web only */
      logout?(): void;
      connectionState?(callback: (state: { state: ConnectionState; machine?: string }) => void): void;
    };
  }
}

export {};

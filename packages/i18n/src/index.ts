import { en } from './en';
import type { Dictionary, MessageKey } from './en';
import { pt } from './pt';

export type { Dictionary, MessageKey };
export type Language = 'en' | 'pt';
export type LanguagePref = Language | 'system';

export const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'pt', label: 'Português' },
];

const DICTIONARIES: Record<Language, Dictionary> = { en, pt };

/** Maps a locale tag ("pt-BR", "en_US.UTF-8") to a supported language. */
export function detectLanguage(locale: string | null | undefined): Language {
  return locale?.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

export function resolveLanguage(pref: LanguagePref | null | undefined, systemLocale?: string | null): Language {
  if (pref === 'en' || pref === 'pt') return pref;
  return detectLanguage(systemLocale);
}

export type Vars = Record<string, string | number>;

export function translate(lang: Language, key: MessageKey, vars?: Vars): string {
  const template = DICTIONARIES[lang][key] ?? en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** Binds a language: `const t = translator('pt'); t('tab.sessions')`. */
export function translator(lang: Language) {
  return (key: MessageKey, vars?: Vars) => translate(lang, key, vars);
}

/** Short relative time ("now", "5m", "3h", "2d"). */
export function relativeTime(lang: Language, time: number, now = Date.now()): string {
  const t = translator(lang);
  const minutes = Math.floor((now - time) / 60000);
  if (minutes < 1) return t('time.now');
  if (minutes < 60) return t('time.minutes', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hours', { n: hours });
  return t('time.days', { n: Math.floor(hours / 24) });
}

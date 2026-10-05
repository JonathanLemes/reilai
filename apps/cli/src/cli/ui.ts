import { type Language, type MessageKey, resolveLanguage, translate, type Vars } from '@reilai/i18n';
import type { LanguagePref } from '@reilai/protocol';

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (open: number, close: number) => (s: string) => (tty ? `\x1b[${open}m${s}\x1b[${close}m` : s);

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  italic: wrap(3, 23),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
  /** brand signal teal (truecolor) */
  brand: (s: string) => (tty ? `\x1b[38;2;45;212;191m${s}\x1b[39m` : s),
};

let lang: Language = resolveLanguage('system', process.env.LC_ALL || process.env.LANG);

export function setLanguage(pref: LanguagePref) {
  lang = resolveLanguage(pref, process.env.LC_ALL || process.env.LANG);
}

export function currentLanguage() {
  return lang;
}

export function t(key: MessageKey, vars?: Vars) {
  return translate(lang, key, vars);
}

export function fail(message: string): never {
  console.error(`${c.red('✖')} ${message}`);
  process.exit(1);
}

export function ok(message: string) {
  console.log(`${c.green('✔')} ${message}`);
}

export function banner() {
  return `${c.brand(c.bold('ReilAI'))} ${c.dim(t('app.tagline'))}`;
}

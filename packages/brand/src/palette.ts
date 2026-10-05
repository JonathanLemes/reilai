/**
 * ReilAI palette. Neutral, iOS-like surfaces with Happy's indigo as the accent
 * (Happy: primary #5e52a7 light, #c8bfff dark). Every screen, the web shell and
 * the Android host read colors from here; never hard-code a hex in a screen.
 */
export type Mode = 'light' | 'dark';

export interface Palette {
  bg: string;
  surface: string;
  'surface-2': string;
  'surface-pressed': string;
  /** Translucent tint laid over anything under the mouse (web). */
  hover: string;
  border: string;
  'border-strong': string;
  text: string;
  'text-secondary': string;
  'text-tertiary': string;
  'text-inverse': string;
  primary: string;
  'primary-pressed': string;
  'primary-soft': string;
  'on-primary': string;
  success: string;
  'success-soft': string;
  warning: string;
  'warning-soft': string;
  danger: string;
  'danger-soft': string;
  'code-bg': string;
  'user-bubble': string;
  'on-user-bubble': string;
  claude: string;
  codex: string;
  scrim: string;
}

export const PALETTES: Record<Mode, Palette> = {
  light: {
    bg: '#F5F5F8',
    surface: '#FFFFFF',
    'surface-2': '#F0F0F4',
    'surface-pressed': '#E9E9EF',
    hover: 'rgba(24, 23, 28, 0.05)',
    border: '#E7E7EC',
    'border-strong': '#D4D4DC',
    text: '#18171C',
    'text-secondary': '#6E6D78',
    'text-tertiary': '#A2A1AB',
    'text-inverse': '#FFFFFF',
    primary: '#5E52A7',
    'primary-pressed': '#4D4290',
    'primary-soft': '#ECE9FB',
    'on-primary': '#FFFFFF',
    success: '#2FB257',
    'success-soft': '#E3F6E8',
    warning: '#E58A00',
    'warning-soft': '#FFF1DC',
    danger: '#E5372C',
    'danger-soft': '#FDE7E5',
    'code-bg': '#F4F4F7',
    'user-bubble': '#5E52A7',
    'on-user-bubble': '#FFFFFF',
    claude: '#D97757',
    codex: '#18171C',
    scrim: 'rgba(12, 11, 18, 0.45)',
  },
  dark: {
    bg: '#0E0E11',
    surface: '#1A191E',
    'surface-2': '#232229',
    'surface-pressed': '#2B2A31',
    hover: 'rgba(255, 255, 255, 0.06)',
    border: '#2A2930',
    'border-strong': '#3A3942',
    text: '#F3F2F7',
    'text-secondary': '#A09FAA',
    'text-tertiary': '#6C6B75',
    'text-inverse': '#18171C',
    primary: '#B4AAFF',
    'primary-pressed': '#9F93F5',
    'primary-soft': '#2A2547',
    'on-primary': '#1B1446',
    success: '#3BD16F',
    'success-soft': '#163322',
    warning: '#FFA53A',
    'warning-soft': '#3A2A12',
    danger: '#FF5A4F',
    'danger-soft': '#3D1A18',
    'code-bg': '#141317',
    'user-bubble': '#3F3680',
    'on-user-bubble': '#F3F2F7',
    claude: '#E58B6B',
    codex: '#F3F2F7',
    scrim: 'rgba(0, 0, 0, 0.6)',
  },
};

export type ThemePref = Mode | 'system';

/** CSS custom properties (`--bg`, `--text`…) for a mode. */
export function themeVariables(mode: Mode): Record<string, string> {
  return { ...PALETTES[mode] };
}

export const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Inter", "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const MONO_STACK = '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace';

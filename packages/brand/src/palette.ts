/**
 * ReilAI palette: cool ink neutrals with the signal teal of the mark as the accent
 * (identity colors in logo.ts: ink #0F1416, signal #2DD4BF). Every screen, the web shell and
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
    bg: '#F4F6F6',
    surface: '#FFFFFF',
    'surface-2': '#EDF1F1',
    'surface-pressed': '#E3E8E8',
    hover: 'rgba(15, 20, 22, 0.05)',
    border: '#E2E7E7',
    'border-strong': '#CDD5D5',
    text: '#0F1416',
    'text-secondary': '#5F6B6E',
    'text-tertiary': '#98A2A5',
    'text-inverse': '#FFFFFF',
    primary: '#0B7F71',
    'primary-pressed': '#086B5F',
    'primary-soft': '#DDF3EF',
    'on-primary': '#FFFFFF',
    success: '#2FA84F',
    'success-soft': '#E2F5E7',
    warning: '#E08600',
    'warning-soft': '#FFF1DC',
    danger: '#E0352B',
    'danger-soft': '#FCE6E4',
    'code-bg': '#F1F4F4',
    'user-bubble': '#0F1416',
    'on-user-bubble': '#EEF3F3',
    claude: '#D97757',
    codex: '#0F1416',
    scrim: 'rgba(8, 12, 13, 0.45)',
  },
  dark: {
    bg: '#0B0F11',
    surface: '#151A1D',
    'surface-2': '#1C2226',
    'surface-pressed': '#232A2E',
    hover: 'rgba(255, 255, 255, 0.06)',
    border: '#232A2E',
    'border-strong': '#333C41',
    text: '#EEF3F3',
    'text-secondary': '#9AA6A9',
    'text-tertiary': '#667175',
    'text-inverse': '#0F1416',
    primary: '#2DD4BF',
    'primary-pressed': '#22B8A5',
    'primary-soft': '#10302B',
    'on-primary': '#062A25',
    success: '#3BD16F',
    'success-soft': '#14301F',
    warning: '#FFA53A',
    'warning-soft': '#3A2A12',
    danger: '#FF5A4F',
    'danger-soft': '#3D1A18',
    'code-bg': '#0F1416',
    'user-bubble': '#1E3B37',
    'on-user-bubble': '#EEF3F3',
    claude: '#E58B6B',
    codex: '#EEF3F3',
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

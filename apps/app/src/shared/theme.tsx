/**
 * Root of every screen: applies the palette as CSS variables (inline on the root
 * view) and follows theme changes pushed by the host (`reil:theme`).
 */
import { useInitData, useLynxGlobalEventListener, useMemo, useState } from '@lynx-js/react';
import type { ReactNode } from '@lynx-js/react';
import { type Mode, PALETTES, type Palette } from '@reilai/brand';

/** Current palette for inline colors (icons, SVG). Updated before children render. */
export const C: Palette = { ...PALETTES.light };

export function ThemeRoot({ children, className }: { children: ReactNode; className?: string }) {
  const init = useInitData();
  const [mode, setMode] = useState<Mode>(init.theme?.effective ?? 'light');

  useLynxGlobalEventListener('reil:theme', (arg: unknown) => {
    const next = (Array.isArray(arg) ? arg[0] : arg) as { effective?: Mode } | undefined;
    if (next?.effective === 'light' || next?.effective === 'dark') setMode(next.effective);
  });

  const vars = useMemo(() => {
    Object.assign(C, PALETTES[mode]);
    return Object.fromEntries(Object.entries(PALETTES[mode]).map(([k, v]) => [`--${k}`, v]));
  }, [mode]);

  // the key remounts the tree so inline colors (C.*) are re-read with the new theme
  return (
    <view key={mode} className={className ?? 'root'} style={{ ...vars, backgroundColor: vars['--bg'] }}>
      {children}
    </view>
  );
}

import { useEffect, useRef } from 'react';

import { createLynx, type Data, type LynxViewElement, type Navigator, updateLynx } from './lynx';

/**
 * One Lynx screen inside React. `data` changes are pushed with updateData
 * (it replaces the screen data, so pass the complete object).
 */
export function LynxView({
  screen,
  data,
  layout,
  nav,
  className,
}: {
  screen: string;
  data: Data;
  layout: 'mobile' | 'desktop';
  nav: Navigator;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const view = useRef<LynxViewElement | null>(null);
  const navRef = useRef(nav);
  navRef.current = nav;
  const dataKey = JSON.stringify(data);
  const mounted = useRef(false);

  useEffect(() => {
    view.current = createLynx(ref.current!, screen, data, layout, () => navRef.current);
    mounted.current = false;
    return () => {
      view.current?.remove();
      view.current = null;
    };
    // a screen is created once per mount; later changes go through updateData
  }, [screen, layout]);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (view.current) updateLynx(view.current, data, layout);
  }, [dataKey]);

  return <div ref={ref} className={className ?? 'lynx-host'} />;
}

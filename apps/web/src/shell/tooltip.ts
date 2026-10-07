/**
 * Desktop tooltips for the shell and the Lynx screens: any element with a `reil-tip`
 * attribute (Lynx `Pressable tip`, `IconButton tip`, or a raw `reil-tip` on a view) shows
 * its text after a short hover. One floating element in the page, so it is never clipped
 * by a screen or a scroll area. `reil-tip-side="right"` places it beside the element.
 */
const SHOW_DELAY_MS = 450;
const GAP = 8;

let tip: HTMLDivElement | null = null;
let current: Element | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function tipTarget(event: Event): Element | null {
  for (const el of event.composedPath()) {
    if (el instanceof Element && el.getAttribute('reil-tip')) return el;
  }
  return null;
}

function hide() {
  if (timer) clearTimeout(timer);
  timer = null;
  current = null;
  tip?.classList.remove('on');
}

function show(el: Element) {
  const text = el.getAttribute('reil-tip');
  if (!text || !el.isConnected) return;
  tip ??= Object.assign(document.createElement('div'), { className: 'tip', role: 'tooltip' });
  if (!tip.isConnected) document.body.append(tip);
  tip.textContent = text;
  const r = el.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  let left: number;
  let top: number;
  if (el.getAttribute('reil-tip-side') === 'right') {
    left = r.right + GAP;
    top = r.top + r.height / 2 - t.height / 2;
  } else {
    left = r.left + r.width / 2 - t.width / 2;
    top = r.bottom + GAP;
    // no room below: above the element
    if (top + t.height > window.innerHeight - 4) top = r.top - GAP - t.height;
  }
  tip.style.left = `${Math.round(Math.max(6, Math.min(window.innerWidth - t.width - 6, left)))}px`;
  tip.style.top = `${Math.round(Math.max(6, top))}px`;
  tip.classList.add('on');
}

export function installTooltips() {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  document.addEventListener(
    'pointerover',
    (event) => {
      const el = tipTarget(event);
      if (el === current) return;
      hide();
      if (!el) return;
      current = el;
      timer = setTimeout(() => show(el), SHOW_DELAY_MS);
    },
    true,
  );
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('wheel', hide, { capture: true, passive: true });
  document.addEventListener('keydown', hide, true);
  window.addEventListener('blur', hide);
  document.documentElement.addEventListener('pointerleave', hide);
}

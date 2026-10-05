import { type ReactNode, runOnBackground, runOnMainThread, useMainThreadRef, useState } from '@lynx-js/react';
import type { MainThread } from '@lynx-js/types';
import type { SolarIconName } from '@reilai/brand';

import { C } from '../shared/theme';
import { Icon } from './kit';
import './swipe-row.css';

const ACTION_WIDTH = 92;

/**
 * Swipe left to reveal an action (archive), like Happy. The drag runs on the main
 * thread so the row follows the finger without lag; vertical moves stay with the list.
 */
export function SwipeRow({
  children,
  actionLabel,
  actionIcon,
  actionColor,
  onAction,
}: {
  children: ReactNode;
  actionLabel: string;
  actionIcon: SolarIconName;
  actionColor?: string;
  onAction: () => void;
}) {
  const [open, setOpen] = useState(false);
  const st = useMainThreadRef<{ x0: number; y0: number; mode: 'none' | 'h' | 'v'; d: number; base: number; row: MainThread.Element | null }>({
    x0: 0,
    y0: 0,
    mode: 'none',
    d: 0,
    base: 0,
    row: null,
  });

  const settle = (to: number) => {
    'main thread';
    const s = st.current;
    if (!s.row) return;
    const from = s.d;
    s.row.setStyleProperty('transform', `translateX(${to}px)`);
    s.row.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], {
      duration: 200,
      easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)',
    });
    s.d = to;
    s.base = to;
  };

  const close = () => {
    'main thread';
    settle(0);
  };

  const onStart = (e: MainThread.TouchEvent) => {
    'main thread';
    const t = e.touches[0];
    if (!t) return;
    const s = st.current;
    s.x0 = t.clientX;
    s.y0 = t.clientY;
    s.mode = 'none';
    s.row = e.currentTarget.querySelector('.swipe-content');
  };

  const onMove = (e: MainThread.TouchEvent) => {
    'main thread';
    const s = st.current;
    const t = e.touches[0];
    if (!t || !s.row || s.mode === 'v') return;
    const dx = t.clientX - s.x0;
    const dy = t.clientY - s.y0;
    if (s.mode === 'none') {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3) s.mode = 'h';
      else if (Math.abs(dy) > 10) s.mode = 'v';
      else return;
    }
    const raw = s.base + dx;
    // rubber band past the action width, never to the right
    const d = Math.min(0, raw < -ACTION_WIDTH ? -ACTION_WIDTH + (raw + ACTION_WIDTH) * 0.3 : raw);
    s.d = d;
    s.row.setStyleProperty('transform', `translateX(${d}px)`);
  };

  const onEnd = () => {
    'main thread';
    const s = st.current;
    if (s.mode === 'h') {
      const opened = s.d < -ACTION_WIDTH / 2;
      settle(opened ? -ACTION_WIDTH : 0);
      void runOnBackground(setOpen)(opened);
    }
    s.mode = 'none';
  };

  return (
    <view
      className="swipe"
      main-thread:bindtouchstart={onStart}
      main-thread:bindtouchmove={onMove}
      main-thread:bindtouchend={onEnd}
      main-thread:bindtouchcancel={onEnd}
    >
      <view
        className="swipe-action"
        style={{ backgroundColor: actionColor ?? C.danger }}
        bindtap={() => {
          void runOnMainThread(close)();
          setOpen(false);
          onAction();
        }}
      >
        <Icon name={actionIcon} size={22} color="#FFFFFF" />
        <text className="t-caption" style={{ color: '#FFFFFF', marginTop: '4px', fontWeight: '600' }}>
          {actionLabel}
        </text>
      </view>
      <view className="swipe-content">
        {children}
        {open && (
          // while open, a tap on the row closes it instead of opening the session
          <view
            className="swipe-shield"
            catchtap={() => {
              void runOnMainThread(close)();
              setOpen(false);
            }}
          />
        )}
      </view>
    </view>
  );
}

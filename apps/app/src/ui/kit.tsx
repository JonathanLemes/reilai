import { type ReactNode, useEffect, useRef, useState } from '@lynx-js/react';
import { iconMarkup, LOGO_ASPECT, logoMarkup, type SolarIconName } from '@reilai/brand';

import { C } from '../shared/theme';

const iconCache = new Map<string, string>();

/** Solar icon (bold/linear) as inline SVG, colored per theme. */
export function Icon({ name, size = 20, color }: { name: SolarIconName; size?: number; color?: string }) {
  const tint = color ?? C['text-secondary'];
  const key = `${name}|${tint}`;
  let markup = iconCache.get(key);
  if (!markup) {
    markup = iconMarkup(name, tint);
    iconCache.set(key, markup);
  }
  return <svg content={markup} style={{ width: `${size}px`, height: `${size}px`, flexShrink: 0 }} />;
}

export function Logo({ size = 28, color }: { size?: number; color?: string }) {
  return <svg content={logoMarkup(color ?? C.primary)} style={{ width: `${size * LOGO_ASPECT}px`, height: `${size}px`, flexShrink: 0 }} />;
}

/** Touchable area with a pressed state. */
const LONG_PRESS_MS = 480;

/**
 * Who owns the touch in progress. A tap is ignored when the touch started on some
 * other element, e.g. the finger that long-pressed a row and lifts over the menu it
 * opened. Mouse clicks produce no touch events on the web, so they are never blocked.
 */
let gestureOwner: symbol | null = null;

function claimGesture(me: symbol) {
  if (!gestureOwner) gestureOwner = me;
}

function releaseGesture(me: symbol) {
  // the tap event comes right after touchend: release a bit later
  setTimeout(() => {
    if (gestureOwner === me) gestureOwner = null;
  }, 80);
}

function ownsTap(me: symbol) {
  return !gestureOwner || gestureOwner === me;
}

/** Touchable area with a pressed state and an optional long press (own timer: same on web and native). */
export function Pressable({
  onTap,
  onLongPress,
  className,
  pressedClassName,
  style,
  children,
  disabled,
}: {
  onTap?: () => void;
  onLongPress?: () => void;
  className?: string;
  pressedClassName?: string;
  style?: Record<string, string | number>;
  children?: ReactNode;
  disabled?: boolean;
}) {
  const [pressed, setPressed] = useState(false);
  const longPressed = useRef(false);
  const me = useRef(Symbol('pressable')).current;
  const moved = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({ x: 0, y: 0 });

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  type Touch = { touches?: { clientX: number; clientY: number }[]; detail?: { x?: number; y?: number } };
  const point = (e: Touch) => ({ x: e.touches?.[0]?.clientX ?? e.detail?.x ?? 0, y: e.touches?.[0]?.clientY ?? e.detail?.y ?? 0 });

  return (
    <view
      className={`${className ?? ''}${onTap && !disabled ? ' hov' : ''}${pressed && pressedClassName ? ` ${pressedClassName}` : ''}`}
      style={style}
      bindtouchstart={(e: Touch) => {
        longPressed.current = false;
        moved.current = false;
        gestureOwner = null;
        claimGesture(me);
        if (disabled) return;
        setPressed(true);
        origin.current = point(e);
        if (onLongPress) {
          cancel();
          timer.current = setTimeout(() => {
            timer.current = null;
            longPressed.current = true;
            setPressed(false);
            onLongPress();
          }, LONG_PRESS_MS);
        }
      }}
      bindtouchmove={(e: Touch) => {
        const p = point(e);
        if (Math.abs(p.x - origin.current.x) > 10 || Math.abs(p.y - origin.current.y) > 10) {
          cancel();
          setPressed(false);
          moved.current = true;
        }
      }}
      bindtouchend={() => {
        cancel();
        setPressed(false);
        releaseGesture(me);
      }}
      bindtouchcancel={() => {
        cancel();
        setPressed(false);
        releaseGesture(me);
      }}
      bindtap={() => {
        if (longPressed.current || moved.current || !ownsTap(me)) return;
        if (!disabled) onTap?.();
      }}
    >
      {children}
    </view>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  label,
  onTap,
  variant = 'primary',
  small,
  icon,
  disabled,
  loading,
  style,
}: {
  label: string;
  onTap?: () => void;
  variant?: ButtonVariant;
  small?: boolean;
  icon?: SolarIconName;
  disabled?: boolean;
  loading?: boolean;
  style?: Record<string, string | number>;
}) {
  const color = variant === 'primary' ? C['on-primary'] : variant === 'danger' ? C.danger : C.text;
  return (
    <Pressable
      onTap={onTap}
      disabled={disabled || loading}
      className={`btn btn-${variant}${small ? ' btn-sm' : ''}${disabled ? ' btn-disabled' : ''}`}
      pressedClassName={`btn-${variant}-pressed`}
      style={style}
    >
      {loading ? (
        <Spinner size={18} color={color} />
      ) : (
        icon && (
          <view style={{ marginRight: '8px' }}>
            <Icon name={icon} size={small ? 16 : 18} color={color} />
          </view>
        )
      )}
      {!loading && (
        <text className="btn-label" style={{ color }}>
          {label}
        </text>
      )}
    </Pressable>
  );
}

export function IconButton({ name, onTap, color, size = 22 }: { name: SolarIconName; onTap?: () => void; color?: string; size?: number }) {
  return (
    <Pressable className="header-btn" pressedClassName="header-btn-pressed" onTap={onTap}>
      <Icon name={name} size={size} color={color ?? C.text} />
    </Pressable>
  );
}

export function Spinner({ size = 22, color }: { size?: number; color?: string }) {
  const border = Math.max(2, Math.round(size / 9));
  return (
    <view
      className="spinner"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: `${size / 2}px`,
        borderWidth: `${border}px`,
        ...(color ? { borderTopColor: color } : {}),
      }}
    />
  );
}

export function Header({
  title,
  subtitle,
  left,
  right,
  safeTop = 0,
  align = 'center',
}: {
  title?: string;
  subtitle?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  safeTop?: number;
  align?: 'center' | 'left';
}) {
  return (
    <view className="header" style={{ marginTop: `${safeTop}px` }}>
      <view style={{ minWidth: '40px' }}>{left}</view>
      <view className={`header-title-wrap${align === 'left' ? ' header-title-wrap-left' : ''}`}>
        {!!title && (
          <text className="t-headline" text-maxline="1">
            {title}
          </text>
        )}
        {subtitle}
      </view>
      <view className="row" style={{ minWidth: '40px', justifyContent: 'flex-end' }}>
        {right}
      </view>
    </view>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: SolarIconName | 'logo';
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <view className="empty">
      <view className="empty-art">{icon === 'logo' ? <Logo size={40} /> : <Icon name={icon} size={38} color={C.primary} />}</view>
      <text className="t-headline" style={{ textAlign: 'center', marginBottom: '6px' }}>
        {title}
      </text>
      {!!body && (
        <text className="t-sub" style={{ textAlign: 'center', maxWidth: '300px', marginBottom: '18px' }}>
          {body}
        </text>
      )}
      {action}
    </view>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; icon?: SolarIconName; disabled?: boolean }[];
  onChange: (value: T) => void;
}) {
  return (
    <view className="seg">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <view
            key={o.value}
            className={`seg-item${on ? ' seg-item-on' : o.disabled ? '' : ' hov'}`}
            style={o.disabled ? { opacity: 0.4 } : undefined}
            bindtap={() => !o.disabled && onChange(o.value)}
          >
            {o.icon && (
              <view style={{ marginRight: '6px' }}>
                <Icon name={o.icon} size={16} color={on ? C.text : C['text-secondary']} />
              </view>
            )}
            <text className="t-callout" style={{ fontWeight: on ? '600' : '400', color: on ? C.text : C['text-secondary'] }}>
              {o.label}
            </text>
          </view>
        );
      })}
    </view>
  );
}

export function Cell({
  icon,
  iconBg,
  iconColor,
  title,
  subtitle,
  value,
  onTap,
  chevron,
  right,
  danger,
}: {
  icon?: SolarIconName;
  iconBg?: string;
  iconColor?: string;
  title: string;
  subtitle?: string;
  value?: string;
  onTap?: () => void;
  chevron?: boolean;
  right?: ReactNode;
  danger?: boolean;
}) {
  return (
    <Pressable className="cell" pressedClassName={onTap ? 'cell-pressed' : undefined} onTap={onTap}>
      {icon && (
        <view className="cell-icon" style={{ backgroundColor: iconBg ?? C['primary-soft'] }}>
          <Icon name={icon} size={18} color={iconColor ?? C.primary} />
        </view>
      )}
      <view className="col grow">
        <text className={`t-body${danger ? ' danger' : ''}`} text-maxline="1">
          {title}
        </text>
        {!!subtitle && (
          <text className="t-caption" text-maxline="2" style={{ marginTop: '2px' }}>
            {subtitle}
          </text>
        )}
      </view>
      {!!value && (
        <text className="t-callout muted" style={{ marginLeft: '8px' }}>
          {value}
        </text>
      )}
      {right}
      {chevron && (
        <view style={{ marginLeft: '6px' }}>
          <Icon name="chevronRight" size={16} color={C['text-tertiary']} />
        </view>
      )}
    </Pressable>
  );
}

export function Divider() {
  return <view className="cell-divider" />;
}

/** Bottom action sheet (in-screen overlay). */
export function ActionSheet({
  open,
  onClose,
  title,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  actions: { label: string; subtitle?: string; icon?: SolarIconName; danger?: boolean; onTap: () => void }[];
}) {
  // Only a touch that starts on the scrim closes it: the finger that long-pressed
  // the row (and may still be down, or lift over the sheet) never does.
  const me = useRef(Symbol('scrim')).current;
  if (!open) return null;
  return (
    <view
      className="scrim"
      bindtouchstart={() => claimGesture(me)}
      bindtouchend={() => releaseGesture(me)}
      bindtap={() => ownsTap(me) && onClose()}
    >
      <view className="sheet" catchtap={() => {}}>
        <view className="sheet-handle" />
        {!!title && (
          <text className="t-sub" style={{ padding: '4px 20px 10px 20px' }} text-maxline="2">
            {title}
          </text>
        )}
        <scroll-view scroll-orientation="vertical" style={{ maxHeight: '460px' }}>
        {actions.map((a) => (
          <Cell
            key={a.label}
            subtitle={a.subtitle}
            icon={a.icon}
            iconBg={a.danger ? C['danger-soft'] : C['surface-2']}
            iconColor={a.danger ? C.danger : C.text}
            title={a.label}
            danger={a.danger}
            onTap={() => {
              onClose();
              a.onTap();
            }}
          />
        ))}
        </scroll-view>
      </view>
    </view>
  );
}

export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <view className="scrim scrim-center" bindtap={onClose}>
      <view className="dialog" catchtap={() => {}}>
        <text className="t-headline" style={{ marginBottom: '18px' }}>
          {title}
        </text>
        <view className="row" style={{ justifyContent: 'flex-end' }}>
          <Button small variant="secondary" label={cancelLabel} onTap={onClose} />
          <Button
            small
            variant={danger ? 'danger' : 'primary'}
            label={confirmLabel}
            style={{ marginLeft: '10px' }}
            onTap={() => {
              onClose();
              onConfirm();
            }}
          />
        </view>
      </view>
    </view>
  );
}

export function PromptDialog({
  open,
  title,
  initial,
  confirmLabel,
  cancelLabel,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  initial: string;
  confirmLabel: string;
  cancelLabel: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (!open) return;
    setValue(initial);
    // default-value is not applied by every host: set the text explicitly
    const timer = setTimeout(() => {
      lynx.createSelectorQuery().select('#prompt-dialog-input').invoke({ method: 'setValue', params: { value: initial } }).exec();
    }, 50);
    return () => clearTimeout(timer);
  }, [open, initial]);
  if (!open) return null;
  return (
    <view className="scrim scrim-center" bindtap={onClose}>
      <view className="dialog" catchtap={() => {}}>
        <text className="t-headline" style={{ marginBottom: '14px' }}>
          {title}
        </text>
        <view className="field" style={{ marginBottom: '18px' }}>
          <input
            id="prompt-dialog-input"
            className="field-input"
            default-value={initial}
            bindinput={(e: { detail: { value: string } }) => setValue(e.detail.value)}
            bindconfirm={() => {
              onClose();
              onSubmit(value);
            }}
          />
        </view>
        <view className="row" style={{ justifyContent: 'flex-end' }}>
          <Button small variant="secondary" label={cancelLabel} onTap={onClose} />
          <Button
            small
            label={confirmLabel}
            style={{ marginLeft: '10px' }}
            onTap={() => {
              onClose();
              onSubmit(value);
            }}
          />
        </view>
      </view>
    </view>
  );
}

export function Toast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <view className="toast">
      <text className="toast-text">{text}</text>
    </view>
  );
}

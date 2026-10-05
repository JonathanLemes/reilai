import type { MessageKey } from '@reilai/i18n';
import type { AgentKind, Session, SessionStatus } from '@reilai/protocol';

import { C } from '../shared/theme';
import { Icon, Spinner } from './kit';

/** Small mark for each agent: Claude's orange asterisk, Codex's dark cloud. */
const CLAUDE_MARK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="COLOR" d="M12 2.2l1.45 6.1 4.99-3.8-3.07 5.47 6.23.43-5.9 2.05 4.47 4.36-6.01-1.7.88 6.19L12 15.9l-3.04 5.4.88-6.19-6.01 1.7 4.47-4.36-5.9-2.05 6.23-.43L5.56 4.5l4.99 3.8z"/></svg>';
const CODEX_MARK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M8 9l3 3-3 3M13 15h3"/><rect x="3" y="4" width="18" height="16" rx="4" fill="none" stroke="COLOR" stroke-width="2"/></svg>';

export function AgentAvatar({ agent, size = 40 }: { agent: AgentKind; size?: number }) {
  const isClaude = agent === 'claude';
  const bg = isClaude ? 'rgba(217, 119, 87, 0.14)' : C['surface-2'];
  const color = isClaude ? C.claude : C.codex;
  const markup = (isClaude ? CLAUDE_MARK : CODEX_MARK).split('COLOR').join(color);
  return (
    <view
      className="center"
      style={{ width: `${size}px`, height: `${size}px`, borderRadius: `${size * 0.32}px`, backgroundColor: bg, flexShrink: 0 }}
    >
      <svg content={markup} style={{ width: `${size * 0.55}px`, height: `${size * 0.55}px` }} />
    </view>
  );
}

export function statusColor(status: SessionStatus): string {
  switch (status) {
    case 'running':
    case 'starting':
      return C.primary;
    case 'waiting':
      return C.warning;
    case 'error':
      return C.danger;
    case 'idle':
      return C.success;
    default:
      return C['text-tertiary'];
  }
}

/** Compact status: spinner while working, amber shield when it needs you. */
export function StatusBadge({ session, t }: { session: Session; t: (k: MessageKey) => string }) {
  const s = session.status;
  if (s === 'running' || s === 'starting') {
    return (
      <view className="pill" style={{ backgroundColor: C['primary-soft'] }}>
        <Spinner size={11} color={C.primary} />
        <text className="t-caption" style={{ color: C.primary, marginLeft: '6px', fontWeight: '600' }}>
          {t(`status.${s}`)}
        </text>
      </view>
    );
  }
  if (s === 'waiting') {
    return (
      <view className="pill" style={{ backgroundColor: C['warning-soft'] }}>
        <Icon name="shieldWarning" size={13} color={C.warning} />
        <text className="t-caption" style={{ color: C.warning, marginLeft: '5px', fontWeight: '600' }}>
          {t('status.waiting')}
        </text>
      </view>
    );
  }
  if (s === 'error') {
    return (
      <view className="pill" style={{ backgroundColor: C['danger-soft'] }}>
        <text className="t-caption" style={{ color: C.danger, fontWeight: '600' }}>
          {t('status.error')}
        </text>
      </view>
    );
  }
  return null;
}

export function StatusDot({ status }: { status: SessionStatus }) {
  return <view className={`dot${status === 'running' ? ' pulse' : ''}`} style={{ backgroundColor: statusColor(status) }} />;
}

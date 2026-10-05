import { useState } from '@lynx-js/react';
import type { SolarIconName } from '@reilai/brand';
import type { MessageKey, Vars } from '@reilai/i18n';
import type { AgentKind, Message, PermissionDecision } from '@reilai/protocol';

import { copyText, push } from '../../shared/host';
import { C } from '../../shared/theme';
import { Button, Icon, Pressable, Spinner } from '../../ui/kit';
import { Markdown, preserveIndent } from '../../ui/Markdown';

type T = (key: MessageKey, vars?: Vars) => string;

const AGENT_NAME: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex' };

function toolIcon(name: string): SolarIconName {
  const n = name.toLowerCase();
  if (n === 'bash') return 'terminal';
  if (n === 'read') return 'file';
  if (['edit', 'write', 'multiedit', 'notebookedit'].includes(n)) return 'edit';
  if (['grep', 'glob'].includes(n)) return 'search';
  if (n.startsWith('web')) return 'globe';
  if (n === 'task' || n === 'agent') return 'robot';
  if (n === 'todowrite') return 'checklist';
  if (n === 'exitplanmode') return 'task';
  if (n.startsWith('mcp')) return 'link';
  return 'bolt';
}

function inputPreview(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (typeof i.command === 'string') return i.command;
  if (name === 'TodoWrite' && Array.isArray(i.todos)) {
    return (i.todos as { content?: string; status?: string }[])
      .map((todo) => `${todo.status === 'completed' ? '☑' : todo.status === 'in_progress' ? '◐' : '☐'} ${todo.content ?? ''}`)
      .join('\n');
  }
  const json = JSON.stringify(input ?? {}, null, 2);
  return json.length > 3000 ? `${json.slice(0, 3000)}\n…` : json;
}

export function UserBubble({ m }: { m: Message }) {
  return (
    <view className="ubub-row">
      <view className="ubub" bindlongpress={() => copyText(m.text ?? '')}>
        <text className="t-body" style={{ color: C['on-user-bubble'] }}>
          {m.text}
        </text>
      </view>
    </view>
  );
}

export function openFile(path: string, cwd: string) {
  push('file', { path, cwd });
}

/** File paths a tool call touched (Claude `file_path`, Codex `changes[].path`). */
function toolPaths(input: unknown): string[] {
  const i = (input ?? {}) as Record<string, unknown>;
  const direct = [i.file_path, i.notebook_path].filter((v): v is string => typeof v === 'string');
  const changes = Array.isArray(i.changes) ? (i.changes as { path?: unknown }[]).map((c) => c.path).filter((v): v is string => typeof v === 'string') : [];
  return [...new Set([...direct, ...changes])];
}

export function AgentText({ m, cwd }: { m: Message; cwd: string }) {
  return (
    <view className="atext" bindlongpress={() => copyText(m.text ?? '')}>
      <Markdown text={m.text ?? ''} onOpenPath={(path) => openFile(path, cwd)} />
      {m.streaming && <view className="caret pulse" />}
    </view>
  );
}

export function Thinking({ m, t }: { m: Message; t: T }) {
  const [open, setOpen] = useState(false);
  return (
    <view className="think">
      <view className="row" bindtap={() => setOpen((o) => !o)}>
        <Icon name="bulb" size={15} color={C['text-tertiary']} />
        <text className={`t-sub${m.streaming ? ' pulse' : ''}`} style={{ marginLeft: '6px' }}>
          {m.streaming ? t('chat.thinking') : t('chat.thought')}
        </text>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} color={C['text-tertiary']} />
      </view>
      {open && (
        <text className="t-sub think-body" style={{ fontStyle: 'italic' }}>
          {m.text}
        </text>
      )}
    </view>
  );
}

export function ToolRow({ m, t, cwd }: { m: Message; t: T; cwd: string }) {
  const [open, setOpen] = useState(false);
  const tool = m.tool!;
  const running = tool.status === 'running';
  const isShell = tool.name.toLowerCase() === 'bash';
  return (
    <view className="tool">
      <Pressable className="tool-head" pressedClassName="tool-head-pressed" onTap={() => setOpen((o) => !o)}>
        <view className="tool-ic">
          <Icon name={toolIcon(tool.name)} size={15} color={C['text-secondary']} />
        </view>
        <text className={isShell ? 't-mono grow' : 't-callout grow'} text-maxline="1" style={{ color: C['text-secondary'] }}>
          {tool.title}
        </text>
        {running ? (
          <Spinner size={14} />
        ) : tool.status === 'error' ? (
          <Icon name="close" size={16} color={C.danger} />
        ) : (
          <Icon name="check" size={16} color={C.success} />
        )}
      </Pressable>
      {open && (
        <view className="tool-body">
          {toolPaths(tool.input).map((path) => (
            <Pressable key={path} className="tool-file" pressedClassName="cell-pressed" onTap={() => openFile(path, cwd)}>
              <Icon name="file" size={15} color={C.primary} />
              <text className="t-callout grow" text-maxline="1" style={{ marginLeft: '8px', color: C.primary }}>
                {t('files.open')}: {path.split('/').pop()}
              </text>
              <Icon name="chevronRight" size={14} color={C['text-tertiary']} />
            </Pressable>
          ))}
          <text className="t-section" style={{ marginBottom: '4px' }}>
            {t('chat.toolInput').toUpperCase()}
          </text>
          <scroll-view scroll-orientation="horizontal">
            <text className="t-mono">{preserveIndent(inputPreview(tool.name, tool.input))}</text>
          </scroll-view>
          {!!tool.output && (
            <>
              <text className="t-section" style={{ margin: '10px 0 4px 0' }}>
                {t('chat.toolOutput').toUpperCase()}
              </text>
              <scroll-view scroll-orientation="horizontal">
                <text className="t-mono" style={tool.status === 'error' ? { color: C.danger } : undefined}>
                  {preserveIndent(tool.output.length > 6000 ? `${tool.output.slice(0, 6000)}\n…` : tool.output)}
                </text>
              </scroll-view>
            </>
          )}
        </view>
      )}
    </view>
  );
}

export function PermissionCard({
  m,
  agent,
  t,
  onDecide,
}: {
  m: Message;
  agent: AgentKind;
  t: T;
  onDecide: (decision: PermissionDecision) => void;
}) {
  const p = m.permission!;
  const pending = p.status === 'pending';
  const [busy, setBusy] = useState<PermissionDecision | null>(null);
  const decide = (d: PermissionDecision) => {
    setBusy(d);
    onDecide(d);
  };
  if (!pending) {
    const label =
      p.status === 'denied'
        ? t('chat.denied')
        : p.status === 'expired'
          ? t('chat.expired')
          : p.decision === 'allow_session'
            ? t('chat.allowedSession')
            : t('chat.allowed');
    const color = p.status === 'denied' ? C.danger : p.status === 'expired' ? C['text-tertiary'] : C.success;
    return (
      <view className="perm-done">
        <Icon name={p.status === 'denied' ? 'shieldWarning' : 'shieldCheck'} size={15} color={color} />
        <text className="t-sub grow" text-maxline="1" style={{ marginLeft: '6px' }}>
          {p.title}
        </text>
        <text className="t-caption" style={{ color, fontWeight: '600' }}>
          {label}
        </text>
      </view>
    );
  }
  return (
    <view className="perm">
      <view className="row" style={{ marginBottom: '10px' }}>
        <view className="perm-ic">
          <Icon name="shieldWarning" size={18} color={C.warning} />
        </view>
        <text className="t-callout bold grow">{t('chat.permissionTitle', { agent: AGENT_NAME[agent], tool: p.tool })}</text>
      </view>
      <view className="perm-detail">
        <scroll-view scroll-orientation="vertical" style={{ maxHeight: '220px' }}>
          <text className="t-mono">{preserveIndent(p.detail)}</text>
        </scroll-view>
      </view>
      <view className="row" style={{ marginTop: '12px' }}>
        <Button small variant="secondary" label={t('chat.deny')} loading={busy === 'deny'} onTap={() => decide('deny')} style={{ flex: 1 }} />
        <Button
          small
          variant="secondary"
          label={t('chat.allowSession')}
          loading={busy === 'allow_session'}
          onTap={() => decide('allow_session')}
          style={{ flex: 1.3, marginLeft: '8px' }}
        />
        <Button small label={t('chat.allow')} loading={busy === 'allow'} onTap={() => decide('allow')} style={{ flex: 1, marginLeft: '8px' }} />
      </view>
    </view>
  );
}

export function EventLine({ m, t }: { m: Message; t: T }) {
  const e = m.event!;
  if (e.type === 'turn-end') {
    const secs = ((e.durationMs ?? 0) / 1000).toFixed(1);
    return (
      <view className="evt">
        <view className="evt-line" />
        <text className="t-caption tertiary" style={{ margin: '0 8px' }}>
          {t('chat.turnDone', { s: secs })}
          {e.costUsd ? ` · $${e.costUsd.toFixed(3)}` : ''}
        </text>
        <view className="evt-line" />
      </view>
    );
  }
  const isError = e.type === 'error';
  return (
    <view className={isError ? 'evt-err' : 'evt-info'}>
      <Icon name={isError ? 'danger' : 'info'} size={15} color={isError ? C.danger : C['text-secondary']} />
      <text className="t-sub grow" style={{ marginLeft: '8px', color: isError ? C.danger : C['text-secondary'] }}>
        {e.text === 'interrupted' ? t('chat.stop') : (e.text ?? t('error.generic'))}
      </text>
    </view>
  );
}

export function WorkingIndicator({ t }: { t: T }) {
  return (
    <view className="working">
      <view className="wdot pulse" />
      <view className="wdot pulse" style={{ animationDelay: '0.2s' }} />
      <view className="wdot pulse" style={{ animationDelay: '0.4s' }} />
      <text className="t-sub" style={{ marginLeft: '8px' }}>
        {t('chat.working')}
      </text>
    </view>
  );
}

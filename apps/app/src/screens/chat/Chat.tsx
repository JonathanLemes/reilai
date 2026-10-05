import { useEffect, useInitData, useInitDataChanged, useRef, useState } from '@lynx-js/react';
import { translateModelText } from '@reilai/i18n';
import { type Message, PERMISSION_MODES, type PermissionMode, projectName } from '@reilai/protocol';

import { findModel, shortModelLabel, useConversation, useModels } from '../../shared/data';
import { haptic, pop, rpc } from '../../shared/host';
import { useConnection, useLanguage, useLayout } from '../../shared/hooks';
import { C } from '../../shared/theme';
import { AgentAvatar, StatusDot } from '../../ui/agent';
import {
  ActionSheet,
  Button,
  EmptyState,
  Header,
  Icon,
  IconButton,
  Pressable,
  Spinner,
  Toast,
} from '../../ui/kit';
import { useSessionActions } from '../../shared/session-actions';
import { AgentText, EventLine, openFile, PermissionCard, Thinking, ToolRow, UserBubble, WorkingIndicator } from './parts';
import './chat.css';

const AGENT_NAME = { claude: 'Claude Code', codex: 'Codex' } as const;
const MODE_ICON = { ask: 'shieldCheck', edits: 'edit', plan: 'task', yolo: 'bolt' } as const;

function scrollToEnd(count: number, smooth: boolean) {
  lynx
    .createSelectorQuery()
    .select('#chat-list')
    .invoke({ method: 'scrollToPosition', params: { index: count + 1, position: count + 1, alignTo: 'bottom', smooth } })
    .exec();
}

function clearComposer() {
  lynx.createSelectorQuery().select('#composer').invoke({ method: 'setValue', params: { value: '' } }).exec();
}

export function Chat() {
  const init = useInitData();
  const [id, setId] = useState(init.id);
  useInitDataChanged((data) => {
    if (data.id && data.id !== id) setId(data.id);
  });

  const { t, lang } = useLanguage();
  const { desktop, safeTop, safeBottom } = useLayout();
  const conn = useConnection();
  const { session, messages, hasMore, error, loading, loadOlder } = useConversation(id);
  const models = useModels(session?.agent);
  const currentModel = findModel(models, session?.model);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [modes, setModes] = useState(false);
  const [modelSheet, setModelSheet] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const scrolledOnce = useRef(false);
  const lastCount = useRef(0);

  const flash = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 2600);
  };
  const sessionActions = useSessionActions({
    t,
    flash,
    onDeleted: () => !desktop && pop(),
    onArchived: () => !desktop && setTimeout(pop, 700),
  });

  // follow the conversation: jump on first load, glide on new content
  const tail = messages[messages.length - 1];
  const tailKey = `${messages.length}:${tail?.id}:${tail?.text?.length ?? 0}:${tail?.tool?.status ?? ''}`;
  useEffect(() => {
    if (!messages.length) return;
    const smooth = scrolledOnce.current && messages.length - lastCount.current < 20;
    const timer = setTimeout(() => scrollToEnd(messages.length, smooth), scrolledOnce.current ? 30 : 80);
    scrolledOnce.current = true;
    lastCount.current = messages.length;
    return () => clearTimeout(timer);
  }, [tailKey]);

  useEffect(() => {
    scrolledOnce.current = false;
  }, [id]);

  if (!id) {
    return <EmptyState icon="sessions" title={t('chat.select')} body={t('chat.selectBody')} />;
  }

  const running = session?.status === 'running' || session?.status === 'starting';
  const agentName = session ? AGENT_NAME[session.agent] : '';

  const send = async () => {
    const text = draft.trim();
    if (!text || !session) return;
    setSending(true);
    setDraft('');
    clearComposer();
    haptic('light');
    try {
      await rpc('sessions.send', { id: session.id, text });
    } catch (e) {
      setDraft(text);
      flash((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const act = (p: Promise<unknown>) => p.catch((e: Error) => flash(e.message));

  const renderMessage = (m: Message) => {
    switch (m.kind) {
      case 'text':
        return m.role === 'user' ? <UserBubble m={m} /> : <AgentText m={m} cwd={session?.cwd ?? ''} />;
      case 'thinking':
        return <Thinking m={m} t={t} />;
      case 'tool':
        return <ToolRow m={m} t={t} cwd={session?.cwd ?? ''} />;
      case 'permission':
        return (
          <PermissionCard
            m={m}
            agent={session?.agent ?? 'claude'}
            t={t}
            onDecide={(decision) =>
              act(rpc('permissions.respond', { sessionId: m.sessionId, requestId: m.permission!.requestId, decision }))
            }
          />
        );
      case 'event':
        return <EventLine m={m} t={t} />;
    }
  };

  const lastIsStreaming = tail?.streaming || tail?.tool?.status === 'running' || tail?.permission?.status === 'pending';

  return (
    <view className="root">
      <Header
        safeTop={safeTop}
        align={desktop ? 'left' : 'center'}
        left={desktop ? <view style={{ width: '8px' }} /> : <IconButton name="back" onTap={pop} />}
        title={session ? session.title || t('sessions.untitled') : ''}
        subtitle={
          session && (
            <view className="row" style={{ marginTop: '1px' }} bindtap={() => setModes(true)}>
              <StatusDot status={session.status} />
              <text className="t-caption" style={{ marginLeft: '5px' }} text-maxline="1">
                {`${agentName} · ${projectName(session.cwd)} · ${t(`status.${session.status}`)}`}
              </text>
            </view>
          )
        }
        right={
          session && (
            <view className="row">
              {desktop && <IconButton name="folderOpen" onTap={() => openFile(session.cwd, session.cwd)} />}
              {desktop && <IconButton name="archive" onTap={() => sessionActions.requestArchive(session)} />}
              <IconButton name="more" onTap={() => sessionActions.openMenu(session)} />
            </view>
          )
        }
      />
      <view className="chat-divider" />

      {loading && !session ? (
        <view className="empty">
          <Spinner />
        </view>
      ) : error && !session ? (
        <EmptyState icon="danger" title={t('error.load')} body={error === 'deleted' ? undefined : error} />
      ) : (
        <list
          id="chat-list"
          className="chat-list"
          list-type="single"
          span-count={1}
          scroll-orientation="vertical"
          initial-scroll-index={messages.length + 1}
          upper-threshold-item-count={2}
          bindscrolltoupper={loadOlder}
        >
          <list-item item-key="intro" key="intro">
            {hasMore ? (
              <view className="center" style={{ padding: '14px' }}>
                <Button small variant="ghost" label={t('chat.loadOlder')} onTap={loadOlder} />
              </view>
            ) : (
              session && (
                <view className="chat-intro">
                  <AgentAvatar agent={session.agent} size={52} />
                  <text className="t-headline" style={{ marginTop: '12px' }}>
                    {agentName}
                  </text>
                  <text className="t-sub" style={{ marginTop: '2px', textAlign: 'center' }}>
                    {session.cwd}
                  </text>
                  {!messages.length && (
                    <text className="t-sub" style={{ marginTop: '14px', textAlign: 'center' }}>
                      {t('chat.emptyBody', { agent: agentName, project: projectName(session.cwd) })}
                    </text>
                  )}
                </view>
              )
            )}
          </list-item>
          {messages.map((m) => (
            <list-item item-key={m.id} key={m.id}>
              {renderMessage(m)}
            </list-item>
          ))}
          <list-item item-key="tail" key="tail">
            {running && !lastIsStreaming ? <WorkingIndicator t={t} /> : null}
            {session && (session.status === 'stopped' || session.status === 'error' || session.archived) && messages.length > 0 && (
              <view className="col" style={{ alignItems: 'center', padding: '12px 24px' }}>
                <text className="t-caption tertiary" style={{ textAlign: 'center', marginBottom: '10px' }}>
                  {t('chat.stopped')}
                </text>
                <Button small variant="secondary" icon="play" label={t('chat.resume')} onTap={() => sessionActions.resume(session)} />
              </view>
            )}
            <view style={{ height: '12px' }} />
          </list-item>
        </list>
      )}

      {session && (
        <view className="composer" style={{ paddingBottom: `${10 + safeBottom}px` }}>
          <view className="row" style={{ marginBottom: '8px' }}>
            <Pressable className="chip" pressedClassName="chip-on" onTap={() => setModes(true)}>
              <Icon name={MODE_ICON[session.mode]} size={14} color={session.mode === 'yolo' ? C.danger : C.primary} />
              <text className="t-caption" style={{ marginLeft: '6px', fontWeight: '600', color: C.text }}>
                {t(`mode.${session.mode}`)}
              </text>
              <view style={{ marginLeft: '4px' }}>
                <Icon name="chevronDown" size={12} color={C['text-tertiary']} />
              </view>
            </Pressable>
            <Pressable className="chip" pressedClassName="chip-on" style={{ marginLeft: '8px', flexShrink: 1 }} onTap={() => setModelSheet(true)}>
              <Icon name="cpu" size={14} color={C.primary} />
              <text className="t-caption" text-maxline="1" style={{ marginLeft: '6px', fontWeight: '600', color: C.text }}>
                {currentModel ? translateModelText(lang, shortModelLabel(currentModel)) : (session.model ?? t('model.default'))}
              </text>
              <view style={{ marginLeft: '4px' }}>
                <Icon name="chevronDown" size={12} color={C['text-tertiary']} />
              </view>
            </Pressable>
            {conn.state !== 'connected' && (
              <text className="t-caption" style={{ marginLeft: '10px', color: C.warning }}>
                {conn.state === 'connecting' ? t('conn.connecting') : t('conn.offline')}
              </text>
            )}
          </view>
          <view className="composer-box">
            <textarea
              id="composer"
              className="composer-input"
              placeholder={t('chat.placeholder', { agent: agentName })}
              maxlines={8}
              bindinput={(e: { detail: { value: string } }) => setDraft(e.detail.value)}
            />
            {running && !draft.trim() ? (
              <Pressable className="send send-stop" onTap={() => act(rpc('sessions.interrupt', { id: session.id }))}>
                <Icon name="stop" size={18} color={C['on-primary']} />
              </Pressable>
            ) : (
              <Pressable className={`send${draft.trim() ? '' : ' send-off'}`} onTap={send} disabled={sending}>
                {sending ? <Spinner size={16} color={C['on-primary']} /> : <Icon name="arrowUp" size={20} color={C['on-primary']} />}
              </Pressable>
            )}
          </view>
        </view>
      )}

      <ActionSheet
        open={modes}
        onClose={() => setModes(false)}
        title={t('new.mode')}
        actions={PERMISSION_MODES.map((mode: PermissionMode) => ({
          label: `${t(`mode.${mode}`)}${session?.mode === mode ? '  ✓' : ''}`,
          icon: MODE_ICON[mode],
          danger: mode === 'yolo',
          onTap: () => session && act(rpc('sessions.setMode', { id: session.id, mode })),
        }))}
      />

      <ActionSheet
        open={modelSheet}
        onClose={() => setModelSheet(false)}
        title={models ? t('model.title') : t('model.loading')}
        actions={(models ?? []).map((m) => ({
          label: `${translateModelText(lang, m.label)}${currentModel?.id === m.id ? '  ✓' : ''}`,
          subtitle: translateModelText(lang, m.description),
          icon: 'cpu' as const,
          onTap: () => session && act(rpc('sessions.setModel', { id: session.id, model: m.isDefault && m.id === 'default' ? null : m.id })),
        }))}
      />

      {sessionActions.elements}

      <Toast text={toast} />
    </view>
  );
}

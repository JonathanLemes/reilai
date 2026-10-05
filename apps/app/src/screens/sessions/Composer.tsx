import { useEffect, useState } from '@lynx-js/react';
import { type MessageKey, translateModelText, type Vars } from '@reilai/i18n';
import { type AgentKind, PERMISSION_MODES, type PermissionMode, projectName } from '@reilai/protocol';

import { findModel, shortModelLabel, useHello, useModels } from '../../shared/data';
import { haptic, kvGet, kvSet, openSession, rpc } from '../../shared/host';
import { C } from '../../shared/theme';
import { AgentAvatar } from '../../ui/agent';
import { FolderPicker } from '../../ui/FolderPicker';
import { ActionSheet, Icon, Pressable, Spinner } from '../../ui/kit';
import './composer.css';

type T = (key: MessageKey, vars?: Vars) => string;

const AGENT_NAME: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex' };
const MODE_ICON = { ask: 'shieldCheck', edits: 'edit', plan: 'task', yolo: 'bolt' } as const;

function input(method: string, params?: Record<string, unknown>) {
  lynx.createSelectorQuery().select('#home-input').invoke({ method, params }).exec();
}

/**
 * Happy-style start: one text field at the bottom of the home screen. Focusing it
 * raises the panel with the computer, folder and agent rows; mode and model live in
 * the field itself. Sending starts the session and opens it.
 */
export function HomeComposer({ t, lang, safeBottom, onError }: { t: T; lang: 'en' | 'pt'; safeBottom: number; onError: (m: string) => void }) {
  const hello = useHello();
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');
  const [agent, setAgent] = useState<AgentKind>('claude');
  const [mode, setMode] = useState<PermissionMode>('ask');
  const [model, setModel] = useState<string | null>(null);
  const [cwd, setCwd] = useState('');
  const [sheet, setSheet] = useState<'folder' | 'agent' | 'mode' | 'model' | null>(null);
  const [sending, setSending] = useState(false);
  const models = useModels(agent);
  const currentModel = findModel(models, model);

  useEffect(() => {
    kvGet('new.agent').then((v) => (v === 'claude' || v === 'codex') && setAgent(v));
    kvGet('new.mode').then((v) => v && PERMISSION_MODES.includes(v as PermissionMode) && setMode(v as PermissionMode));
    kvGet('home.cwd').then((v) => {
      if (v) return setCwd(v);
      rpc('fs.recent', {})
        .then((list) => list[0] && setCwd((c) => c || list[0]!.path))
        .catch(() => {});
    });
  }, []);

  const collapse = () => {
    input('blur');
    setExpanded(false);
    setSheet(null);
  };

  const send = async () => {
    const prompt = text.trim();
    if (!prompt) return;
    if (!cwd) {
      setExpanded(true);
      setSheet('folder');
      return;
    }
    setSending(true);
    haptic('light');
    kvSet('new.agent', agent);
    kvSet('new.mode', mode);
    kvSet('home.cwd', cwd);
    try {
      const session = await rpc('sessions.create', { agent, cwd, prompt, mode, model, startedBy: 'app' });
      input('setValue', { value: '' });
      setText('');
      collapse();
      openSession(session.id);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const agentInstalled = (a: AgentKind) => hello?.agents.find((x) => x.agent === a)?.installed !== false;

  return (
    <>
      {expanded && <view className="hc-scrim" bindtap={collapse} />}
      <view className="hc" style={{ paddingBottom: `${10 + safeBottom}px` }}>
        {expanded && (
          <view className="hc-rows">
            <view className="hc-row">
              <Icon name="monitor" size={20} color={C.text} />
              <text className="t-body grow" style={{ marginLeft: '14px' }}>
                {hello?.machine.name ?? '…'}
              </text>
            </view>
            <Pressable className="hc-row" pressedClassName="hc-row-pressed" onTap={() => setSheet('folder')}>
              <Icon name="folder" size={20} color={C.text} />
              <text className="t-body grow" text-maxline="1" style={{ marginLeft: '14px' }}>
                {cwd ? cwd.replace(hello?.machine.home ?? '\u0000', '~') : t('composer.pickFolder')}
              </text>
              <Icon name="chevronRight" size={16} color={C['text-tertiary']} />
            </Pressable>
            <Pressable className="hc-row" pressedClassName="hc-row-pressed" onTap={() => setSheet('agent')}>
              <AgentAvatar agent={agent} size={22} />
              <text className="t-body grow" style={{ marginLeft: '12px' }}>
                {AGENT_NAME[agent]}
              </text>
              <Icon name="chevronRight" size={16} color={C['text-tertiary']} />
            </Pressable>
          </view>
        )}
        <view className={`hc-box${expanded ? ' hc-box-on' : ''}`}>
          <textarea
            id="home-input"
            className="hc-input"
            placeholder={t('composer.placeholder', { agent: AGENT_NAME[agent] })}
            maxlines={6}
            bindfocus={() => setExpanded(true)}
            bindinput={(e: { detail: { value: string } }) => setText(e.detail.value)}
          />
          <view className="row" style={{ marginTop: '6px' }}>
            <Pressable className="hc-chip" pressedClassName="hc-chip-pressed" onTap={() => setSheet('mode')} style={{ flexShrink: 0 }}>
              <Icon name={MODE_ICON[mode]} size={15} color={mode === 'yolo' ? C.danger : C.primary} />
              <text className="t-callout" text-maxline="1" style={{ marginLeft: '6px' }}>
                {t(`mode.${mode}`)}
              </text>
            </Pressable>
            <Pressable className="hc-chip" pressedClassName="hc-chip-pressed" onTap={() => setSheet('model')} style={{ flexShrink: 1 }}>
              <Icon name="cpu" size={15} color={C.primary} />
              <text className="t-callout" text-maxline="1" style={{ marginLeft: '6px' }}>
                {currentModel ? translateModelText(lang, shortModelLabel(currentModel)) : t('model.default')}
              </text>
            </Pressable>
            {!expanded && !!cwd && (
              <text className="t-caption grow" text-maxline="1" style={{ marginLeft: '6px' }}>
                {projectName(cwd)}
              </text>
            )}
            <view className="grow" />
            <Pressable className={`hc-send${text.trim() ? '' : ' hc-send-off'}`} onTap={send} disabled={sending}>
              {sending ? <Spinner size={16} color={C['on-primary']} /> : <Icon name="arrowUp" size={20} color={C['on-primary']} />}
            </Pressable>
          </view>
        </view>
      </view>

      {sheet === 'folder' && (
        <view className="scrim" bindtap={() => setSheet(null)}>
          <view className="sheet" catchtap={() => {}} style={{ padding: '8px 16px 20px 16px' }}>
            <view className="sheet-handle" />
            <text className="t-headline" style={{ marginBottom: '12px' }}>
              {t('new.folder')}
            </text>
            <FolderPicker
              cwd={cwd}
              t={t}
              maxHeight={340}
              onChange={(p) => {
                setCwd(p);
                kvSet('home.cwd', p);
              }}
            />
          </view>
        </view>
      )}
      <ActionSheet
        open={sheet === 'agent'}
        onClose={() => setSheet(null)}
        title={t('new.agent')}
        actions={(['claude', 'codex'] as AgentKind[]).map((a) => ({
          label: `${AGENT_NAME[a]}${agent === a ? '  ✓' : ''}`,
          subtitle: agentInstalled(a) ? undefined : t('agent.notInstalled'),
          icon: 'robot' as const,
          onTap: () => {
            if (!agentInstalled(a) || a === agent) return;
            setAgent(a);
            setModel(null);
          },
        }))}
      />
      <ActionSheet
        open={sheet === 'mode'}
        onClose={() => setSheet(null)}
        title={t('new.mode')}
        actions={PERMISSION_MODES.map((m) => ({
          label: `${t(`mode.${m}`)}${mode === m ? '  ✓' : ''}`,
          subtitle: t(`mode.${m}.hint`),
          icon: MODE_ICON[m],
          danger: m === 'yolo',
          onTap: () => setMode(m),
        }))}
      />
      <ActionSheet
        open={sheet === 'model'}
        onClose={() => setSheet(null)}
        title={models ? t('model.title') : t('model.loading')}
        actions={(models ?? []).map((m) => ({
          label: `${translateModelText(lang, m.label)}${currentModel?.id === m.id ? '  ✓' : ''}`,
          subtitle: translateModelText(lang, m.description),
          icon: 'cpu' as const,
          onTap: () => setModel(m.isDefault && m.id === 'default' ? null : m.id),
        }))}
      />
    </>
  );
}

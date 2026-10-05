import { useEffect, useInitData, useState } from '@lynx-js/react';
import { translateModelText } from '@reilai/i18n';
import { type AgentKind, PERMISSION_MODES, type PermissionMode } from '@reilai/protocol';

import { findModel, useHello, useModels } from '../../shared/data';
import { dismiss, kvGet, kvSet, push, rpc, selectTab } from '../../shared/host';
import { useLanguage, useLayout } from '../../shared/hooks';
import { C } from '../../shared/theme';
import { AgentAvatar } from '../../ui/agent';
import { FolderPicker } from '../../ui/FolderPicker';
import { ActionSheet, Button, Cell, Header, Icon, IconButton, Pressable, Toast } from '../../ui/kit';
import './new.css';

const MODE_ICON = { ask: 'shieldCheck', edits: 'edit', plan: 'task', yolo: 'bolt' } as const;

export function NewSession() {
  const init = useInitData();
  const asTab = init.asTab === true;
  const { t, lang } = useLanguage();
  const { safeTop, safeBottom, desktop } = useLayout();
  const hello = useHello();
  const [agent, setAgent] = useState<AgentKind>('claude');
  const [mode, setMode] = useState<PermissionMode>('ask');
  const [model, setModel] = useState<string | null>(null);
  const [modelSheet, setModelSheet] = useState(false);
  const models = useModels(agent);
  const selectedModel = findModel(models, model);
  const [cwd, setCwd] = useState('');
  const [starting, setStarting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 2800);
  };

  useEffect(() => {
    rpc('fs.recent', {})
      .then((list) => list[0] && setCwd((c) => c || list[0]!.path))
      .catch(() => {});
    kvGet('new.agent').then((v) => (v === 'claude' || v === 'codex') && setAgent(v));
    kvGet('new.mode').then((v) => v && PERMISSION_MODES.includes(v as PermissionMode) && setMode(v as PermissionMode));
  }, []);


  useEffect(() => {
    if (!hello) return;
    const available = hello.agents.find((a) => a.agent === agent);
    if (available && !available.installed) {
      const other = hello.agents.find((a) => a.installed);
      if (other) setAgent(other.agent);
    }
  }, [hello]);

  const start = async () => {
    if (!cwd) return flash(t('new.noFolder'));
    setStarting(true);
    kvSet('new.agent', agent);
    kvSet('new.mode', mode);
    try {
      const session = await rpc('sessions.create', { agent, cwd, mode, model, startedBy: 'app' });
      if (asTab) {
        selectTab('sessions');
      } else dismiss();
      push('chat', { id: session.id });
    } catch (e) {
      flash((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const agentInfo = (a: AgentKind) => hello?.agents.find((x) => x.agent === a);

  return (
    <view className="root">
      <Header
        safeTop={asTab ? safeTop : desktop ? 0 : 6}
        title={t('new.title')}
        left={asTab ? undefined : <IconButton name={desktop ? 'closeLine' : 'chevronDown'} onTap={dismiss} />}
      />
      <scroll-view className="new-scroll" scroll-orientation="vertical">
        <text className="t-section group-label">{t('new.agent').toUpperCase()}</text>
        <view className="row" style={{ padding: '0 16px' }}>
          {(['claude', 'codex'] as AgentKind[]).map((a) => {
            const info = agentInfo(a);
            const on = agent === a;
            const disabled = info ? !info.installed : false;
            return (
              <Pressable
                key={a}
                className={`agent-card${on ? ' agent-card-on' : ''}`}
                style={{ marginRight: a === 'claude' ? '10px' : '0px', opacity: disabled ? 0.45 : 1 }}
                onTap={() => {
                  if (disabled || a === agent) return;
                  setAgent(a);
                  setModel(null);
                }}
              >
                <AgentAvatar agent={a} size={36} />
                <text className="t-body bold" style={{ marginTop: '10px' }}>
                  {a === 'claude' ? t('agent.claude') : t('agent.codex')}
                </text>
                <text className="t-caption">{info ? (info.installed ? `v${info.version ?? '?'}` : t('agent.notInstalled')) : ' '}</text>
                {on && (
                  <view className="agent-check">
                    <Icon name="check" size={18} color={C.primary} />
                  </view>
                )}
              </Pressable>
            );
          })}
        </view>

        <text className="t-section group-label">{t('model.title').toUpperCase()}</text>
        <view className="card" style={{ margin: '0 16px' }}>
          <Cell
            icon="cpu"
            title={selectedModel ? translateModelText(lang, selectedModel.label) : models ? (model ?? t('model.default')) : t('model.loading')}
            subtitle={translateModelText(lang, selectedModel?.description)}
            chevron
            onTap={() => setModelSheet(true)}
          />
        </view>

        <text className="t-section group-label">{t('new.folder').toUpperCase()}</text>
        <view style={{ padding: '0 16px' }}>
          <FolderPicker cwd={cwd} onChange={setCwd} t={t} />
        </view>

        <text className="t-section group-label">{t('new.mode').toUpperCase()}</text>
        <view className="card" style={{ margin: '0 16px' }}>
          {PERMISSION_MODES.map((m) => (
            <Pressable key={m} className="cell" pressedClassName="cell-pressed" onTap={() => setMode(m)}>
              <view className="cell-icon" style={{ backgroundColor: m === 'yolo' ? C['danger-soft'] : C['primary-soft'] }}>
                <Icon name={MODE_ICON[m]} size={17} color={m === 'yolo' ? C.danger : C.primary} />
              </view>
              <view className="col grow">
                <text className="t-body">{t(`mode.${m}`)}</text>
                <text className="t-caption">{t(`mode.${m}.hint`)}</text>
              </view>
              <view className={`radio${mode === m ? ' radio-on' : ''}`}>{mode === m && <view className="radio-dot" />}</view>
            </Pressable>
          ))}
        </view>

        <view style={{ height: '120px' }} />
      </scroll-view>

      <view className="new-footer" style={{ paddingBottom: `${12 + (asTab ? 0 : safeBottom)}px` }}>
        <view className="row" style={{ marginBottom: '10px' }}>
          <Icon name="folder" size={14} color={C['text-tertiary']} />
          <text className="t-caption grow" text-maxline="1" style={{ marginLeft: '6px' }}>
            {cwd || t('new.noFolder')}
          </text>
        </view>
        <Button
          label={starting ? t('new.starting') : t('new.start')}
          icon="play"
          loading={starting}
          disabled={!cwd}
          onTap={start}
        />
      </view>
      <ActionSheet
        open={modelSheet}
        onClose={() => setModelSheet(false)}
        title={models ? t('model.title') : t('model.loading')}
        actions={(models ?? []).map((m) => ({
          label: `${translateModelText(lang, m.label)}${selectedModel?.id === m.id ? '  ✓' : ''}`,
          subtitle: translateModelText(lang, m.description),
          icon: 'cpu' as const,
          onTap: () => setModel(m.isDefault && m.id === 'default' ? null : m.id),
        }))}
      />
      <Toast text={toast} />
    </view>
  );
}


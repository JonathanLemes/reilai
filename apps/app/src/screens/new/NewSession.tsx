import { useCallback, useEffect, useInitData, useState } from '@lynx-js/react';
import { type AgentKind, type DirEntry, PERMISSION_MODES, type PermissionMode } from '@reilai/protocol';

import { findModel, useHello, useModels } from '../../shared/data';
import { dismiss, kvGet, kvSet, push, rpc, selectTab } from '../../shared/host';
import { useLanguage, useLayout } from '../../shared/hooks';
import { C } from '../../shared/theme';
import { AgentAvatar } from '../../ui/agent';
import { ActionSheet, Button, Cell, Header, Icon, IconButton, Pressable, Segmented, Spinner, Toast } from '../../ui/kit';
import './new.css';

const MODE_ICON = { ask: 'shieldCheck', edits: 'edit', plan: 'task', yolo: 'bolt' } as const;

function FolderRow({ entry, selected, onTap, onOpen }: { entry: DirEntry; selected: boolean; onTap: () => void; onOpen?: () => void }) {
  return (
    <Pressable className={`frow${selected ? ' frow-on' : ''}`} pressedClassName="frow-pressed" onTap={onTap}>
      <Icon name={entry.isGitRepo ? 'folderCode' : 'folder'} size={20} color={selected ? C.primary : C['text-secondary']} />
      <view className="col grow" style={{ marginLeft: '10px', minWidth: '0px' }}>
        <text className="t-body" text-maxline="1" style={selected ? { color: C.primary, fontWeight: '600' } : undefined}>
          {entry.name}
        </text>
        <text className="t-caption" text-maxline="1">
          {entry.path}
        </text>
      </view>
      {entry.isGitRepo && (
        <view className="pill" style={{ backgroundColor: C['surface-2'], marginRight: '6px' }}>
          <text className="t-caption">git</text>
        </view>
      )}
      {onOpen && (
        <view bindtap={onOpen} style={{ padding: '6px' }} catchtap={onOpen}>
          <Icon name="chevronRight" size={18} color={C['text-tertiary']} />
        </view>
      )}
    </Pressable>
  );
}

export function NewSession() {
  const init = useInitData();
  const asTab = init.asTab === true;
  const { t } = useLanguage();
  const { safeTop, safeBottom, desktop } = useLayout();
  const hello = useHello();
  const [agent, setAgent] = useState<AgentKind>('claude');
  const [mode, setMode] = useState<PermissionMode>('ask');
  const [model, setModel] = useState<string | null>(null);
  const [modelSheet, setModelSheet] = useState(false);
  const models = useModels(agent);
  const selectedModel = findModel(models, model);
  const [cwd, setCwd] = useState('');
  const [tab, setTab] = useState<'recent' | 'browse'>('recent');
  const [recent, setRecent] = useState<DirEntry[] | null>(null);
  const [browse, setBrowse] = useState<{ path: string; parent: string | null; entries: DirEntry[] } | null>(null);
  const [prompt, setPrompt] = useState('');
  const [starting, setStarting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 2800);
  };

  useEffect(() => {
    rpc('fs.recent', {})
      .then((list) => {
        setRecent(list);
        if (list[0]) setCwd((c) => c || list[0]!.path);
        if (!list.length) setTab('browse');
      })
      .catch(() => setRecent([]));
    kvGet('new.agent').then((v) => (v === 'claude' || v === 'codex') && setAgent(v));
    kvGet('new.mode').then((v) => v && PERMISSION_MODES.includes(v as PermissionMode) && setMode(v as PermissionMode));
  }, []);

  const openDir = useCallback((path?: string) => {
    rpc('fs.list', { path })
      .then(setBrowse)
      .catch((e: Error) => flash(e.message));
  }, []);

  useEffect(() => {
    if (tab === 'browse' && !browse) openDir(cwd || undefined);
  }, [tab]);

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
      const session = await rpc('sessions.create', { agent, cwd, prompt: prompt.trim() || undefined, mode, model, startedBy: 'app' });
      if (asTab) {
        selectTab('sessions');
        lynx.createSelectorQuery().select('#prompt').invoke({ method: 'setValue', params: { value: '' } }).exec();
        setPrompt('');
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
            title={selectedModel?.label ?? (models ? (model ?? t('model.default')) : t('model.loading'))}
            subtitle={selectedModel?.description}
            chevron
            onTap={() => setModelSheet(true)}
          />
        </view>

        <text className="t-section group-label">{t('new.folder').toUpperCase()}</text>
        <view style={{ padding: '0 16px' }}>
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'recent', label: t('new.recent'), icon: 'history' },
              { value: 'browse', label: t('new.browse'), icon: 'folderOpen' },
            ]}
          />
          <view className="card" style={{ marginTop: '10px' }}>
            {tab === 'recent' ? (
              recent === null ? (
                <view className="center" style={{ padding: '18px' }}>
                  <Spinner />
                </view>
              ) : (
                recent.map((e) => <FolderRow key={e.path} entry={e} selected={cwd === e.path} onTap={() => setCwd(e.path)} />)
              )
            ) : browse === null ? (
              <view className="center" style={{ padding: '18px' }}>
                <Spinner />
              </view>
            ) : (
              <view>
                <view className="crumb">
                  {browse.parent && (
                    <view bindtap={() => openDir(browse.parent!)} style={{ marginRight: '6px' }}>
                      <Icon name="back" size={18} color={C.primary} />
                    </view>
                  )}
                  <text className="t-caption grow" text-maxline="1">
                    {browse.path}
                  </text>
                  <Button
                    small
                    variant={cwd === browse.path ? 'primary' : 'secondary'}
                    label={t('new.useThis')}
                    onTap={() => setCwd(browse.path)}
                  />
                </view>
                <scroll-view scroll-orientation="vertical" style={{ maxHeight: '300px' }}>
                  {browse.entries.length === 0 && (
                    <text className="t-sub" style={{ padding: '16px' }}>
                      {t('new.emptyDir')}
                    </text>
                  )}
                  {browse.entries.map((e) => (
                    <FolderRow key={e.path} entry={e} selected={cwd === e.path} onTap={() => setCwd(e.path)} onOpen={() => openDir(e.path)} />
                  ))}
                </scroll-view>
              </view>
            )}
          </view>
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

        <text className="t-section group-label">{t('new.prompt').toUpperCase()}</text>
        <view className="field" style={{ margin: '0 16px', alignItems: 'flex-start' }}>
          <textarea
            id="prompt"
            className="field-area"
            placeholder={t('new.promptPlaceholder')}
            maxlines={10}
            bindinput={(e: { detail: { value: string } }) => setPrompt(e.detail.value)}
          />
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
          label: `${m.label}${selectedModel?.id === m.id ? '  ✓' : ''}`,
          subtitle: m.description,
          icon: 'cpu' as const,
          onTap: () => setModel(m.isDefault && m.id === 'default' ? null : m.id),
        }))}
      />
      <Toast text={toast} />
    </view>
  );
}


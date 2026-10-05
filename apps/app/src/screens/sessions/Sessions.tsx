import { useInitData, useInitDataChanged, useLynxGlobalEventListener, useMemo, useState } from '@lynx-js/react';
import { relativeTime } from '@reilai/i18n';
import { projectName, type Session } from '@reilai/protocol';

import { useSessions } from '../../shared/data';
import { openSession, present } from '../../shared/host';
import { useConnection, useLanguage, useLayout, useTick } from '../../shared/hooks';
import { C } from '../../shared/theme';
import { AgentAvatar, StatusBadge } from '../../ui/agent';
import { Button, EmptyState, Icon, IconButton, Logo, Pressable, Spinner } from '../../ui/kit';
import './sessions.css';

const DAY = 86_400_000;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

type Group = { key: string; title: string; items: Session[] };

function groupSessions(list: Session[], t: ReturnType<typeof useLanguage>['t']): Group[] {
  const active: Session[] = [];
  const today: Session[] = [];
  const yesterday: Session[] = [];
  const earlier: Session[] = [];
  const midnight = startOfToday();
  for (const s of list) {
    if (s.status === 'running' || s.status === 'waiting' || s.status === 'starting') active.push(s);
    else if (s.updatedAt >= midnight) today.push(s);
    else if (s.updatedAt >= midnight - DAY) yesterday.push(s);
    else earlier.push(s);
  }
  return [
    { key: 'active', title: t('sessions.active'), items: active },
    { key: 'today', title: t('time.today'), items: today },
    { key: 'yesterday', title: t('time.yesterday'), items: yesterday },
    { key: 'earlier', title: t('time.earlier'), items: earlier },
  ].filter((g) => g.items.length);
}

function SessionRow({ s, selected, onTap }: { s: Session; selected: boolean; onTap: () => void }) {
  const { t, lang } = useLanguage();
  return (
    <Pressable className={`srow${selected ? ' srow-on' : ''}`} pressedClassName="srow-pressed" onTap={onTap}>
      <AgentAvatar agent={s.agent} size={42} />
      <view className="col grow" style={{ marginLeft: '12px', minWidth: '0px' }}>
        <view className="row">
          <text className="t-body bold grow" text-maxline="1">
            {s.title || t('sessions.untitled')}
          </text>
          <text className="t-caption tertiary" style={{ marginLeft: '8px' }}>
            {relativeTime(lang, s.updatedAt)}
          </text>
        </view>
        <text className="t-sub" text-maxline="1" style={{ marginTop: '2px' }}>
          {s.preview || t('chat.emptyTitle')}
        </text>
        <view className="row" style={{ marginTop: '6px' }}>
          <Icon name="folder" size={13} color={C['text-tertiary']} />
          <text className="t-caption grow" text-maxline="1" style={{ marginLeft: '4px' }}>
            {projectName(s.cwd)}
          </text>
          <StatusBadge session={s} t={t} />
        </view>
      </view>
    </Pressable>
  );
}

export function Sessions() {
  const init = useInitData();
  const { t } = useLanguage();
  const { desktop, safeTop, safeBottom } = useLayout();
  const conn = useConnection();
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(init.selectedId ?? '');
  const { sessions, error, reload } = useSessions(archived);
  useTick();

  useInitDataChanged((data) => setSelected(data.selectedId ?? ''));
  useLynxGlobalEventListener('reil:selected', (arg: unknown) => {
    const v = (Array.isArray(arg) ? arg[0] : arg) as { id?: string } | undefined;
    setSelected(v?.id ?? '');
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!sessions || !q) return sessions ?? [];
    return sessions.filter((s) => `${s.title} ${s.preview} ${s.cwd}`.toLowerCase().includes(q));
  }, [sessions, query]);
  const groups = useMemo(() => groupSessions(filtered, t), [filtered, t]);
  const embedded = init.embedded === true;

  const newSession = () => present('new', {});

  return (
    <view className="root">
      <view style={{ height: `${safeTop}px` }} />
      <view className="large-title">
        {embedded && (
          <view style={{ marginRight: '10px' }}>
            <Logo size={26} />
          </view>
        )}
        <text className={embedded ? 't-headline grow' : 't-title grow'} style={embedded ? { fontSize: '20px' } : undefined}>
          {embedded ? 'ReilAI' : t('sessions.title')}
        </text>
        <IconButton name={archived ? 'history' : 'archive'} onTap={() => setArchived((a) => !a)} color={archived ? C.primary : C['text-secondary']} />
        {desktop && <IconButton name="add" onTap={newSession} color={C.primary} size={26} />}
      </view>

      <view className="row" style={{ padding: '0 16px 10px 16px' }}>
        <view className="search grow">
          <Icon name="search" size={17} color={C['text-tertiary']} />
          <input
            className="search-input"
            placeholder={t('sessions.searchPlaceholder')}
            bindinput={(e: { detail: { value: string } }) => setQuery(e.detail.value)}
          />
        </view>
      </view>

      {conn.state !== 'connected' && (
        <view className="banner">
          {conn.state === 'connecting' ? <Spinner size={14} color={C.warning} /> : <Icon name="danger" size={16} color={C.warning} />}
          <text className="t-callout" style={{ marginLeft: '8px', color: C.warning }}>
            {conn.state === 'connecting' ? t('conn.connecting') : t('conn.offline')}
          </text>
        </view>
      )}

      {archived && (
        <text className="t-section" style={{ padding: '0 20px 6px 20px' }}>
          {t('sessions.archived').toUpperCase()}
        </text>
      )}

      {sessions === null && !error ? (
        <view className="empty">
          <Spinner />
        </view>
      ) : error && !sessions ? (
        <EmptyState icon="danger" title={t('error.load')} body={error} action={<Button small label={t('common.retry')} onTap={reload} />} />
      ) : !filtered.length ? (
        query ? (
          <EmptyState icon="search" title={t('sessions.noResults', { q: query })} />
        ) : (
          <EmptyState
            icon="logo"
            title={t('sessions.emptyTitle')}
            body={t('sessions.emptyBody')}
            action={!archived && <Button label={t('sessions.start')} icon="add" onTap={newSession} />}
          />
        )
      ) : (
        <list className="slist" list-type="single" span-count={1} scroll-orientation="vertical">
          {groups.flatMap((g) => [
            <list-item item-key={`h-${g.key}`} key={`h-${g.key}`}>
              <text className="t-section group-title">{g.title.toUpperCase()}</text>
            </list-item>,
            ...g.items.map((s) => (
              <list-item item-key={s.id} key={s.id}>
                <SessionRow
                  s={s}
                  selected={selected === s.id}
                  onTap={() => {
                    setSelected(s.id);
                    openSession(s.id);
                  }}
                />
              </list-item>
            )),
          ])}
          <list-item item-key="pad" key="pad">
            <view style={{ height: `${96 + safeBottom}px` }} />
          </list-item>
        </list>
      )}

      {!desktop && !embedded && (
        <Pressable className="fab" pressedClassName="fab-pressed" onTap={newSession} style={{ bottom: `${20 + safeBottom}px` }}>
          <Icon name="plus" size={26} color={C['on-primary']} />
        </Pressable>
      )}
    </view>
  );
}

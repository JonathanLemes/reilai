import { useCallback, useEffect, useState } from '@lynx-js/react';
import type { MessageKey, Vars } from '@reilai/i18n';
import type { DirEntry } from '@reilai/protocol';

import { rpc } from '../shared/host';
import { C } from '../shared/theme';
import { Icon, Pressable, Segmented, Spinner } from './kit';
import './folder-picker.css';

type T = (key: MessageKey, vars?: Vars) => string;
type Listing = { path: string; parent: string | null; entries: DirEntry[] };

function FolderRow({ entry, selected, onTap, chevron }: { entry: DirEntry; selected: boolean; onTap: () => void; chevron?: boolean }) {
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
      {chevron && <Icon name="chevronRight" size={18} color={C['text-tertiary']} />}
    </Pressable>
  );
}

/**
 * Recent folders + a browser of the computer's folders. In the browser, the
 * folder you are looking at is the selected one: one tap opens it and selects it.
 */
export function FolderPicker({ cwd, onChange, t, maxHeight = 320 }: { cwd: string; onChange: (path: string) => void; t: T; maxHeight?: number }) {
  const [tab, setTab] = useState<'recent' | 'browse'>('recent');
  const [recent, setRecent] = useState<DirEntry[] | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rpc('fs.recent', {})
      .then((list) => {
        setRecent(list);
        if (!list.length) setTab('browse');
      })
      .catch(() => setRecent([]));
  }, []);

  const open = useCallback(
    (path?: string, select = true) => {
      setError(null);
      rpc('fs.list', { path })
        .then((l) => {
          setListing(l);
          if (select) onChange(l.path);
        })
        .catch((e: Error) => setError(e.message));
    },
    [onChange],
  );

  useEffect(() => {
    if (tab === 'browse' && !listing) open(cwd || undefined, !cwd);
  }, [tab]);

  return (
    <view>
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
            <scroll-view scroll-orientation="vertical" style={{ maxHeight: `${maxHeight}px` }}>
              {recent.map((e) => (
                <FolderRow key={e.path} entry={e} selected={cwd === e.path} onTap={() => onChange(e.path)} />
              ))}
            </scroll-view>
          )
        ) : !listing ? (
          <view className="center" style={{ padding: '18px' }}>
            {error ? <text className="t-sub danger">{error}</text> : <Spinner />}
          </view>
        ) : (
          <view>
            <view className="crumb">
              {listing.parent && (
                <Pressable className="crumb-back" pressedClassName="cell-pressed" onTap={() => open(listing.parent!)}>
                  <Icon name="back" size={18} color={C.primary} />
                </Pressable>
              )}
              <text className="t-caption grow" text-maxline="1">
                {listing.path}
              </text>
              {cwd === listing.path ? (
                <view className="pill" style={{ backgroundColor: C['primary-soft'] }}>
                  <Icon name="check" size={13} color={C.primary} />
                  <text className="t-caption" style={{ marginLeft: '4px', color: C.primary, fontWeight: '600' }}>
                    {t('new.selected')}
                  </text>
                </view>
              ) : (
                <Pressable className="pill" style={{ backgroundColor: C['surface-2'] }} onTap={() => onChange(listing.path)}>
                  <text className="t-caption" style={{ fontWeight: '600' }}>
                    {t('new.useThis')}
                  </text>
                </Pressable>
              )}
            </view>
            <scroll-view scroll-orientation="vertical" style={{ maxHeight: `${maxHeight}px` }}>
              {listing.entries.length === 0 && (
                <text className="t-sub" style={{ padding: '16px' }}>
                  {t('new.emptyDir')}
                </text>
              )}
              {listing.entries.map((e) => (
                <FolderRow key={e.path} entry={e} selected={false} chevron onTap={() => open(e.path)} />
              ))}
            </scroll-view>
            {!!error && (
              <text className="t-caption danger" style={{ padding: '8px 14px' }}>
                {error}
              </text>
            )}
          </view>
        )}
      </view>
    </view>
  );
}

import { useEffect, useInitData, useMemo, useState } from '@lynx-js/react';
import type { DirEntry, FileContent } from '@reilai/protocol';

import { copyText, pop, rpc } from '../../shared/host';
import { useLanguage, useLayout, useSelectable } from '../../shared/hooks';
import { C } from '../../shared/theme';
import { Button, EmptyState, Header, Icon, IconButton, Pressable, Spinner } from '../../ui/kit';
import { Markdown, preserveIndent } from '../../ui/Markdown';
import './file.css';

type Entry = { path: string };
type Loaded =
  | { kind: 'dir'; path: string; parent: string | null; entries: DirEntry[] }
  | { kind: 'file'; file: FileContent }
  | { kind: 'error'; message: string };

const MAX_LINES = 4000;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileIcon(entry: DirEntry) {
  if (entry.isDir) return entry.isGitRepo ? 'folderCode' : 'folder';
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(entry.name) ? 'image' : 'file';
}

/** Text with a line-number gutter; both columns share font and line height so they stay aligned. */
function CodeView({ text }: { text: string }) {
  const sel = useSelectable();
  const { numbers, body, cut } = useMemo(() => {
    const lines = text.split('\n');
    const shown = lines.slice(0, MAX_LINES);
    return {
      numbers: shown.map((_, i) => String(i + 1)).join('\n'),
      body: preserveIndent(shown.join('\n')),
      cut: lines.length > MAX_LINES,
    };
  }, [text]);
  return (
    <view>
      <scroll-view scroll-orientation="horizontal" className="code-scroll">
        <view className="row" style={{ alignItems: 'flex-start' }}>
          <text className="t-mono code-gutter">{numbers}</text>
          <text className="t-mono code-body" {...sel}>
            {body}
          </text>
        </view>
      </scroll-view>
      {cut && <text className="t-caption" style={{ padding: '10px 16px' }}>{`… ${MAX_LINES}+`}</text>}
    </view>
  );
}

export function FileViewer() {
  const init = useInitData();
  const { t } = useLanguage();
  const { safeTop, safeBottom } = useLayout();
  const cwd = init.cwd ?? '';
  const [history, setHistory] = useState<Entry[]>([{ path: init.path ?? cwd }]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [copied, setCopied] = useState(false);
  const current = history[history.length - 1]!;

  useEffect(() => {
    setLoaded(null);
    // folders and files share the screen: try the folder listing first, then the file
    rpc('fs.list', { path: current.path.startsWith('/') || current.path.startsWith('~') ? current.path : `${cwd}/${current.path}`, files: true })
      .then((l) => setLoaded({ kind: 'dir', ...l }))
      .catch(() =>
        rpc('fs.read', { path: current.path, cwd })
          .then((file) => setLoaded({ kind: 'file', file }))
          .catch((e: Error) => setLoaded({ kind: 'error', message: e.message })),
      );
  }, [current.path]);

  const open = (path: string) => setHistory((h) => [...h, { path }]);
  const back = () => (history.length > 1 ? setHistory((h) => h.slice(0, -1)) : pop());
  const up = loaded?.kind === 'dir' && loaded.parent ? loaded.parent : null;

  const title =
    loaded?.kind === 'file' ? loaded.file.name : loaded?.kind === 'dir' ? loaded.path.split('/').filter(Boolean).pop() || '/' : t('files.title');
  const subtitle = loaded?.kind === 'file' ? loaded.file.path : loaded?.kind === 'dir' ? loaded.path : '';

  return (
    <view className="root">
      <Header
        safeTop={safeTop}
        left={<IconButton name="back" tip={t('common.back')} onTap={back} />}
        title={title}
        subtitle={
          !!subtitle && (
            <text className="t-caption" text-maxline="1">
              {subtitle}
            </text>
          )
        }
        right={
          loaded?.kind === 'file' ? (
            <IconButton
              name={copied ? 'checkLine' : 'copy'}
              color={copied ? C.success : undefined}
              tip={copied ? t('common.copied') : t('common.copy')}
              onTap={() => {
                copyText(loaded.file.kind === 'text' ? loaded.file.content : loaded.file.path);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
            />
          ) : up ? (
            <IconButton name="chevronUp" tip={t('tip.parent')} onTap={() => open(up)} />
          ) : undefined
        }
      />
      <view className="chat-divider" style={{ height: '1px', backgroundColor: C.border }} />

      {!loaded ? (
        <view className="empty">
          <Spinner />
        </view>
      ) : loaded.kind === 'error' ? (
        <EmptyState icon="danger" title={t('error.load')} body={loaded.message} action={<Button small variant="secondary" label={t('common.back')} onTap={back} />} />
      ) : loaded.kind === 'dir' ? (
        loaded.entries.length === 0 ? (
          <EmptyState icon="folderOpen" title={t('files.empty')} />
        ) : (
          <list className="file-list" list-type="single" span-count={1} scroll-orientation="vertical">
            {loaded.entries.map((e) => (
              <list-item item-key={e.path} key={e.path}>
                <Pressable className="file-row" pressedClassName="cell-pressed" onTap={() => open(e.path)}>
                  <Icon name={fileIcon(e)} size={20} color={e.isDir ? C.primary : C['text-secondary']} />
                  <text className="t-body grow" text-maxline="1" style={{ marginLeft: '12px' }}>
                    {e.name}
                  </text>
                  {e.isDir ? (
                    <Icon name="chevronRight" size={16} color={C['text-tertiary']} />
                  ) : (
                    <text className="t-caption">{formatSize(e.size ?? 0)}</text>
                  )}
                </Pressable>
              </list-item>
            ))}
            <list-item item-key="pad" key="pad">
              <view style={{ height: `${24 + safeBottom}px` }} />
            </list-item>
          </list>
        )
      ) : loaded.file.kind === 'image' ? (
        <view className="image-wrap">
          <image src={loaded.file.content} mode="aspectFit" className="image-full" />
          <text className="t-caption" style={{ marginTop: '10px' }}>
            {`${loaded.file.mime} · ${formatSize(loaded.file.size)}`}
          </text>
        </view>
      ) : loaded.file.kind === 'binary' ? (
        <EmptyState icon="file" title={loaded.file.name} body={t('files.binary', { size: formatSize(loaded.file.size) })} />
      ) : (
        <scroll-view scroll-orientation="vertical" style={{ flex: 1, width: '100%' }}>
          {loaded.file.truncated && (
            <view className="banner" style={{ marginTop: '10px' }}>
              <text className="t-callout" style={{ color: C.warning }}>
                {t('files.truncated')}
              </text>
            </view>
          )}
          {/\.(md|markdown)$/i.test(loaded.file.name) ? (
            <view style={{ padding: '16px 18px' }}>
              <Markdown text={loaded.file.content} />
            </view>
          ) : (
            <CodeView text={loaded.file.content} />
          )}
          <view style={{ height: `${24 + safeBottom}px` }} />
        </scroll-view>
      )}
    </view>
  );
}

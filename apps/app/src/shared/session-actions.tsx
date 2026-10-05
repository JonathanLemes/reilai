import { useState } from '@lynx-js/react';
import type { MessageKey, Vars } from '@reilai/i18n';
import type { Session } from '@reilai/protocol';

import { openFile } from '../screens/chat/parts';
import { ActionSheet, ConfirmDialog, PromptDialog } from '../ui/kit';
import { rpc } from './host';

type T = (key: MessageKey, vars?: Vars) => string;

export function isLive(s: Session) {
  return s.status === 'running' || s.status === 'waiting' || s.status === 'starting';
}

export function hasProcess(s: Session) {
  return isLive(s) || s.status === 'idle';
}

/**
 * One set of session actions for the chat menu, the long press on the list and the
 * swipe-to-archive: same options, same confirmations everywhere.
 */
export function useSessionActions({
  t,
  flash,
  onDeleted,
  onArchived,
}: {
  t: T;
  flash: (text: string) => void;
  onDeleted?: (s: Session) => void;
  onArchived?: (s: Session) => void;
}) {
  const [menu, setMenu] = useState<Session | null>(null);
  const [renaming, setRenaming] = useState<Session | null>(null);
  const [deleting, setDeleting] = useState<Session | null>(null);
  const [archiving, setArchiving] = useState<Session | null>(null);

  const act = (p: Promise<unknown>) => p.catch((e: Error) => flash(e.message));

  const doArchive = (s: Session) =>
    act(
      rpc('sessions.archive', { id: s.id, archived: true }).then(() => {
        flash(t('sessions.archivedToast'));
        onArchived?.(s);
      }),
    );

  /** Archiving ends the agent: ask first when it is working right now. */
  const requestArchive = (s: Session) => {
    if (s.archived) return act(rpc('sessions.archive', { id: s.id, archived: false }));
    if (isLive(s)) setArchiving(s);
    else doArchive(s);
  };

  const resume = (s: Session) => act(rpc('sessions.resume', { id: s.id }));

  const actions = (s: Session) => [
    ...(!hasProcess(s) || s.archived ? [{ label: t('chat.menu.resume'), icon: 'play' as const, onTap: () => resume(s) }] : []),
    { label: t('chat.menu.files'), icon: 'folderOpen' as const, onTap: () => openFile(s.cwd, s.cwd) },
    { label: t('common.rename'), icon: 'rename' as const, onTap: () => setRenaming(s) },
    ...(isLive(s) ? [{ label: t('chat.stop'), icon: 'stop' as const, onTap: () => act(rpc('sessions.interrupt', { id: s.id })) }] : []),
    ...(hasProcess(s) ? [{ label: t('chat.menu.stopAgent'), icon: 'close' as const, onTap: () => act(rpc('sessions.stop', { id: s.id })) }] : []),
    {
      label: s.archived ? t('chat.menu.unarchive') : t('chat.menu.archive'),
      icon: 'archive' as const,
      onTap: () => requestArchive(s),
    },
    { label: t('chat.menu.delete'), icon: 'trash' as const, danger: true, onTap: () => setDeleting(s) },
  ];

  const elements = (
    <>
      <ActionSheet open={!!menu} onClose={() => setMenu(null)} title={menu ? menu.title || t('sessions.untitled') : ''} actions={menu ? actions(menu) : []} />
      <PromptDialog
        key={renaming?.id ?? 'none'}
        open={!!renaming}
        title={t('chat.renamePrompt')}
        initial={renaming?.title ?? ''}
        confirmLabel={t('common.save')}
        cancelLabel={t('common.cancel')}
        onClose={() => setRenaming(null)}
        onSubmit={(title) => renaming && act(rpc('sessions.rename', { id: renaming.id, title }))}
      />
      <ConfirmDialog
        open={!!deleting}
        title={t('chat.deleteConfirm')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          const s = deleting;
          if (s) act(rpc('sessions.delete', { id: s.id }).then(() => onDeleted?.(s)));
        }}
      />
      <ConfirmDialog
        open={!!archiving}
        title={t('sessions.archiveRunning')}
        confirmLabel={t('sessions.archiveAnyway')}
        cancelLabel={t('common.cancel')}
        danger
        onClose={() => setArchiving(null)}
        onConfirm={() => archiving && doArchive(archiving)}
      />
    </>
  );

  return { openMenu: setMenu, requestArchive, resume, elements };
}

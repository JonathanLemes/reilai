import { useCallback, useEffect, useLynxGlobalEventListener, useState } from '@lynx-js/react';
import type { AgentAvailability, AgentKind, MachineInfo, Message, ModelOption, Session, Settings } from '@reilai/protocol';

import { rpc } from './host';
import { useServerEvent } from './hooks';

/** Re-runs `load` whenever the host reconnects to the computer. */
function useOnReconnect(load: () => void) {
  useLynxGlobalEventListener('reil:connection', (arg: unknown) => {
    const next = (Array.isArray(arg) ? arg[0] : arg) as { state?: string } | undefined;
    if (next?.state === 'connected') load();
  });
}

function sortSessions(list: Session[]) {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Live session list: one fetch, then every change arrives as an event. */
export function useSessions(archived = false) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    rpc('sessions.list', { archived })
      .then((list) => {
        setSessions(sortSessions(list));
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [archived]);

  useEffect(load, [load]);
  useOnReconnect(load);

  useServerEvent((event, data) => {
    if (event === 'session.upsert') {
      const s = data as Session;
      setSessions((list) => {
        if (!list) return list;
        const rest = list.filter((x) => x.id !== s.id);
        return s.archived === archived ? sortSessions([s, ...rest]) : rest;
      });
    } else if (event === 'session.removed') {
      const { id } = data as { id: string };
      setSessions((list) => list?.filter((x) => x.id !== id) ?? list);
    }
  });

  return { sessions, error, reload: load };
}

function mergeMessage(list: Message[], m: Message): Message[] {
  const index = list.findIndex((x) => x.id === m.id);
  if (index >= 0) {
    const next = list.slice();
    next[index] = m;
    return next;
  }
  if (!list.length || list[list.length - 1]!.seq < m.seq) return [...list, m];
  return [...list, m].sort((a, b) => a.seq - b.seq);
}

/** Live conversation: history page + streamed updates for this session only. */
export function useConversation(id: string | undefined) {
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!id) return;
    rpc('sessions.get', { id, limit: 120 })
      .then((r) => {
        setSession(r.session);
        setMessages(r.messages);
        setHasMore(r.hasMore);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    setSession(null);
    load();
  }, [load]);
  useOnReconnect(load);

  const loadOlder = useCallback(() => {
    if (!id || !hasMore || !messages.length) return;
    rpc('sessions.get', { id, limit: 80, before: messages[0]!.seq }).then((r) => {
      setMessages((list) => [...r.messages, ...list]);
      setHasMore(r.hasMore);
    });
  }, [id, hasMore, messages]);

  useServerEvent((event, data) => {
    if (event === 'message.append' || event === 'message.update') {
      const m = data as Message;
      if (m.sessionId === id) setMessages((list) => mergeMessage(list, m));
    } else if (event === 'session.upsert') {
      const s = data as Session;
      if (s.id === id) setSession(s);
    } else if (event === 'session.removed' && (data as { id: string }).id === id) {
      setSession(null);
      setError('deleted');
    }
  });

  return { session, messages, hasMore, error, loading, loadOlder, reload: load };
}

export interface HelloInfo {
  machine: MachineInfo;
  settings: Settings;
  agents: AgentAvailability[];
}

export function useHello() {
  const [info, setInfo] = useState<HelloInfo | null>(null);
  const load = useCallback(() => {
    rpc('hello', { client: 'app' })
      .then(setInfo)
      .catch(() => {});
  }, []);
  useEffect(load, [load]);
  useOnReconnect(load);
  useServerEvent((event, data) => {
    if (event === 'settings.changed') setInfo((i) => (i ? { ...i, settings: data as Settings } : i));
  });
  return info;
}

const modelCache = new Map<AgentKind, Promise<ModelOption[]>>();

/** Models the agent offers (fetched once per screen and agent). */
export function useModels(agent: AgentKind | undefined) {
  const [models, setModels] = useState<ModelOption[] | null>(null);
  useEffect(() => {
    if (!agent) return;
    setModels(null);
    let request = modelCache.get(agent);
    if (!request) {
      request = rpc('agents.models', { agent });
      modelCache.set(agent, request);
      request.catch(() => modelCache.delete(agent));
    }
    let alive = true;
    request.then((list) => alive && setModels(list)).catch(() => alive && setModels([]));
    return () => {
      alive = false;
    };
  }, [agent]);
  return models;
}

/** The option a session's stored model points to (alias, full id or null = default). */
export function findModel(models: ModelOption[] | null, model: string | null | undefined): ModelOption | undefined {
  if (!models) return undefined;
  if (!model) return models.find((m) => m.isDefault) ?? models[0];
  return models.find((m) => m.id === model || m.resolved === model);
}

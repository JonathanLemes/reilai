import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';

import {
  type AgentKind,
  type ClientKind,
  type Message,
  type PermissionDecision,
  type PermissionMode,
  RpcError,
  type ServerEventName,
  type ServerEvents,
  type Session,
} from '@reilai/protocol';

import { ClaudeRunner } from '../agents/claude';
import { CodexRunner } from '../agents/codex';
import type { AgentRunner, RunnerHost } from '../agents/types';
import type { Store } from './store';

export type Broadcast = <E extends ServerEventName>(event: E, data: ServerEvents[E]) => void;

const STREAM_FLUSH_MS = 50;
const TITLE_MAX = 64;

function newId() {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

function preview(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 140);
}

/** Runtime state of a session whose agent process is alive. */
class LiveSession implements RunnerHost {
  runner: AgentRunner | null = null;
  private items = new Map<string, Message>();
  private tools = new Map<string, Message>();
  private permissions = new Map<string, { message: Message; resolve: (d: PermissionDecision) => void }>();
  private dirty = new Set<Message>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private turnStartedAt = 0;

  constructor(
    private readonly manager: SessionManager,
    readonly sessionId: string,
  ) {}

  private get session(): Session {
    const s = this.manager.store.getSession(this.sessionId);
    if (!s) throw new RpcError('not_found', 'Session not found');
    return s;
  }

  get cwd() {
    return this.session.cwd;
  }
  get mode() {
    return this.session.mode;
  }
  get agentRef() {
    return this.session.agentRef;
  }

  private streamed(map: Map<string, Message>, item: string, kind: 'text' | 'thinking'): Message {
    let message = map.get(item);
    if (!message) {
      message = this.manager.append(this.sessionId, { role: 'agent', kind, text: '', streaming: true });
      map.set(item, message);
    }
    return message;
  }

  private scheduleFlush(message: Message) {
    this.dirty.add(message);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      for (const m of this.dirty) this.manager.broadcast('message.update', m);
      this.dirty.clear();
    }, STREAM_FLUSH_MS);
  }

  private finish(message: Message, text: string) {
    message.text = text;
    message.streaming = false;
    this.dirty.delete(message);
    this.manager.update(message);
  }

  textDelta(item: string, delta: string) {
    const m = this.streamed(this.items, item, 'text');
    m.text = (m.text ?? '') + delta;
    this.scheduleFlush(m);
  }

  textDone(item: string, text: string) {
    this.finish(this.streamed(this.items, item, 'text'), text);
    this.items.delete(item);
    this.manager.patch(this.sessionId, { preview: preview(text) });
  }

  thinkingDelta(item: string, delta: string) {
    const m = this.streamed(this.items, `think:${item}`, 'thinking');
    m.text = (m.text ?? '') + delta;
    this.scheduleFlush(m);
  }

  thinkingDone(item: string, text: string) {
    this.finish(this.streamed(this.items, `think:${item}`, 'thinking'), text);
    this.items.delete(`think:${item}`);
  }

  toolStart(callId: string, name: string, title: string, input: unknown) {
    const message = this.manager.append(this.sessionId, {
      role: 'agent',
      kind: 'tool',
      tool: { callId, name, title, input, status: 'running' },
    });
    this.tools.set(callId, message);
  }

  toolEnd(callId: string, output: string, isError: boolean) {
    const message = this.tools.get(callId);
    if (!message?.tool) return;
    message.tool = { ...message.tool, output, status: isError ? 'error' : 'done' };
    this.manager.update(message);
    this.tools.delete(callId);
  }

  turnStart() {
    this.turnStartedAt = Date.now();
    this.manager.patch(this.sessionId, { status: 'running', error: null });
  }

  turnEnd(status: 'completed' | 'failed' | 'interrupted', info: { durationMs?: number; costUsd?: number; error?: string } = {}) {
    this.closeOpenItems();
    this.manager.append(this.sessionId, {
      role: 'system',
      kind: 'event',
      event: {
        type: status === 'completed' ? 'turn-end' : 'error',
        text: status === 'interrupted' ? 'interrupted' : info.error,
        durationMs: info.durationMs ?? (this.turnStartedAt ? Date.now() - this.turnStartedAt : undefined),
        costUsd: info.costUsd,
      },
    });
    const pending = this.permissions.size;
    this.manager.patch(this.sessionId, { status: pending > 0 ? 'waiting' : 'idle' });
  }

  setAgentRef(ref: string) {
    if (ref !== this.session.agentRef) this.manager.patch(this.sessionId, { agentRef: ref });
  }

  setModel(model: string) {
    this.manager.patch(this.sessionId, { model });
  }

  modeChanged(mode: PermissionMode) {
    this.manager.patch(this.sessionId, { mode });
  }

  info(text: string) {
    this.manager.append(this.sessionId, { role: 'system', kind: 'event', event: { type: 'info', text } });
  }

  requestPermission(request: { tool: string; title: string; detail: string }): Promise<PermissionDecision> {
    const requestId = newId();
    const message = this.manager.append(this.sessionId, {
      role: 'agent',
      kind: 'permission',
      permission: { requestId, tool: request.tool, title: request.title, detail: request.detail, status: 'pending' },
    });
    return new Promise((resolve) => {
      this.permissions.set(requestId, { message, resolve });
      this.syncPending();
      this.manager.patch(this.sessionId, { status: 'waiting' });
    });
  }

  respond(requestId: string, decision: PermissionDecision) {
    const entry = this.permissions.get(requestId);
    if (!entry?.message.permission) throw new RpcError('not_found', 'This request is no longer pending');
    this.permissions.delete(requestId);
    entry.message.permission = {
      ...entry.message.permission,
      status: decision === 'deny' ? 'denied' : 'allowed',
      decision,
    };
    this.manager.update(entry.message);
    this.syncPending();
    this.manager.patch(this.sessionId, { status: this.permissions.size > 0 ? 'waiting' : 'running' });
    entry.resolve(decision);
  }

  private syncPending() {
    this.manager.store.pending.set(this.sessionId, this.permissions.size);
  }

  /** Denies and expires open approvals (interrupt, stop, crash). */
  expirePermissions() {
    for (const [, entry] of this.permissions) {
      if (entry.message.permission) entry.message.permission = { ...entry.message.permission, status: 'expired' };
      this.manager.update(entry.message);
      entry.resolve('deny');
    }
    this.permissions.clear();
    this.syncPending();
  }

  private closeOpenItems() {
    for (const m of this.items.values()) this.finish(m, m.text ?? '');
    this.items.clear();
    for (const m of this.tools.values()) {
      if (m.tool) m.tool = { ...m.tool, status: 'error' };
      this.manager.update(m);
    }
    this.tools.clear();
  }

  closed(error?: string) {
    this.closeOpenItems();
    this.expirePermissions();
    this.runner = null;
    this.manager.runnerClosed(this.sessionId, error);
  }
}

export class SessionManager {
  private live = new Map<string, LiveSession>();

  constructor(
    readonly store: Store,
    readonly broadcast: Broadcast,
  ) {}

  append(sessionId: string, fields: Omit<Message, 'id' | 'sessionId' | 'seq' | 'time'>): Message {
    const message: Message = { id: newId(), sessionId, seq: this.store.nextSeq(sessionId), time: Date.now(), ...fields };
    this.store.saveMessage(message);
    this.broadcast('message.append', message);
    this.patch(sessionId, {});
    return message;
  }

  update(message: Message) {
    this.store.saveMessage(message);
    this.broadcast('message.update', message);
  }

  patch(sessionId: string, patch: Partial<Session>): Session | null {
    const session = this.store.updateSession(sessionId, { ...patch, updatedAt: Date.now() });
    if (session) this.broadcast('session.upsert', session);
    return session;
  }

  get(id: string): Session {
    const session = this.store.getSession(id);
    if (!session) throw new RpcError('not_found', 'Session not found');
    return session;
  }

  create(params: {
    agent: AgentKind;
    cwd: string;
    prompt?: string;
    mode?: PermissionMode;
    model?: string | null;
    startedBy?: ClientKind;
  }): Session {
    if (params.agent !== 'claude' && params.agent !== 'codex') throw new RpcError('bad_request', 'Unknown agent');
    if (!existsSync(params.cwd) || !statSync(params.cwd).isDirectory()) {
      throw new RpcError('bad_request', `Folder not found: ${params.cwd}`);
    }
    const now = Date.now();
    const session: Session = {
      id: newId(),
      agent: params.agent,
      title: params.prompt ? params.prompt.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX) : '',
      cwd: params.cwd,
      status: 'idle',
      mode: params.mode ?? 'ask',
      model: params.model ?? null,
      createdAt: now,
      updatedAt: now,
      preview: '',
      agentRef: null,
      archived: false,
      pendingPermissions: 0,
      startedBy: params.startedBy ?? 'cli',
      error: null,
    };
    this.store.insertSession(session);
    this.store.touchRecentDir(params.cwd);
    this.broadcast('session.upsert', session);
    if (params.prompt?.trim()) {
      void this.send(session.id, params.prompt).catch(() => {});
    } else {
      this.ensureRunner(session.id);
    }
    return this.get(session.id);
  }

  private ensureRunner(id: string): LiveSession {
    const session = this.get(id);
    let live = this.live.get(id);
    if (!live) {
      live = new LiveSession(this, id);
      this.live.set(id, live);
    }
    if (!live.runner) {
      this.patch(id, { status: 'starting', error: null });
      try {
        live.runner =
          session.agent === 'claude' ? new ClaudeRunner(live, { model: session.model }) : new CodexRunner(live, { model: session.model });
        this.patch(id, { status: 'idle' });
      } catch (e) {
        this.patch(id, { status: 'error', error: (e as Error).message });
        throw new RpcError('agent_failed', (e as Error).message);
      }
    }
    return live;
  }

  async send(id: string, text: string) {
    const body = text.trim();
    if (!body) throw new RpcError('bad_request', 'Empty message');
    const session = this.get(id);
    this.append(id, { role: 'user', kind: 'text', text: body });
    this.patch(id, {
      preview: preview(body),
      title: session.title || body.replace(/\s+/g, ' ').slice(0, TITLE_MAX),
      archived: false,
    });
    const live = this.ensureRunner(id);
    try {
      await live.runner!.send(body);
    } catch (e) {
      this.patch(id, { status: 'error', error: (e as Error).message });
      throw new RpcError('agent_failed', (e as Error).message);
    }
  }

  async interrupt(id: string) {
    const live = this.live.get(id);
    live?.expirePermissions();
    await live?.runner?.interrupt();
  }

  async stop(id: string) {
    const live = this.live.get(id);
    if (live?.runner) await live.runner.close();
    else this.patch(id, { status: 'stopped' });
  }

  async setMode(id: string, mode: PermissionMode) {
    const session = this.patch(id, { mode });
    await this.live.get(id)?.runner?.setMode(mode);
    return session ?? this.get(id);
  }

  respond(sessionId: string, requestId: string, decision: PermissionDecision) {
    const live = this.live.get(sessionId);
    if (!live) throw new RpcError('not_found', 'The agent for this session is not running');
    live.respond(requestId, decision);
  }

  runnerClosed(id: string, error?: string) {
    if (!this.store.getSession(id)) return;
    this.patch(id, { status: error ? 'error' : 'stopped', error: error ?? null });
    if (error) this.append(id, { role: 'system', kind: 'event', event: { type: 'error', text: error } });
  }

  async remove(id: string) {
    await this.stop(id).catch(() => {});
    this.live.delete(id);
    this.store.deleteSession(id);
    this.broadcast('session.removed', { id });
  }

  async shutdown() {
    await Promise.all([...this.live.values()].map((l) => l.runner?.close()));
  }
}

import { chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Subprocess, spawn } from 'bun';

import type { PermissionDecision, PermissionMode } from '@reilai/protocol';

import { paths, VERSION } from '../config';
import { resultText } from './describe';
import { agentEnv } from './env';
import type { AgentRunner, RunnerHost, RunnerOptions } from './types';
import { UnixWebSocket } from './unix-ws';

type Json = Record<string, unknown>;

export const POLICY: Record<PermissionMode, { approval: string; sandbox: string }> = {
  ask: { approval: 'untrusted', sandbox: 'workspace-write' },
  edits: { approval: 'on-request', sandbox: 'workspace-write' },
  plan: { approval: 'on-request', sandbox: 'read-only' },
  yolo: { approval: 'never', sandbox: 'danger-full-access' },
};

function sandboxPolicy(mode: PermissionMode, cwd: string): Json {
  const sandbox = POLICY[mode].sandbox;
  if (sandbox === 'read-only') return { type: 'readOnly', networkAccess: false };
  if (sandbox === 'danger-full-access') return { type: 'dangerFullAccess' };
  return { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false };
}

function wire(decision: PermissionDecision, legacy: boolean): string {
  if (legacy) return decision === 'allow' ? 'approved' : decision === 'allow_session' ? 'approved_for_session' : 'denied';
  return decision === 'allow' ? 'accept' : decision === 'allow_session' ? 'acceptForSession' : 'decline';
}

/** Unix sockets are capped at ~108 bytes; a long REILAI_HOME falls back to a private tmp dir. */
function socketPath(sessionId: string): string {
  let dir = join(paths.home, 'run');
  if (join(dir, `${sessionId}.sock`).length > 100) dir = join(tmpdir(), `reilai-${process.getuid?.() ?? 'user'}`);
  mkdirSync(dir, { recursive: true });
  chmodSync(dir, 0o700);
  return join(dir, `${sessionId}.sock`);
}

function itemText(item: Json): string {
  if (!Array.isArray(item.content)) return '';
  return (item.content as { type?: string; text?: string }[])
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text)
    .join('\n');
}

function changesDetail(changes: unknown): string {
  if (!Array.isArray(changes)) return '';
  return (changes as { path?: string; diff?: string }[])
    .map((c) => `${c.path ?? ''}\n${c.diff ?? ''}`)
    .join('\n\n')
    .slice(0, 6000);
}

/**
 * Codex through `codex app-server` (JSON-RPC), one process per session, listening
 * on a private Unix socket. The daemon is one client; `codex --remote` (Codex's
 * own TUI, from `reilai codex`) can join as another. Both are subscribed to the
 * same thread, so turns, streaming and approvals show up in both, and an
 * approval answered in one is resolved in the other (`serverRequest/resolved`).
 */
export class CodexRunner implements AgentRunner {
  private proc: Subprocess<'ignore', 'ignore', 'pipe'>;
  private ws: UnixWebSocket | null = null;
  readonly socket: string;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private ready: Promise<void>;
  private threadId: string | null = null;
  private turnId: string | null = null;
  private mode: PermissionMode;
  private modeDirty = false;
  private model: string | null;
  private modelDirty = false;
  private fileChanges = new Map<string, unknown>();
  private exited = false;
  /** a thread has a rollout (and can be resumed by another client) after its first turn */
  private materialized = false;
  private startingThread = false;
  /** items already reported, so a backfill after joining a thread skips them */
  private seen = new Set<string>();
  /** texts we sent, to tell them apart from turns typed in the TUI */
  private sent: string[] = [];
  /** approval request id → item id, for approvals answered in the TUI */
  private settledElsewhere = new Map<string, string>();
  private openApprovals = new Map<string, string>();

  constructor(
    private readonly host: RunnerHost,
    private readonly options: RunnerOptions = {},
  ) {
    this.mode = host.mode;
    this.model = options.model && options.model !== 'default' ? options.model : null;
    const bin = process.env.REILAI_CODEX_PATH ?? Bun.which('codex') ?? 'codex';
    this.socket = socketPath(host.sessionId);
    rmSync(this.socket, { force: true });
    this.proc = spawn([bin, 'app-server', '--listen', `unix://${this.socket}`], {
      cwd: host.cwd,
      env: agentEnv(),
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'pipe',
    });
    void this.drainStderr();
    void this.proc.exited.then((code) => {
      this.exited = true;
      this.ws?.close();
      rmSync(this.socket, { force: true });
      for (const p of this.pending.values()) p.reject(new Error(`codex exited (${code})`));
      this.pending.clear();
      host.closed(code === 0 || code === 143 ? undefined : `codex app-server exited with code ${code}`);
    });
    this.ready = this.boot();
    this.ready.catch((e: Error) => {
      host.info(`Codex: ${e.message}`);
      this.proc.kill();
    });
  }

  private async connect() {
    const until = Date.now() + 15_000;
    while (!existsSync(this.socket)) {
      if (this.exited) throw new Error('codex app-server exited while starting');
      if (Date.now() > until) throw new Error('codex app-server did not open its socket');
      await Bun.sleep(50);
    }
    this.ws = await UnixWebSocket.connect(this.socket);
    this.ws.onmessage = (text) => this.onLine(text);
    this.ws.onclose = () => {
      if (!this.exited) this.proc.kill();
    };
  }

  private async boot() {
    await this.connect();
    await this.request('initialize', {
      clientInfo: { name: 'reilai', title: 'ReilAI', version: VERSION },
      capabilities: { experimentalApi: true },
    });
    this.notify('initialized');
    const { approval, sandbox } = POLICY[this.mode];
    const common = { cwd: this.host.cwd, approvalPolicy: approval, sandbox, model: this.model };
    let result: Json | null = null;
    if (this.host.agentRef) {
      try {
        result = (await this.request('thread/resume', { threadId: this.host.agentRef, ...common, excludeTurns: true })) as Json;
        this.materialized = true;
      } catch (e) {
        this.host.info(`Could not resume the Codex thread, starting a new one (${(e as Error).message})`);
      }
    }
    if (!result) {
      this.startingThread = true;
      try {
        result = (await this.request('thread/start', common)) as Json;
      } finally {
        this.startingThread = false;
      }
    }
    const thread = result.thread as { id: string };
    this.threadId = thread.id;
    this.host.setAgentRef(thread.id);
  }

  async remoteEndpoint() {
    await this.ready;
    return { socket: this.socket, threadId: this.materialized ? this.threadId : null };
  }

  /**
   * Another client (the TUI) started a thread: follow it. Joining needs its
   * rollout, which exists once the first turn starts, so retry until then and
   * backfill what was missed.
   */
  private adopt(threadId: string) {
    const previous = this.threadId;
    this.threadId = threadId;
    this.turnId = null;
    this.materialized = false;
    this.host.setAgentRef(threadId);
    if (previous && previous !== threadId) void this.request('thread/unsubscribe', { threadId: previous }).catch(() => {});
  }

  private joining = false;

  private async join(threadId: string) {
    if (this.joining) return;
    this.joining = true;
    try {
      for (let attempt = 0; attempt < 40 && this.threadId === threadId && !this.exited; attempt++) {
        try {
          const result = (await this.request('thread/resume', { threadId })) as { thread?: { turns?: Json[] } };
          this.materialized = true;
          this.backfill(result.thread?.turns ?? []);
          return;
        } catch {
          await Bun.sleep(250);
        }
      }
    } finally {
      this.joining = false;
    }
  }

  private backfill(turns: Json[]) {
    for (const turn of turns) {
      const items = Array.isArray(turn.items) ? (turn.items as (Json & { id: string; type: string })[]) : [];
      const running = turn.status === 'inProgress';
      if (running) {
        this.turnId = String(turn.id);
        this.host.turnStart();
      }
      for (const item of items) {
        if (this.seen.has(item.id)) continue;
        // in a running turn, unfinished items complete through the live notifications
        const done = !running || item.type === 'userMessage' || (typeof item.status === 'string' && item.status !== 'inProgress');
        this.onNotification('item/started', { threadId: this.threadId, item });
        if (done) this.onNotification('item/completed', { threadId: this.threadId, item });
      }
    }
  }

  private async drainStderr() {
    for await (const _ of this.proc.stderr) {
      // codex logs to stderr; ignored (RUST_LOG controls verbosity)
    }
  }

  private write(message: Json) {
    if (this.exited || !this.ws) return;
    this.ws.send(JSON.stringify({ jsonrpc: '2.0', ...message }));
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (this.exited) return reject(new Error('codex is not running'));
      this.pending.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }

  private notify(method: string, params?: unknown) {
    this.write({ method, params });
  }

  private onLine(line: string) {
    if (process.env.REILAI_DEBUG_CODEX) console.log('[codex]', line.slice(0, 300));
    let msg: Json;
    try {
      msg = JSON.parse(line) as Json;
    } catch {
      return;
    }
    const id = msg.id as number | undefined;
    const method = msg.method as string | undefined;
    if (id != null && !method) {
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      const error = msg.error as { message?: string } | undefined;
      if (error) p.reject(new Error(error.message ?? 'codex error'));
      else p.resolve(msg.result);
      return;
    }
    if (id != null && method) {
      void this.onServerRequest(id, method, (msg.params ?? {}) as Json);
      return;
    }
    if (method) this.onNotification(method, (msg.params ?? {}) as Json);
  }

  private async onServerRequest(id: number, method: string, params: Json) {
    const host = this.host;
    const key = String(id);
    const itemId = String(params.itemId ?? params.callId ?? '');
    if (itemId) this.openApprovals.set(key, itemId);
    if (method === 'item/commandExecution/requestApproval' || method === 'execCommandApproval') {
      const command = Array.isArray(params.command) ? params.command.join(' ') : String(params.command ?? '');
      const decision = await host.requestPermission(
        {
          tool: 'bash',
          title: `$ ${command.split('\n')[0]}`,
          detail: command + (params.reason ? `\n\n# ${String(params.reason)}` : ''),
        },
        key,
      );
      if (decision) this.write({ id, result: { decision: wire(decision, method === 'execCommandApproval') } });
      return;
    }
    if (method === 'item/fileChange/requestApproval' || method === 'applyPatchApproval') {
      const detail = changesDetail(params.fileChanges ?? this.fileChanges.get(itemId)) || String(params.reason ?? '');
      const decision = await host.requestPermission({ tool: 'edit', title: 'Apply file changes', detail }, key);
      if (decision) this.write({ id, result: { decision: wire(decision, method === 'applyPatchApproval') } });
      return;
    }
    if (method === 'mcpServer/elicitation/request') {
      const decision = await host.requestPermission(
        {
          tool: 'mcp',
          title: String(params.serverName ?? 'MCP tool'),
          detail: String(params.message ?? ''),
        },
        key,
      );
      if (decision) this.write({ id, result: { action: decision === 'deny' ? 'decline' : 'accept', content: null, _meta: null } });
      return;
    }
    this.write({ id, error: { code: -32601, message: `ReilAI does not support ${method} yet` } });
  }

  private onNotification(method: string, params: Json) {
    const host = this.host;
    const item = params.item as (Json & { id: string; type: string }) | undefined;
    if (method === 'thread/started') {
      const thread = params.thread as { id?: string; ephemeral?: boolean; parentThreadId?: string | null } | undefined;
      // a thread we did not start: the TUI began a new conversation (title generation and
      // sub-agents run in ephemeral / child threads, which are not the conversation)
      if (thread?.id && thread.id !== this.threadId && !this.startingThread && !thread.ephemeral && !thread.parentThreadId) {
        this.adopt(thread.id);
      }
      return;
    }
    if (method === 'serverRequest/resolved') {
      const key = String(params.requestId);
      const itemId = this.openApprovals.get(key);
      this.openApprovals.delete(key);
      if (itemId) this.settledElsewhere.set(itemId, key);
      host.permissionSettled(key, 'allow');
      return;
    }
    // other threads on this app-server are not this session
    if (typeof params.threadId === 'string' && this.threadId && params.threadId !== this.threadId) return;
    if (method === 'thread/status/changed') {
      const type = (params.status as { type?: string } | undefined)?.type;
      if (!this.materialized && type === 'active' && this.threadId) void this.join(this.threadId);
      return;
    }
    switch (method) {
      case 'turn/started':
        this.turnId = (params.turn as { id?: string } | undefined)?.id ?? null;
        this.materialized = true;
        host.turnStart();
        return;
      case 'turn/completed': {
        const turn = params.turn as { status?: string; error?: { message?: string } | null } | undefined;
        this.turnId = null;
        this.sent = [];
        const status = turn?.status === 'failed' ? 'failed' : turn?.status === 'interrupted' ? 'interrupted' : 'completed';
        host.turnEnd(status, { error: turn?.error?.message });
        return;
      }
      case 'error': {
        const error = params.error as { message?: string } | undefined;
        if (!params.willRetry) host.info(`Codex: ${error?.message ?? 'error'}`);
        return;
      }
      case 'item/agentMessage/delta':
        host.textDelta(String(params.itemId), String(params.delta ?? ''));
        return;
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta':
        host.thinkingDelta(String(params.itemId), String(params.delta ?? ''));
        return;
      case 'item/started':
        if (!item || this.seen.has(item.id)) return;
        this.seen.add(item.id);
        if (item.type === 'commandExecution') {
          host.toolStart(item.id, 'bash', `$ ${String(item.command ?? '').split('\n')[0]}`, { command: item.command });
        } else if (item.type === 'fileChange') {
          this.fileChanges.set(item.id, item.changes);
          const files = Array.isArray(item.changes) ? (item.changes as { path: string }[]).map((c) => c.path.split('/').pop()) : [];
          host.toolStart(item.id, 'edit', `Edit ${files.join(', ') || 'files'}`, { changes: item.changes });
        } else if (item.type === 'mcpToolCall') {
          host.toolStart(item.id, 'mcp', `${String(item.server)} · ${String(item.tool)}`, item.arguments);
        } else if (item.type === 'webSearch') {
          host.toolStart(item.id, 'web_search', `Search the web: ${String(item.query ?? '')}`, { query: item.query });
        }
        return;
      case 'item/completed':
        if (!item) return;
        this.seen.add(item.id);
        if (this.settledElsewhere.has(item.id)) {
          const key = this.settledElsewhere.get(item.id)!;
          this.settledElsewhere.delete(item.id);
          if (item.status === 'declined') host.permissionSettled(key, 'deny');
        }
        if (item.type === 'userMessage') {
          const text = itemText(item);
          const index = this.sent.indexOf(text);
          if (index >= 0) this.sent.splice(index, 1);
          else if (text.trim()) host.userMessage(text);
        } else if (item.type === 'agentMessage') host.textDone(item.id, String(item.text ?? ''));
        else if (item.type === 'reasoning') {
          const summary = Array.isArray(item.summary) ? (item.summary as string[]).join('\n\n') : '';
          if (summary) host.thinkingDone(item.id, summary);
        } else if (item.type === 'commandExecution') {
          const failed = item.status === 'failed' || item.status === 'declined' || (typeof item.exitCode === 'number' && item.exitCode !== 0);
          host.toolEnd(item.id, resultText(item.aggregatedOutput ?? ''), failed);
        } else if (item.type === 'fileChange') {
          host.toolEnd(item.id, changesDetail(item.changes), item.status !== 'completed');
          this.fileChanges.delete(item.id);
        } else if (item.type === 'mcpToolCall') {
          host.toolEnd(item.id, resultText((item.result as { content?: unknown } | null)?.content ?? item.error ?? ''), !!item.error);
        } else if (item.type === 'webSearch') {
          host.toolEnd(item.id, '', false);
        }
        return;
      default:
        return;
    }
  }

  async send(text: string) {
    await this.ready;
    this.host.turnStart();
    this.sent.push(text);
    const params: Json = { threadId: this.threadId, input: [{ type: 'text', text, text_elements: [] }] };
    if (this.modeDirty) {
      params.approvalPolicy = POLICY[this.mode].approval;
      params.sandboxPolicy = sandboxPolicy(this.mode, this.host.cwd);
      this.modeDirty = false;
    }
    if (this.modelDirty) {
      params.model = this.model;
      this.modelDirty = false;
    }
    const result = (await this.request('turn/start', params)) as { turn?: { id?: string } };
    this.turnId = result.turn?.id ?? this.turnId;
  }

  async interrupt() {
    if (this.threadId && this.turnId) await this.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId });
  }

  async setMode(mode: PermissionMode) {
    this.mode = mode;
    this.modeDirty = true;
  }

  async setModel(model: string | null) {
    this.model = model && model !== 'default' ? model : null;
    this.modelDirty = true;
  }

  async close() {
    if (!this.exited) this.proc.kill();
  }
}

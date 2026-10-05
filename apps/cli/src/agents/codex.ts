import { type Subprocess, spawn } from 'bun';

import type { PermissionDecision, PermissionMode } from '@reilai/protocol';

import { VERSION } from '../config';
import { resultText } from './describe';
import type { AgentRunner, RunnerHost, RunnerOptions } from './types';

type Json = Record<string, unknown>;

const POLICY: Record<PermissionMode, { approval: string; sandbox: string }> = {
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

function changesDetail(changes: unknown): string {
  if (!Array.isArray(changes)) return '';
  return (changes as { path?: string; diff?: string }[])
    .map((c) => `${c.path ?? ''}\n${c.diff ?? ''}`)
    .join('\n\n')
    .slice(0, 6000);
}

/**
 * Codex through `codex app-server` (JSON-RPC over stdio), one process per session.
 * Same transport the official IDE extension uses, so approvals, streaming and
 * thread resume all come from Codex itself.
 */
export class CodexRunner implements AgentRunner {
  private proc: Subprocess<'pipe', 'pipe', 'pipe'>;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private ready: Promise<void>;
  private threadId: string | null = null;
  private turnId: string | null = null;
  private mode: PermissionMode;
  private modeDirty = false;
  private fileChanges = new Map<string, unknown>();
  private exited = false;

  constructor(
    private readonly host: RunnerHost,
    private readonly options: RunnerOptions = {},
  ) {
    this.mode = host.mode;
    const bin = process.env.REILAI_CODEX_PATH ?? Bun.which('codex') ?? 'codex';
    this.proc = spawn([bin, 'app-server'], { cwd: host.cwd, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    void this.readLines();
    void this.drainStderr();
    void this.proc.exited.then((code) => {
      this.exited = true;
      for (const p of this.pending.values()) p.reject(new Error(`codex exited (${code})`));
      this.pending.clear();
      host.closed(code === 0 || code === 143 ? undefined : `codex app-server exited with code ${code}`);
    });
    this.ready = this.boot();
  }

  private async boot() {
    await this.request('initialize', {
      clientInfo: { name: 'reilai', title: 'ReilAI', version: VERSION },
      capabilities: { experimentalApi: true },
    });
    this.notify('initialized');
    const { approval, sandbox } = POLICY[this.mode];
    const common = { cwd: this.host.cwd, approvalPolicy: approval, sandbox, model: this.options.model ?? null };
    let result: Json | null = null;
    if (this.host.agentRef) {
      try {
        result = (await this.request('thread/resume', { threadId: this.host.agentRef, ...common, excludeTurns: true })) as Json;
      } catch (e) {
        this.host.info(`Could not resume the Codex thread, starting a new one (${(e as Error).message})`);
      }
    }
    result ??= (await this.request('thread/start', common)) as Json;
    const thread = result.thread as { id: string };
    this.threadId = thread.id;
    this.host.setAgentRef(thread.id);
    if (typeof result.model === 'string') this.host.setModel(result.model);
  }

  private async readLines() {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of this.proc.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) this.onLine(line);
        nl = buffer.indexOf('\n');
      }
    }
  }

  private async drainStderr() {
    for await (const _ of this.proc.stderr) {
      // codex logs to stderr; ignored (RUST_LOG controls verbosity)
    }
  }

  private write(message: Json) {
    if (this.exited) return;
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    this.proc.stdin.flush();
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
    if (method === 'item/commandExecution/requestApproval' || method === 'execCommandApproval') {
      const command = Array.isArray(params.command) ? params.command.join(' ') : String(params.command ?? '');
      const decision = await host.requestPermission({
        tool: 'bash',
        title: `$ ${command.split('\n')[0]}`,
        detail: command + (params.reason ? `\n\n# ${String(params.reason)}` : ''),
      });
      this.write({ id, result: { decision: wire(decision, method === 'execCommandApproval') } });
      return;
    }
    if (method === 'item/fileChange/requestApproval' || method === 'applyPatchApproval') {
      const itemId = String(params.itemId ?? params.callId ?? '');
      const detail = changesDetail(params.fileChanges ?? this.fileChanges.get(itemId)) || String(params.reason ?? '');
      const decision = await host.requestPermission({ tool: 'edit', title: 'Apply file changes', detail });
      this.write({ id, result: { decision: wire(decision, method === 'applyPatchApproval') } });
      return;
    }
    if (method === 'mcpServer/elicitation/request') {
      const decision = await host.requestPermission({
        tool: 'mcp',
        title: String(params.serverName ?? 'MCP tool'),
        detail: String(params.message ?? ''),
      });
      this.write({ id, result: { action: decision === 'deny' ? 'decline' : 'accept', content: null, _meta: null } });
      return;
    }
    this.write({ id, error: { code: -32601, message: `ReilAI does not support ${method} yet` } });
  }

  private onNotification(method: string, params: Json) {
    const host = this.host;
    const item = params.item as (Json & { id: string; type: string }) | undefined;
    switch (method) {
      case 'turn/started':
        this.turnId = (params.turn as { id?: string } | undefined)?.id ?? null;
        return;
      case 'turn/completed': {
        const turn = params.turn as { status?: string; error?: { message?: string } | null } | undefined;
        this.turnId = null;
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
        if (!item) return;
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
        if (item.type === 'agentMessage') host.textDone(item.id, String(item.text ?? ''));
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
    const params: Json = { threadId: this.threadId, input: [{ type: 'text', text, text_elements: [] }] };
    if (this.modeDirty) {
      params.approvalPolicy = POLICY[this.mode].approval;
      params.sandboxPolicy = sandboxPolicy(this.mode, this.host.cwd);
      this.modeDirty = false;
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

  async close() {
    if (!this.exited) this.proc.kill();
  }
}

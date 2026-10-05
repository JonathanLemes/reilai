import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { randomToken } from '@reilai/crypto';
import type { PermissionDecision, PermissionMode } from '@reilai/protocol';

import { daemonPort } from '../config';
import { resultText, toolDetail, toolTitle } from './describe';
import { agentEnv } from './env';
import type { AgentRunner, RunnerHost, RunnerOptions, TerminalSink } from './types';

const MODES: Record<PermissionMode, string> = {
  ask: 'default',
  edits: 'acceptEdits',
  plan: 'plan',
  yolo: 'bypassPermissions',
};

/** Claude's own mode names (hooks) → ReilAI modes. `auto` has no ReilAI equivalent. */
const FROM_CLAUDE: Record<string, PermissionMode> = {
  default: 'ask',
  acceptEdits: 'edits',
  plan: 'plan',
  bypassPermissions: 'yolo',
};

/** Footer text of each mode in the TUI, used to follow Shift+Tab from the terminal. */
const FOOTER: [RegExp, PermissionMode | 'auto'][] = [
  [/manual mode on/, 'ask'],
  [/accept edits on/, 'edits'],
  [/plan mode on/, 'plan'],
  [/bypass permissions on/, 'yolo'],
  [/auto mode on/, 'auto'],
];

const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
];
const TAIL_MS = 250;

/** Hook token → runner. The daemon's `/hook` endpoint routes Claude's hook calls here. */
export const hookTargets = new Map<string, (payload: HookPayload) => void>();

export interface HookPayload {
  hook_event_name: string;
  session_id?: string;
  transcript_path?: string;
  permission_mode?: string;
  prompt?: string;
  source?: string;
  tool_name?: string;
  tool_input?: unknown;
  [key: string]: unknown;
}

type Block = {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
};
type Entry = {
  type?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  timestamp?: string;
  uuid?: string;
  message?: { id?: string; content?: unknown };
};

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escape sequences is the point
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>78]/g;

function plain(chunk: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: cursor-forward escapes stand for spaces
  return chunk.replace(/\x1b\[(\d*)C/g, (_m, n: string) => ' '.repeat(Number(n || 1))).replace(ANSI, '');
}

function same(a: string, b: string) {
  return a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
}

/**
 * Claude Code's own terminal UI, run by the daemon in a PTY. The terminal that
 * attaches sees (and types into) the real `claude`; every other client follows
 * it through hooks (turns, approvals, mode) and the session transcript
 * (messages), and drives it by typing into the same PTY.
 */
export class ClaudeTuiRunner implements AgentRunner {
  private readonly proc: ReturnType<typeof Bun.spawn>;
  private readonly hookToken = randomToken(24);
  private readonly sinks = new Set<TerminalSink>();
  private readonly startedAt = Date.now();
  private transcript: string | null = null;
  private offset = 0;
  private partial = '';
  private tail: ReturnType<typeof setInterval>;
  private booted = false;
  private inTurn = false;
  private queue: string[] = [];
  private sent: string[] = [];
  private permission: { key: string; tool: string } | null = null;
  private permissionCounter = 0;
  private lastEscape = 0;
  private tuiMode: PermissionMode | 'auto' | null = null;
  private modeChain: Promise<void> = Promise.resolve();
  private modeWaiter: ((mode: PermissionMode | 'auto') => void) | null = null;
  private pendingModel: string | null | undefined = undefined;
  private cols = 120;
  private rows = 40;
  private exited = false;
  private readonly decoder = new TextDecoder();

  constructor(
    private readonly host: RunnerHost,
    options: RunnerOptions = {},
  ) {
    hookTargets.set(this.hookToken, (payload) => this.onHook(payload));
    const hook = {
      type: 'command',
      command:
        'curl -s -m 5 -X POST -H "Authorization: Bearer $REILAI_HOOK_TOKEN" -H "Content-Type: application/json" ' +
        '--data-binary @- "$REILAI_HOOK_URL" >/dev/null 2>&1 || true',
    };
    const settings = { hooks: Object.fromEntries(HOOK_EVENTS.map((name) => [name, [{ matcher: '', hooks: [hook] }]])) };

    const args = ['--settings', JSON.stringify(settings), '--allow-dangerously-skip-permissions'];
    if (host.agentRef) args.push('--resume', host.agentRef);
    else {
      const id = randomUUID();
      args.push('--session-id', id);
      host.setAgentRef(id);
    }
    if (options.model && options.model !== 'default') args.push('--model', options.model);
    if (options.explicitMode !== false) args.push('--permission-mode', MODES[host.mode]);
    if (options.prompt?.trim()) args.push(options.prompt.trim());

    const bin = process.env.REILAI_CLAUDE_PATH ?? Bun.which('claude') ?? 'claude';
    this.proc = Bun.spawn([bin, ...args], {
      cwd: host.cwd,
      env: agentEnv({
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        REILAI_HOOK_URL: `http://127.0.0.1:${daemonPort()}/hook`,
        REILAI_HOOK_TOKEN: this.hookToken,
      }),
      terminal: {
        cols: this.cols,
        rows: this.rows,
        data: (_terminal, chunk) => this.onOutput(chunk),
      },
    });
    this.tail = setInterval(() => this.readTranscript(), TAIL_MS);
    void this.proc.exited.then((code) => this.onExit(code));
  }

  // ── terminal ──────────────────────────────────────────────────────────

  private onOutput(chunk: Uint8Array) {
    const copy = new Uint8Array(chunk);
    for (const sink of this.sinks) sink.data(copy);
    this.followFooter(plain(this.decoder.decode(copy, { stream: true })));
  }

  /** Mode changes made with Shift+Tab in the terminal show up in the footer. */
  private followFooter(text: string) {
    let found: PermissionMode | 'auto' | null = null;
    let at = -1;
    for (const [re, mode] of FOOTER) {
      const m = [...text.matchAll(new RegExp(re, 'g'))].pop();
      if (m && m.index! > at) {
        at = m.index!;
        found = mode;
      }
    }
    if (!found) return;
    this.tuiMode = found;
    this.modeWaiter?.(found);
    if (found !== 'auto' && found !== this.host.mode) this.host.modeChanged(found);
  }

  attachTerminal(sink: TerminalSink, cols: number, rows: number) {
    this.sinks.add(sink);
    // redraw from a clean screen at the attaching terminal's size
    sink.data(new TextEncoder().encode('\x1b[2J\x1b[3J\x1b[H'));
    if (cols === this.cols && rows === this.rows) this.terminalResize(cols, rows - 1);
    setTimeout(() => this.terminalResize(cols, rows), 60);
    return () => {
      this.sinks.delete(sink);
    };
  }

  terminalInput(data: Uint8Array) {
    if (this.exited) return;
    this.proc.terminal?.write(data);
  }

  terminalResize(cols: number, rows: number) {
    if (this.exited || cols < 10 || rows < 5) return;
    this.cols = cols;
    this.rows = rows;
    this.proc.terminal?.resize(cols, rows);
  }

  private type(text: string) {
    this.proc.terminal?.write(text);
  }

  // ── hooks ─────────────────────────────────────────────────────────────

  private onHook(payload: HookPayload) {
    if (payload.transcript_path && payload.transcript_path !== this.transcript) {
      this.readTranscript();
      this.transcript = payload.transcript_path;
      this.offset = 0;
      this.partial = '';
    }
    if (payload.session_id) this.host.setAgentRef(payload.session_id);
    const mode = payload.permission_mode ? FROM_CLAUDE[payload.permission_mode] : undefined;
    if (payload.permission_mode) this.tuiMode = mode ?? (payload.permission_mode === 'auto' ? 'auto' : this.tuiMode);
    if (mode && mode !== this.host.mode) this.host.modeChanged(mode);

    switch (payload.hook_event_name) {
      case 'SessionStart':
        this.booted = true;
        this.flushQueue();
        return;
      case 'UserPromptSubmit': {
        this.settlePermission('deny');
        const prompt = String(payload.prompt ?? '');
        const index = this.sent.findIndex((s) => same(s, prompt));
        if (index >= 0) this.sent.splice(index, 1);
        else if (prompt.trim()) this.host.userMessage(prompt);
        this.inTurn = true;
        this.host.turnStart();
        return;
      }
      case 'PermissionRequest': {
        this.settlePermission('deny');
        const tool = String(payload.tool_name ?? 'tool');
        const key = `p${++this.permissionCounter}`;
        this.permission = { key, tool };
        void this.host
          .requestPermission(
            { tool, title: toolTitle(tool, payload.tool_input), detail: toolDetail(tool, payload.tool_input) },
            key,
          )
          .then((decision) => {
            if (decision === null || this.permission?.key !== key) return;
            this.permission = null;
            this.answer(decision);
          });
        return;
      }
      case 'PostToolUse':
        if (this.permission?.tool === payload.tool_name) this.settlePermission('allow');
        this.readTranscript();
        return;
      case 'PostToolUseFailure':
        this.settlePermission('deny');
        this.readTranscript();
        return;
      case 'Stop':
        this.settlePermission('deny');
        // the transcript can lag the hook by a few milliseconds
        setTimeout(() => {
          this.readTranscript();
          this.endTurn('completed');
        }, 150);
        return;
      default:
        return;
    }
  }

  /** Keys for the TUI approval dialog: Enter = "Yes", option 2 = "Yes, and don't ask again", Esc = "No". */
  private answer(decision: PermissionDecision) {
    if (decision === 'allow') this.type('\r');
    else if (decision === 'allow_session') this.type('\x1b[B\r');
    else {
      this.lastEscape = Date.now();
      this.type('\x1b');
    }
    setTimeout(() => this.flushQueue(), 300);
  }

  private settlePermission(decision: PermissionDecision) {
    if (!this.permission) return;
    const { key } = this.permission;
    this.permission = null;
    this.host.permissionSettled(key, decision);
    this.flushQueue();
  }

  private endTurn(status: 'completed' | 'interrupted') {
    if (!this.inTurn) return;
    this.inTurn = false;
    this.sent = [];
    this.host.turnEnd(status);
    if (this.pendingModel !== undefined) {
      const model = this.pendingModel;
      this.pendingModel = undefined;
      void this.setModel(model);
    }
    this.flushQueue();
  }

  // ── transcript ────────────────────────────────────────────────────────

  private readTranscript() {
    const path = this.transcript;
    if (!path || !existsSync(path)) return;
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      return;
    }
    if (size < this.offset) this.offset = 0;
    if (size === this.offset) return;
    const fd = openSync(path, 'r');
    const buffer = Buffer.alloc(size - this.offset);
    try {
      readSync(fd, buffer, 0, buffer.length, this.offset);
    } finally {
      closeSync(fd);
    }
    this.offset = size;
    const text = this.partial + buffer.toString('utf8');
    const lines = text.split('\n');
    this.partial = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        this.onEntry(JSON.parse(line) as Entry);
      } catch {
        // partial or foreign line
      }
    }
  }

  private onEntry(entry: Entry) {
    if (entry.isSidechain || entry.isMeta) return;
    // a resumed session may start from a copy of its history
    if (entry.timestamp && Date.parse(entry.timestamp) < this.startedAt - 1000) return;
    const content = entry.message?.content;
    if (entry.type === 'assistant' && Array.isArray(content)) {
      for (const [i, block] of (content as Block[]).entries()) {
        const key = `${entry.uuid ?? entry.message?.id}:${i}`;
        if (block.type === 'text' && block.text?.trim()) this.host.textDone(key, block.text);
        else if (block.type === 'thinking' && block.thinking?.trim()) this.host.thinkingDone(key, block.thinking);
        else if (block.type === 'tool_use' && block.id && block.name) {
          this.host.toolStart(block.id, block.name, toolTitle(block.name, block.input), block.input);
        }
      }
      return;
    }
    if (entry.type === 'user') {
      const blocks: Block[] =
        typeof content === 'string'
          ? [{ type: 'text', text: content }]
          : Array.isArray(content)
            ? (content as Block[])
            : [];
      for (const block of blocks) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          this.host.toolEnd(block.tool_use_id, resultText(block.content), block.is_error === true);
        } else if (block.type === 'text' && block.text?.startsWith('[Request interrupted by user')) {
          this.settlePermission('deny');
          this.endTurn('interrupted');
        }
      }
    }
  }

  // ── driving it from other clients ─────────────────────────────────────

  /** Messages wait while the TUI is booting or showing an approval dialog. */
  private flushQueue() {
    if (!this.booted || this.permission || this.exited) return;
    const next = this.queue.shift();
    if (next === undefined) return;
    this.sent.push(next);
    this.type(`\x1b[200~${next}\x1b[201~`);
    setTimeout(() => {
      this.type('\r');
      setTimeout(() => this.flushQueue(), 120);
    }, 80);
  }

  async send(text: string) {
    if (this.exited) throw new Error('Claude has exited');
    this.host.turnStart();
    this.queue.push(text);
    this.flushQueue();
  }

  async interrupt() {
    // a denied approval already sent Esc; a second one would open the rewind menu
    if (Date.now() - this.lastEscape < 600) return;
    this.lastEscape = Date.now();
    this.type('\x1b');
  }

  /** Shift+Tab until the footer shows the wanted mode. */
  setMode(mode: PermissionMode) {
    this.modeChain = this.modeChain.then(async () => {
      for (let i = 0; i < 6 && !this.exited && this.tuiMode !== mode; i++) {
        const seen = new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 400);
          this.modeWaiter = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        this.type('\x1b[Z');
        await seen;
        this.modeWaiter = null;
        await Bun.sleep(60);
      }
    });
    return this.modeChain;
  }

  async setModel(model: string | null) {
    if (this.inTurn || this.permission || !this.booted) {
      this.pendingModel = model;
      return;
    }
    this.type(`/model ${model && model !== 'default' ? model : 'default'}`);
    await Bun.sleep(80);
    this.type('\r');
  }

  async close() {
    if (this.exited) return;
    this.proc.kill('SIGTERM');
    const timer = setTimeout(() => {
      if (!this.exited) this.proc.kill('SIGKILL');
    }, 3000);
    await this.proc.exited;
    clearTimeout(timer);
  }

  private onExit(code: number | null) {
    this.exited = true;
    clearInterval(this.tail);
    this.readTranscript();
    hookTargets.delete(this.hookToken);
    this.proc.terminal?.close();
    for (const sink of this.sinks) sink.exit(code);
    this.sinks.clear();
    if (this.inTurn) this.host.turnEnd('interrupted');
    this.host.closed(code === 0 || code === 143 || code === null ? undefined : `claude exited with code ${code}`);
  }
}

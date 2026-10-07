/**
 * ReilAI wire contract.
 *
 * Every client (CLI, web service, tunnel, native app) speaks the same JSON-RPC-ish
 * protocol with the daemon. The web service and the tunnel only proxy it, so a
 * session started anywhere shows up everywhere, live.
 */

export const PROTOCOL_VERSION = 1;

export const DEFAULT_PORTS = {
  daemon: 7410,
  web: 7420,
  tunnel: 7430,
  relay: 7440,
} as const;

export type AgentKind = 'claude' | 'codex';

export type SessionStatus = 'starting' | 'idle' | 'running' | 'waiting' | 'error' | 'stopped';

/** Who started a session. Only informative: any client can drive any session. */
export type ClientKind = 'cli' | 'web' | 'app';

/**
 * Permission modes, normalized across agents.
 * - ask: every sensitive tool asks first (Claude `default`, Codex `untrusted`)
 * - edits: file edits are auto-approved (Claude `acceptEdits`, Codex `on-request` + workspace-write)
 * - plan: read-only planning (Claude `plan`, Codex `read-only` sandbox)
 * - yolo: never ask (Claude `bypassPermissions`, Codex `never` + full access)
 */
export type PermissionMode = 'ask' | 'edits' | 'plan' | 'yolo';

export const PERMISSION_MODES: PermissionMode[] = ['ask', 'edits', 'plan', 'yolo'];

export interface Session {
  id: string;
  agent: AgentKind;
  title: string;
  cwd: string;
  status: SessionStatus;
  mode: PermissionMode;
  model: string | null;
  createdAt: number;
  updatedAt: number;
  /** Plain-text preview of the last message, for lists. */
  preview: string;
  /** Claude session id or Codex thread id, used to resume after a daemon restart. */
  agentRef: string | null;
  archived: boolean;
  pendingPermissions: number;
  startedBy: ClientKind;
  /** Last error, when status is `error`. */
  error: string | null;
}

export type MessageRole = 'user' | 'agent' | 'system';

export type MessageKind = 'text' | 'thinking' | 'tool' | 'permission' | 'event';

export interface ToolInfo {
  callId: string;
  name: string;
  /** Short human title, e.g. "Run `bun test`". */
  title: string;
  input: unknown;
  output?: string;
  status: 'running' | 'done' | 'error';
}

export type PermissionDecision = 'allow' | 'allow_session' | 'deny';

export interface PermissionInfo {
  requestId: string;
  tool: string;
  title: string;
  /** Command, diff or arguments to show before approving. */
  detail: string;
  status: 'pending' | 'allowed' | 'denied' | 'expired';
  decision?: PermissionDecision;
}

export interface EventInfo {
  type: 'turn-start' | 'turn-end' | 'error' | 'info';
  text?: string;
  /** turn-end only */
  durationMs?: number;
  costUsd?: number;
}

export interface Message {
  id: string;
  sessionId: string;
  seq: number;
  time: number;
  role: MessageRole;
  kind: MessageKind;
  text?: string;
  tool?: ToolInfo;
  permission?: PermissionInfo;
  event?: EventInfo;
  /** True while text is still streaming in. */
  streaming?: boolean;
}

export type Language = 'en' | 'pt';
export type LanguagePref = Language | 'system';

export interface Settings {
  language: LanguagePref;
  /** Minutes an idle agent stays alive before it is stopped; 0 = never (ended by hand or by archiving). */
  sessionTimeoutMinutes: number;
  /** Permission mode of new sessions: the last one picked in any client. */
  defaultMode: PermissionMode;
}

/** Choices offered by the clients for `sessionTimeoutMinutes` (0 = never). */
export const SESSION_TIMEOUTS = [0, 15, 30, 60, 240, 1440] as const;

export interface MachineInfo {
  name: string;
  platform: string;
  home: string;
  version: string;
}

export interface AgentAvailability {
  agent: AgentKind;
  installed: boolean;
  version: string | null;
}

export interface Device {
  id: string;
  name: string;
  publicKey: string;
  pairedAt: number;
  lastSeenAt: number | null;
}

/** A model the agent can run. `id` is what gets sent to the agent (alias or full id). */
export interface ModelOption {
  id: string;
  label: string;
  description: string;
  /** full model id an alias resolves to (Claude `sonnet` → `claude-sonnet-…`) */
  resolved?: string;
  isDefault?: boolean;
}

export interface FileMatch {
  /** relative to the project folder; folders end with `/` */
  path: string;
  isDir: boolean;
}

export interface DirEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
  /** only set when files are listed too */
  isDir?: boolean;
  size?: number;
}

export interface FileContent {
  path: string;
  name: string;
  kind: 'text' | 'image' | 'binary';
  mime: string;
  size: number;
  /** text, or a data: URL for images; empty for binary */
  content: string;
  truncated: boolean;
}

/** RPC surface: method → [params, result]. */
export interface RpcMethods {
  hello: [{ client: ClientKind; name?: string }, { machine: MachineInfo; settings: Settings; agents: AgentAvailability[] }];
  'sessions.list': [{ archived?: boolean }, Session[]];
  'sessions.get': [{ id: string; before?: number; limit?: number }, { session: Session; messages: Message[]; hasMore: boolean }];
  'sessions.create': [
    {
      agent: AgentKind;
      cwd: string;
      prompt?: string;
      mode?: PermissionMode;
      model?: string | null;
      startedBy?: ClientKind;
      /** started from a terminal that will attach the agent's own TUI (`terminal.attach`) */
      terminal?: boolean;
    },
    Session,
  ];
  'sessions.send': [{ id: string; text: string }, { ok: true }];
  'sessions.interrupt': [{ id: string }, { ok: true }];
  'sessions.stop': [{ id: string }, { ok: true }];
  /** starts the agent again (resuming its context) and unarchives the session */
  'sessions.resume': [{ id: string }, Session];
  'sessions.setMode': [{ id: string; mode: PermissionMode }, Session];
  /** `null` goes back to the agent's default model */
  'sessions.setModel': [{ id: string; model: string | null }, Session];
  'agents.models': [{ agent: AgentKind }, ModelOption[]];
  'sessions.rename': [{ id: string; title: string }, Session];
  'sessions.archive': [{ id: string; archived: boolean }, Session];
  'sessions.delete': [{ id: string }, { ok: true }];
  'permissions.respond': [{ sessionId: string; requestId: string; decision: PermissionDecision }, { ok: true }];
  'fs.list': [{ path?: string; files?: boolean }, { path: string; parent: string | null; entries: DirEntry[] }];
  /** relative paths resolve against `cwd` (the session folder) */
  'fs.read': [{ path: string; cwd?: string }, FileContent];
  'fs.recent': [Record<string, never>, DirEntry[]];
  /** `@` mentions: project files and folders matching `query`, paths relative to `cwd` */
  'fs.search': [{ cwd: string; query: string; limit?: number }, FileMatch[]];
  'settings.get': [Record<string, never>, Settings];
  'settings.set': [Partial<Settings>, Settings];
  'devices.list': [Record<string, never>, Device[]];
  'devices.revoke': [{ id: string }, { ok: true }];
  // Local only (CLI and tunnel, authenticated with the daemon token). Never proxied to remote clients.
  'pairing.create': [Record<string, never>, { token: string; expiresAt: number; machineKey: string; machineName: string }];
  'pairing.status': [{ token: string }, { device: Device | null; expired: boolean }];
  'devices.authorize': [{ publicKey: string; pairingToken?: string; name?: string }, Device | null];
  /**
   * Attaches the agent's own terminal UI to this connection (CLI only).
   * Claude: the daemon runs `claude` in a PTY and streams it as `terminal.data`.
   * Codex: the CLI runs `codex --remote` against the session's app-server socket.
   */
  'terminal.attach': [{ id: string; cols: number; rows: number }, TerminalAttach];
  /** raw keyboard bytes, base64 */
  'terminal.input': [{ id: string; data: string }, { ok: true }];
  'terminal.resize': [{ id: string; cols: number; rows: number }, { ok: true }];
  'terminal.detach': [{ id: string }, { ok: true }];
}

export type TerminalAttach =
  | { kind: 'pty' }
  | {
      kind: 'codex';
      /** app-server endpoint for `codex --remote` */
      socket: string;
      /** thread to resume, or null to let the TUI start it (the daemon joins it) */
      threadId: string | null;
      cwd: string;
      mode: PermissionMode;
      model: string | null;
    };

export type RpcMethod = keyof RpcMethods;
export type RpcParams<M extends RpcMethod> = RpcMethods[M][0];
export type RpcResult<M extends RpcMethod> = RpcMethods[M][1];

/** Server push events. */
export interface ServerEvents {
  'session.upsert': Session;
  'session.removed': { id: string };
  'message.append': Message;
  'message.update': Message;
  'settings.changed': Settings;
  'devices.changed': Device[];
  /** only sent to the connection that attached the terminal; data is base64 */
  'terminal.data': { id: string; data: string };
  'terminal.exit': { id: string; code: number | null };
}

export type ServerEventName = keyof ServerEvents;

export type ClientFrame = { id: number; method: RpcMethod; params?: unknown };

export type ServerFrame =
  | { id: number; result: unknown }
  | { id: number; error: { code: string; message: string } }
  | { event: ServerEventName; data: unknown };

export class RpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Methods a remote device may call. Pairing management stays local to the machine. */
export const REMOTE_METHODS: ReadonlySet<RpcMethod> = new Set<RpcMethod>([
  'hello',
  'sessions.list',
  'sessions.get',
  'sessions.create',
  'sessions.send',
  'sessions.interrupt',
  'sessions.stop',
  'sessions.resume',
  'sessions.setMode',
  'sessions.setModel',
  'agents.models',
  'sessions.rename',
  'sessions.archive',
  'sessions.delete',
  'permissions.respond',
  'fs.list',
  'fs.read',
  'fs.recent',
  'fs.search',
  'settings.get',
  'settings.set',
  'devices.list',
  'devices.revoke',
]);

export function isRpcMethod(value: unknown): value is RpcMethod {
  return typeof value === 'string' && REMOTE_METHODS.has(value as RpcMethod);
}

/** Last path segment, used as a project label. */
export function projectName(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

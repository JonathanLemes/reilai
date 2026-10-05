import type { PermissionDecision, PermissionMode } from '@reilai/protocol';

/**
 * What a runner reports. Keys (`item`) are runner-scoped ids: the session maps
 * each to one stored message, so deltas and the final text land on the same row.
 */
export interface RunnerHost {
  readonly sessionId: string;
  readonly cwd: string;
  readonly mode: PermissionMode;
  readonly agentRef: string | null;
  textDelta(item: string, delta: string): void;
  textDone(item: string, text: string): void;
  thinkingDelta(item: string, delta: string): void;
  thinkingDone(item: string, text: string): void;
  toolStart(callId: string, name: string, title: string, input: unknown): void;
  toolEnd(callId: string, output: string, isError: boolean): void;
  /** a user turn typed in the agent's own UI (terminal), not sent through ReilAI */
  userMessage(text: string): void;
  /** idempotent: a turn already running stays as is */
  turnStart(): void;
  turnEnd(status: 'completed' | 'failed' | 'interrupted', info?: { durationMs?: number; costUsd?: number; error?: string }): void;
  setAgentRef(ref: string): void;
  setModel(model: string): void;
  modeChanged(mode: PermissionMode): void;
  info(text: string): void;
  /**
   * Shows an approval in every client. Resolves with the decision taken in ReilAI,
   * or `null` when it was answered in the agent's own UI (see `permissionSettled`).
   */
  requestPermission(request: { tool: string; title: string; detail: string }, key?: string): Promise<PermissionDecision | null>;
  /** the approval `key` was answered in the agent's own UI (also corrects an earlier guess) */
  permissionSettled(key: string, decision: PermissionDecision): void;
  /** The agent process is gone (normally or not). */
  closed(error?: string): void;
}

export interface AgentRunner {
  send(text: string): Promise<void>;
  interrupt(): Promise<void>;
  setMode(mode: PermissionMode): Promise<void>;
  /** `null` = the agent's default model */
  setModel(model: string | null): Promise<void>;
  close(): Promise<void>;
  /** Claude TUI: the PTY the terminal attaches to */
  attachTerminal?(sink: TerminalSink, cols: number, rows: number): () => void;
  terminalInput?(data: Uint8Array): void;
  terminalResize?(cols: number, rows: number): void;
  /** Codex: app-server endpoint for `codex --remote` */
  remoteEndpoint?(): Promise<{ socket: string; threadId: string | null }>;
}

export interface TerminalSink {
  data(chunk: Uint8Array): void;
  exit(code: number | null): void;
}

export interface RunnerOptions {
  model?: string | null;
  /** first prompt, passed to the agent's own UI on start (terminal sessions) */
  prompt?: string;
  /** terminal sessions keep the agent's own default mode unless one was asked for */
  explicitMode?: boolean;
}

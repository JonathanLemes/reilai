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
  turnStart(): void;
  turnEnd(status: 'completed' | 'failed' | 'interrupted', info?: { durationMs?: number; costUsd?: number; error?: string }): void;
  setAgentRef(ref: string): void;
  setModel(model: string): void;
  modeChanged(mode: PermissionMode): void;
  info(text: string): void;
  requestPermission(request: { tool: string; title: string; detail: string }): Promise<PermissionDecision>;
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
}

export interface RunnerOptions {
  model?: string | null;
}

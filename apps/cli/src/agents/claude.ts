import {
  type CanUseTool,
  type PermissionMode as ClaudeMode,
  type Query,
  query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { PermissionMode } from '@reilai/protocol';

import { resultText, toolDetail, toolTitle } from './describe';
import { AsyncQueue } from './queue';
import type { AgentRunner, RunnerHost, RunnerOptions } from './types';

const MODES: Record<PermissionMode, ClaudeMode> = {
  ask: 'default',
  edits: 'acceptEdits',
  plan: 'plan',
  yolo: 'bypassPermissions',
};

type Block = { type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown };
type ToolResultBlock = { type: string; tool_use_id?: string; content?: unknown; is_error?: boolean };

/**
 * Claude Code through the official Agent SDK, one long-lived query per session.
 * User turns are pushed into an AsyncQueue, so the process (and its context)
 * stays warm between messages.
 */
export class ClaudeRunner implements AgentRunner {
  private readonly input = new AsyncQueue<SDKUserMessage>();
  private readonly q: Query;
  private currentMessage = '';
  /** stream keys of text/thinking blocks not yet finalized, per assistant message id */
  private openText = new Map<string, string[]>();
  private openThinking = new Map<string, string[]>();
  private counter = 0;
  private closed = false;
  /** aborting kills the claude process (close() alone only ends the input stream) */
  private readonly abort = new AbortController();

  constructor(
    private readonly host: RunnerHost,
    options: RunnerOptions = {},
  ) {
    const canUseTool: CanUseTool = async (toolName, toolInput, { suggestions }) => {
      const decision = await host.requestPermission({
        tool: toolName,
        title: toolTitle(toolName, toolInput),
        detail: toolDetail(toolName, toolInput),
      });
      if (decision === 'deny') return { behavior: 'deny', message: 'The user denied this action.' };
      if (toolName === 'ExitPlanMode') host.modeChanged('ask');
      return {
        behavior: 'allow',
        updatedInput: toolInput,
        updatedPermissions: decision === 'allow_session' ? suggestions : undefined,
      };
    };

    this.q = query({
      prompt: this.input,
      options: {
        cwd: host.cwd,
        resume: host.agentRef ?? undefined,
        model: options.model && options.model !== 'default' ? options.model : undefined,
        permissionMode: MODES[host.mode],
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        settingSources: ['user', 'project', 'local'],
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        pathToClaudeCodeExecutable: process.env.REILAI_CLAUDE_PATH ?? Bun.which('claude') ?? undefined,
        canUseTool,
        abortController: this.abort,
        env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' } as Record<string, string>,
      },
    });
    void this.pump();
  }

  private key(prefix: string) {
    this.counter += 1;
    return `${prefix}:${this.counter}`;
  }

  private async pump() {
    let error: string | undefined;
    try {
      for await (const message of this.q) this.handle(message);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    this.closed = true;
    this.host.closed(error);
  }

  private handle(message: SDKMessage) {
    const host = this.host;
    switch (message.type) {
      case 'system':
        if (message.subtype === 'init') {
          host.setAgentRef(message.session_id);
        }
        return;
      case 'stream_event': {
        if (message.parent_tool_use_id) return;
        const event = message.event as {
          type: string;
          index?: number;
          message?: { id: string };
          content_block?: Block;
          delta?: { type: string; text?: string; thinking?: string };
        };
        if (event.type === 'message_start' && event.message) {
          this.currentMessage = event.message.id;
        } else if (event.type === 'content_block_start' && event.content_block) {
          const k = `${this.currentMessage}:${event.index}`;
          const map = event.content_block.type === 'text' ? this.openText : event.content_block.type === 'thinking' ? this.openThinking : null;
          if (map) map.set(this.currentMessage, [...(map.get(this.currentMessage) ?? []), k]);
        } else if (event.type === 'content_block_delta' && event.delta) {
          const k = `${this.currentMessage}:${event.index}`;
          if (event.delta.type === 'text_delta' && event.delta.text) host.textDelta(k, event.delta.text);
          if (event.delta.type === 'thinking_delta' && event.delta.thinking) host.thinkingDelta(k, event.delta.thinking);
        }
        return;
      }
      case 'assistant': {
        if (message.parent_tool_use_id) return;
        const id = message.message.id;
        for (const block of message.message.content as Block[]) {
          if (block.type === 'text' && block.text) {
            host.textDone(this.openText.get(id)?.shift() ?? this.key(id), block.text);
          } else if (block.type === 'thinking' && block.thinking) {
            host.thinkingDone(this.openThinking.get(id)?.shift() ?? this.key(id), block.thinking);
          } else if (block.type === 'tool_use' && block.id && block.name) {
            host.toolStart(block.id, block.name, toolTitle(block.name, block.input), block.input);
          }
        }
        return;
      }
      case 'user': {
        if (message.parent_tool_use_id) return;
        const content = (message.message as { content?: unknown }).content;
        if (!Array.isArray(content)) return;
        for (const block of content as ToolResultBlock[]) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            host.toolEnd(block.tool_use_id, resultText(block.content), block.is_error === true);
          }
        }
        return;
      }
      case 'result': {
        const isError = message.subtype !== 'success' || message.is_error;
        host.turnEnd(isError ? 'failed' : 'completed', {
          durationMs: message.duration_ms,
          costUsd: message.total_cost_usd,
          error: isError && 'result' in message ? String(message.result) : undefined,
        });
        this.openText.clear();
        this.openThinking.clear();
        return;
      }
      default:
        return;
    }
  }

  async send(text: string) {
    if (this.closed) throw new Error('Claude process has exited');
    this.host.turnStart();
    this.input.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
    } as SDKUserMessage);
  }

  async interrupt() {
    if (!this.closed) await this.q.interrupt();
  }

  async setMode(mode: PermissionMode) {
    if (!this.closed) await this.q.setPermissionMode(MODES[mode]);
  }

  async setModel(model: string | null) {
    if (!this.closed) await this.q.setModel(model && model !== 'default' ? model : undefined);
  }

  async close() {
    this.input.end();
    try {
      this.q.close();
    } catch {
      // already gone
    }
    this.abort.abort();
  }
}

import type { RpcMethod, RpcParams, RpcResult, ServerEventName, ServerEvents, ServerFrame } from './index';
import { RpcError } from './index';

type Listener = (event: ServerEventName, data: unknown) => void;

/**
 * WebSocket RPC client for the daemon. Used by the CLI, the web service and the
 * tunnel (all local, authenticated with the daemon token). Reconnects on drop.
 */
export class DaemonClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private listeners = new Set<Listener>();
  private stateListeners = new Set<(connected: boolean) => void>();
  private opening: Promise<void> | null = null;
  private closedByUser = false;
  private retry = 0;
  connected = false;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly options: { reconnect?: boolean } = {},
  ) {}

  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    if (this.opening) return this.opening;
    this.closedByUser = false;
    this.opening = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url, { headers: { Authorization: `Bearer ${this.token}` } } as unknown as string[]);
      this.ws = ws;
      ws.onopen = () => {
        this.connected = true;
        this.retry = 0;
        this.opening = null;
        for (const l of this.stateListeners) l(true);
        resolve();
      };
      ws.onmessage = (e) => this.onFrame(String(e.data));
      ws.onerror = () => {
        if (!this.connected) {
          this.opening = null;
          reject(new Error(`Cannot reach the ReilAI daemon at ${this.url}`));
        }
      };
      ws.onclose = () => {
        const wasConnected = this.connected;
        this.connected = false;
        this.opening = null;
        for (const p of this.pending.values()) p.reject(new Error('Connection to the daemon closed'));
        this.pending.clear();
        if (wasConnected) for (const l of this.stateListeners) l(false);
        if (!this.closedByUser && this.options.reconnect) {
          const delay = Math.min(1000 * 2 ** this.retry, 10000);
          this.retry += 1;
          setTimeout(() => void this.connect().catch(() => {}), delay);
        }
      };
    });
    return this.opening;
  }

  private onFrame(text: string) {
    let frame: ServerFrame;
    try {
      frame = JSON.parse(text) as ServerFrame;
    } catch {
      return;
    }
    if ('event' in frame) {
      for (const l of this.listeners) l(frame.event, frame.data);
      return;
    }
    const p = this.pending.get(frame.id);
    if (!p) return;
    this.pending.delete(frame.id);
    if ('error' in frame) p.reject(new RpcError(frame.error.code, frame.error.message));
    else p.resolve(frame.result);
  }

  async call<M extends RpcMethod>(method: M, params?: RpcParams<M>): Promise<RpcResult<M>> {
    await this.connect();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws!.send(JSON.stringify({ id, method, params: params ?? {} }));
    });
  }

  /** Raw call for proxies (params already validated against an allowlist). */
  async callRaw(method: RpcMethod, params: unknown): Promise<unknown> {
    return this.call(method, params as never);
  }

  on<E extends ServerEventName>(listener: (event: E, data: ServerEvents[E]) => void): () => void {
    const l = listener as Listener;
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onState(listener: (connected: boolean) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  close() {
    this.closedByUser = true;
    this.ws?.close();
  }
}

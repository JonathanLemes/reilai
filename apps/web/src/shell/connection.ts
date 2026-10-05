import type { RpcMethod, ServerFrame } from '@reilai/protocol';

export type ConnState = 'connected' | 'connecting' | 'offline';

const TOKEN_KEY = 'reilai:token';

export function readToken(): string | null {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('token');
  if (fromHash) {
    try {
      localStorage.setItem(TOKEN_KEY, fromHash);
    } catch {
      // private mode: token lives only in this tab
    }
    history.replaceState(null, '', location.pathname + location.search);
    return fromHash;
  }
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

export async function checkToken(token: string): Promise<boolean> {
  const res = await fetch('/api/check', { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  return !!res?.ok;
}

type Listener = (event: string, data: unknown) => void;

/** One WebSocket to the web service, shared by every Lynx screen of this tab. */
export class Connection {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, (frame: ServerFrame) => void>();
  private queue: string[] = [];
  private retry = 0;
  private listeners = new Set<Listener>();
  private stateListeners = new Set<(s: ConnState) => void>();
  state: ConnState = 'connecting';
  machine = '';

  constructor(private readonly token: string) {
    this.open();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.state === 'offline') this.open();
    });
  }

  private setState(state: ConnState) {
    if (state === this.state) return;
    this.state = state;
    for (const l of this.stateListeners) l(state);
  }

  private open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(this.token)}`);
    this.ws = ws;
    this.setState('connecting');
    ws.onopen = () => {
      this.retry = 0;
      for (const q of this.queue.splice(0)) ws.send(q);
    };
    ws.onmessage = (e) => {
      const frame = JSON.parse(String(e.data)) as ServerFrame & { event?: string; data?: unknown };
      if ('event' in frame && frame.event) {
        if (frame.event === 'connection') {
          const daemonUp = (frame.data as { daemon: boolean }).daemon;
          this.setState(daemonUp ? 'connected' : 'offline');
        }
        for (const l of this.listeners) l(frame.event, frame.data);
        return;
      }
      const id = (frame as { id: number }).id;
      const resolve = this.pending.get(id);
      if (resolve) {
        this.pending.delete(id);
        resolve(frame);
      }
    };
    ws.onclose = (e) => {
      this.setState('offline');
      for (const [, resolve] of this.pending) resolve({ id: 0, error: { code: 'offline', message: 'Connection lost' } });
      this.pending.clear();
      if (e.code === 1008 || e.code === 4001) return;
      const delay = Math.min(500 * 2 ** this.retry, 8000);
      this.retry += 1;
      setTimeout(() => this.open(), delay);
    };
  }

  /** Same shape the native hosts return: { ok, result } | { ok: false, error }. */
  rpc(method: RpcMethod, params: unknown): Promise<{ ok: true; result: unknown } | { ok: false; error: { code: string; message: string } }> {
    const id = this.nextId++;
    const text = JSON.stringify({ id, method, params });
    return new Promise((resolve) => {
      this.pending.set(id, (frame) => {
        if ('error' in frame) resolve({ ok: false, error: frame.error });
        else resolve({ ok: true, result: (frame as { result: unknown }).result });
      });
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(text);
      else this.queue.push(text);
    });
  }

  on(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onState(listener: (s: ConnState) => void) {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }
}

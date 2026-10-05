import { type KeyPair, type SecureChannel, type ServerHello, startHandshake } from '@reilai/crypto';

/**
 * Reference device client (the Android host implements the same steps in Kotlin).
 * Used by the smoke test and handy for scripting a remote computer.
 */
export class TunnelClient {
  private ws: WebSocket | null = null;
  private channel: SecureChannel | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  onEvent: (event: string, data: unknown) => void = () => {};

  constructor(
    private readonly device: KeyPair,
    private readonly machineKey: string,
  ) {}

  connect(url: string, auth: { pair?: string; name?: string } = {}): Promise<{ device: { id: string }; machine: string }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      const handshake = startHandshake(this.device);
      let ready = false;
      ws.onopen = () => ws.send(JSON.stringify(handshake.hello));
      ws.onerror = () => reject(new Error(`cannot connect to ${url}`));
      ws.onclose = (e) => {
        if (!ready) reject(new Error(`closed during handshake (${e.code} ${e.reason})`));
        for (const p of this.pending.values()) p.reject(new Error('tunnel closed'));
      };
      ws.onmessage = (e) => {
        const text = String(e.data);
        try {
          if (!this.channel) {
            this.channel = handshake.finish(JSON.parse(text) as ServerHello, this.machineKey);
            ws.send(this.channel.seal({ t: 'auth', ...auth }));
            return;
          }
          const frame = this.channel.open(text) as Record<string, unknown>;
          if (frame.t === 'ready') {
            ready = true;
            resolve(frame as never);
          } else if (frame.t === 'denied') reject(new Error(String(frame.reason)));
          else if (frame.t === 'event') this.onEvent(String(frame.event), frame.data);
          else if (frame.t === 'res') {
            const p = this.pending.get(frame.id as number);
            if (!p) return;
            this.pending.delete(frame.id as number);
            const error = frame.error as { message: string } | undefined;
            error ? p.reject(new Error(error.message)) : p.resolve(frame.result);
          }
        } catch (err) {
          reject(err as Error);
          ws.close();
        }
      };
    });
  }

  call<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws!.send(this.channel!.seal({ t: 'rpc', id, method, params }));
    });
  }

  close() {
    this.ws?.close();
  }
}

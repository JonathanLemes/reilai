import { acceptHandshake, type ClientHello, type KeyPair, type SecureChannel } from '@reilai/crypto';
import { type Device, isRpcMethod, RpcError, type ServerEventName } from '@reilai/protocol';
import type { DaemonClient } from '@reilai/protocol/client';

/** A transport-agnostic connection: a direct WebSocket or a stream inside the relay. */
export interface Link {
  send(text: string): void;
  close(code?: number, reason?: string): void;
}

const HANDSHAKE_TIMEOUT_MS = 10_000;

type Phase = 'hello' | 'auth' | 'ready' | 'closed';

/**
 * One encrypted session with a device. Plaintext only exists between this
 * process and the local daemon; everything on the link is AES-256-GCM.
 */
export class TunnelSession {
  private phase: Phase = 'hello';
  private channel: SecureChannel | null = null;
  private devicePublicKey = '';
  device: Device | null = null;
  private timer: ReturnType<typeof setTimeout>;

  constructor(
    private readonly link: Link,
    private readonly machine: KeyPair,
    private readonly daemon: DaemonClient,
    private readonly machineName: string,
    private readonly onReady: (s: TunnelSession) => void,
    private readonly onClose: (s: TunnelSession) => void,
  ) {
    this.timer = setTimeout(() => {
      if (this.phase !== 'ready') this.close(4008, 'handshake timeout');
    }, HANDSHAKE_TIMEOUT_MS);
  }

  async receive(text: string) {
    try {
      if (this.phase === 'hello') return this.onHello(text);
      if (!this.channel) return;
      const frame = this.channel.open(text) as Record<string, unknown>;
      if (this.phase === 'auth') return await this.onAuth(frame);
      if (this.phase === 'ready') return await this.onRpc(frame);
    } catch (e) {
      // any decryption/ordering failure kills the session: never try to resync
      this.close(4002, e instanceof Error ? e.message : 'protocol error');
    }
  }

  private onHello(text: string) {
    const hello = JSON.parse(text) as ClientHello;
    if (hello.t !== 'hello') throw new Error('expected hello');
    const { reply, channel } = acceptHandshake(this.machine, hello);
    this.channel = channel;
    this.devicePublicKey = hello.dpk;
    this.phase = 'auth';
    this.link.send(JSON.stringify(reply));
  }

  private async onAuth(frame: Record<string, unknown>) {
    if (frame.t !== 'auth') throw new Error('expected auth');
    const device = await this.daemon.call('devices.authorize', {
      publicKey: this.devicePublicKey,
      pairingToken: typeof frame.pair === 'string' ? frame.pair : undefined,
      name: typeof frame.name === 'string' ? frame.name : undefined,
    });
    if (!device) {
      this.sendSealed({ t: 'denied', reason: 'This device is not paired. Run `reilai pair` on the computer.' });
      return this.close(4003, 'not paired');
    }
    this.device = device;
    this.phase = 'ready';
    clearTimeout(this.timer);
    this.sendSealed({ t: 'ready', device, machine: this.machineName });
    this.onReady(this);
  }

  private async onRpc(frame: Record<string, unknown>) {
    if (frame.t === 'ping') return this.sendSealed({ t: 'pong' });
    if (frame.t !== 'rpc' || typeof frame.id !== 'number') return;
    const id = frame.id;
    try {
      if (!isRpcMethod(frame.method)) throw new RpcError('forbidden', 'Method not allowed over the tunnel');
      const result = await this.daemon.callRaw(frame.method, frame.params ?? {});
      this.sendSealed({ t: 'res', id, result });
    } catch (e) {
      const err = e instanceof RpcError ? e : new RpcError('internal', e instanceof Error ? e.message : String(e));
      this.sendSealed({ t: 'res', id, error: { code: err.code, message: err.message } });
    }
  }

  event(event: ServerEventName, data: unknown) {
    if (this.phase === 'ready') this.sendSealed({ t: 'event', event, data });
  }

  private sendSealed(value: unknown) {
    if (this.channel && this.phase !== 'closed') this.link.send(this.channel.seal(value));
  }

  close(code = 1000, reason = '') {
    if (this.phase === 'closed') return;
    this.phase = 'closed';
    clearTimeout(this.timer);
    try {
      this.link.close(code, reason);
    } catch {
      // already closed
    }
    this.onClose(this);
  }

  /** Called when the underlying transport is gone. */
  dropped() {
    if (this.phase === 'closed') return;
    this.phase = 'closed';
    clearTimeout(this.timer);
    this.onClose(this);
  }
}

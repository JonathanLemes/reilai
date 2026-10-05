import { randomBytes } from 'node:crypto';

/**
 * Minimal WebSocket client over a Unix domain socket (text frames only), for
 * `codex app-server --listen unix://…`. Bun's WebSocket cannot reach a Unix
 * socket handshake, and the socket's 0600 permissions are the access control.
 */
export class UnixWebSocket {
  onmessage: (text: string) => void = () => {};
  onclose: () => void = () => {};
  private socket: Awaited<ReturnType<typeof Bun.connect>> | null = null;
  private buffer = Buffer.alloc(0);
  private upgraded = false;
  private fragments: Buffer[] = [];
  private closed = false;

  static connect(path: string): Promise<UnixWebSocket> {
    const ws = new UnixWebSocket();
    return ws.open(path).then(() => ws);
  }

  private open(path: string): Promise<void> {
    const key = randomBytes(16).toString('base64');
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (error?: Error) => {
        if (settled) return;
        settled = true;
        error ? reject(error) : resolve();
      };
      Bun.connect({
        unix: path,
        socket: {
          open: (socket) => {
            this.socket = socket;
            socket.write(
              'GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
                `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
            );
          },
          data: (_socket, chunk) => {
            this.buffer = Buffer.concat([this.buffer, chunk]);
            if (!this.upgraded) {
              const end = this.buffer.indexOf('\r\n\r\n');
              if (end < 0) return;
              const head = this.buffer.subarray(0, end).toString();
              this.buffer = this.buffer.subarray(end + 4);
              if (!/^HTTP\/1\.1 101/.test(head)) {
                done(new Error(`websocket upgrade refused: ${head.split('\r\n')[0]}`));
                this.socket?.end();
                return;
              }
              this.upgraded = true;
              done();
            }
            this.readFrames();
          },
          close: () => this.finish(),
          error: (_socket, error) => {
            done(error);
            this.finish();
          },
          connectError: (_socket, error) => done(error),
        },
      }).catch((e: Error) => done(e));
    });
  }

  private finish() {
    if (this.closed) return;
    this.closed = true;
    this.onclose();
  }

  private readFrames() {
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0]!;
      const b1 = this.buffer[1]!;
      let length = b1 & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        length = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const masked = (b1 & 0x80) !== 0;
      const maskAt = offset;
      if (masked) offset += 4;
      if (this.buffer.length < offset + length) return;
      let payload = this.buffer.subarray(offset, offset + length);
      if (masked) {
        const mask = this.buffer.subarray(maskAt, maskAt + 4);
        payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]!));
      }
      this.buffer = this.buffer.subarray(offset + length);
      const opcode = b0 & 0x0f;
      const fin = (b0 & 0x80) !== 0;
      if (opcode === 0x8) {
        this.socket?.end();
        this.finish();
        return;
      }
      if (opcode === 0x9) {
        this.frame(0xa, payload);
        continue;
      }
      if (opcode === 0xa) continue;
      this.fragments.push(Buffer.from(payload));
      if (fin) {
        const text = Buffer.concat(this.fragments).toString('utf8');
        this.fragments = [];
        this.onmessage(text);
      }
    }
  }

  private frame(opcode: number, payload: Buffer) {
    if (!this.socket || this.closed) return;
    const length = payload.length;
    const header = length < 126 ? Buffer.alloc(2) : length < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    if (length < 126) header[1] = 0x80 | length;
    else if (length < 65536) {
      header[1] = 0x80 | 126;
      header.writeUInt16BE(length, 2);
    } else {
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    const mask = randomBytes(4);
    const body = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]!));
    this.socket.write(Buffer.concat([header, mask, body]));
  }

  send(text: string) {
    this.frame(0x1, Buffer.from(text, 'utf8'));
  }

  close() {
    this.frame(0x8, Buffer.alloc(0));
    this.socket?.end();
    this.finish();
  }
}

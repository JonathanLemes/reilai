/**
 * ReilAI secure channel (tunnel transport). Spec: docs/security.md.
 *
 * Primitives are the ones every platform ships natively (Node/Bun crypto,
 * Android Tink + JCE, iOS CryptoKit): X25519, HKDF-SHA256 and AES-256-GCM.
 *
 * Handshake (one round trip, then everything is encrypted):
 *   C → S  { t: "hello", v, dpk, epk }        device static key + client ephemeral
 *   S → C  { t: "hello", v, mpk, epk }        machine static key + server ephemeral
 *   ikm = DH(e_c, e_s) ‖ DH(e_c, S_m) ‖ DH(D_c, S_m)
 *   th  = SHA-256("reilai-v1" ‖ dpk ‖ epk_c ‖ mpk ‖ epk_s)
 *   k_c2s ‖ k_s2c = HKDF-SHA256(ikm, salt = th, info = "reilai/v1/keys", 64)
 *
 * The ephemeral DH gives forward secrecy; the static terms authenticate both ends
 * (only the real machine can derive the keys for its `mpk`, only the paired device
 * for its `dpk`). Frames carry a strictly increasing counter used as the GCM nonce,
 * so replays and reordering are rejected.
 */
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto';

export const CHANNEL_VERSION = 1;
const LABEL = 'reilai-v1';
const INFO = 'reilai/v1/keys';

export interface KeyPair {
  /** base64url, 32 raw bytes */
  publicKey: string;
  /** base64url, 32 raw bytes */
  privateKey: string;
}

export function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export function fromB64url(text: string): Buffer {
  return Buffer.from(text, 'base64url');
}

export function randomToken(bytes = 32): string {
  return b64url(randomBytes(bytes));
}

export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const jwk = privateKey.export({ format: 'jwk' });
  const pub = publicKey.export({ format: 'jwk' });
  return { publicKey: pub.x as string, privateKey: jwk.d as string };
}

function dh(privateKey: string, publicKey: string, ownPublicKey: string): Buffer {
  const priv = createPrivateKey({ key: { kty: 'OKP', crv: 'X25519', d: privateKey, x: ownPublicKey }, format: 'jwk' });
  const pub = createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: publicKey }, format: 'jwk' });
  return diffieHellman({ privateKey: priv, publicKey: pub });
}

function transcript(dpk: string, epkC: string, mpk: string, epkS: string): Buffer {
  const h = createHash('sha256');
  h.update(LABEL);
  for (const k of [dpk, epkC, mpk, epkS]) h.update(fromB64url(k));
  return h.digest();
}

function deriveKeys(ikm: Buffer, th: Buffer) {
  const okm = Buffer.from(hkdfSync('sha256', ikm, th, INFO, 64));
  return { c2s: okm.subarray(0, 32), s2c: okm.subarray(32, 64) };
}

export interface ClientHello {
  t: 'hello';
  v: number;
  dpk: string;
  epk: string;
}

export interface ServerHello {
  t: 'hello';
  v: number;
  mpk: string;
  epk: string;
}

/** Encrypts one direction and decrypts the other. */
export class SecureChannel {
  private sendCounter = 0n;
  private recvCounter = 0n;

  constructor(
    private readonly sendKey: Buffer,
    private readonly recvKey: Buffer,
    private readonly sendLabel: string,
    private readonly recvLabel: string,
  ) {}

  seal(value: unknown): string {
    const nonce = Buffer.alloc(12);
    nonce.writeBigUInt64BE(this.sendCounter, 4);
    const cipher = createCipheriv('aes-256-gcm', this.sendKey, nonce);
    cipher.setAAD(Buffer.from(this.sendLabel));
    const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final(), cipher.getAuthTag()]);
    const frame = JSON.stringify({ n: Number(this.sendCounter), c: body.toString('base64url') });
    this.sendCounter += 1n;
    return frame;
  }

  open(frame: string): unknown {
    const parsed = JSON.parse(frame) as { n?: unknown; c?: unknown };
    if (typeof parsed.n !== 'number' || typeof parsed.c !== 'string') throw new Error('malformed frame');
    if (BigInt(parsed.n) !== this.recvCounter) throw new Error('unexpected frame counter (replay or reorder)');
    const nonce = Buffer.alloc(12);
    nonce.writeBigUInt64BE(this.recvCounter, 4);
    const body = fromB64url(parsed.c);
    if (body.length < 16) throw new Error('frame too short');
    const decipher = createDecipheriv('aes-256-gcm', this.recvKey, nonce);
    decipher.setAAD(Buffer.from(this.recvLabel));
    decipher.setAuthTag(body.subarray(body.length - 16));
    const plain = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
    this.recvCounter += 1n;
    return JSON.parse(plain.toString('utf8'));
  }
}

/** Machine side: answers a client hello and returns the channel. */
export function acceptHandshake(machine: KeyPair, hello: ClientHello): { reply: ServerHello; channel: SecureChannel } {
  if (hello.v !== CHANNEL_VERSION) throw new Error(`unsupported channel version ${hello.v}`);
  if (fromB64url(hello.dpk).length !== 32 || fromB64url(hello.epk).length !== 32) throw new Error('bad key length');
  const eph = generateKeyPair();
  const ikm = Buffer.concat([
    dh(eph.privateKey, hello.epk, eph.publicKey),
    dh(machine.privateKey, hello.epk, machine.publicKey),
    dh(machine.privateKey, hello.dpk, machine.publicKey),
  ]);
  const { c2s, s2c } = deriveKeys(ikm, transcript(hello.dpk, hello.epk, machine.publicKey, eph.publicKey));
  return {
    reply: { t: 'hello', v: CHANNEL_VERSION, mpk: machine.publicKey, epk: eph.publicKey },
    channel: new SecureChannel(s2c, c2s, 's2c', 'c2s'),
  };
}

/** Device side, in two steps (hello out, hello in). The Kotlin host mirrors this. */
export function startHandshake(device: KeyPair) {
  const eph = generateKeyPair();
  const hello: ClientHello = { t: 'hello', v: CHANNEL_VERSION, dpk: device.publicKey, epk: eph.publicKey };
  return {
    hello,
    finish(reply: ServerHello, expectedMachineKey?: string): SecureChannel {
      if (reply.v !== CHANNEL_VERSION) throw new Error(`unsupported channel version ${reply.v}`);
      if (expectedMachineKey && reply.mpk !== expectedMachineKey) throw new Error('machine key mismatch');
      const ikm = Buffer.concat([
        dh(eph.privateKey, reply.epk, eph.publicKey),
        dh(eph.privateKey, reply.mpk, eph.publicKey),
        dh(device.privateKey, reply.mpk, device.publicKey),
      ]);
      const { c2s, s2c } = deriveKeys(ikm, transcript(device.publicKey, eph.publicKey, reply.mpk, reply.epk));
      return new SecureChannel(c2s, s2c, 'c2s', 's2c');
    },
  };
}

/** What the pairing QR encodes: `reilai://pair?...`. */
export interface PairingPayload {
  /** machine public key */
  k: string;
  /** one-time pairing token */
  t: string;
  /** candidate tunnel URLs (ws:// or wss://), tried in order */
  u: string[];
  /** machine display name */
  n: string;
}

export function encodePairing(p: PairingPayload): string {
  const q = new URLSearchParams({ v: String(CHANNEL_VERSION), k: p.k, t: p.t, n: p.n });
  for (const u of p.u) q.append('u', u);
  return `reilai://pair?${q.toString()}`;
}

export function decodePairing(link: string): PairingPayload {
  const url = new URL(link.trim());
  const q = url.searchParams;
  const k = q.get('k');
  const t = q.get('t');
  if (!k || !t) throw new Error('invalid pairing link');
  return { k, t, u: q.getAll('u'), n: q.get('n') ?? 'computer' };
}

/** Constant-time string compare for tokens. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

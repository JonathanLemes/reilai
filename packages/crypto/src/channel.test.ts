import { describe, expect, test } from 'bun:test';

import { acceptHandshake, decodePairing, encodePairing, generateKeyPair, startHandshake } from './index';

describe('secure channel', () => {
  test('both sides derive the same keys and exchange frames', () => {
    const machine = generateKeyPair();
    const device = generateKeyPair();
    const client = startHandshake(device);
    const { reply, channel: server } = acceptHandshake(machine, client.hello);
    const channel = client.finish(reply, machine.publicKey);

    expect(server.open(channel.seal({ hi: 'there' }))).toEqual({ hi: 'there' });
    expect(channel.open(server.seal({ n: 1 }))).toEqual({ n: 1 });
    expect(channel.open(server.seal({ n: 2 }))).toEqual({ n: 2 });
  });

  test('rejects replayed frames', () => {
    const machine = generateKeyPair();
    const client = startHandshake(generateKeyPair());
    const { reply, channel: server } = acceptHandshake(machine, client.hello);
    const channel = client.finish(reply);
    const frame = channel.seal('once');
    server.open(frame);
    expect(() => server.open(frame)).toThrow();
  });

  test('rejects a tampered frame', () => {
    const machine = generateKeyPair();
    const client = startHandshake(generateKeyPair());
    const { reply, channel: server } = acceptHandshake(machine, client.hello);
    const channel = client.finish(reply);
    const frame = JSON.parse(channel.seal('secret')) as { n: number; c: string };
    const flipped = frame.c.slice(0, -2) + (frame.c.endsWith('A') ? 'B' : 'A') + frame.c.slice(-1);
    expect(() => server.open(JSON.stringify({ ...frame, c: flipped }))).toThrow();
  });

  test('an impostor machine cannot be accepted by a pinned device', () => {
    const real = generateKeyPair();
    const impostor = generateKeyPair();
    const client = startHandshake(generateKeyPair());
    const { reply } = acceptHandshake(impostor, client.hello);
    expect(() => client.finish(reply, real.publicKey)).toThrow('machine key mismatch');
  });

  test('a device with a different static key derives different keys', () => {
    const machine = generateKeyPair();
    const honest = startHandshake(generateKeyPair());
    const { reply, channel: server } = acceptHandshake(machine, honest.hello);
    // attacker replays the honest hello but owns a different device key
    const forged = startHandshake(generateKeyPair());
    const forgedChannel = forged.finish(reply);
    expect(() => server.open(forgedChannel.seal('x'))).toThrow();
  });

  test('pairing link round trip', () => {
    const link = encodePairing({ k: 'abc', t: 'tok', u: ['ws://10.0.0.2:7430', 'wss://x.example'], n: 'box' });
    expect(decodePairing(link)).toEqual({ k: 'abc', t: 'tok', u: ['ws://10.0.0.2:7430', 'wss://x.example'], n: 'box' });
  });
});

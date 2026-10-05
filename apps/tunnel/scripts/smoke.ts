/**
 * End-to-end tunnel check against a running daemon + tunnel (+ optional relay):
 *   bun apps/tunnel/scripts/smoke.ts [relayUrl]
 * Pairs a throwaway device, calls RPC directly and through the relay, checks that
 * an unpaired key is refused, then revokes the device.
 */
import { readDaemonState, readServiceState } from '@reilai/cli/config';
import { generateKeyPair } from '@reilai/crypto';
import { DaemonClient } from '@reilai/protocol/client';

import { TunnelClient } from '../src/device-client';

const relay = process.argv[2];
const daemonState = readDaemonState();
const tunnel = readServiceState('tunnel') as { port: number; machineId?: string } | null;
if (!daemonState || !tunnel) throw new Error('start the daemon and the tunnel first');

const local = new DaemonClient(`ws://127.0.0.1:${daemonState.port}/rpc`, daemonState.token);
const pairing = await local.call('pairing.create');
const device = generateKeyPair();

const direct = new TunnelClient(device, pairing.machineKey);
const ready = await direct.connect(`ws://127.0.0.1:${tunnel.port}/tunnel`, { pair: pairing.token, name: 'smoke-test' });
console.log('paired as', ready.device.id, 'on', ready.machine);
const hello = await direct.call<{ machine: { name: string } }>('hello', { client: 'app' });
console.log('direct hello →', hello.machine.name);
const sessions = await direct.call<unknown[]>('sessions.list', {});
console.log('direct sessions.list →', sessions.length, 'sessions');
try {
  await direct.call('pairing.create', {});
  throw new Error('local-only method leaked through the tunnel');
} catch (e) {
  console.log('local-only method refused ✓', (e as Error).message);
}
direct.close();

const again = new TunnelClient(device, pairing.machineKey);
await again.connect(`ws://127.0.0.1:${tunnel.port}/tunnel`);
console.log('reconnected without token ✓');
again.close();

const stranger = new TunnelClient(generateKeyPair(), pairing.machineKey);
try {
  await stranger.connect(`ws://127.0.0.1:${tunnel.port}/tunnel`, { pair: pairing.token });
  throw new Error('a used pairing token was accepted twice');
} catch (e) {
  console.log('unpaired device refused ✓', (e as Error).message);
}

if (relay && tunnel.machineId) {
  const viaRelay = new TunnelClient(device, pairing.machineKey);
  await viaRelay.connect(`${relay}/c/${tunnel.machineId}`);
  const h = await viaRelay.call<{ machine: { name: string } }>('hello', { client: 'app' });
  console.log('relay hello →', h.machine.name, '✓');
  viaRelay.close();
}

await local.call('devices.revoke', { id: ready.device.id });
console.log('revoked ✓');
local.close();
process.exit(0);

/** Prints a pairing link for custom tunnel URLs (emulators, port forwards): bun pair-link.ts ws://localhost:7430/tunnel */
import { readDaemonState } from '@reilai/cli/config';
import { encodePairing } from '@reilai/crypto';
import { DaemonClient } from '@reilai/protocol/client';

const state = readDaemonState();
if (!state) throw new Error('daemon not running');
const client = new DaemonClient(`ws://127.0.0.1:${state.port}/rpc`, state.token);
const p = await client.call('pairing.create');
console.log(encodePairing({ k: p.machineKey, t: p.token, u: process.argv.slice(2), n: p.machineName }));
client.close();
process.exit(0);

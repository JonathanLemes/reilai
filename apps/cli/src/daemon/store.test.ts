import { describe, expect, test } from 'bun:test';

import type { Message, Session } from '@reilai/protocol';

import { toolDetail, toolTitle } from '../agents/describe';
import { Store } from './store';

function session(id: string, patch: Partial<Session> = {}): Session {
  return {
    id,
    agent: 'claude',
    title: 't',
    cwd: '/tmp',
    status: 'idle',
    mode: 'ask',
    model: null,
    createdAt: 1,
    updatedAt: 1,
    preview: '',
    agentRef: null,
    archived: false,
    pendingPermissions: 0,
    startedBy: 'cli',
    error: null,
    ...patch,
  };
}

function message(sessionId: string, seq: number, patch: Partial<Message> = {}): Message {
  return { id: `${sessionId}-${seq}`, sessionId, seq, time: seq, role: 'agent', kind: 'text', text: `m${seq}`, ...patch };
}

describe('store', () => {
  test('pages messages from the end, oldest first', () => {
    const store = new Store(':memory:');
    store.insertSession(session('s1'));
    for (let i = 1; i <= 10; i++) store.saveMessage(message('s1', i));
    const last = store.listMessages('s1', 4);
    expect(last.messages.map((m) => m.seq)).toEqual([7, 8, 9, 10]);
    expect(last.hasMore).toBe(true);
    const older = store.listMessages('s1', 4, 7);
    expect(older.messages.map((m) => m.seq)).toEqual([3, 4, 5, 6]);
    expect(store.nextSeq('s1')).toBe(11);
  });

  test('a restart stops live sessions and expires pending approvals', () => {
    const store = new Store(':memory:');
    store.insertSession(session('s1', { status: 'waiting' }));
    store.saveMessage(
      message('s1', 1, { kind: 'permission', permission: { requestId: 'r', tool: 'Bash', title: '$ ls', detail: 'ls', status: 'pending' } }),
    );
    store.saveMessage(message('s1', 2, { streaming: true }));
    store.saveMessage(message('s1', 3, { kind: 'tool', tool: { callId: 'c', name: 'Bash', title: '$ ls', input: {}, status: 'running' } }));
    store.recoverAfterRestart();
    expect(store.getSession('s1')?.status).toBe('stopped');
    const [perm, text, tool] = store.listMessages('s1', 10).messages;
    expect(perm?.permission?.status).toBe('expired');
    expect(text?.streaming).toBe(false);
    expect(tool?.tool?.status).toBe('error');
  });

  test('archived sessions are listed apart and settings default to system, no session limit', () => {
    const store = new Store(':memory:');
    store.insertSession(session('a'));
    store.insertSession(session('b', { archived: true }));
    expect(store.listSessions().map((s) => s.id)).toEqual(['a']);
    expect(store.listSessions(true).map((s) => s.id)).toEqual(['b']);
    expect(store.getSettings()).toEqual({ language: 'system', sessionTimeoutMinutes: 0 });
    store.saveSettings({ language: 'pt', sessionTimeoutMinutes: 30 });
    expect(store.getSettings()).toEqual({ language: 'pt', sessionTimeoutMinutes: 30 });
  });

  test('devices are unique by public key', () => {
    const store = new Store(':memory:');
    store.addDevice({ id: '1', name: 'Phone', publicKey: 'k', pairedAt: 1, lastSeenAt: null });
    store.addDevice({ id: '2', name: 'Phone 2', publicKey: 'k', pairedAt: 2, lastSeenAt: null });
    expect(store.listDevices()).toHaveLength(1);
    expect(store.findDeviceByKey('k')?.name).toBe('Phone 2');
    store.removeDevice('1');
    expect(store.listDevices()).toHaveLength(0);
  });
});

describe('tool descriptions', () => {
  test('titles are short and human', () => {
    expect(toolTitle('Bash', { command: 'bun test\nmore' })).toBe('$ bun test');
    expect(toolTitle('Read', { file_path: '/a/b/c/d.ts' })).toBe('Read …/c/d.ts');
    expect(toolTitle('mcp__github__create_issue', {})).toBe('github · create_issue');
  });

  test('edit details show a diff', () => {
    expect(toolDetail('Edit', { file_path: 'x.ts', old_string: 'a', new_string: 'b' })).toBe('x.ts\n\n- a\n+ b');
  });
});

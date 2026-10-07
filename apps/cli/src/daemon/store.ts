import { Database } from 'bun:sqlite';

import type { Device, Message, PermissionMode, Session, Settings } from '@reilai/protocol';

type SessionRow = {
  id: string;
  agent: string;
  title: string;
  cwd: string;
  status: string;
  mode: string;
  model: string | null;
  created_at: number;
  updated_at: number;
  preview: string;
  agent_ref: string | null;
  archived: number;
  started_by: string;
  error: string | null;
};

type MessageRow = { id: string; session_id: string; seq: number; time: number; data: string };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  title TEXT NOT NULL,
  cwd TEXT NOT NULL,
  status TEXT NOT NULL,
  mode TEXT NOT NULL,
  model TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  preview TEXT NOT NULL DEFAULT '',
  agent_ref TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  started_by TEXT NOT NULL,
  error TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  time INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_by_session ON messages(session_id, seq);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  public_key TEXT NOT NULL UNIQUE,
  paired_at INTEGER NOT NULL,
  last_seen_at INTEGER
);
CREATE TABLE IF NOT EXISTS recent_dirs (path TEXT PRIMARY KEY, used_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

function toSession(row: SessionRow, pendingPermissions: number): Session {
  return {
    id: row.id,
    agent: row.agent as Session['agent'],
    title: row.title,
    cwd: row.cwd,
    status: row.status as Session['status'],
    mode: row.mode as PermissionMode,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    preview: row.preview,
    agentRef: row.agent_ref,
    archived: row.archived === 1,
    pendingPermissions,
    startedBy: row.started_by as Session['startedBy'],
    error: row.error,
  };
}

/** SQLite persistence. The daemon is the only writer. */
export class Store {
  private db: Database;
  /** Pending permission counts live in memory (they die with the agent process). */
  readonly pending = new Map<string, number>();

  constructor(file: string) {
    this.db = new Database(file, { create: true });
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }

  /** After a restart no agent process is alive. */
  recoverAfterRestart() {
    this.db.run(`UPDATE sessions SET status = 'stopped' WHERE status IN ('starting', 'running', 'waiting', 'idle')`);
    this.db.run(
      `UPDATE messages SET data = json_set(data, '$.permission.status', 'expired') WHERE json_extract(data, '$.permission.status') = 'pending'`,
    );
    this.db.run(`UPDATE messages SET data = json_set(data, '$.streaming', json('false')) WHERE json_extract(data, '$.streaming') = 1`);
    this.db.run(
      `UPDATE messages SET data = json_set(data, '$.tool.status', 'error') WHERE json_extract(data, '$.tool.status') = 'running'`,
    );
  }

  listSessions(archived = false): Session[] {
    return this.db
      .query<SessionRow, [number]>('SELECT * FROM sessions WHERE archived = ? ORDER BY updated_at DESC')
      .all(archived ? 1 : 0)
      .map((row) => toSession(row, this.pending.get(row.id) ?? 0));
  }

  getSession(id: string): Session | null {
    const row = this.db.query<SessionRow, [string]>('SELECT * FROM sessions WHERE id = ?').get(id);
    return row ? toSession(row, this.pending.get(id) ?? 0) : null;
  }

  insertSession(s: Session) {
    this.db.run(
      `INSERT INTO sessions (id, agent, title, cwd, status, mode, model, created_at, updated_at, preview, agent_ref, archived, started_by, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        s.id,
        s.agent,
        s.title,
        s.cwd,
        s.status,
        s.mode,
        s.model,
        s.createdAt,
        s.updatedAt,
        s.preview,
        s.agentRef,
        s.archived ? 1 : 0,
        s.startedBy,
        s.error,
      ],
    );
  }

  updateSession(id: string, patch: Partial<Session>): Session | null {
    const columns: Record<string, string> = {
      title: 'title',
      status: 'status',
      mode: 'mode',
      model: 'model',
      updatedAt: 'updated_at',
      preview: 'preview',
      agentRef: 'agent_ref',
      archived: 'archived',
      error: 'error',
    };
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [key, column] of Object.entries(columns)) {
      if (!(key in patch)) continue;
      const value = patch[key as keyof Session];
      sets.push(`${column} = ?`);
      values.push(typeof value === 'boolean' ? (value ? 1 : 0) : (value as string | number | null));
    }
    if (sets.length) this.db.run(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`, [...values, id]);
    return this.getSession(id);
  }

  deleteSession(id: string) {
    this.db.run('DELETE FROM messages WHERE session_id = ?', [id]);
    this.db.run('DELETE FROM sessions WHERE id = ?', [id]);
    this.pending.delete(id);
  }

  nextSeq(sessionId: string): number {
    const row = this.db
      .query<{ seq: number | null }, [string]>('SELECT MAX(seq) AS seq FROM messages WHERE session_id = ?')
      .get(sessionId);
    return (row?.seq ?? 0) + 1;
  }

  saveMessage(m: Message) {
    this.db.run(
      `INSERT INTO messages (id, session_id, seq, time, data) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [m.id, m.sessionId, m.seq, m.time, JSON.stringify(m)],
    );
  }

  getMessage(id: string): Message | null {
    const row = this.db.query<MessageRow, [string]>('SELECT * FROM messages WHERE id = ?').get(id);
    return row ? (JSON.parse(row.data) as Message) : null;
  }

  /** Latest `limit` messages before `before` (exclusive), in ascending order. */
  listMessages(sessionId: string, limit: number, before?: number): { messages: Message[]; hasMore: boolean } {
    const rows = this.db
      .query<MessageRow, [string, number, number]>(
        'SELECT * FROM messages WHERE session_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?',
      )
      .all(sessionId, before ?? Number.MAX_SAFE_INTEGER, limit + 1);
    const hasMore = rows.length > limit;
    return { messages: rows.slice(0, limit).reverse().map((r) => JSON.parse(r.data) as Message), hasMore };
  }

  touchRecentDir(path: string) {
    this.db.run('INSERT INTO recent_dirs (path, used_at) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET used_at = excluded.used_at', [
      path,
      Date.now(),
    ]);
  }

  recentDirs(limit = 12): string[] {
    return this.db
      .query<{ path: string }, [number]>('SELECT path FROM recent_dirs ORDER BY used_at DESC LIMIT ?')
      .all(limit)
      .map((r) => r.path);
  }

  getSettings(): Settings {
    const row = this.db.query<{ value: string }, [string]>('SELECT value FROM kv WHERE key = ?').get('settings');
    const saved = row ? (JSON.parse(row.value) as Partial<Settings>) : {};
    const timeout = Number(saved.sessionTimeoutMinutes);
    return { language: saved.language ?? 'system', sessionTimeoutMinutes: Number.isFinite(timeout) && timeout > 0 ? timeout : 0 };
  }

  saveSettings(settings: Settings) {
    this.db.run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
      'settings',
      JSON.stringify(settings),
    ]);
  }

  listDevices(): Device[] {
    return this.db
      .query<{ id: string; name: string; public_key: string; paired_at: number; last_seen_at: number | null }, []>(
        'SELECT * FROM devices ORDER BY paired_at DESC',
      )
      .all()
      .map((r) => ({ id: r.id, name: r.name, publicKey: r.public_key, pairedAt: r.paired_at, lastSeenAt: r.last_seen_at }));
  }

  findDeviceByKey(publicKey: string): Device | null {
    return this.listDevices().find((d) => d.publicKey === publicKey) ?? null;
  }

  addDevice(device: Device) {
    this.db.run(
      'INSERT INTO devices (id, name, public_key, paired_at, last_seen_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(public_key) DO UPDATE SET name = excluded.name',
      [device.id, device.name, device.publicKey, device.pairedAt, device.lastSeenAt],
    );
  }

  touchDevice(id: string) {
    this.db.run('UPDATE devices SET last_seen_at = ? WHERE id = ?', [Date.now(), id]);
  }

  removeDevice(id: string) {
    this.db.run('DELETE FROM devices WHERE id = ?', [id]);
  }
}

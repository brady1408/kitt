import { Database } from 'bun:sqlite'
import type { ChatMessage, Task } from './protocol'

type MessageRow = { id: string; target: string; role: ChatMessage['role']; text: string; tool_summary: string | null; created_at: number }
type TaskRow = { id: string; prompt: string; cwd: string; status: Task['status']; output: string; created_at: number; finished_at: number | null; usage_in: number; usage_out: number; cost_usd: number }

const toMessage = (r: MessageRow): ChatMessage => ({ id: r.id, target: r.target, role: r.role, text: r.text, toolSummary: r.tool_summary, createdAt: r.created_at })
const toTask = (r: TaskRow): Task => ({ id: r.id, prompt: r.prompt, cwd: r.cwd, status: r.status, output: r.output, createdAt: r.created_at, finishedAt: r.finished_at, usageIn: r.usage_in, usageOut: r.usage_out, costUsd: r.cost_usd })

export class Store {
  private db: Database

  constructor(path: string) {
    this.db = new Database(path, { create: true })
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, target TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL,
        tool_summary TEXT, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS messages_target ON messages(target, created_at);
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, prompt TEXT NOT NULL, cwd TEXT NOT NULL, status TEXT NOT NULL,
        output TEXT NOT NULL, created_at INTEGER NOT NULL, finished_at INTEGER,
        usage_in INTEGER NOT NULL, usage_out INTEGER NOT NULL, cost_usd REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage (ts INTEGER NOT NULL, kind TEXT NOT NULL, tokens_in INTEGER NOT NULL, tokens_out INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS usage_ts ON usage(ts);
    `)
  }

  insertMessage(m: ChatMessage): ChatMessage {
    this.db.query('INSERT INTO messages (id, target, role, text, tool_summary, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(m.id, m.target, m.role, m.text, m.toolSummary, m.createdAt)
    return m
  }

  listMessages(target: string, limit = 200): ChatMessage[] {
    const rows = this.db.query<MessageRow, [string, number]>(
      'SELECT * FROM (SELECT *, rowid AS rid FROM messages WHERE target = ? ORDER BY created_at DESC, rowid DESC LIMIT ?) ORDER BY created_at ASC, rid ASC',
    ).all(target, limit)
    return rows.map(toMessage)
  }

  listAllMessages(limitPerTarget: number): ChatMessage[] {
    const rows = this.db.query<MessageRow, [number]>(
      `SELECT id, target, role, text, tool_summary, created_at FROM (
         SELECT *, rowid AS rid, row_number() OVER (PARTITION BY target ORDER BY created_at DESC, rowid DESC) AS rn FROM messages
       ) WHERE rn <= ? ORDER BY created_at ASC, rid ASC`,
    ).all(limitPerTarget)
    return rows.map(toMessage)
  }

  clearMessages(target: string): void {
    this.db.query('DELETE FROM messages WHERE target = ?').run(target)
  }

  upsertTask(t: Task): void {
    this.db.query(`INSERT INTO tasks (id, prompt, cwd, status, output, created_at, finished_at, usage_in, usage_out, cost_usd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, output = excluded.output, finished_at = excluded.finished_at,
        usage_in = excluded.usage_in, usage_out = excluded.usage_out, cost_usd = excluded.cost_usd`)
      .run(t.id, t.prompt, t.cwd, t.status, t.output, t.createdAt, t.finishedAt, t.usageIn, t.usageOut, t.costUsd)
  }

  listTasks(): Task[] {
    return this.db.query<TaskRow, []>('SELECT * FROM tasks ORDER BY created_at DESC').all().map(toTask)
  }

  deleteTask(id: string): void {
    this.db.query('DELETE FROM tasks WHERE id = ?').run(id)
  }

  kvGet(key: string): string | null {
    const row = this.db.query<{ value: string }, [string]>('SELECT value FROM kv WHERE key = ?').get(key)
    return row?.value ?? null
  }

  kvSet(key: string, value: string): void {
    this.db.query('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  recordUsage(kind: string, tokensIn: number, tokensOut: number, ts = Date.now()): void {
    this.db.query('INSERT INTO usage (ts, kind, tokens_in, tokens_out) VALUES (?, ?, ?, ?)').run(ts, kind, tokensIn, tokensOut)
  }

  sumUsageSince(ms: number, now = Date.now()): number {
    const row = this.db.query<{ total: number | null }, [number]>(
      'SELECT SUM(tokens_in + tokens_out) AS total FROM usage WHERE ts > ?',
    ).get(now - ms)
    return row?.total ?? 0
  }

  close(): void { this.db.close() }
}

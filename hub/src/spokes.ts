import { randomUUID } from 'node:crypto'
import type { Store } from './store'
import type { Registry } from './registry'
import { SpokeFrame, type ChatMessage, type HubToSpokeFrame, type ServerFrame } from './protocol'

export type SpokeSend = (f: HubToSpokeFrame) => void
export type SpokeDeps = { registry: Registry; store: Store; emit: (f: ServerFrame) => void; staleMs?: number }

type Conn = { id: string | null; send: SpokeSend; lastSeen: number; pendingTurns: string[] }

export class Spokes {
  private conns = new Map<string, Conn>()

  constructor(private deps: SpokeDeps) {}

  connect(send: SpokeSend): { handle(raw: string): void; close(): void } {
    const conn: Conn = { id: null, send, lastSeen: Date.now(), pendingTurns: [] }
    return {
      handle: (raw) => {
        let json: unknown
        try { json = JSON.parse(raw) } catch { return }
        const parsed = SpokeFrame.safeParse(json)
        if (!parsed.success) return
        this.onFrame(conn, parsed.data)
      },
      close: () => this.drop(conn),
    }
  }

  deliver(id: string, text: string): ChatMessage | null {
    const conn = this.conns.get(id)
    if (!conn) return null
    const msg = this.deps.store.insertMessage({
      id: randomUUID(), target: id, role: 'user', text, toolSummary: null, createdAt: Date.now(),
    })
    this.deps.emit({ type: 'chat.user', message: msg })
    conn.pendingTurns.push(randomUUID())
    this.deps.registry.patch(id, { status: 'working' })
    conn.send({ type: 'deliver', messageId: msg.id, text })
    return msg
  }

  isOnline(id: string): boolean {
    return this.conns.has(id)
  }

  sweep(now = Date.now()): void {
    const stale = this.deps.staleMs ?? 45_000
    for (const conn of [...this.conns.values()]) {
      if (now - conn.lastSeen > stale) this.drop(conn)
    }
  }

  private onFrame(conn: Conn, f: SpokeFrame): void {
    conn.lastSeen = Date.now()
    if (f.type === 'register') {
      const id = `spoke:${f.sessionId}`
      conn.id = id
      this.conns.set(id, conn)
      this.deps.registry.upsert({
        id, kind: 'spoke', name: f.name, cwd: f.cwd, status: 'idle', lastActivity: Date.now(), sessionId: f.sessionId, pid: f.pid,
      })
      conn.send({ type: 'registered', id })
      return
    }
    if (!conn.id) return
    if (f.type === 'reply') {
      const turnId = conn.pendingTurns.shift() ?? randomUUID()
      const msg = this.deps.store.insertMessage({
        id: randomUUID(), target: conn.id, role: 'assistant', text: f.text, toolSummary: null, createdAt: Date.now(),
      })
      this.deps.registry.patch(conn.id, { status: conn.pendingTurns.length > 0 ? 'working' : 'idle' })
      this.deps.emit({ type: 'chat.done', target: conn.id, turnId, message: msg, usage: null })
    }
  }

  private drop(conn: Conn): void {
    if (!conn.id || this.conns.get(conn.id) !== conn) return
    this.conns.delete(conn.id)
    this.deps.registry.patch(conn.id, { status: 'offline' })
  }
}

import type { SessionEntry } from './protocol'

const KIND_ORDER: Record<SessionEntry['kind'], number> = { kitt: 0, task: 1, spoke: 2 }
type Listener = (entry: SessionEntry) => void

export class Registry {
  private entries = new Map<string, SessionEntry>()
  private listeners = new Set<Listener>()

  upsert(entry: SessionEntry): SessionEntry {
    this.entries.set(entry.id, entry)
    this.notify(entry)
    return entry
  }

  patch(id: string, patch: Partial<SessionEntry>): SessionEntry | undefined {
    const current = this.entries.get(id)
    if (!current) return undefined
    const next = { ...current, ...patch, lastActivity: Date.now() }
    this.entries.set(id, next)
    this.notify(next)
    return next
  }

  get(id: string): SessionEntry | undefined { return this.entries.get(id) }

  list(): SessionEntry[] {
    return [...this.entries.values()].sort((a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name))
  }

  remove(id: string): void { this.entries.delete(id) }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notify(entry: SessionEntry): void { for (const l of this.listeners) l(entry) }
}

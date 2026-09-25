import type { ServerFrame } from './protocol'

export type Bus = {
  emit(f: ServerFrame): void
  subscribe(listener: (f: ServerFrame) => void): () => void
}

export function createBus(): Bus {
  const listeners = new Set<(f: ServerFrame) => void>()
  return {
    emit(f) { for (const l of listeners) l(f) },
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l) } },
  }
}

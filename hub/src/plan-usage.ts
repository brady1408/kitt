import type { Store } from './store'
import type { PlanUsageSnapshot, PlanWindow } from './protocol'
import type { RunnerEvent } from './runner'

const KEY = 'plan_usage'
type RateLimitEvent = Extract<RunnerEvent, { type: 'ratelimit' }>

export class PlanUsage {
  private windows: PlanUsageSnapshot = { fiveHour: null, sevenDay: null }
  private listeners = new Set<() => void>()

  constructor(private store: Store) {
    const raw = store.kvGet(KEY)
    if (raw) {
      try { this.windows = JSON.parse(raw) as PlanUsageSnapshot } catch { /* start empty */ }
    }
  }

  update(ev: RateLimitEvent): void {
    const window: PlanWindow = { utilization: ev.utilization, resetsAt: ev.resetsAt, status: ev.status }
    this.windows = ev.window === 'five_hour' ? { ...this.windows, fiveHour: window } : { ...this.windows, sevenDay: window }
    this.store.kvSet(KEY, JSON.stringify(this.windows))
    for (const l of this.listeners) l()
  }

  snapshot(): PlanUsageSnapshot {
    return { fiveHour: this.windows.fiveHour, sevenDay: this.windows.sevenDay }
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}

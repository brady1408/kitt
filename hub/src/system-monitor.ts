import { cpus, freemem, homedir, loadavg, totalmem } from 'node:os'
import { readFileSync, statfsSync } from 'node:fs'
import type { ServerFrame, SystemStats } from './protocol'

export type SystemReaders = {
  loadavg1: () => number
  cpus: () => number
  memTotal: () => number
  memAvailable: () => number
  disk: () => { total: number; available: number }
}

const clamp = (n: number) => Math.min(1, Math.max(0, n))

export const osReaders: SystemReaders = {
  loadavg1: () => loadavg()[0] ?? 0,
  cpus: () => Math.max(1, cpus().length),
  memTotal: () => totalmem(),
  memAvailable: () => {
    try {
      const kb = /MemAvailable:\s+(\d+)/.exec(readFileSync('/proc/meminfo', 'utf8'))?.[1]
      if (kb) return Number(kb) * 1024
    } catch { /* not linux */ }
    return freemem()
  },
  disk: () => {
    const s = statfsSync(homedir())
    return { total: s.blocks * s.bsize, available: s.bavail * s.bsize }
  },
}

export class SystemMonitor {
  private lastApiMs: number | null = null

  constructor(private readers: SystemReaders = osReaders) {}

  noteApi(ms: number): void { this.lastApiMs = ms }

  sample(now = Date.now()): SystemStats {
    const r = this.readers
    const disk = r.disk()
    return {
      load: clamp(r.loadavg1() / r.cpus()),
      memUsed: clamp(1 - r.memAvailable() / r.memTotal()),
      diskUsed: clamp(1 - disk.available / disk.total),
      diskFreeGb: Math.round(disk.available / 1e9),
      apiMs: this.lastApiMs,
      sampledAt: now,
    }
  }

  start(intervalMs: number, emit: (f: ServerFrame) => void): () => void {
    const tick = () => emit({ type: 'system.update', stats: this.sample() })
    tick()
    const timer = setInterval(tick, intervalMs)
    return () => clearInterval(timer)
  }
}

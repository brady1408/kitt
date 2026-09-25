import { test, expect } from 'bun:test'
import { SystemMonitor } from '../src/system-monitor'

const readers = {
  loadavg1: () => 3,
  cpus: () => 12,
  memTotal: () => 100,
  memAvailable: () => 40,
  disk: () => ({ total: 200e9, available: 20e9 }),
}

test('samples load, memory, disk and the last api round-trip', () => {
  const m = new SystemMonitor(readers)
  m.noteApi(1234)
  expect(m.sample(5000)).toEqual({ load: 0.25, memUsed: 0.6, diskUsed: 0.9, diskFreeGb: 20, apiMs: 1234, sampledAt: 5000 })
})

test('apiMs is null until a result arrives and load is capped at 1', () => {
  const m = new SystemMonitor({ ...readers, loadavg1: () => 40 })
  expect(m.sample(1)).toMatchObject({ load: 1, apiMs: null })
})

test('start emits a sample immediately and then on the interval', async () => {
  const m = new SystemMonitor(readers)
  const frames: unknown[] = []
  const stop = m.start(20, (f) => frames.push(f))
  await new Promise((r) => setTimeout(r, 55))
  stop()
  expect(frames.length).toBeGreaterThanOrEqual(3)
  expect(frames[0]).toMatchObject({ type: 'system.update', stats: { load: 0.25 } })
})

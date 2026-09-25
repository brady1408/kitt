import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TaskManager } from '../src/task-manager'
import { Store } from '../src/store'
import { Registry } from '../src/registry'
import { fakeFactory } from './fake-runner'
import { PlanUsage } from '../src/plan-usage'
import { SystemMonitor } from '../src/system-monitor'
import type { ServerFrame } from '../src/protocol'

const tick = () => new Promise((r) => setTimeout(r, 0))
const usage = { input: 10, output: 5, cacheRead: 0, cacheCreate: 0 }

function setup(maxRunning = 3) {
  const home = mkdtempSync(join(tmpdir(), 'kitt-home-'))
  mkdirSync(join(home, 'pa')); mkdirSync(join(home, 'proj'))
  const store = new Store(':memory:')
  const registry = new Registry()
  const frames: ServerFrame[] = []
  const { factory, runners, calls } = fakeFactory()
  const planUsage = new PlanUsage(store)
  const tasks = new TaskManager({ factory, store, registry, planUsage, system: new SystemMonitor(), emit: (f) => frames.push(f), defaultCwd: join(home, 'pa'), homeDir: home, taskPrompt: 'do task', maxRunning })
  return { home, store, registry, planUsage, frames, runners, calls, tasks }
}

test('create validates cwd: default, ~ expansion, escapes rejected', () => {
  const s = setup()
  expect(s.tasks.create('a').cwd).toBe(join(s.home, 'pa'))
  expect(s.tasks.create('b', '~/proj').cwd).toBe(join(s.home, 'proj'))
  expect(s.tasks.create('c', join(s.home, 'proj')).cwd).toBe(join(s.home, 'proj'))
  expect(() => s.tasks.create('d', '/etc')).toThrow('bad_cwd')
  expect(() => s.tasks.create('e', join(s.home, '..'))).toThrow('bad_cwd')
  expect(() => s.tasks.create('f', '~/../etc')).toThrow('bad_cwd')
  expect(() => s.tasks.create('g', join(s.home, 'missing'))).toThrow('bad_cwd')
})

test('a task runs with the task prompt, streams output, and finishes done', async () => {
  const s = setup()
  const t = s.tasks.create('list files')
  expect(s.calls[0]).toMatchObject({ prompt: 'list files', appendSystemPrompt: 'do task', cwd: join(s.home, 'pa') })
  expect(s.registry.get(t.id)).toMatchObject({ kind: 'task', status: 'working' })
  expect(s.tasks.list()[0]?.status).toBe('running')
  const r = s.runners[0]!
  r.emit({ type: 'tool', name: 'Bash', summary: 'Bash ls' }); await tick()
  r.emit({ type: 'delta', text: 'Two files.' }); await tick()
  expect(s.tasks.list()[0]?.output).toContain('Two files.')
  r.emit({ type: 'result', ok: true, text: 'Two files.', usage, costUsd: 0.03 }); r.end(); await tick()
  const done = s.tasks.list()[0]!
  expect(done).toMatchObject({ status: 'done', usageIn: 10, usageOut: 5, costUsd: 0.03 })
  expect(done.finishedAt).not.toBeNull()
  expect(s.registry.get(t.id)).toBeUndefined()
  expect(s.frames.filter((f) => f.type === 'task.update').length).toBeGreaterThanOrEqual(4)
  expect(s.store.sumUsageSince(60_000)).toBe(15)
})

test('empty streamed output falls back to the result text', async () => {
  const s = setup()
  s.tasks.create('quiet')
  s.runners[0]!.emit({ type: 'result', ok: true, text: 'Final answer.', usage, costUsd: 0 }); s.runners[0]!.end(); await tick()
  expect(s.tasks.list()[0]?.output).toBe('Final answer.')
})

test('the running cap queues extra tasks until one finishes', async () => {
  const s = setup(1)
  s.tasks.create('one'); s.tasks.create('two')
  expect(s.runners).toHaveLength(1)
  expect(s.tasks.list().map((t) => t.status)).toEqual(['queued', 'running'])
  s.runners[0]!.emit({ type: 'result', ok: true, text: 'r', usage, costUsd: 0 }); s.runners[0]!.end(); await tick()
  expect(s.runners).toHaveLength(2)
  expect(s.calls[1]?.prompt).toBe('two')
})

test('cancel closes the runner and marks cancelled; exit without result is an error', async () => {
  const s = setup()
  const a = s.tasks.create('a'); const b = s.tasks.create('b')
  s.tasks.cancel(a.id); await tick()
  expect(s.runners[0]!.closed).toBe(true)
  expect(s.tasks.list().find((t) => t.id === a.id)?.status).toBe('cancelled')
  s.runners[1]!.end('boom'); await tick()
  const tb = s.tasks.list().find((t) => t.id === b.id)!
  expect(tb.status).toBe('error')
  expect(tb.output).toContain('boom')
})

test('delete refuses running tasks and removes finished ones', async () => {
  const s = setup()
  const t = s.tasks.create('x')
  expect(() => s.tasks.delete(t.id)).toThrow('task_running')
  s.runners[0]!.emit({ type: 'result', ok: true, text: 'r', usage, costUsd: 0 }); s.runners[0]!.end(); await tick()
  s.tasks.delete(t.id)
  expect(s.tasks.list()).toEqual([])
})

test('markInterruptedOnStartup flips running and queued tasks', () => {
  const s = setup()
  const base = { prompt: 'p', cwd: '/x', output: '', createdAt: 1, finishedAt: null, usageIn: 0, usageOut: 0, costUsd: 0 }
  s.store.upsertTask({ ...base, id: 'r', status: 'running' })
  s.store.upsertTask({ ...base, id: 'q', status: 'queued' })
  s.store.upsertTask({ ...base, id: 'd', status: 'done' })
  s.tasks.markInterruptedOnStartup()
  expect(Object.fromEntries(s.tasks.list().map((t) => [t.id, t.status]))).toEqual({ r: 'interrupted', q: 'interrupted', d: 'done' })
})

test('delete announces the removal to browsers', async () => {
  const s = setup()
  const t = s.tasks.create('x')
  s.runners[0]!.emit({ type: 'result', ok: true, text: 'r', usage, costUsd: 0 }); s.runners[0]!.end(); await tick()
  s.tasks.delete(t.id)
  expect(s.frames.at(-1)).toEqual({ type: 'task.deleted', id: t.id })
})

test('cancel on a queued task marks it cancelled without ever starting it', () => {
  const s = setup(1)
  s.tasks.create('one'); const two = s.tasks.create('two')
  s.tasks.cancel(two.id)
  const t = s.tasks.list().find((x) => x.id === two.id)!
  expect(t.status).toBe('cancelled')
  expect(t.finishedAt).not.toBeNull()
  expect(s.runners).toHaveLength(1)
  expect(s.frames.at(-1)).toMatchObject({ type: 'task.update', task: { id: two.id, status: 'cancelled' } })
})

test('rate limit events from task runners update plan usage too', async () => {
  const s = setup()
  s.tasks.create('x')
  s.runners[0]!.emit({ type: 'ratelimit', window: 'five_hour', utilization: 0.5, resetsAt: 900, status: 'allowed' }); await tick()
  expect(s.planUsage.snapshot().fiveHour).toEqual({ utilization: 0.5, resetsAt: 900, status: 'allowed' })
})

test('task output separates text blocks with a paragraph break', async () => {
  const s = setup()
  s.tasks.create('x')
  const r = s.runners[0]!
  r.emit({ type: 'block' }); r.emit({ type: 'delta', text: 'First.' }); await tick()
  r.emit({ type: 'block' }); r.emit({ type: 'delta', text: 'Second.' }); await tick()
  expect(s.tasks.list()[0]?.output).toBe('First.\n\nSecond.')
})

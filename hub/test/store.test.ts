import { test, expect } from 'bun:test'
import { Store } from '../src/store'
import type { ChatMessage, Task } from '../src/protocol'

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: crypto.randomUUID(), target: 'kitt', role: 'user', text: 'hi', toolSummary: null, createdAt: 1, ...over,
})
const task = (over: Partial<Task>): Task => ({
  id: crypto.randomUUID(), prompt: 'p', cwd: '/tmp', status: 'queued', output: '', createdAt: 1,
  finishedAt: null, usageIn: 0, usageOut: 0, costUsd: 0, ...over,
})

test('messages round-trip per target, oldest first, capped', () => {
  const s = new Store(':memory:')
  s.insertMessage(msg({ text: 'a', createdAt: 1 }))
  s.insertMessage(msg({ text: 'b', createdAt: 2 }))
  s.insertMessage(msg({ text: 'c', createdAt: 3, target: 'spoke:x' }))
  expect(s.listMessages('kitt').map((m) => m.text)).toEqual(['a', 'b'])
  expect(s.listMessages('kitt', 1).map((m) => m.text)).toEqual(['b'])
  expect(s.listAllMessages(1).map((m) => m.text)).toEqual(['b', 'c'])
  s.clearMessages('kitt')
  expect(s.listMessages('kitt')).toEqual([])
  expect(s.listMessages('spoke:x')).toHaveLength(1)
})

test('tasks upsert, list newest first, delete', () => {
  const s = new Store(':memory:')
  const t1 = task({ createdAt: 1 }); const t2 = task({ createdAt: 2 })
  s.upsertTask(t1); s.upsertTask(t2)
  s.upsertTask({ ...t1, status: 'done', output: 'ok', finishedAt: 5 })
  expect(s.listTasks().map((t) => t.createdAt)).toEqual([2, 1])
  expect(s.listTasks()[1]).toMatchObject({ status: 'done', output: 'ok', finishedAt: 5 })
  s.deleteTask(t2.id)
  expect(s.listTasks()).toHaveLength(1)
})

test('kv and usage rollups', () => {
  const s = new Store(':memory:')
  expect(s.kvGet('x')).toBeNull()
  s.kvSet('x', '1'); s.kvSet('x', '2')
  expect(s.kvGet('x')).toBe('2')
  const now = 10_000_000
  s.recordUsage('kitt', 100, 10, now - 1000)
  s.recordUsage('task', 50, 5, now - 5000)
  expect(s.sumUsageSince(2000, now)).toBe(110)
  expect(s.sumUsageSince(10_000, now)).toBe(165)
})

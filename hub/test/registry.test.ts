import { test, expect } from 'bun:test'
import { Registry } from '../src/registry'
import type { SessionEntry } from '../src/protocol'

const entry = (over: Partial<SessionEntry>): SessionEntry => ({
  id: 'x', kind: 'spoke', name: 'x', cwd: '/x', status: 'idle', lastActivity: 0, ...over,
})

test('upsert, patch, list order, remove, change events', () => {
  const r = new Registry()
  const seen: string[] = []
  const off = r.onChange((e) => seen.push(`${e.id}:${e.status}`))
  r.upsert(entry({ id: 'spoke:b', name: 'beta' }))
  r.upsert(entry({ id: 'task-1', kind: 'task', name: 'task' }))
  r.upsert(entry({ id: 'kitt', kind: 'kitt', name: 'K.I.T.T.' }))
  r.upsert(entry({ id: 'spoke:a', name: 'alpha' }))
  expect(r.list().map((e) => e.id)).toEqual(['kitt', 'task-1', 'spoke:a', 'spoke:b'])
  const patched = r.patch('spoke:a', { status: 'working' })
  expect(patched?.status).toBe('working')
  expect(patched!.lastActivity).toBeGreaterThan(0)
  expect(r.patch('nope', { status: 'idle' })).toBeUndefined()
  r.remove('task-1')
  expect(r.get('task-1')).toBeUndefined()
  off()
  r.patch('spoke:a', { status: 'idle' })
  expect(seen).toEqual(['spoke:b:idle', 'task-1:idle', 'kitt:idle', 'spoke:a:idle', 'spoke:a:working'])
})

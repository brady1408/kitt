import { test, expect } from 'bun:test'
import { Spokes } from '../src/spokes'
import { Store } from '../src/store'
import { Registry } from '../src/registry'
import type { HubToSpokeFrame, ServerFrame } from '../src/protocol'

function setup(staleMs?: number) {
  const store = new Store(':memory:')
  const registry = new Registry()
  const frames: ServerFrame[] = []
  const spokes = new Spokes({ registry, store, emit: (f) => frames.push(f), ...(staleMs ? { staleMs } : {}) })
  const out: HubToSpokeFrame[] = []
  const conn = spokes.connect((f) => out.push(f))
  const register = () => conn.handle(JSON.stringify({ type: 'register', sessionId: 's1', pid: 7, cwd: '/home/b/ws/go', name: 'go' }))
  return { store, registry, frames, spokes, out, conn, register }
}

test('register creates a registry entry and acks with the id', () => {
  const s = setup()
  s.register()
  expect(s.out[0]).toEqual({ type: 'registered', id: 'spoke:s1' })
  expect(s.registry.get('spoke:s1')).toMatchObject({ kind: 'spoke', name: 'go', cwd: '/home/b/ws/go', status: 'idle', sessionId: 's1', pid: 7 })
  expect(s.spokes.isOnline('spoke:s1')).toBe(true)
})

test('deliver stores the user message, marks working, and forwards; reply lands as chat.done', () => {
  const s = setup()
  s.register()
  const msg = s.spokes.deliver('spoke:s1', 'status?')
  expect(msg?.role).toBe('user')
  expect(s.out[1]).toEqual({ type: 'deliver', messageId: msg!.id, text: 'status?' })
  expect(s.registry.get('spoke:s1')?.status).toBe('working')
  expect(s.frames[0]).toMatchObject({ type: 'chat.user', message: { target: 'spoke:s1', text: 'status?' } })
  s.conn.handle(JSON.stringify({ type: 'reply', text: 'all green' }))
  expect(s.frames[1]).toMatchObject({ type: 'chat.done', target: 'spoke:s1', message: { role: 'assistant', text: 'all green' }, usage: null })
  expect(s.registry.get('spoke:s1')?.status).toBe('idle')
  expect(s.store.listMessages('spoke:s1').map((m) => m.text)).toEqual(['status?', 'all green'])
})

test('two delivers before any reply produce two chat.done frames in order', () => {
  const s = setup()
  s.register()
  s.spokes.deliver('spoke:s1', 'first'); s.spokes.deliver('spoke:s1', 'second')
  s.conn.handle(JSON.stringify({ type: 'reply', text: 'A' }))
  expect(s.registry.get('spoke:s1')?.status).toBe('working')
  s.conn.handle(JSON.stringify({ type: 'reply', text: 'B' }))
  expect(s.registry.get('spoke:s1')?.status).toBe('idle')
  const dones = s.frames.filter((f) => f.type === 'chat.done')
  expect(dones.map((f) => (f as { message: { text: string } }).message.text)).toEqual(['A', 'B'])
  expect(new Set(dones.map((f) => (f as { turnId: string }).turnId)).size).toBe(2)
})

test('deliver to an unknown or offline spoke returns null; close marks offline', () => {
  const s = setup()
  expect(s.spokes.deliver('spoke:nope', 'x')).toBeNull()
  s.register()
  s.conn.close()
  expect(s.spokes.deliver('spoke:s1', 'x')).toBeNull()
  expect(s.registry.get('spoke:s1')?.status).toBe('offline')
})

test('frames before register and malformed frames are ignored', () => {
  const s = setup()
  s.conn.handle(JSON.stringify({ type: 'reply', text: 'orphan' }))
  s.conn.handle('not json')
  s.conn.handle(JSON.stringify({ type: 'bogus' }))
  expect(s.frames).toEqual([])
})

test('sweep marks spokes offline after the stale window', () => {
  const s = setup(1000)
  s.register()
  s.spokes.sweep(Date.now() + 500)
  expect(s.spokes.isOnline('spoke:s1')).toBe(true)
  s.conn.handle(JSON.stringify({ type: 'heartbeat' }))
  s.spokes.sweep(Date.now() + 2000)
  expect(s.spokes.isOnline('spoke:s1')).toBe(false)
  expect(s.registry.get('spoke:s1')?.status).toBe('offline')
})

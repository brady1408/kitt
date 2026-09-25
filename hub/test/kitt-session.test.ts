import { test, expect } from 'bun:test'
import { KittSession } from '../src/kitt-session'
import { Store } from '../src/store'
import { Registry } from '../src/registry'
import { fakeFactory } from './fake-runner'
import type { ServerFrame } from '../src/protocol'

const tick = () => new Promise((r) => setTimeout(r, 0))
const usage = { input: 100, output: 20, cacheRead: 1000, cacheCreate: 0 }

function setup(seedSessionId?: string) {
  const store = new Store(':memory:')
  if (seedSessionId) store.kvSet('kitt_session_id', seedSessionId)
  const registry = new Registry()
  const frames: ServerFrame[] = []
  const { factory, runners, calls } = fakeFactory()
  const kitt = new KittSession({ factory, store, registry, cwd: '/tmp/pa', persona: 'be kitt', emit: (f) => frames.push(f) })
  kitt.start()
  return { store, registry, frames, runners, calls, kitt }
}

test('start registers KITT and launches a runner with the persona', () => {
  const s = setup()
  expect(s.registry.get('kitt')).toMatchObject({ kind: 'kitt', status: 'idle', cwd: '/tmp/pa' })
  expect(s.calls[0]).toMatchObject({ cwd: '/tmp/pa', appendSystemPrompt: 'be kitt' })
  expect(s.calls[0]!.resume).toBeUndefined()
})

test('a turn streams deltas, records tools, and finishes with the full text', async () => {
  const s = setup()
  s.kitt.send('hello')
  expect(s.runners[0]!.sent).toEqual(['hello'])
  expect(s.frames[0]).toMatchObject({ type: 'chat.user', message: { text: 'hello', role: 'user', target: 'kitt' } })
  expect(s.registry.get('kitt')?.status).toBe('working')
  const r = s.runners[0]!
  r.emit({ type: 'init', sessionId: 'sess-1', model: 'claude-opus-5' }); await tick()
  r.emit({ type: 'tool', name: 'Read', summary: 'Read /tmp/x' }); await tick()
  r.emit({ type: 'delta', text: 'Good ' }); r.emit({ type: 'delta', text: 'evening.' }); await tick()
  r.emit({ type: 'result', ok: true, text: 'Good evening.', usage, costUsd: 0.01 }); await tick()
  const done = s.frames.find((f) => f.type === 'chat.done')
  expect(done).toMatchObject({ type: 'chat.done', target: 'kitt', message: { role: 'assistant', text: 'Good evening.' }, usage })
  expect(s.frames.filter((f) => f.type === 'chat.delta').map((f) => (f as { text: string }).text)).toEqual(['Good ', 'evening.'])
  expect(s.frames.some((f) => f.type === 'chat.tool' && f.summary === 'Read /tmp/x')).toBe(true)
  expect(s.store.kvGet('kitt_session_id')).toBe('sess-1')
  expect(s.store.listMessages('kitt').map((m) => [m.role, m.text, m.toolSummary]))
    .toEqual([['user', 'hello', null], ['assistant', '', 'Read /tmp/x'], ['assistant', 'Good evening.', null]])
  expect(s.kitt.usage()).toMatchObject({ context: 1100, contextWindow: 1_000_000, h5: 1120, d7: 1120 })
  expect(s.registry.get('kitt')?.status).toBe('idle')
  expect(s.frames.at(-1)?.type).toBe('usage.update')
})

test('a second message waits for the first turn to finish', async () => {
  const s = setup()
  s.kitt.send('one'); s.kitt.send('two')
  expect(s.runners[0]!.sent).toEqual(['one'])
  s.runners[0]!.emit({ type: 'result', ok: true, text: 'r1', usage, costUsd: 0 }); await tick()
  expect(s.runners[0]!.sent).toEqual(['one', 'two'])
})

test('init on later turns does not overwrite the stored session id', async () => {
  const s = setup()
  s.runners[0]!.emit({ type: 'init', sessionId: 'a', model: 'm' }); await tick()
  s.runners[0]!.emit({ type: 'init', sessionId: 'b', model: 'm' }); await tick()
  expect(s.store.kvGet('kitt_session_id')).toBe('a')
})

test('a failed resume falls back to a fresh session and replays the pending message', async () => {
  const s = setup('stale-session')
  expect(s.calls[0]).toMatchObject({ resume: 'stale-session' })
  s.kitt.send('hi')
  s.runners[0]!.end('resume failed'); await tick()
  expect(s.calls).toHaveLength(2)
  expect(s.calls[1]!.resume).toBeUndefined()
  expect(s.runners[1]!.sent).toEqual(['hi'])
  expect(s.frames.some((f) => f.type === 'chat.system' && /Starting fresh/.test(f.text))).toBe(true)
  expect(s.store.kvGet('kitt_session_id')).toBe('')
})

test('an exit after init is reported and the next send relaunches with resume', async () => {
  const s = setup()
  s.runners[0]!.emit({ type: 'init', sessionId: 'sess-9', model: 'm' }); await tick()
  s.runners[0]!.end('crash'); await tick()
  expect(s.registry.get('kitt')?.status).toBe('error')
  expect(s.frames.some((f) => f.type === 'chat.system' && /crash/.test(f.text))).toBe(true)
  s.kitt.send('back?')
  expect(s.calls[1]).toMatchObject({ resume: 'sess-9' })
  expect(s.runners[1]!.sent).toEqual(['back?'])
})

test('clear discards history and starts a session without resume', async () => {
  const s = setup()
  s.kitt.send('x')
  s.runners[0]!.emit({ type: 'init', sessionId: 'sess-1', model: 'm' }); await tick()
  s.kitt.clear()
  expect(s.runners[0]!.closed).toBe(true)
  expect(s.calls[1]!.resume).toBeUndefined()
  expect(s.store.listMessages('kitt')).toEqual([])
  expect(s.store.kvGet('kitt_session_id')).toBe('')
  expect(s.kitt.usage().context).toBe(0)
})

test('interrupt forwards to the runner', async () => {
  const s = setup()
  await s.kitt.interrupt()
  expect(s.runners[0]!.interrupted).toBe(1)
})

test('a runner stream that ends without an exit event is treated as an exit', async () => {
  const s = setup()
  s.runners[0]!.emit({ type: 'init', sessionId: 'sess-2', model: 'm' }); await tick()
  s.runners[0]!.close(); await tick()
  expect(s.registry.get('kitt')?.status).toBe('error')
  s.kitt.send('again')
  expect(s.calls).toHaveLength(2)
  expect(s.runners[1]!.sent).toEqual(['again'])
})

test('clear tells browsers to drop the KITT history before announcing the fresh session', async () => {
  const s = setup()
  s.kitt.send('x')
  s.kitt.clear()
  const types = s.frames.map((f) => f.type)
  const cleared = types.indexOf('chat.cleared')
  expect(cleared).toBeGreaterThan(-1)
  expect(s.frames[cleared]).toEqual({ type: 'chat.cleared', target: 'kitt' })
  expect(types.indexOf('chat.system')).toBeGreaterThan(cleared)
})

test('interrupt swallows a rejecting runner instead of crashing the hub', async () => {
  const s = setup()
  s.runners[0]!.interrupt = async () => { throw new Error('transport closed') }
  await expect(s.kitt.interrupt()).resolves.toBeUndefined()
})

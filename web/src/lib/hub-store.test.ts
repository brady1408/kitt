import { test, expect } from 'bun:test'
import { reduce, initialState, type HubState } from './hub-store'
import type { ChatMessage, ServerFrame } from '@kitt/hub/protocol'

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: crypto.randomUUID(), target: 'kitt', role: 'assistant', text: 't', toolSummary: null, createdAt: 1, ...over,
})
const apply = (state: HubState, ...frames: ServerFrame[]) => frames.reduce((s, frame) => reduce(s, { type: 'frame', frame }), state)
const usage = { context: 5, contextWindow: 1_000_000, h5: 10, d7: 20 }

test('snapshot groups messages by target and resets live turns', () => {
  const s = apply({ ...initialState, live: { kitt: { turnId: 'x', text: 'half', tools: [] } } }, {
    type: 'snapshot', registry: [], tasks: [], usage,
    messages: [msg({ target: 'kitt', text: 'a' }), msg({ target: 'spoke:1', text: 'b' }), msg({ target: 'kitt', text: 'c' })],
  })
  expect(s.messages['kitt']?.map((m) => m.text)).toEqual(['a', 'c'])
  expect(s.messages['spoke:1']?.map((m) => m.text)).toEqual(['b'])
  expect(s.live).toEqual({})
  expect(s.usage).toEqual(usage)
})

test('deltas and tools accumulate into a live turn; done replaces it with stored messages', () => {
  let s = apply(initialState,
    { type: 'chat.user', message: msg({ role: 'user', text: 'hi', id: 'u1' }) },
    { type: 'chat.delta', target: 'kitt', turnId: 't1', text: 'Good ' },
    { type: 'chat.tool', target: 'kitt', turnId: 't1', name: 'Read', summary: 'Read /x' },
    { type: 'chat.delta', target: 'kitt', turnId: 't1', text: 'evening.' })
  expect(s.live['kitt']).toEqual({ turnId: 't1', text: 'Good evening.', tools: ['Read /x'] })
  s = apply(s, { type: 'chat.done', target: 'kitt', turnId: 't1', message: msg({ id: 'a1', text: 'Good evening.' }), usage: null })
  expect(s.live['kitt']).toBeNull()
  expect(s.messages['kitt']?.map((m) => [m.text, m.toolSummary])).toEqual([['hi', null], ['', 'Read /x'], ['Good evening.', null]])
})

test('chat.done with no live turn still appends the message', () => {
  const s = apply(initialState, { type: 'chat.done', target: 'spoke:9', turnId: 't', message: msg({ target: 'spoke:9', text: 'pong' }), usage: null })
  expect(s.messages['spoke:9']?.map((m) => m.text)).toEqual(['pong'])
})

test('registry updates replace entries and keep kitt first; tasks upsert newest first', () => {
  let s = apply(initialState,
    { type: 'registry.update', entry: { id: 'spoke:a', kind: 'spoke', name: 'a', cwd: '/a', status: 'idle', lastActivity: 1 } },
    { type: 'registry.update', entry: { id: 'kitt', kind: 'kitt', name: 'K.I.T.T.', cwd: '/pa', status: 'idle', lastActivity: 1 } },
    { type: 'registry.update', entry: { id: 'spoke:a', kind: 'spoke', name: 'a', cwd: '/a', status: 'working', lastActivity: 2 } })
  expect(s.registry.map((e) => [e.id, e.status])).toEqual([['kitt', 'idle'], ['spoke:a', 'working']])
  const base = { prompt: 'p', cwd: '/x', output: '', finishedAt: null, usageIn: 0, usageOut: 0, costUsd: 0 }
  s = apply(s,
    { type: 'task.update', task: { ...base, id: 'old', status: 'queued', createdAt: 1 } },
    { type: 'task.update', task: { ...base, id: 'new', status: 'queued', createdAt: 2 } },
    { type: 'task.update', task: { ...base, id: 'old', status: 'done', createdAt: 1 } })
  expect(s.tasks.map((t) => [t.id, t.status])).toEqual([['new', 'queued'], ['old', 'done']])
})

test('system lines, errors and connection state', () => {
  let s = apply(initialState, { type: 'chat.system', target: 'kitt', text: 'Fresh session started.' }, { type: 'error', code: 'x', text: 'boom' })
  expect(s.messages['kitt']?.[0]).toMatchObject({ role: 'system', text: 'Fresh session started.' })
  expect(s.lastError).toBe('boom')
  s = reduce(s, { type: 'dismissError' })
  expect(s.lastError).toBeNull()
  expect(reduce(s, { type: 'connected', value: true }).connected).toBe(true)
})

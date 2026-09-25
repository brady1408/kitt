import { test, expect } from 'bun:test'
import { reduce, initialState, type HubState } from './hub-store'
import type { ChatMessage, ServerFrame } from '@kitt/hub/protocol'

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: crypto.randomUUID(), target: 'kitt', role: 'assistant', text: 't', toolSummary: null, createdAt: 1, ...over,
})
const apply = (state: HubState, ...frames: ServerFrame[]) => frames.reduce((s, frame) => reduce(s, { type: 'frame', frame }), state)
const usage = { context: 5, contextWindow: 1_000_000, plan: { fiveHour: { utilization: 0.1, resetsAt: 1, status: 'allowed' as const }, sevenDay: null } }

test('snapshot groups messages by target and resets live turns', () => {
  const s = apply({ ...initialState, live: { kitt: { turnId: 'x', text: 'half', tools: [] } } }, {
    type: 'snapshot', registry: [], tasks: [], usage, system: { load: 0, memUsed: 0, diskUsed: 0, diskFreeGb: 0, apiMs: null, sampledAt: 0 },
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

test('chat.cleared drops that target\'s messages and live turn only', () => {
  let s = apply(initialState,
    { type: 'chat.user', message: msg({ role: 'user', text: 'hi', target: 'kitt' }) },
    { type: 'chat.user', message: msg({ role: 'user', text: 'yo', target: 'spoke:1' }) },
    { type: 'chat.delta', target: 'kitt', turnId: 't', text: 'partial' })
  s = apply(s, { type: 'chat.cleared', target: 'kitt' })
  expect(s.messages['kitt']).toEqual([])
  expect(s.live['kitt']).toBeNull()
  expect(s.messages['spoke:1']?.map((m) => m.text)).toEqual(['yo'])
})

test('task.deleted and registry.remove drop their rows', () => {
  const base = { prompt: 'p', cwd: '/x', output: '', finishedAt: null, usageIn: 0, usageOut: 0, costUsd: 0 }
  let s = apply(initialState,
    { type: 'task.update', task: { ...base, id: 'a', status: 'done', createdAt: 1 } },
    { type: 'registry.update', entry: { id: 'task-a', kind: 'task', name: 'a', cwd: '/a', status: 'working', lastActivity: 1 } },
    { type: 'registry.update', entry: { id: 'kitt', kind: 'kitt', name: 'K', cwd: '/pa', status: 'idle', lastActivity: 1 } })
  s = apply(s, { type: 'task.deleted', id: 'a' }, { type: 'registry.remove', id: 'task-a' })
  expect(s.tasks).toEqual([])
  expect(s.registry.map((e) => e.id)).toEqual(['kitt'])
})

test('system.update replaces the system stats', () => {
  const stats = { load: 0.25, memUsed: 0.6, diskUsed: 0.9, diskFreeGb: 20, apiMs: 1234, sampledAt: 5 }
  const s = apply(initialState, { type: 'system.update', stats })
  expect(s.system).toEqual(stats)
})

const taskBase = { prompt: 'count files', cwd: '/x', output: '', finishedAt: null, usageIn: 0, usageOut: 0, costUsd: 0 }
const entry = (id: string, kind: 'kitt' | 'spoke', status: 'idle' | 'working' | 'offline' | 'error') => ({ id, kind, name: id === 'kitt' ? 'K.I.T.T.' : 'go', cwd: '/x', status, lastActivity: 1 })
const texts = (s: HubState) => s.activity.map((a) => a.text)

test('activity records tool calls, task transitions, terminals joining and leaving', () => {
  let s = apply(initialState,
    { type: 'chat.tool', target: 'kitt', turnId: 't', name: 'Bash', summary: 'Bash ls -la' },
    { type: 'task.update', task: { ...taskBase, id: 'a', status: 'queued', createdAt: 1 } },
    { type: 'task.update', task: { ...taskBase, id: 'a', status: 'running', createdAt: 1 } },
    { type: 'task.update', task: { ...taskBase, id: 'a', status: 'running', createdAt: 1, output: 'partial' } },
    { type: 'task.update', task: { ...taskBase, id: 'a', status: 'done', createdAt: 1, output: 'x' } },
    { type: 'registry.update', entry: entry('spoke:1', 'spoke', 'idle') },
    { type: 'registry.update', entry: entry('spoke:1', 'spoke', 'working') },
    { type: 'registry.update', entry: entry('spoke:1', 'spoke', 'offline') })
  expect(texts(s)).toEqual([
    'Terminal offline: go',
    'Terminal joined: go',
    'Task done: count files',
    'Task running: count files',
    'Task queued: count files',
    'Bash ls -la',
  ])
  expect(s.activity[0]).toMatchObject({ kind: 'session', sessionId: 'spoke:1', tone: 'muted' })
  expect(s.activity[5]).toMatchObject({ kind: 'tool', sessionId: 'kitt', tone: 'amber' })
})

test('activity records link changes, plan and disk thresholds, and system lines, but not snapshots', () => {
  let s = reduce(initialState, { type: 'connected', value: true })
  s = reduce(s, { type: 'connected', value: false })
  s = reduce(s, { type: 'connected', value: true })
  const plan = (status: 'allowed' | 'allowed_warning' | 'rejected') => ({ context: 0, contextWindow: 1, plan: { fiveHour: { utilization: 0.9, resetsAt: 1, status }, sevenDay: null } })
  s = apply(s, { type: 'usage.update', usage: plan('allowed') }, { type: 'usage.update', usage: plan('allowed_warning') }, { type: 'usage.update', usage: plan('allowed') })
  const sys = (diskUsed: number) => ({ load: 0, memUsed: 0, diskUsed, diskFreeGb: 5, apiMs: null, sampledAt: 1 })
  s = apply(s, { type: 'system.update', stats: sys(0.85) }, { type: 'system.update', stats: sys(0.92) }, { type: 'system.update', stats: sys(0.93) })
  s = apply(s, { type: 'chat.system', target: 'kitt', text: 'Fresh session started.' })
  s = apply(s, { type: 'snapshot', registry: [entry('kitt', 'kitt', 'idle')], messages: [], tasks: [], usage: plan('allowed'), system: sys(0.5) })
  expect(texts(s)).toEqual([
    'Fresh session started.',
    'Drive space above 90%',
    'Plan window back to normal',
    'Plan window warning',
    'Link restored',
    'Link lost',
  ])
})

test('activity is capped at 200 entries', () => {
  let s = initialState
  for (let i = 0; i < 205; i++) s = reduce(s, { type: 'frame', frame: { type: 'chat.tool', target: 'kitt', turnId: 't', name: 'Read', summary: `Read ${i}` } })
  expect(s.activity).toHaveLength(200)
  expect(s.activity[0]?.text).toBe('Read 204')
})

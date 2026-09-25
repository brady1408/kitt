import { test, expect } from 'bun:test'
import { ClientFrame, ServerFrame, SpokeFrame, HubToSpokeFrame } from '../src/protocol'

test('accepts a well-formed chat.send', () => {
  const r = ClientFrame.safeParse({ type: 'chat.send', target: 'kitt', text: 'hello' })
  expect(r.success).toBe(true)
})

test('rejects unknown frame types', () => {
  expect(ClientFrame.safeParse({ type: 'chat.explode' }).success).toBe(false)
})

test('rejects whitespace-only chat text and trims the rest', () => {
  expect(ClientFrame.safeParse({ type: 'chat.send', target: 'kitt', text: '   ' }).success).toBe(false)
  const r = ClientFrame.safeParse({ type: 'chat.send', target: 'kitt', text: '  hi  ' })
  expect(r.success && r.data.type === 'chat.send' && r.data.text).toBe('hi')
})

test('task.create cwd is optional', () => {
  expect(ClientFrame.safeParse({ type: 'task.create', prompt: 'do it' }).success).toBe(true)
})

test('server snapshot frame validates', () => {
  const r = ServerFrame.safeParse({
    type: 'snapshot', registry: [], messages: [], tasks: [],
    system: { load: 0.1, memUsed: 0.5, diskUsed: 0.9, diskFreeGb: 20, apiMs: null, sampledAt: 1 },
    usage: { context: 0, contextWindow: 1000000, plan: { fiveHour: null, sevenDay: { utilization: 0.36, resetsAt: 1790582400, status: 'allowed' } } },
  })
  expect(r.success).toBe(true)
})

test('spoke register and hub deliver frames validate', () => {
  expect(SpokeFrame.safeParse({ type: 'register', sessionId: 's1', pid: 12, cwd: '/x', name: 'x' }).success).toBe(true)
  expect(HubToSpokeFrame.safeParse({ type: 'deliver', messageId: 'm1', text: 'hi' }).success).toBe(true)
})

import { test, expect } from 'bun:test'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { translate, summarizeTool, contextWindowFor } from '../src/runner'

const asMsg = (m: unknown) => m as SDKMessage

test('init, text delta, tool use, and result translate to events', () => {
  expect(translate(asMsg({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude-opus-5' })))
    .toEqual([{ type: 'init', sessionId: 's1', model: 'claude-opus-5' }])
  expect(translate(asMsg({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } } })))
    .toEqual([{ type: 'delta', text: 'Hi' }])
  expect(translate(asMsg({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{' } } })))
    .toEqual([])
  expect(translate(asMsg({ type: 'assistant', message: { content: [
    { type: 'text', text: 'Looking.' },
    { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls -la /tmp', description: 'list' } },
    { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/etc/hosts' } },
  ] } }))).toEqual([
    { type: 'tool', name: 'Bash', summary: 'Bash ls -la /tmp' },
    { type: 'tool', name: 'Read', summary: 'Read /etc/hosts' },
  ])
  expect(translate(asMsg({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', total_cost_usd: 0.02,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 7 } })))
    .toEqual([{ type: 'result', ok: true, text: 'Done.', usage: { input: 10, output: 5, cacheRead: 100, cacheCreate: 7 }, costUsd: 0.02 }])
  expect(translate(asMsg({ type: 'result', subtype: 'error_max_turns', is_error: true, usage: {} })))
    .toEqual([{ type: 'result', ok: false, text: '', usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 }, costUsd: 0 }])
  expect(translate(asMsg({ type: 'user', message: { role: 'user', content: 'x' } }))).toEqual([])
})

test('tool summaries pick the primary field and cap at 80 chars', () => {
  expect(summarizeTool('Grep', { pattern: 'foo', path: '/x' })).toBe('Grep foo')
  expect(summarizeTool('Bash', { command: 'a'.repeat(200) })).toHaveLength('Bash '.length + 80)
  expect(summarizeTool('Weird', { nested: { a: 1 } })).toBe('Weird {"a":1}')
  expect(summarizeTool('Empty', null)).toBe('Empty')
})

test('context window by model family', () => {
  expect(contextWindowFor('claude-fable-5-1')).toBe(1_000_000)
  expect(contextWindowFor('claude-opus-5')).toBe(1_000_000)
  expect(contextWindowFor('claude-haiku-4-5-20251001')).toBe(200_000)
  expect(contextWindowFor('')).toBe(1_000_000)
})

test('rate limit events translate to plan usage events', () => {
  expect(translate(asMsg({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', utilization: 0.12, resetsAt: 1790000000 } })))
    .toEqual([{ type: 'ratelimit', window: 'five_hour', utilization: 0.12, resetsAt: 1790000000, status: 'allowed' }])
  expect(translate(asMsg({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'overage' } }))).toEqual([])
  expect(translate(asMsg({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', utilization: 0.14, resetsAt: 1,
    unifiedWindows: { five_hour: { utilization: 0.14, resetsAt: 1 }, seven_day: { utilization: 0.36, resetsAt: 2 }, seven_day_overage_included: { utilization: 0.68, resetsAt: 2 } } } })))
    .toEqual([
      { type: 'ratelimit', window: 'five_hour', utilization: 0.14, resetsAt: 1, status: 'allowed' },
      { type: 'ratelimit', window: 'seven_day', utilization: 0.36, resetsAt: 2, status: 'allowed' },
    ])
})

test('result events carry the api round-trip time', () => {
  const [ev] = translate(asMsg({ type: 'result', subtype: 'success', is_error: false, result: 'x', total_cost_usd: 0, duration_api_ms: 987, usage: {} }))
  expect(ev).toMatchObject({ type: 'result', apiMs: 987 })
})

test('a new text block starts a block event; tool blocks do not', () => {
  expect(translate(asMsg({ type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } } })))
    .toEqual([{ type: 'block' }])
  expect(translate(asMsg({ type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't', name: 'Bash', input: {} } } })))
    .toEqual([])
})

import { test, expect } from 'bun:test'
import { createNarrator } from './narrator'
import type { ChatMessage, ServerFrame } from '@kitt/hub/protocol'

const msg = (text: string, target = 'kitt'): ChatMessage => ({ id: 'm', target, role: 'assistant', text, toolSummary: null, createdAt: 1 })
const delta = (text: string, target = 'kitt', turnId = 't1'): ServerFrame => ({ type: 'chat.delta', target, turnId, text })
const tool = (target = 'kitt', turnId = 't1'): ServerFrame => ({ type: 'chat.tool', target, turnId, name: 'Bash', summary: 'Bash ls' })
const done = (text: string, target = 'kitt', turnId = 't1'): ServerFrame => ({ type: 'chat.done', target, turnId, message: msg(text, target), usage: null })

function setup(enabled = () => true, target = () => 'kitt') {
  const spoken: string[] = []
  const n = createNarrator({ speak: (t) => spoken.push(t), enabled, target })
  return { n, spoken }
}

test('speaks the narration when a tool call starts, then the rest at the end', () => {
  const { n, spoken } = setup()
  n.handle(delta('Let me '))
  n.handle(delta('check first.'))
  n.handle(tool())
  expect(spoken).toEqual(['Let me check first.'])
  n.handle(delta('\n\n'))
  n.handle(delta('It is Thursday.'))
  n.handle(done('Let me check first.\n\nIt is Thursday.'))
  expect(spoken).toEqual(['Let me check first.', 'It is Thursday.'])
})

test('a turn with no tool calls is spoken once at the end', () => {
  const { n, spoken } = setup()
  n.handle(delta('Good evening.'))
  n.handle(done('Good evening.'))
  expect(spoken).toEqual(['Good evening.'])
})

test('a reply with no streamed text falls back to the final message', () => {
  const { n, spoken } = setup()
  n.handle(done('Only in the result.'))
  expect(spoken).toEqual(['Only in the result.'])
})

test('back-to-back tool calls do not repeat what was already spoken', () => {
  const { n, spoken } = setup()
  n.handle(delta('Checking.'))
  n.handle(tool())
  n.handle(tool())
  n.handle(done('Checking.'))
  expect(spoken).toEqual(['Checking.'])
})

test('ignores other targets, other turns, and speaks nothing when voice is off', () => {
  const { n, spoken } = setup(() => false)
  n.handle(delta('hidden')); n.handle(done('hidden'))
  expect(spoken).toEqual([])
  const b = setup(() => true, () => 'kitt')
  b.n.handle(delta('for a terminal', 'spoke:1')); b.n.handle(done('for a terminal', 'spoke:1'))
  expect(b.spoken).toEqual([])
  b.n.handle(delta('turn one', 'kitt', 'a'))
  b.n.handle(delta('turn two', 'kitt', 'b'))
  b.n.handle(done('turn two', 'kitt', 'b'))
  expect(b.spoken).toEqual(['turn two'])
})

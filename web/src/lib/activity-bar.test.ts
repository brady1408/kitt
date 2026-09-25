import { test, expect } from 'bun:test'
import { barSegments } from './activity-bar'
import type { SessionEntry } from '@kitt/hub/protocol'

const e = (id: string, kind: SessionEntry['kind'], status: SessionEntry['status']): SessionEntry =>
  ({ id, kind, name: id, cwd: '/x', status, lastActivity: 0 })

test('one segment per session in kitt, task, terminal order; the rest empty', () => {
  const segs = barSegments([e('s1', 'spoke', 'idle'), e('t1', 'task', 'working'), e('kitt', 'kitt', 'idle')], true, 6)
  expect(segs).toEqual(['idle', 'working', 'idle', 'empty', 'empty', 'empty'])
})

test('error and offline sessions keep their own states', () => {
  expect(barSegments([e('kitt', 'kitt', 'error'), e('s1', 'spoke', 'offline')], true, 3)).toEqual(['error', 'offline', 'empty'])
})

test('a lost link greys every segment', () => {
  expect(barSegments([e('kitt', 'kitt', 'working'), e('s1', 'spoke', 'idle')], false, 3)).toEqual(['dark', 'dark', 'dark'])
})

test('more sessions than segments truncates rather than overflowing', () => {
  const many = Array.from({ length: 15 }, (_, i) => e(`s${i}`, 'spoke', 'idle'))
  expect(barSegments(many, true, 12)).toHaveLength(12)
})

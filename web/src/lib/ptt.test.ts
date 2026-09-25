import { test, expect } from 'bun:test'
import { pttKeyAction, pttPointerAction } from './ptt'

const key = (type: 'keydown' | 'keyup', code = 'Space', extra: Partial<{ repeat: boolean; typing: boolean; ctrl: boolean }> = {}) =>
  ({ type, code, repeat: extra.repeat ?? false, typing: extra.typing ?? false, modifier: extra.ctrl ?? false })

test('holding space starts recording when idle and releasing it stops', () => {
  expect(pttKeyAction(key('keydown'), 'idle')).toBe('start')
  expect(pttKeyAction(key('keyup'), 'recording')).toBe('stop')
})

test('space does nothing while typing, on key repeat, with modifiers, or for other keys', () => {
  expect(pttKeyAction(key('keydown', 'Space', { typing: true }), 'idle')).toBeNull()
  expect(pttKeyAction(key('keydown', 'Space', { repeat: true }), 'idle')).toBeNull()
  expect(pttKeyAction(key('keydown', 'Space', { ctrl: true }), 'idle')).toBeNull()
  expect(pttKeyAction(key('keydown', 'KeyA'), 'idle')).toBeNull()
  expect(pttKeyAction(key('keyup'), 'idle')).toBeNull()
  expect(pttKeyAction(key('keydown'), 'transcribing')).toBeNull()
})

test('a held lamp records for the hold; a quick tap toggles instead', () => {
  expect(pttPointerAction('down', 'idle', 0)).toBe('start')
  expect(pttPointerAction('up', 'recording', 600)).toBe('stop')
  expect(pttPointerAction('up', 'recording', 120)).toBeNull()
  expect(pttPointerAction('down', 'recording', 0)).toBe('stop')
  expect(pttPointerAction('down', 'transcribing', 0)).toBeNull()
})

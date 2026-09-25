import { test, expect } from 'bun:test'
import { pickVoice, type VoiceLike } from './voice'

const v = (name: string, lang: string): VoiceLike => ({ name, lang })
const edge = [
  v('Microsoft Zira - English (United States)', 'en-US'),
  v('Microsoft David - English (United States)', 'en-US'),
  v('Microsoft Guy Online (Natural) - English (United States)', 'en-US'),
  v('Microsoft Sonia Online (Natural) - English (United Kingdom)', 'en-GB'),
  v('Google UK English Male', 'en-GB'),
]

test('a remembered voice wins when it exists', () => {
  expect(pickVoice(edge, 'Google UK English Male')?.name).toBe('Google UK English Male')
})

test('otherwise prefer an American natural male voice', () => {
  expect(pickVoice(edge, null)?.name).toBe('Microsoft Guy Online (Natural) - English (United States)')
})

test('falls back to any American male, then any English voice, then anything', () => {
  expect(pickVoice([v('Microsoft David - English (United States)', 'en-US'), v('Google UK English Female', 'en-GB')], null)?.name).toBe('Microsoft David - English (United States)')
  expect(pickVoice([v('Google Deutsch', 'de-DE'), v('Google UK English Female', 'en-GB')], null)?.name).toBe('Google UK English Female')
  expect(pickVoice([v('Google Deutsch', 'de-DE')], null)?.name).toBe('Google Deutsch')
  expect(pickVoice([], null)).toBeNull()
})

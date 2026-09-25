import { test, expect } from 'bun:test'
import { cleanForSpeech, splitForSpeech } from './speech'

test('cleanForSpeech drops markdown syntax but keeps the words', () => {
  expect(cleanForSpeech('## Title\n- **bold** and _em_ and `code` and [link](http://x) > quote')).toBe('Title\nbold and em and code and link quote')
})

test('splitForSpeech breaks on sentence ends and paragraph breaks, merging short pieces', () => {
  expect(splitForSpeech('Hi. There.\n\nNew paragraph, longer than a couple of words. Ok?')).toEqual(['Hi. There.', 'New paragraph, longer than a couple of words.', 'Ok?'])
  expect(splitForSpeech('a'.repeat(700))).toHaveLength(3)
})

import { test, expect } from 'bun:test'
import { createMic } from './mic'

function setup(opts: { transcript?: string | null; recognizer?: boolean } = {}) {
  const log: string[] = []
  let stopRecording: ((blob: Blob | null) => void) | null = null
  const states: string[] = []
  const mic = createMic({
    startRecording: async () => { log.push('rec:start'); return new Promise<Blob | null>((resolve) => { stopRecording = resolve }) },
    stopRecording: () => { log.push('rec:stop'); stopRecording?.(new Blob(['audio'])); stopRecording = null },
    transcribe: async (blob) => { log.push(`stt:${await blob.text()}`); return opts.transcript === undefined ? 'hello kitt' : opts.transcript },
    recognizer: opts.recognizer === false ? null : async () => { log.push('browser-recognizer'); return 'browser text' },
    onState: (s) => states.push(s),
    onText: (t) => log.push(`text:${t}`),
  })
  return { mic, log, states }
}
const tick = () => new Promise((r) => setTimeout(r, 5))

test('toggle starts recording, toggle again stops, transcribes, and delivers the text', async () => {
  const s = setup()
  await s.mic.toggle(); await tick()
  expect(s.states).toEqual(['recording'])
  await s.mic.toggle(); await tick()
  expect(s.log).toEqual(['rec:start', 'rec:stop', 'stt:audio', 'text:hello kitt'])
  expect(s.states).toEqual(['recording', 'transcribing', 'idle'])
})

test('when the sidecar cannot transcribe, the browser recognizer takes over', async () => {
  const s = setup({ transcript: null })
  await s.mic.toggle(); await tick(); await s.mic.toggle(); await tick()
  expect(s.log).toEqual(['rec:start', 'rec:stop', 'stt:audio', 'browser-recognizer', 'text:browser text'])
})

test('an empty transcript delivers nothing and returns to idle', async () => {
  const s = setup({ transcript: '' })
  await s.mic.toggle(); await tick(); await s.mic.toggle(); await tick()
  expect(s.log.some((l) => l.startsWith('text:'))).toBe(false)
  expect(s.states.at(-1)).toBe('idle')
})

test('recording that fails to start goes straight to the recognizer if there is one', async () => {
  const log: string[] = []
  const mic = createMic({
    startRecording: async () => { throw new Error('no mic') },
    stopRecording: () => {},
    transcribe: async () => 'x',
    recognizer: async () => { log.push('browser-recognizer'); return 'spoken' },
    onState: () => {},
    onText: (t) => log.push(`text:${t}`),
  })
  await mic.toggle(); await tick()
  expect(log).toEqual(['browser-recognizer', 'text:spoken'])
})

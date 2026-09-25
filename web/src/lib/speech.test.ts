import { test, expect } from 'bun:test'
import { createSpeaker } from './speech'

function setup(opts: { voice?: string | null; fail?: Set<string> } = {}) {
  const log: string[] = []
  let release: (() => void) | null = null
  const speaker = createSpeaker({
    serverVoice: () => (opts.voice === undefined ? 'am_michael' : opts.voice),
    fetchAudio: async (text, voice) => { log.push(`fetch:${voice}:${text}`); return opts.fail?.has(text) ? null : new Blob([text]) },
    play: (blob) => new Promise<void>((resolve) => { blob.text().then((t) => { log.push(`play:${t}`); release = resolve }) }),
    stop: () => { log.push('stop'); release?.(); release = null },
    fallback: (text) => log.push(`browser:${text}`),
  })
  return { speaker, log, finish: () => { release?.(); release = null } }
}
const tick = () => new Promise((r) => setTimeout(r, 5))

test('chunks play in order, one at a time', async () => {
  const s = setup()
  s.speaker.speak('one'); s.speaker.speak('two')
  await tick()
  expect(s.log.filter((l) => l.startsWith('play:'))).toEqual(['play:one'])
  s.finish(); await tick()
  expect(s.log.filter((l) => l.startsWith('play:'))).toEqual(['play:one', 'play:two'])
  expect(s.log.filter((l) => l.startsWith('fetch:'))).toEqual(['fetch:am_michael:one', 'fetch:am_michael:two'])
})

test('falls back to the browser voice when the server has no voice or the fetch fails', async () => {
  const a = setup({ voice: null })
  a.speaker.speak('hi'); await tick()
  expect(a.log).toEqual(['browser:hi'])
  const b = setup({ fail: new Set(['broken']) })
  b.speaker.speak('broken'); await tick()
  expect(b.log).toEqual(['fetch:am_michael:broken', 'browser:broken'])
})

test('cancel stops playback and drops what was queued', async () => {
  const s = setup()
  s.speaker.speak('one'); s.speaker.speak('two'); await tick()
  s.speaker.cancel(); await tick()
  expect(s.log.filter((l) => l.startsWith('play:'))).toEqual(['play:one'])
  expect(s.log.at(-1)).toBe('stop')
  s.speaker.speak('three'); await tick()
  expect(s.log.at(-1)).toBe('play:three')
})

test('long text is split into sentence-sized pieces, each synthesized and played in order', async () => {
  const s = setup()
  s.speaker.speak('First sentence. Second sentence!\n\nThird, after a break? Fourth.')
  await tick()
  expect(s.log[0]).toBe('fetch:am_michael:First sentence.')
  expect(s.log).toContain('play:First sentence.')
  s.finish(); await tick(); s.finish(); await tick(); s.finish(); await tick(); s.finish(); await tick()
  expect(s.log.filter((l) => l.startsWith('play:'))).toEqual(['play:First sentence.', 'play:Second sentence!', 'play:Third, after a break?', 'play:Fourth.'])
})

test('the next piece is fetched while the current one plays', async () => {
  const s = setup()
  s.speaker.speak('One two three four five six seven eight nine ten. Eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen.')
  await tick()
  expect(s.log).toContain('play:One two three four five six seven eight nine ten.')
  expect(s.log).toContain('fetch:am_michael:Eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen.')
  expect(s.log).not.toContain('play:Eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen.')
})

test('markdown is stripped before synthesis', async () => {
  const s = setup()
  s.speaker.speak('- **Shipped:** `business`, done. See [docs](http://x).')
  await tick()
  expect(s.log[0]).toBe('fetch:am_michael:Shipped: business, done. See docs.')
})

import { test, expect } from 'bun:test'
import { createRecorder, type RecorderLike } from './recorder'

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void }
const deferred = <T,>(): Deferred<T> => { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }

function fakeStream() {
  const track = { stopped: false, stop() { this.stopped = true } }
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track }
}

function fakeRecorderCtor(log: string[]) {
  return class implements RecorderLike {
    state: 'inactive' | 'recording' = 'inactive'
    mimeType = 'audio/webm'
    ondataavailable: ((e: { data: Blob }) => void) | null = null
    onstop: (() => void) | null = null
    onerror: (() => void) | null = null
    start() { this.state = 'recording'; log.push('start') }
    stop() { this.state = 'inactive'; log.push('stop'); this.ondataavailable?.({ data: new Blob(['x']) }); this.onstop?.() }
  }
}

test('a normal start and stop yields the clip and releases the stream', async () => {
  const log: string[] = []
  const { stream, track } = fakeStream()
  const rec = createRecorder({ getStream: () => Promise.resolve(stream), Recorder: fakeRecorderCtor(log), releaseStream: () => track.stop() })
  const clip = rec.start()
  await Promise.resolve()
  rec.stop()
  expect(await clip).not.toBeNull()
  expect(log).toEqual(['start', 'stop'])
  expect(track.stopped).toBe(true)
})

test('a stop that arrives before the stream is granted ends the session with no clip', async () => {
  const log: string[] = []
  const { stream, track } = fakeStream()
  const pending = deferred<MediaStream>()
  const rec = createRecorder({ getStream: () => pending.promise, Recorder: fakeRecorderCtor(log), releaseStream: () => track.stop() })
  const clip = rec.start()
  rec.stop()
  pending.resolve(stream)
  expect(await clip).toBeNull()
  expect(log).toEqual([])
  expect(track.stopped).toBe(true)
})

test('a recorder that fails to start rejects instead of hanging', async () => {
  const { stream, track } = fakeStream()
  class Broken implements RecorderLike {
    state: 'inactive' | 'recording' = 'inactive'
    mimeType = ''
    ondataavailable = null
    onstop = null
    onerror = null
    start() { throw new Error('NotSupportedError') }
    stop() {}
  }
  const rec = createRecorder({ getStream: () => Promise.resolve(stream), Recorder: Broken, releaseStream: () => track.stop() })
  await expect(rec.start()).rejects.toThrow('NotSupportedError')
  expect(track.stopped).toBe(true)
})

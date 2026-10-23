export type RecorderLike = {
  state: 'inactive' | 'recording' | 'paused'
  mimeType: string
  ondataavailable: ((e: { data: Blob }) => void) | null
  onstop: (() => void) | null
  onerror: (() => void) | null
  start(): void
  stop(): void
}

type Deps = {
  getStream: () => Promise<MediaStream>
  Recorder: new (stream: MediaStream, options?: { mimeType: string }) => RecorderLike
  releaseStream: () => void
  mimeType?: string
}

/**
 * One recording session at a time. A stop that lands before the stream is granted cancels the
 * start (the browser can still be showing the permission prompt), so the session can never be
 * left running with nothing able to end it.
 */
export function createRecorder(deps: Deps) {
  let recorder: RecorderLike | null = null
  let stopRequested = false

  return {
    start(): Promise<Blob | null> {
      stopRequested = false
      return new Promise((resolve, reject) => {
        deps.getStream().then((stream) => {
          if (stopRequested) { deps.releaseStream(); resolve(null); return }
          let rec: RecorderLike
          try {
            rec = new deps.Recorder(stream, deps.mimeType ? { mimeType: deps.mimeType } : undefined)
            const chunks: Blob[] = []
            rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
            rec.onstop = () => {
              deps.releaseStream()
              recorder = null
              resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType || 'audio/webm' }) : null)
            }
            rec.onerror = () => { deps.releaseStream(); recorder = null; resolve(null) }
            rec.start()
          } catch (err) {
            deps.releaseStream()
            recorder = null
            reject(err)
            return
          }
          recorder = rec
        }, reject)
      })
    },
    stop(): void {
      stopRequested = true
      if (recorder && recorder.state !== 'inactive') recorder.stop()
    },
  }
}

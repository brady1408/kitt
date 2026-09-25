export type MicState = 'idle' | 'recording' | 'transcribing'

type Deps = {
  /** Starts capturing; resolves with the clip when stopRecording is called, or null if nothing was captured. Rejects if the mic is unavailable. */
  startRecording: () => Promise<Blob | null>
  stopRecording: () => void
  /** Sidecar transcription; null means the sidecar could not do it. */
  transcribe: (clip: Blob) => Promise<string | null>
  /** Browser speech recognition as a fallback; null when the browser has none. */
  recognizer: (() => Promise<string>) | null
  onState: (state: MicState) => void
  onText: (text: string) => void
}

/** Push-to-talk: toggle to start recording, toggle again to stop and transcribe. */
export function createMic(deps: Deps) {
  let state: MicState = 'idle'
  let clip: Promise<Blob | null> | null = null
  const set = (s: MicState) => { state = s; deps.onState(s) }
  const deliver = (text: string) => { const t = text.trim(); if (t) deps.onText(t) }
  const viaRecognizer = async () => {
    if (!deps.recognizer) return
    try { deliver(await deps.recognizer()) } catch { /* nothing heard */ }
  }

  return {
    get state() { return state },
    async toggle(): Promise<void> {
      if (state === 'transcribing') return
      if (state === 'recording') {
        set('transcribing')
        deps.stopRecording()
        const blob = await clip
        clip = null
        if (blob) {
          const text = await deps.transcribe(blob)
          if (text === null) await viaRecognizer()
          else deliver(text)
        }
        set('idle')
        return
      }
      const started = deps.startRecording()
      clip = started.catch(() => null)
      set('recording')
      started.catch(async () => {
        if (state !== 'recording') return
        clip = null
        set('idle')
        await viaRecognizer()
      })
    },
  }
}

import { createMic, type MicState } from './mic'
import { createRecorder } from './recorder'
import { startMic, stopMic } from './audio-meter'

type RecognitionCtor = new () => { lang: string; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void; onend: () => void; onerror: () => void; start(): void; stop(): void }

function recognitionCtor(): RecognitionCtor | null {
  const w = window as Window & { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function pickMime(): string | undefined {
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(m)) return m
  }
  return undefined
}

/** Records from the microphone until stopped; the meter hears it too, so the voice matrix follows your voice. */
const recorder = createRecorder({
  getStream: startMic,
  Recorder: MediaRecorder as unknown as Parameters<typeof createRecorder>[0]['Recorder'],
  releaseStream: stopMic,
  get mimeType() { return pickMime() },
})

async function transcribe(clip: Blob): Promise<string | null> {
  try {
    const res = await fetch('/stt', { method: 'POST', headers: { 'Content-Type': clip.type || 'application/octet-stream' }, body: clip, signal: AbortSignal.timeout(25_000) })
    if (!res.ok) return null
    const { text } = (await res.json()) as { text: string }
    return text
  } catch { return null }
}

function recognizerOrNull(): (() => Promise<string>) | null {
  const Ctor = recognitionCtor()
  if (!Ctor) return null
  return () => new Promise<string>((resolve, reject) => {
    const r = new Ctor()
    r.lang = 'en-US'
    r.interimResults = false
    let text = ''
    r.onresult = (e) => { for (let i = 0; i < e.results.length; i++) { const res = e.results[i]!; if (res.isFinal) text = res[0]!.transcript } }
    r.onend = () => (text ? resolve(text) : reject(new Error('nothing heard')))
    r.onerror = () => reject(new Error('recognition failed'))
    r.start()
  })
}

export function createKittMic(handlers: { onState: (s: MicState) => void; onText: (t: string) => void }) {
  return createMic({ startRecording: () => recorder.start(), stopRecording: () => recorder.stop(), transcribe, recognizer: recognizerOrNull(), ...handlers })
}

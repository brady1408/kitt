import { createMic, type MicState } from './mic'
import { startMic, stopMic } from './audio-meter'

type RecognitionCtor = new () => { lang: string; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void; onend: () => void; onerror: () => void; start(): void; stop(): void }

function recognitionCtor(): RecognitionCtor | null {
  const w = window as Window & { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

let recorder: MediaRecorder | null = null

function pickMime(): string | undefined {
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m
  }
  return undefined
}

/** Records from the microphone until stopped; the meter hears it too, so the voice matrix follows your voice. */
function startRecording(): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    startMic().then((stream) => {
      const mimeType = pickMime()
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      const chunks: Blob[] = []
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      rec.onstop = () => {
        stopMic()
        recorder = null
        resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType || 'audio/webm' }) : null)
      }
      rec.onerror = () => { stopMic(); recorder = null; resolve(null) }
      recorder = rec
      rec.start()
    }, reject)
  })
}

function stopRecording(): void {
  if (recorder && recorder.state !== 'inactive') recorder.stop()
}

async function transcribe(clip: Blob): Promise<string | null> {
  try {
    const res = await fetch('/stt', { method: 'POST', headers: { 'Content-Type': clip.type || 'application/octet-stream' }, body: clip })
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
  return createMic({ startRecording, stopRecording, transcribe, recognizer: recognizerOrNull(), ...handlers })
}

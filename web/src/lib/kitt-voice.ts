import { createSpeaker } from './speech'
import { getVoiceName, playBlob, speak as browserSpeak, stopPlayback } from './audio-meter'
import { parseVoiceChoice } from './voice'

export type ServerVoices = { voices: string[]; default: string }

let serverVoices: ServerVoices | null = null
const listeners = new Set<() => void>()

export function getServerVoices(): ServerVoices | null { return serverVoices }
export function onServerVoices(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l) } }

/** Asks the hub which sidecar voices exist. Null means no sidecar; the browser voice is used. */
export async function loadServerVoices(): Promise<void> {
  try {
    const res = await fetch('/tts/voices', { cache: 'no-store' })
    serverVoices = res.ok ? ((await res.json()) as ServerVoices) : null
  } catch { serverVoices = null }
  for (const l of listeners) l()
}

function chosenServerVoice(): string | null {
  if (!serverVoices) return null
  const choice = parseVoiceChoice(getVoiceName())
  if (choice?.kind === 'browser') return null
  if (choice?.kind === 'server') return serverVoices.voices.includes(choice.name) ? choice.name : serverVoices.default
  return serverVoices.default
}

async function fetchAudio(text: string, voice: string): Promise<Blob | null> {
  try {
    const res = await fetch(`/tts?${new URLSearchParams({ text, voice })}`, { cache: 'no-store' })
    if (!res.ok) { if (res.status === 503) serverVoices = null; return null }
    return await res.blob()
  } catch { return null }
}

export const kittVoice = createSpeaker({
  serverVoice: chosenServerVoice,
  fetchAudio,
  play: playBlob,
  stop: () => { stopPlayback(); window.speechSynthesis?.cancel() },
  fallback: (text) => browserSpeak(text, { queue: true }),
})

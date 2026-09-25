type Deps = {
  serverVoice: () => string | null
  fetchAudio: (text: string, voice: string) => Promise<Blob | null>
  play: (blob: Blob) => Promise<void>
  stop: () => void
  fallback: (text: string) => void
}

/** Speaks chunks in order through the server voice, falling back to the browser voice per chunk when the server can't. */
export function createSpeaker(deps: Deps) {
  const queue: string[] = []
  let running = false
  let generation = 0

  const pump = async () => {
    if (running) return
    running = true
    try {
      while (queue.length > 0) {
        const text = queue.shift() as string
        const gen = generation
        const voice = deps.serverVoice()
        if (!voice) { deps.fallback(text); continue }
        const blob = await deps.fetchAudio(text, voice)
        if (gen !== generation) continue
        if (!blob) { deps.fallback(text); continue }
        await deps.play(blob)
      }
    } finally {
      running = false
    }
  }

  return {
    speak(text: string): void {
      if (!text.trim()) return
      queue.push(text)
      void pump()
    },
    cancel(): void {
      queue.length = 0
      generation++
      deps.stop()
    },
  }
}

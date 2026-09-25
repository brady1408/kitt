type Deps = {
  serverVoice: () => string | null
  fetchAudio: (text: string, voice: string) => Promise<Blob | null>
  play: (blob: Blob) => Promise<void>
  stop: () => void
  fallback: (text: string) => void
}

const MIN_PIECE = 40
const MAX_PIECE = 300

/** Turns markdown into something worth reading aloud: keeps the words, drops the syntax. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/[*#>]+/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Splits text into pieces short enough to synthesize quickly: paragraph breaks always split, sentences merge until they reach a comfortable length. */
export function splitForSpeech(text: string): string[] {
  const pieces: string[] = []
  for (const paragraph of text.split(/\n\s*\n/)) {
    const sentences = paragraph.replace(/\n/g, ' ').match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? []
    let current = ''
    for (const raw of sentences) {
      const sentence = raw.trim()
      if (!sentence) continue
      if (current && current.length >= MIN_PIECE) { pieces.push(current); current = '' }
      current = current ? `${current} ${sentence}` : sentence
    }
    if (current) pieces.push(current)
  }
  return pieces.flatMap((p) => {
    if (p.length <= MAX_PIECE) return [p]
    const out: string[] = []
    let rest = p
    while (rest.length > MAX_PIECE) {
      const cut = rest.lastIndexOf(' ', MAX_PIECE)
      const at = cut > MAX_PIECE / 2 ? cut : MAX_PIECE
      out.push(rest.slice(0, at).trim())
      rest = rest.slice(at).trim()
    }
    if (rest) out.push(rest)
    return out
  })
}

/** Speaks text in order through the server voice, one short piece at a time, fetching the next piece while the current one plays. Falls back to the browser voice per piece when the server can't. */
export function createSpeaker(deps: Deps) {
  const queue: string[] = []
  let running = false
  let generation = 0
  let prefetched: { text: string; blob: Promise<Blob | null> } | null = null

  const pump = async () => {
    if (running) return
    running = true
    try {
      while (queue.length > 0) {
        const text = queue.shift() as string
        const gen = generation
        const voice = deps.serverVoice()
        if (!voice) { deps.fallback(text); continue }
        const blob = await (prefetched?.text === text ? prefetched.blob : deps.fetchAudio(text, voice))
        prefetched = null
        if (gen !== generation) continue
        if (!blob) { deps.fallback(text); continue }
        const playing = deps.play(blob)
        const next = queue[0]
        if (next !== undefined) prefetched = { text: next, blob: deps.fetchAudio(next, voice) }
        await playing
      }
    } finally {
      running = false
    }
  }

  return {
    speak(text: string): void {
      const pieces = splitForSpeech(cleanForSpeech(text))
      if (pieces.length === 0) return
      queue.push(...pieces)
      void pump()
    },
    cancel(): void {
      queue.length = 0
      prefetched = null
      generation++
      deps.stop()
    },
  }
}

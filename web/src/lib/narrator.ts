import type { ServerFrame } from '@kitt/hub/protocol'

type Deps = {
  speak: (text: string) => void
  enabled: () => boolean
  target: () => string
}

/**
 * Reads a reply aloud as it arrives: everything streamed so far is spoken when the
 * model pauses to use a tool, and whatever remains is spoken when the turn finishes.
 */
export function createNarrator(deps: Deps) {
  let turnId: string | null = null
  let buffer = ''
  let spokenUpTo = 0

  const reset = (id: string) => { turnId = id; buffer = ''; spokenUpTo = 0 }
  const flush = () => {
    const chunk = buffer.slice(spokenUpTo).trim()
    spokenUpTo = buffer.length
    if (chunk && deps.enabled()) deps.speak(chunk)
  }

  return {
    handle(frame: ServerFrame): void {
      if (frame.type !== 'chat.delta' && frame.type !== 'chat.tool' && frame.type !== 'chat.done') return
      if (frame.target !== deps.target()) return
      if (frame.turnId !== turnId) reset(frame.turnId)
      if (frame.type === 'chat.delta') { buffer += frame.text; return }
      if (frame.type === 'chat.tool') { flush(); return }
      if (!buffer.trim()) buffer = frame.message.text
      flush()
      turnId = null
    },
  }
}

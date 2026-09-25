import type { MicState } from './mic'

export type PttAction = 'start' | 'stop' | null
export type KeyLike = { type: 'keydown' | 'keyup'; code: string; repeat: boolean; typing: boolean; modifier: boolean }

/** Hold the space bar to talk, outside text fields. */
export function pttKeyAction(e: KeyLike, state: MicState): PttAction {
  if (e.code !== 'Space' || e.typing || e.modifier || e.repeat) return null
  if (e.type === 'keydown' && state === 'idle') return 'start'
  if (e.type === 'keyup' && state === 'recording') return 'stop'
  return null
}

const TAP_MS = 250

/** The MIC lamp: press to start; releasing after a hold stops, releasing quickly leaves it running as a toggle; pressing again while recording stops. */
export function pttPointerAction(phase: 'down' | 'up', state: MicState, heldMs: number): PttAction {
  if (state === 'transcribing') return null
  if (phase === 'down') return state === 'idle' ? 'start' : 'stop'
  return state === 'recording' && heldMs >= TAP_MS ? 'stop' : null
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable
}

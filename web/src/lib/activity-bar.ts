import type { SessionEntry } from '@kitt/hub/protocol'

export type Segment = 'empty' | 'idle' | 'working' | 'error' | 'offline' | 'dark'

const KIND_ORDER: Record<SessionEntry['kind'], number> = { kitt: 0, task: 1, spoke: 2 }

/** Maps sessions onto a fixed row of LED segments: one per session, KITT first, then tasks, then terminals. */
export function barSegments(registry: SessionEntry[], connected: boolean, count = 12): Segment[] {
  const ordered = [...registry].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name)).slice(0, count)
  const segments: Segment[] = ordered.map((e) => e.status)
  while (segments.length < count) segments.push('empty')
  return connected ? segments : segments.map(() => 'dark')
}

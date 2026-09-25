import type { SessionEntry } from '@kitt/hub/protocol'

export type Blip = { entry: SessionEntry; x: number; y: number }

/** Places sessions on a radar: KITT at the center, tasks on the inner ring, terminal sessions on the outer ring. Units are whatever the radii are in. */
export function radarLayout(registry: SessionEntry[], radii: { inner: number; outer: number }): Blip[] {
  const ring = (entries: SessionEntry[], r: number, phase: number): Blip[] =>
    entries.map((entry, i) => {
      const angle = -Math.PI / 2 + phase + (i / entries.length) * 2 * Math.PI
      return { entry, x: r * Math.cos(angle), y: r * Math.sin(angle) }
    })
  const kitt = registry.filter((e) => e.kind === 'kitt').map((entry) => ({ entry, x: 0, y: 0 }))
  const tasks = ring(registry.filter((e) => e.kind === 'task'), radii.inner, 0)
  const spokes = ring(registry.filter((e) => e.kind === 'spoke'), radii.outer, Math.PI / 6)
  return [...kitt, ...tasks, ...spokes]
}

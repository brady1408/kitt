import { test, expect } from 'bun:test'
import { radarLayout } from './radar'
import type { SessionEntry } from '@kitt/hub/protocol'

const e = (id: string, kind: SessionEntry['kind'], status: SessionEntry['status'] = 'idle'): SessionEntry =>
  ({ id, kind, name: id, cwd: '/x', status, lastActivity: 0 })

test('kitt sits at the center, tasks on the inner ring, spokes on the outer ring, evenly spaced', () => {
  const out = radarLayout([e('kitt', 'kitt'), e('t1', 'task'), e('t2', 'task'), e('s1', 'spoke'), e('s2', 'spoke'), e('s3', 'spoke')], { inner: 20, outer: 40 })
  const by = Object.fromEntries(out.map((b) => [b.entry.id, b]))
  expect(by['kitt']).toMatchObject({ x: 0, y: 0 })
  for (const id of ['t1', 't2']) expect(Math.hypot(by[id]!.x, by[id]!.y)).toBeCloseTo(20, 5)
  for (const id of ['s1', 's2', 's3']) expect(Math.hypot(by[id]!.x, by[id]!.y)).toBeCloseTo(40, 5)
  // two tasks sit opposite each other; three spokes are 120° apart
  expect(by['t1']!.x + by['t2']!.x).toBeCloseTo(0, 5)
  expect(by['t1']!.y + by['t2']!.y).toBeCloseTo(0, 5)
  const angle = (b: { x: number; y: number }) => Math.atan2(b.y, b.x)
  const d = ((angle(by['s2']!) - angle(by['s1']!)) * 180) / Math.PI
  expect(((d % 360) + 360) % 360).toBeCloseTo(120, 5)
})

test('offline spokes still get a slot so the picture is stable', () => {
  const out = radarLayout([e('s1', 'spoke', 'offline'), e('s2', 'spoke')], { inner: 20, outer: 40 })
  expect(out).toHaveLength(2)
})

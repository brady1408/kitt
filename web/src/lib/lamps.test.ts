import { test, expect } from 'bun:test'
import { deriveLamps, type LampInputs } from './lamps'

const base: LampInputs = {
  voiceOn: true, listening: false, connected: true, planStatus: 'allowed',
  system: { load: 0.1, memUsed: 0.3, diskUsed: 0.5, diskFreeGb: 90, apiMs: 1200, sampledAt: 0 },
  tasksRunning: 0, terminalsOnline: 0,
}
const lit = (inputs: LampInputs) => deriveLamps(inputs).filter((l) => l.lit).map((l) => l.id)

test('quiet system lights only the voice lamp', () => {
  expect(lit(base)).toEqual(['voice'])
})

test('alarms light their red lamps', () => {
  expect(lit({ ...base, connected: false, planStatus: 'rejected', system: { ...base.system!, load: 0.9, memUsed: 0.95, diskUsed: 0.92, apiMs: 45_000 } }))
    .toEqual(['voice', 'link', 'plan', 'disk', 'load', 'mem', 'api'])
})

test('activity lights the yellow lamps with counts', () => {
  const lamps = deriveLamps({ ...base, listening: true, tasksRunning: 2, terminalsOnline: 1 })
  expect(lamps.find((l) => l.id === 'mic')?.lit).toBe(true)
  expect(lamps.find((l) => l.id === 'aux')).toMatchObject({ lit: true, detail: '2' })
  expect(lamps.find((l) => l.id === 'satcom')).toMatchObject({ lit: true, detail: '1' })
})

test('lamps come in two columns of five with tones', () => {
  const lamps = deriveLamps(base)
  expect(lamps.filter((l) => l.side === 'left')).toHaveLength(5)
  expect(lamps.filter((l) => l.side === 'right')).toHaveLength(5)
  expect(lamps.map((l) => l.tone)).toEqual(['yellow', 'yellow', 'red', 'red', 'red', 'yellow', 'yellow', 'red', 'red', 'red'])
})

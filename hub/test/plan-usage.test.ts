import { test, expect } from 'bun:test'
import { PlanUsage } from '../src/plan-usage'
import { Store } from '../src/store'

test('tracks the latest five-hour and seven-day windows and persists them', () => {
  const store = new Store(':memory:')
  const p = new PlanUsage(store)
  expect(p.snapshot()).toEqual({ fiveHour: null, sevenDay: null })
  p.update({ type: 'ratelimit', window: 'five_hour', utilization: 0.12, resetsAt: 100, status: 'allowed' })
  p.update({ type: 'ratelimit', window: 'seven_day', utilization: 0.34, resetsAt: 200, status: 'allowed_warning' })
  p.update({ type: 'ratelimit', window: 'five_hour', utilization: 0.15, resetsAt: 100, status: 'allowed' })
  expect(p.snapshot()).toEqual({
    fiveHour: { utilization: 0.15, resetsAt: 100, status: 'allowed' },
    sevenDay: { utilization: 0.34, resetsAt: 200, status: 'allowed_warning' },
  })
  expect(new PlanUsage(store).snapshot()).toEqual(p.snapshot())
})

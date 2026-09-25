import { test, expect } from 'bun:test'
import { InputQueue } from '../src/input-queue'

test('delivers pushed items in order and ends on close', async () => {
  const q = new InputQueue<number>()
  const out: number[] = []
  const done = (async () => { for await (const n of q) out.push(n) })()
  q.push(1); q.push(2)
  await new Promise((r) => setTimeout(r, 0))
  q.push(3)
  q.close()
  await done
  expect(out).toEqual([1, 2, 3])
})

test('push after close throws', () => {
  const q = new InputQueue<number>()
  q.close()
  expect(() => q.push(1)).toThrow()
})

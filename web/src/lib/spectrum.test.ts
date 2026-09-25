import { test, expect } from 'bun:test'
import { bandLevels } from './spectrum'

// 256 frequency bins, byte magnitudes 0..255
const bins = (fill: (i: number) => number) => Uint8Array.from({ length: 256 }, (_, i) => fill(i))

test('silence gives zero in every band', () => {
  expect(bandLevels(bins(() => 0))).toEqual([0, 0, 0])
})

test('energy in the low bins shows up in the first band only', () => {
  const [low, mid, high] = bandLevels(bins((i) => (i < 3 ? 255 : 0)))
  expect(low).toBeGreaterThan(0.8)
  expect(mid).toBe(0)
  expect(high).toBe(0)
})

test('bands cover speech ranges: roughly 0-300 Hz, 300-2k, 2k-8k at 48 kHz / fft 512', () => {
  // bin width = 48000 / 512 = 93.75 Hz; so 300 Hz ≈ bin 3, 2 kHz ≈ bin 21, 8 kHz ≈ bin 85
  const only = (from: number, to: number) => bins((i) => (i >= from && i < to ? 200 : 0))
  expect(bandLevels(only(0, 3), 48000, 512)[0]).toBeGreaterThan(0.5)
  expect(bandLevels(only(4, 21), 48000, 512)[1]).toBeGreaterThan(0.5)
  expect(bandLevels(only(22, 85), 48000, 512)[2]).toBeGreaterThan(0.5)
  expect(bandLevels(only(100, 256), 48000, 512)).toEqual([0, 0, 0])
})

test('levels are clamped to 1', () => {
  for (const l of bandLevels(bins(() => 255))) expect(l).toBeLessThanOrEqual(1)
})

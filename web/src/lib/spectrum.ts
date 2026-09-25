/** Speech bands in Hz: fundamentals and low harmonics, the vowel formants, and the consonant sibilance. */
const BANDS: [number, number][] = [[0, 300], [300, 2000], [2000, 8000]]

/** Averages an FFT byte spectrum into three 0..1 levels, one per speech band. */
export function bandLevels(spectrum: Uint8Array, sampleRate = 48000, fftSize = 512): [number, number, number] {
  const binHz = sampleRate / fftSize
  const out: number[] = []
  for (const [lo, hi] of BANDS) {
    const from = Math.floor(lo / binHz)
    const to = Math.min(spectrum.length, Math.max(from + 1, Math.ceil(hi / binHz)))
    let sum = 0
    for (let i = from; i < to; i++) sum += spectrum[i] ?? 0
    const mean = sum / (to - from) / 255
    // Byte magnitudes are dB-scaled and speech rarely fills a band; stretch so normal speech reaches the top.
    out.push(Math.min(1, mean * 1.6))
  }
  return out as [number, number, number]
}

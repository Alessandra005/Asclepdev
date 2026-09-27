import { describe, expect, it } from 'vitest'
import { pickFrames, type CapturedFrame } from './useLiveScribeCapture'

const frames = (motion: number[]): CapturedFrame[] =>
  motion.map((m, i) => ({ blob: new Blob([String(i)]), atMs: i * 1000, motion: m }))
const secs = (picked: CapturedFrame[]): number[] => picked.map((f) => f.atMs / 1000)

describe('pickFrames', () => {
  it('sends one frame when nothing moved', () => {
    expect(secs(pickFrames(frames([0, 0.004, 0.003, 0.005])))).toEqual([3])
  })

  it('sends BEFORE, PEAK and AFTER around a movement', () => {
    // still, still, starts moving at 2s, peak at 3s, settles
    expect(secs(pickFrames(frames([0, 0.004, 0.05, 0.12, 0.03, 0.006, 0.004])))).toEqual([1, 3, 6])
  })

  it('never sends more than three frames or duplicates', () => {
    expect(secs(pickFrames(frames([0, 0.2])))).toEqual([0, 1])
    expect(pickFrames([])).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { CoalescedSeeker, type Follower, HARD_RESYNC_S, MAX_RATE_ADJUST, syncFollowers, syncOffsets, type SyncMedia } from './sync'
import { quantize, stepTime } from './frameLength'

class FakeVideo implements SyncMedia {
  currentTime: number
  paused: boolean
  playbackRate = 1
  duration: number
  seeks: number[] = []
  constructor(t: number, duration: number, paused = false) {
    this.currentTime = t
    this.duration = duration
    this.paused = paused
  }
  play() {
    this.paused = false
  }
  pause() {
    this.paused = true
  }
}

/** A follower whose seeks land at once (as if `seeked` fired immediately). */
function follower(t: number, duration: number, offset: number, paused = false): Follower & { media: FakeVideo } {
  const media = new FakeVideo(t, duration, paused)
  const seeker = new CoalescedSeeker(media, () => 1 / 30)
  const seek = seeker.seek.bind(seeker)
  seeker.seek = (to: number) => {
    media.seeks.push(to)
    seek(to)
    seeker.seeked()
  }
  return { media, offset, duration, frame: 1 / 30, seeker }
}

describe('syncOffsets', () => {
  it('aligns on the snap when every playable pane has one', () => {
    expect(syncOffsets([{ id: 'a', snap: 1.8, playable: true }, { id: 'b', snap: 2.4, playable: true }])).toEqual({
      offsets: { a: 1.8, b: 2.4 },
      aligned: true
    })
  })
  it('falls back to clip start when a snap is missing', () => {
    expect(syncOffsets([{ id: 'a', snap: 1.8, playable: true }, { id: 'b', snap: null, playable: true }])).toEqual({
      offsets: { a: 0, b: 0 },
      aligned: false
    })
  })
  it('ignores panes without a playable clip', () => {
    const r = syncOffsets([{ id: 'a', snap: 1.8, playable: true }, { id: 'b', snap: null, playable: false }])
    expect(r.aligned).toBe(true)
    expect(r.offsets.a).toBe(1.8)
  })
})

describe('syncFollowers (02 §8.5)', () => {
  it('hard-resyncs a follower more than 0.25 s off', () => {
    const f = follower(1, 10, 2.4)
    // tau 0 → target 2.4; drift −1.4
    syncFollowers(0, false, 1, [f])
    expect(f.media.seeks).toEqual([2.4])
    expect(f.media.playbackRate).toBe(1)
    expect(f.media.paused).toBe(false)
  })

  it('trims the playback rate inside the hard-resync limit', () => {
    const f = follower(2.44, 10, 2.4) // ahead by 0.04
    syncFollowers(0, false, 1, [f])
    expect(f.media.seeks).toEqual([])
    expect(f.media.playbackRate).toBeCloseTo(1 - 0.04 * 2)
    const g = follower(2.3 + HARD_RESYNC_S - 0.01, 10, 2.4) // ahead by 0.14: clamped to the max adjust
    syncFollowers(0, false, 1, [g])
    expect(g.media.playbackRate).toBeCloseTo(1 - MAX_RATE_ADJUST)
    const h = follower(2.37, 10, 2.4) // behind by 0.03 → speeds up
    syncFollowers(0, false, 0.5, [h])
    expect(h.media.playbackRate).toBeCloseTo(0.5 * (1 + 0.06))
  })

  it('plays at speed within tolerance', () => {
    const f = follower(2.41, 10, 2.4)
    f.media.playbackRate = 0.9
    syncFollowers(0, false, 1, [f])
    expect(f.media.playbackRate).toBe(1)
  })

  it('pauses a follower on its first frame before its clip starts, and on its last after it ends', () => {
    const early = follower(0.5, 10, 0.2)
    syncFollowers(-1, false, 1, [early]) // target −0.8
    expect(early.media.paused).toBe(true)
    expect(early.media.seeks).toEqual([0])
    const late = follower(3, 4, 2)
    syncFollowers(3, false, 1, [late]) // target 5 > duration 4
    expect(late.media.paused).toBe(true)
    expect(late.media.seeks[0]).toBeCloseTo(4 - 1 / 60)
  })

  it('pauses every follower on its exact mapped frame while the clock is paused', () => {
    const f = follower(2, 10, 2.4)
    syncFollowers(0.5, true, 1, [f])
    expect(f.media.paused).toBe(true)
    expect(f.media.seeks).toEqual([2.9])
    // Already there: no new seek.
    syncFollowers(0.5, true, 1, [f])
    expect(f.media.seeks).toEqual([2.9])
  })
})

describe('CoalescedSeeker', () => {
  it('keeps one seek in flight and applies the newest pending target', () => {
    const v = new FakeVideo(0, 10)
    const s = new CoalescedSeeker(v, () => 1 / 30)
    s.seek(1)
    s.seek(2)
    s.seek(3)
    expect(v.currentTime).toBe(1)
    expect(s.target()).toBe(3)
    s.seeked()
    expect(v.currentTime).toBe(3)
    s.seeked()
    expect(s.inFlight).toBe(false)
    s.dispose()
  })
})

describe('frame quantizing (02 §5.10)', () => {
  it('lands in the middle of the containing frame', () => {
    expect(quantize(1, 1 / 30)).toBeCloseTo(1 + 1 / 60)
    expect(quantize(0, 1 / 30)).toBeCloseTo(1 / 60)
    expect(quantize(9.99, 1 / 30, 10)).toBeCloseTo(10 - 1 / 60)
  })
  it('steps whole frames', () => {
    const f = 1 / 30
    expect(stepTime(quantize(1, f), 1, f)).toBeCloseTo(quantize(1, f) + f)
    expect(stepTime(quantize(1, f), -2, f)).toBeCloseTo(quantize(1, f) - 2 * f)
    expect(stepTime(0, -1, f)).toBeCloseTo(f / 2)
  })
})

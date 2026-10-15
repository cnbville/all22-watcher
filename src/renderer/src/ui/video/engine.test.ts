import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Clip } from '@shared/types'
import { VideoEngine } from './engine'

/** Just enough of an HTMLVideoElement for the engine, with events fired by hand. */
class FakeVideo {
  muted = true
  playsInline = false
  preload = ''
  disablePictureInPicture = false
  className = ''
  draggable = true
  style = { zIndex: '' }
  src = ''
  currentTime = 0
  duration = 8
  paused = true
  seeking = false
  readyState = 0
  playbackRate = 1
  videoWidth = 1280
  videoHeight = 720
  parentElement: unknown = null
  private handlers = new Map<string, Set<() => void>>()
  addEventListener(name: string, fn: () => void) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set())
    this.handlers.get(name)!.add(fn)
  }
  removeEventListener(name: string, fn: () => void) {
    this.handlers.get(name)?.delete(fn)
  }
  fire(name: string) {
    this.handlers.get(name)?.forEach((fn) => fn())
  }
  play() {
    this.paused = false
    return Promise.resolve()
  }
  pause() {
    this.paused = true
  }
  remove() {}
  removeAttribute() {}
  load() {}
}

const clip = (over: Partial<Clip> = {}): Clip => ({
  id: 7, gameId: 'g', path: '/c.mp4', fileName: 'c.mp4', angle: 'sideline', sortIndex: 0, playId: 1, snapMs: null, duration: 8, ...over
})

let made: FakeVideo[] = []
beforeEach(() => {
  made = []
  vi.useFakeTimers()
  vi.stubGlobal('document', {
    createElement: () => {
      const v = new FakeVideo()
      made.push(v)
      return v
    }
  })
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('VideoEngine', () => {
  it('replays from the new start point after the snap moves on the clip on screen (02 §10.2)', () => {
    const engine = new VideoEngine({ startAtSnap: true, preRoll: 1, speed: 1, loop: true, sound: false, autoplay: false })
    engine.setPanes([{ id: 'sideline', clip: clip() }], 'sideline')
    const v = made[0]
    v.readyState = 2
    v.fire('loadedmetadata')
    vi.advanceTimersByTime(400)
    // ⇧B on this clip: same clip id, now with a snap.
    engine.setPanes([{ id: 'sideline', clip: clip({ snapMs: 2500 }) }], 'sideline')
    engine.replay()
    expect(v.currentTime).toBeCloseTo(1.5)
    // Loop goes back to the same start point.
    v.fire('seeked')
    v.currentTime = 8
    v.fire('ended')
    expect(v.currentTime).toBeCloseTo(1.5)
    engine.dispose()
  })

  it('works again after a dispose and revive (a StrictMode remount)', () => {
    const engine = new VideoEngine({ startAtSnap: true, preRoll: 1, speed: 1, loop: false, sound: false, autoplay: true })
    engine.dispose()
    engine.revive()
    const seen: boolean[] = []
    engine.subscribe(() => seen.push(engine.getState().ready))
    engine.setPanes([{ id: 'sideline', clip: clip({ snapMs: 3000 }) }], 'sideline')
    const v = made[0]
    v.readyState = 2
    v.fire('loadedmetadata')
    expect(v.currentTime).toBeCloseTo(2)
    v.fire('seeked')
    expect(v.paused).toBe(false)
    expect(seen.length).toBeGreaterThan(0)
    engine.dispose()
  })
})

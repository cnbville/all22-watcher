import { describe, expect, it } from 'vitest'
import { KnownPaths } from './knownPaths'

describe('KnownPaths', () => {
  const clips = new Set(['/Film/DAL at PHI/Sideline/Play 1.mp4'])
  const known = new KnownPaths({ isClip: (p) => clips.has(p), folders: () => ['/Users/me/Library/Application Support/All-22 Watcher', null, '/Film/Inbox'] })

  it('reveals clips, the app’s folders and files it saved, and nothing else', () => {
    expect(known.canReveal('/Film/DAL at PHI/Sideline/Play 1.mp4')).toBe(true)
    expect(known.canReveal('/Film/DAL at PHI/Sideline/../Sideline/Play 1.mp4')).toBe(true)
    expect(known.canReveal('/Film/Inbox')).toBe(true)
    expect(known.canReveal('/Applications/Calculator.app')).toBe(false)
    expect(known.canReveal('Play 1.mp4')).toBe(false)
    expect(known.canReveal(42)).toBe(false)
    expect(known.canReveal(undefined)).toBe(false)
    known.remember('/Users/me/Movies/Cooper DeJean reel.mp4')
    expect(known.canReveal('/Users/me/Movies/Cooper DeJean reel.mp4')).toBe(true)
  })

  it('opens only files the app saved', () => {
    known.remember('/Users/me/Movies/Reel.mp4')
    known.remember('relative.mp4')
    known.remember(undefined)
    expect(known.canOpen('/Users/me/Movies/Reel.mp4')).toBe(true)
    expect(known.canOpen('relative.mp4')).toBe(false)
    expect(known.canOpen('/Film/DAL at PHI/Sideline/Play 1.mp4')).toBe(false)
    expect(known.canOpen('/Applications/Calculator.app')).toBe(false)
    expect(known.canOpen(['/Users/me/Movies/Reel.mp4'])).toBe(false)
  })
})

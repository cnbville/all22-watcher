import { describe, expect, it } from 'vitest'
import { expectedDuration } from './alignment'
import { guessScope, playGroups, type SmartClip, scopePlays, smartMatch } from './smartMatch'
import type { Play } from './types'

/** A seeded random number generator, so the simulated games are the same every run. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/** A made-up game: drives that alternate between DAL and PHI, with kicks between them. */
function fakeGame(seed: number): Play[] {
  const r = rng(seed)
  const plays: Play[] = []
  let id = 1
  const add = (posteam: string, playType: string, yards: number) => {
    const defteam = posteam === 'DAL' ? 'PHI' : 'DAL'
    plays.push({ playId: id++ * 10, gameId: 'g', playType, posteam, defteam, yardsGained: yards, sack: false, touchdown: false, turnover: false } as Play)
  }
  let team = 'DAL'
  for (let drive = 0; drive < 22; drive++) {
    add(team === 'DAL' ? 'PHI' : 'DAL', 'kickoff', 0)
    const snaps = 3 + Math.floor(r() * 8)
    for (let s = 0; s < snaps; s++) {
      const roll = r()
      if (roll < 0.05) add(team, 'no_play', 0)
      else if (roll < 0.55) add(team, 'pass', Math.floor(r() < 0.35 ? 0 : r() * (r() < 0.1 ? 60 : 18)))
      else add(team, 'run', Math.floor(r() * (r() < 0.08 ? 50 : 8)))
    }
    add(team, r() < 0.6 ? 'punt' : 'field_goal', 0)
    team = team === 'DAL' ? 'PHI' : 'DAL'
  }
  return plays
}

/** Clips cut by hand: a clip's length is the play's real length (which itself varies) times the person's padding. */
function cut(plays: Play[], keep: (p: Play, r: () => number) => boolean, seed: number, opts: { scale?: number; noise?: number } = {}) {
  const r = rng(seed)
  const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r())
  const truth = new Map<string, number>()
  const clips: SmartClip[] = []
  for (const p of plays) {
    if (!keep(p, r)) continue
    const path = `/film/clip ${String(clips.length + 1).padStart(3, '0')}.mp4`
    truth.set(path, p.playId)
    clips.push({ path, angle: 'main', duration: expectedDuration(p) * (opts.scale ?? 1.8) * Math.exp(gauss() * (opts.noise ?? 0.3)) })
  }
  return { clips, truth }
}

const accuracy = (placed: Map<string, { playId: number | null }>, truth: Map<string, number>) =>
  [...truth].filter(([path, id]) => placed.get(path)?.playId === id).length / truth.size

describe('smart matching', () => {
  const plays = fakeGame(7)

  it('keeps a complete one-clip-per-play game in order', () => {
    const scoped = scopePlays(plays, { side: 'all', includeSpecialTeams: true, includeNoPlays: true }, 'DAL')
    const { clips, truth } = cut(scoped, () => true, 1)
    expect(accuracy(smartMatch(clips, scoped, plays), truth)).toBe(1)
  })

  it('finds where a clip is missing in the middle of a game', () => {
    const scoped = scopePlays(plays, { side: 'all', includeSpecialTeams: false, includeNoPlays: false }, 'DAL')
    const missing = scoped[40].playId
    const { clips, truth } = cut(scoped, (p) => p.playId !== missing, 2, { noise: 0.15 })
    expect(accuracy(smartMatch(clips, scoped, plays), truth)).toBeGreaterThan(0.9)
  })

  it('guesses the side the clips were cut from by how many there are', () => {
    const offense = scopePlays(plays, { side: 'offense', includeSpecialTeams: false, includeNoPlays: false }, 'DAL')
    expect(guessScope(plays, 'DAL', offense.length)).toEqual({ side: 'offense', includeSpecialTeams: false, includeNoPlays: false })
    const all = scopePlays(plays, { side: 'all', includeSpecialTeams: true, includeNoPlays: false }, 'DAL')
    expect(guessScope(plays, 'DAL', all.length).side).toBe('all')
    // A confirmed defensive play rules out the offense.
    const def = plays.find((p) => p.defteam === 'DAL' && p.playType === 'pass')!
    expect(guessScope(plays, 'DAL', offense.length, [def.playId]).side).not.toBe('offense')
  })

  it('places every clip of one side of the ball when the side is known', () => {
    const scoped = scopePlays(plays, { side: 'offense', includeSpecialTeams: false, includeNoPlays: false }, 'DAL')
    const { clips, truth } = cut(scoped, () => true, 3)
    expect(accuracy(smartMatch(clips, scoped, plays), truth)).toBe(1)
  })

  it('keeps anchored clips where the user put them and moves the rest around them', () => {
    const scoped = scopePlays(plays, { side: 'all', includeSpecialTeams: false, includeNoPlays: false }, 'DAL')
    // Cut only some drives: a person studying one series at a time.
    const { clips, truth } = cut(scoped, (p) => Math.floor(p.playId / 100) % 3 !== 1, 4)
    const anchors = new Map<string, number | null>()
    const placed = smartMatch(clips, scoped, plays, anchors)
    // Confirm the clips the matcher wasn't sure about, one at a time, like the review flow does.
    let rounds = 0
    let current = placed
    for (;;) {
      const unsure = clips.find((c) => !current.get(c.path)!.sure && !anchors.has(c.path))
      if (!unsure || rounds > clips.length) break
      anchors.set(unsure.path, truth.get(unsure.path)!)
      current = smartMatch(clips, scoped, plays, anchors)
      rounds++
    }
    for (const [path, id] of anchors) expect(current.get(path)!.playId).toBe(id)
    // Not every clip needed a look, and the ones nobody looked at are right.
    expect(rounds).toBeLessThan(clips.length * 0.9)
    const sureWrong = clips.filter((c) => current.get(c.path)!.sure && current.get(c.path)!.playId !== truth.get(c.path))
    expect(sureWrong.length).toBeLessThanOrEqual(Math.ceil(clips.length * 0.05))
  })

  it('marks a clip with no play when the user says so', () => {
    const scoped = scopePlays(plays, { side: 'all', includeSpecialTeams: false, includeNoPlays: false }, 'DAL')
    const { clips } = cut(scoped.slice(0, 10), () => true, 5)
    const placed = smartMatch(clips, scoped, plays, new Map([[clips[3].path, null]]))
    expect(placed.get(clips[3].path)!.playId).toBeNull()
    const ids = clips.map((c) => placed.get(c.path)!.playId).filter((x): x is number => x !== null)
    expect([...ids].sort((a, b) => a - b)).toEqual(ids)
  })

  it('matches an anchored play outside the scope', () => {
    const scoped = scopePlays(plays, { side: 'offense', includeSpecialTeams: false, includeNoPlays: false }, 'DAL')
    const punt = plays.find((p) => p.playType === 'punt' && p.playId > scoped[5].playId)!
    const { clips } = cut(scoped.slice(0, 10), () => true, 6)
    const placed = smartMatch(clips, scoped, plays, new Map([[clips[6].path, punt.playId]]))
    expect(placed.get(clips[6].path)!.playId).toBe(punt.playId)
  })

  it('places the sideline and end zone clips of one play together', () => {
    const scoped = scopePlays(plays, { side: 'all', includeSpecialTeams: false, includeNoPlays: false }, 'DAL')
    const { clips: sideline, truth } = cut(scoped, (p) => Math.floor(p.playId / 100) % 2 === 0, 8)
    const endzone = sideline.map((c, k) => ({ ...c, path: `/film/ez ${k}.mp4`, angle: 'endzone' as const, duration: (c.duration ?? 5) * 1.05 }))
    const placed = smartMatch([...sideline.map((c) => ({ ...c, angle: 'sideline' as const })), ...endzone], scoped, plays, new Map([[endzone[5].path, truth.get(sideline[5].path)!]]))
    sideline.forEach((c, k) => expect(placed.get(endzone[k].path)!.playId).toBe(placed.get(c.path)!.playId))
    expect(placed.get(sideline[5].path)!.playId).toBe(truth.get(sideline[5].path))
  })

  it('only guesses one side of the ball when the clips could be most of its snaps', () => {
    expect(guessScope(plays, 'DAL', 12).side).toBe('all')
    const offense = plays.filter((p) => p.posteam === 'DAL' && p.playType === 'run').slice(0, 3).map((p) => p.playId)
    expect(guessScope(plays, 'DAL', 12, offense).side).toBe('offense')
  })

  it('groups angles by clip name, so a play shown from one angle only keeps the rest together', () => {
    const c = (path: string, angle: 'sideline' | 'endzone') => ({ path, angle, duration: 5 })
    const groups = playGroups([
      [c('/s/Sideline/001.mp4', 'sideline'), c('/s/Sideline/002.mp4', 'sideline'), c('/s/Sideline/003.mp4', 'sideline')],
      [c('/s/End Zone/002.mp4', 'endzone'), c('/s/End Zone/003.mp4', 'endzone')]
    ])
    expect(groups?.map((g) => g.map((x) => x.path))).toEqual([
      ['/s/Sideline/001.mp4'],
      ['/s/Sideline/002.mp4', '/s/End Zone/002.mp4'],
      ['/s/Sideline/003.mp4', '/s/End Zone/003.mp4']
    ])
    expect(playGroups([[c('/a/1.mp4', 'sideline'), c('/a/2.mp4', 'sideline')], [c('/b/x.mp4', 'endzone')]])).toBeNull()
  })
})

import { existsSync } from 'node:fs'
import { buildExportPlan, type ExportItemData, type ExportPlan, type ExportVideoRequest, type PlanInput } from '@shared/exportVideo'
import { playCaption, shortDesc } from '@shared/labels'
import { gradeScore, tallyOf } from '@shared/stats'
import { TEAM_BY_ABBR } from '@shared/teams'
import type { CutupFocus, CutupItem, RosterPlayer } from '@shared/types'
import { pickEncoder } from './exportVideo'
import { ffmpegStatus, probeAll } from './ffmpeg'
import type { Library } from './library'
import type { CutupEngine } from './playQuery'

/**
 * Resolves an Export Video request into a plan (03 §11.6): the source's plays with their perspective team, clips and
 * probes, per-play burn-in data for the renderer, and the title card text.
 */
export async function planExport(library: Library, cutups: CutupEngine, req: ExportVideoRequest, today = new Date()): Promise<ExportPlan> {
  const status = await ffmpegStatus()
  const encoder = pickEncoder(status.encoders)
  const src = req.source
  const focus: CutupFocus | null =
    src.kind === 'cutup'
      ? (library.store.cutupById(src.cutupId)?.focus ?? null)
      : src.kind === 'plays'
        ? { team: src.team }
        : null
  const playerId = src.kind === 'player' ? src.playerId : req.playerId
  // The burned-in player's team decides the perspective when the source doesn't set one.
  const items: CutupItem[] = await cutups.itemsForRefs(src.plays.slice(0, 301), playerId && !focus?.team ? { ...(focus ?? {}), playerId } : focus)

  const paths = [...new Set(items.flatMap((i) => i.clips.map((c) => c.path)))]
  const probes = status.path ? await probeAll(paths.filter((p) => existsSync(p))) : new Map()
  const inputs: PlanInput[] = items.map((item) => ({
    ref: item.ref,
    game: item.game,
    caption: playCaption(item.game, item.team, item.play),
    clips: item.clips.map((c) => {
      const p = probes.get(c.path) ?? null
      return { ...c, probe: p ? { duration: p.duration ?? c.duration, width: p.width, height: p.height, fps: p.fps, hasAudio: p.hasAudio } : null }
    })
  }))

  const player = playerId ? await findPlayer(library, playerId, items) : null
  const data: ExportItemData[] = []
  let number = 0
  for (const item of items) {
    const hasFilm = item.clips.length > 0
    if (hasFilm) number++
    const entry = playerId ? (await gradesFor(library, item.ref.gameId)).find((e) => e.playId === item.ref.playId && e.playerId === playerId) : undefined
    data.push({
      ref: item.ref,
      game: item.game,
      team: item.team,
      play: item.play,
      number: hasFilm ? number : 0,
      caption: playCaption(item.game, item.team, item.play),
      description: item.play ? shortDesc(item.play.desc) : '',
      player: player
        ? { id: player.id, name: player.name, jersey: player.jersey, position: player.position, team: entry?.team ?? player.team, color: TEAM_BY_ABBR[entry?.team ?? player.team]?.color ?? '#8E8E93' }
        : null,
      grade: entry?.grade ?? null,
      critical: !!entry?.critical && entry.grade !== null,
      drawing: item.drawing
    })
  }

  const plan = buildExportPlan(req, inputs, {
    ffmpeg: !!status.path,
    encoder: !!encoder,
    exists: (p) => existsSync(p),
    items: data
  })
  const games = new Set(plan.segments.map((s) => s.ref.gameId)).size
  const exported = `Exported ${today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  if (src.kind === 'player' && player) {
    const team = TEAM_BY_ABBR[player.team]
    const graded = data.filter((d) => d.grade !== null)
    const score = gradeScore(tallyOf(graded.map((d) => ({ grade: d.grade, critical: d.critical }))))
    plan.titleCard = {
      title: player.name,
      line2: [player.jersey ? `#${player.jersey}` : '', player.position, team?.name ?? player.team].filter(Boolean).join(' · '),
      line3: [`${src.season} season`, `${plan.playCount} plays`, score !== null ? `Grade ${score}` : ''].filter(Boolean).join(' · '),
      color: team?.color ?? null
    }
  } else {
    plan.titleCard = {
      title:
        src.kind === 'cutup'
          ? (library.store.cutupById(src.cutupId)?.name ?? 'Cut-up')
          : src.kind === 'plays'
            ? src.label
            : (player?.name ?? 'Reel'),
      line2: `${plan.playCount} play${plan.playCount === 1 ? '' : 's'} · ${games} game${games === 1 ? '' : 's'}`,
      line3: exported,
      color: null
    }
  }
  return plan
}

const gradeCache = new WeakMap<Library, Map<string, { at: number; list: ReturnType<Library['store']['gradesForGame']> }>>()

async function gradesFor(library: Library, gameId: string) {
  let m = gradeCache.get(library)
  if (!m) gradeCache.set(library, (m = new Map()))
  const hit = m.get(gameId)
  if (hit && hit.at === library.store.changeCount) return hit.list
  const list = library.store.gradesForGame(gameId)
  m.set(gameId, { at: library.store.changeCount, list })
  return list
}

/** The burned-in player, from the season of the first play that has them (players are matched by id across seasons). */
async function findPlayer(library: Library, playerId: string, items: CutupItem[]): Promise<RosterPlayer | null> {
  const seasons = [...new Set(items.map((i) => i.game.season))].sort((a, b) => b - a)
  for (const s of seasons) {
    const data = await library.seasonOrNull(s)
    const p = data ? library.playerIndex(data).get(playerId) : undefined
    if (p) return p
  }
  return null
}

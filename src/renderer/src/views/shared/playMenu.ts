import { shortDesc } from '@shared/labels'
import type { Angle, Clip, GameInfo, Play, PlayNote, PlayRef } from '@shared/types'
import { api } from '../../api'
import { errorBanner } from '../../shell/Banners'
import { action, type MenuAction, sep, submenu } from '../../shell/contextMenus'
import { openImport } from '../../shell/importRequest'
import { links, navigate } from '../../shell/router'
import { addToCutupMenu } from './requests'

export const ANGLE_LABEL: Record<Angle, string> = { sideline: 'Sideline', endzone: 'End Zone', main: 'Main' }
/** Sentence case, for the stage's angle label. */
export const ANGLE_NAME: Record<Angle, string> = { sideline: 'Sideline', endzone: 'End zone', main: 'Main' }

export interface PlayMenuTarget {
  ref: PlayRef
  game: GameInfo
  team: string
  play: Play | null
  clips: Clip[]
  flagged: boolean
  /** Opens the tape room with this player in focus. */
  playerId?: string
}

/**
 * The Play row context menu (01 §3.6) outside the tape room. `preview` adds "Preview  Space"; `remove` adds
 * "Remove from Cut-up" (manual cut-ups).
 */
export async function playMenu(t: PlayMenuTarget, opts: { preview?: () => void; remove?: () => void } = {}): Promise<MenuAction[]> {
  const cutupItems = await addToCutupMenu([t.ref])
  const clips = t.clips.filter((c) => c.playId === t.ref.playId)
  const reveal = clips.length === 1 ? [action('Show Clip in Finder', () => void api.revealClip(clips[0].path))] : clips.length > 1 ? [submenu('Show Clip in Finder', clips.map((c) => action(ANGLE_LABEL[c.angle], () => void api.revealClip(c.path))))] : [action('Show Clip in Finder', () => {}, { enabled: false })]
  return [
    action('Open in Tape Room', () => navigate(links.tape(t.ref.gameId, t.team, { play: t.ref.playId, player: t.playerId, focus: !!t.playerId }))),
    ...(opts.preview ? [action('Preview', opts.preview, { accelerator: 'Space' })] : []),
    sep(),
    action(t.flagged ? 'Unflag Play' : 'Flag Play', () => void toggleFlag(t), { accelerator: 'F' }),
    submenu('Add to Cut-up', cutupItems),
    ...(opts.remove ? [action('Remove from Cut-up', opts.remove, { accelerator: 'Backspace' })] : []),
    sep(),
    action('Copy Description', () => void navigator.clipboard.writeText(t.play ? shortDesc(t.play.desc) : `Play ${t.ref.playId}`), { enabled: !!t.play }),
    ...reveal,
    sep(),
    action('Fix Clip Match…', () => void fixMatch(t), { enabled: clips.length > 0 })
  ]
}

async function toggleFlag(t: PlayMenuTarget) {
  try {
    const film = await api.gameFilm(t.ref.gameId)
    const note = film.notes.find((n) => n.playId === t.ref.playId)
    const next: PlayNote = note
      ? { ...note, flagged: !note.flagged }
      : { gameId: t.ref.gameId, playId: t.ref.playId, note: '', chart: {}, drawing: {}, flagged: true }
    await api.savePlayNote(next)
  } catch (e) {
    errorBanner('Couldn’t flag the play', e)
  }
}

/** Fix Clip Matches for the play's game, with the saved rows (04's sheet scrolls to the play's clip). */
async function fixMatch(t: PlayMenuTarget) {
  try {
    const film = await api.gameFilm(t.ref.gameId)
    openImport({
      game: film.game,
      team: t.team,
      existing: film.clips.map((c) => ({ path: c.path, fileName: c.fileName, angle: c.angle, playId: c.playId }))
    })
  } catch (e) {
    errorBanner('Couldn’t open the clip matches', e)
  }
}

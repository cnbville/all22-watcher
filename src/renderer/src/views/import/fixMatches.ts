import type { GameInfo } from '@shared/types'
import { api } from '../../api'
import { banner, errorBanner } from '../../shell/Banners'
import { openImport, type ImportRequest } from '../../shell/importRequest'

/**
 * Entry points for Fix Clip Matches and the alignment check (02 §18, improvement 14) that any screen can call: the
 * tape room, the Film screen, a game's context menu and File › Check Clip Alignment.
 */

export interface FixMatchesRequest {
  game: GameInfo
  /** Studied team. */
  team: string
  /** The saved clips; read from the game's film when absent. */
  existing?: ImportRequest['existing']
  /** Scroll to and highlight this play's clip rows. */
  focusPlayId?: number
  /** Show only the clips the alignment check flagged. */
  onlySuspects?: boolean
  onImported?: () => void
}

/** Opens the Fix Clip Matches sheet for a game with film. */
export async function openFixMatches(req: FixMatchesRequest): Promise<void> {
  let existing = req.existing
  if (!existing) {
    try {
      const film = await api.gameFilm(req.game.gameId)
      existing = film.clips.map((c) => ({ clipId: c.id, path: c.path, fileName: c.fileName, angle: c.angle, playId: c.playId, snapMs: c.snapMs }))
    } catch (e) {
      errorBanner('Couldn’t open the clip matches', e)
      return
    }
  }
  if (!existing.length) {
    openImport({ game: req.game, team: req.team, onImported: req.onImported })
    return
  }
  openImport({ game: req.game, team: req.team, existing, focusPlayId: req.focusPlayId, onlySuspects: req.onlySuspects, onImported: req.onImported })
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * File › Check Clip Alignment: runs the check on the game's saved clips, then says what it found in a banner. Suspect
 * clips get "Review…", which opens Fix Clip Matches filtered to them. Resolves with the number of suspect clips.
 */
export async function checkClipAlignment(game: GameInfo, team: string, onImported?: () => void): Promise<number | null> {
  const dismiss = banner({ title: 'Checking clip lengths…', timeout: 60_000 })
  try {
    const result = await api.checkAlignment(game.gameId)
    dismiss()
    if (!result.checked && !result.unknown) {
      banner({ title: 'This game has no film to check' })
      return 0
    }
    if (!result.suspects.length) {
      banner({
        title: 'Every clip’s length fits its play',
        body: result.unknown ? `${plural(result.unknown, 'clip’s length', 'clips’ lengths')} couldn’t be read.` : undefined,
        kind: 'success'
      })
      return 0
    }
    banner({
      title: `${plural(result.suspects.length, 'clip', 'clips')} may be matched to the wrong play`,
      body: 'Their lengths don’t fit the plays they’re on.',
      action: { label: 'Review…', run: () => void openFixMatches({ game, team, onlySuspects: true, onImported }) },
      timeout: 10_000
    })
    return result.suspects.length
  } catch (e) {
    dismiss()
    errorBanner('Couldn’t check clip alignment', e, () => void checkClipAlignment(game, team, onImported))
    return null
  }
}

import type { ContextMenuItem } from '@shared/shell'
import { TEAM_BY_ABBR } from '@shared/teams'
import type { GameInfo } from '@shared/types'
import { api } from '../api'
import { banner, errorBanner } from './Banners'
import { links, navigate } from './router'
import { addMyTeam, removeMyTeam, settingsNow } from './store'

/**
 * Native context menus (01 §3.6). Each builder returns items with ids and a handler map; `showMenu` pops the
 * native menu up at the cursor and runs the chosen action.
 */

export interface MenuAction {
  item: ContextMenuItem
  run?: () => void
}

export const sep = (): MenuAction => ({ item: { type: 'separator' } })

export function action(label: string, run: () => void, opts: { accelerator?: string; enabled?: boolean; checked?: boolean } = {}): MenuAction {
  return { item: { label, accelerator: opts.accelerator, enabled: opts.enabled, checked: opts.checked, type: opts.checked !== undefined ? 'checkbox' : 'normal' }, run }
}

export function submenu(label: string, children: MenuAction[]): MenuAction & { children: MenuAction[] } {
  return { item: { label, type: 'submenu' }, children }
}

/** Shows a native context menu and runs the clicked action. */
export async function showMenu(e: { preventDefault(): void; stopPropagation?(): void } | null, actions: MenuAction[]) {
  e?.preventDefault()
  e?.stopPropagation?.()
  const runs = new Map<string, () => void>()
  let n = 0
  const build = (list: MenuAction[]): ContextMenuItem[] =>
    list.map((a) => {
      const children = (a as { children?: MenuAction[] }).children
      if (children) return { ...a.item, submenu: build(children) }
      if (!a.run) return a.item
      const id = `m${n++}`
      runs.set(id, a.run)
      return { ...a.item, id }
    })
  const items = build(actions)
  if (!window.shell) return
  const chosen = await window.shell.showContextMenu(items)
  if (chosen) runs.get(chosen)?.()
}

/** Team (My Teams row, Teams tile, team chip in a header). */
export function teamMenu(season: number, abbr: string): MenuAction[] {
  const mine = settingsNow()?.myTeams.includes(abbr) ?? false
  return [
    action('Open Team', () => navigate(links.team(season, abbr))),
    action('Open Matchup…', () => navigate(links.matchup(season, abbr))),
    sep(),
    mine ? action('Remove from My Teams', () => void removeMyTeam(abbr)) : action('Add to My Teams', () => void addMyTeam(abbr)),
    sep(),
    action('Export Grades as CSV…', () => void exportCsv(season, abbr), { accelerator: 'Shift+CmdOrCtrl+E' })
  ]
}

export async function exportCsv(season: number, abbr: string) {
  try {
    const path = await api.exportGradesCsv(season, abbr)
    if (path) banner({ title: `Exported ${path.split(/[\\/]/).pop()}`, action: { label: 'Show in Finder', run: () => window.shell.showItemInFolder(path) } })
  } catch (e) {
    errorBanner('Couldn’t export grades', e, () => void exportCsv(season, abbr))
  }
}

export async function exportReport(season: number, playerId: string) {
  try {
    const path = await api.exportPlayerReport(season, playerId)
    if (path) banner({ title: `Saved ${path.split(/[\\/]/).pop()}`, action: { label: 'Show in Finder', run: () => window.shell.showItemInFolder(path) } })
  } catch (e) {
    errorBanner('Couldn’t save the report', e, () => void exportReport(season, playerId))
  }
}

/** Game (team Games row, Film row, Continue Watching tile). */
export function gameMenu(
  game: GameInfo,
  team: string,
  opts: { hasFilm: boolean; importFilm: () => void; fixMatches?: () => void; revealClips?: () => void; onRemoved?: () => void }
): MenuAction[] {
  const label = `${game.awayTeam} @ ${game.homeTeam}`
  return [
    opts.hasFilm ? action('Watch', () => navigate(links.tape(game.gameId, team))) : action('Import Film…', opts.importFilm),
    sep(),
    action('Fix Clip Matches…', () => (opts.fixMatches ? opts.fixMatches() : navigate(links.tape(game.gameId, team))), { enabled: opts.hasFilm }),
    action('Check Clip Alignment', () => navigate(links.tape(game.gameId, team)), { enabled: false }),
    action('Show Clips in Finder', () => opts.revealClips?.(), { enabled: opts.hasFilm && !!opts.revealClips }),
    sep(),
    action(
      'Remove Film…',
      async () => {
        const ok = await window.shell.confirm({
          message: `Remove the film for ${label}, Week ${game.week}?`,
          detail: 'Your clips stay on disk and your grades are kept. You can import the film again later.',
          confirmLabel: 'Remove'
        })
        if (!ok) return
        try {
          await api.removeFilm(game.gameId)
          opts.onRemoved?.()
        } catch (e) {
          errorBanner('Couldn’t remove the film', e)
        }
      },
      { enabled: opts.hasFilm }
    )
  ]
}

/** Player (roster row, grading list row, player name or headshot). */
export function playerMenu(season: number, player: { id: string; name: string; team: string }, extra: { star?: { starred: boolean; toggle: () => void } } = {}): MenuAction[] {
  return [
    action('Open Player', () => navigate(links.player(season, player.id))),
    ...(extra.star ? [action(extra.star.starred ? 'Unstar for Grading' : 'Star for Grading', extra.star.toggle)] : []),
    sep(),
    action('Export Scouting Report (PDF)…', () => void exportReport(season, player.id), { accelerator: 'Alt+CmdOrCtrl+E' }),
    sep(),
    action('Copy Name', () => void navigator.clipboard.writeText(player.name))
  ]
}

export function teamName(abbr: string) {
  return TEAM_BY_ABBR[abbr]?.name ?? abbr
}

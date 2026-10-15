import { useEffect, useState } from 'react'
import { gameTitle } from '@shared/labels'
import { DIVISIONS, TEAMS, TEAM_BY_ABBR } from '@shared/teams'
import type { GameInfo, TeamGame } from '@shared/types'
import { api } from '../../api'
import { FormRow } from '../../ui/GroupedForm'
import { type MenuItemSpec } from '../../ui/Menu'
import { PopupButton } from '../../ui/PopupButton'
import { Spinner } from '../../ui/Spinner'
import { seasonNow, useSeasons } from '../../shell/store'
import { weekLabel } from '../../format'

/**
 * Which game the clips are from, when nothing passed one in (File › Import Film…, a drop on Home): season, a team
 * and one of its played games. Rows of a grouped form.
 */
export function GamePicker({
  game,
  team: preferredTeam,
  onGame,
  busy,
  compact,
  disabled
}: {
  game: GameInfo | null
  team?: string
  onGame: (g: GameInfo) => void
  busy?: boolean
  compact?: boolean
  disabled?: boolean
}) {
  const seasons = useSeasons()
  const downloaded = (seasons ?? []).filter((s) => s.downloaded).map((s) => s.season)
  const now = seasonNow()
  const [season, setSeason] = useState<number>(game?.season ?? (now !== null && downloaded.includes(now) ? now : (downloaded[0] ?? now ?? new Date().getFullYear())))
  const [team, setTeam] = useState<string | null>(preferredTeam ?? game?.homeTeam ?? null)
  const [games, setGames] = useState<TeamGame[] | null>(null)

  // Seasons arrive after the first render; start on a downloaded one.
  useEffect(() => {
    if (!game && downloaded.length && !downloaded.includes(season)) setSeason(downloaded[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloaded.join()])

  useEffect(() => {
    if (game) {
      setSeason(game.season)
      setTeam((t) => (t === game.homeTeam || t === game.awayTeam ? t : (preferredTeam === game.awayTeam ? game.awayTeam : game.homeTeam)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.gameId])

  useEffect(() => {
    if (!team) return
    let live = true
    setGames(null)
    api.teamOverview(season, team).then(
      (o) => live && setGames(o.games.filter((g) => g.playCount > 0)),
      () => live && setGames([])
    )
    return () => {
      live = false
    }
  }, [team, season])

  const teamItems: MenuItemSpec[] = DIVISIONS.flatMap((d): MenuItemSpec[] => [
    { kind: 'header', label: d },
    ...TEAMS.filter((t) => t.division === d).map((t): MenuItemSpec => ({ label: t.name, checked: t.abbr === team, run: () => setTeam(t.abbr) }))
  ])
  const opponent = (g: TeamGame) => (g.homeTeam === team ? `vs ${g.awayTeam}` : `@ ${g.homeTeam}`)
  const gameLabel = (g: TeamGame) => `${weekLabel(g)} ${opponent(g)}${g.clipCount ? ' · Has film' : ''}`

  const seasonControl = downloaded.length > 1 && (
    <PopupButton size={compact ? 'sm' : 'md'} width={84} value={season} disabled={disabled} options={downloaded.map((s) => ({ value: s, label: String(s) }))} onChange={setSeason} test="import-season" />
  )
  return (
    <>
      <FormRow label="Team" description={compact ? undefined : 'The game’s home or away team.'}>
        {seasonControl}
        <PopupButton
          size={compact ? 'sm' : 'md'}
          width={compact ? 180 : 220}
          value={team ?? ''}
          disabled={disabled}
          label={team ? TEAM_BY_ABBR[team]?.name : 'Choose a Team'}
          options={TEAMS.map((t) => ({ value: t.abbr, label: t.name }))}
          sections={teamItems}
          onChange={(v) => setTeam(v)}
          test="import-team-picker"
        />
      </FormRow>
      <FormRow label="Game" description={compact ? undefined : game ? `${gameTitle(game)} · ${game.gameday}` : 'Games with play-by-play.'}>
        {busy && <Spinner size={12} />}
        <PopupButton
          size={compact ? 'sm' : 'md'}
          width={compact ? 180 : 220}
          value={game?.gameId ?? ''}
          disabled={disabled || !team || !games?.length}
          label={game ? `${weekLabel(game)} · ${gameTitle(game)}` : !team ? 'Choose a team first' : games === null ? 'Loading…' : games.length ? 'Choose a Game' : `No ${season} games yet`}
          options={(games ?? []).map((g) => ({ value: g.gameId, label: gameLabel(g), test: `import-game-${g.gameId}` }))}
          onChange={(id) => {
            const g = games?.find((x) => x.gameId === id)
            if (g) onGame(g)
          }}
          test="import-game-picker"
        />
      </FormRow>
    </>
  )
}

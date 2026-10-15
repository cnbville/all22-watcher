import { useCallback, useEffect, useState } from 'react'
import type { RecentFilm } from '@shared/types'
import { api } from '../../api'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { ListRow } from '../../ui/ListRow'
import { ProgressBar } from '../../ui/Progress'
import { TeamChip } from '../../ui/TeamChip'
import { gameMenu, showMenu } from '../../shell/contextMenus'
import { useDataEvent } from '../../shell/dataEvents'
import { openImport } from '../../shell/importRequest'
import { links, navigate } from '../../shell/router'
import { LargeTitle, Loading, Screen } from '../../shell/Screen'
import { Toolbar } from '../../shell/Toolbar'
import { weekLabel } from '../../format'

/** Film library placeholder: games with film you opened recently, or the "No film yet" state (01 §8.2). */
export function Film() {
  const [films, setFilms] = useState<RecentFilm[] | null>(null)
  const load = useCallback(() => {
    api.recentFilm().then(setFilms, () => setFilms([]))
  }, [])
  useEffect(load, [load])
  useDataEvent('film', load)
  const graded = films?.reduce((n, f) => n + f.gradedPlays, 0) ?? 0
  const plays = films?.reduce((n, f) => n + f.playCount, 0) ?? 0
  return (
    <Screen name="film">
      <Toolbar
        title="Film"
        subtitle={films?.length ? `${films.length} ${films.length === 1 ? 'game' : 'games'} · ${plays.toLocaleString()} plays · ${plays ? Math.round((graded / plays) * 100) : 0}% graded` : undefined}
        separator="always"
        trailing={[{ kind: 'button', command: 'file.importFilm', icon: 'folder-input', label: 'Import', showLabel: true }]}
      />
      {!films ? (
        <Loading label="Loading film…" />
      ) : !films.length ? (
        <EmptyState
          icon="film"
          title="No film yet"
          body="Import a game’s All-22 clips, or drop a folder of clips anywhere on this window."
          primary={{ label: 'Import Film…', run: () => openImport() }}
          secondary={<Button variant="borderless" label="Watch a Folder…" onClick={() => void window.shell.openSettings('film')} />}
        />
      ) : (
        <>
          <LargeTitle>Film</LargeTitle>
          <div className="film-list">
            {films.map((f) => (
              <ListRow
                key={f.game.gameId}
                height={44}
                leading={<TeamChip abbr={f.team} />}
                title={`${f.game.awayTeam} @ ${f.game.homeTeam}`}
                subtitle={`${weekLabel(f.game)} · ${f.game.season} · ${f.clipCount} clips`}
                trailing={
                  <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className="t-callout c-label-2">
                      {f.gradedPlays} of {f.playCount} graded
                    </span>
                    <ProgressBar value={f.playCount ? f.gradedPlays / f.playCount : 0} style={{ width: 80 }} />
                  </span>
                }
                onClick={() => navigate(links.tape(f.game.gameId, f.team))}
                onContextMenu={(e) => void showMenu(e, gameMenu(f.game, f.team, { hasFilm: true, importFilm: () => openImport({ game: f.game, team: f.team }), onRemoved: load }))}
              />
            ))}
          </div>
        </>
      )}
    </Screen>
  )
}

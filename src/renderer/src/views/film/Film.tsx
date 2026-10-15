import { useEffect, useMemo, useRef, useState } from 'react'
import { weekName } from '@shared/labels'
import { TEAM_BY_ABBR } from '@shared/teams'
import type { AlignmentResult, FilmLibraryItem } from '@shared/types'
import { api } from '../../api'
import { gameDayLabel, plural, relativeDay } from '../../format'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { Icon } from '../../ui/Icon'
import { ProgressBar } from '../../ui/Progress'
import { Segmented } from '../../ui/Segmented'
import { Spinner } from '../../ui/Spinner'
import { type Column, type SortState, Table } from '../../ui/Table'
import { TeamChip } from '../../ui/TeamChip'
import { errorBanner } from '../../shell/Banners'
import { useCommand } from '../../shell/commands'
import { gameMenu, showMenu } from '../../shell/contextMenus'
import { useDataEvent } from '../../shell/dataEvents'
import { openImport } from '../../shell/importRequest'
import { Inspector, InspectorForm, InspectorSection } from '../../shell/Inspector'
import { links, navigate } from '../../shell/router'
import { LargeTitle, Loading, LoadError, Screen, useScrollRestore } from '../../shell/Screen'
import { Toolbar } from '../../shell/Toolbar'
import { ANGLE_LABEL, Poster, useLoaded, useLocalState, useRouteState } from '../shared'
import './film.css'

/**
 * Film (01 §1.1 `/film`): every game with imported film, all seasons. A table with grading progress and the
 * alignment state; the inspector shows the poster, the last alignment check and Open / Show in Finder / Remove.
 */

type Show = 'all' | 'progress' | 'new' | 'done'
const SHOWS: { value: Show; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'progress', label: 'In Progress' },
  { value: 'new', label: 'Not Started' },
  { value: 'done', label: 'Done' }
]

const keyOf = (f: FilmLibraryItem) => f.game.gameId
const progressOf = (f: FilmLibraryItem) => (f.playCount ? f.gradedPlays / f.playCount : 0)
const stateOf = (f: FilmLibraryItem): Exclude<Show, 'all'> => (f.gradedPlays === 0 ? 'new' : f.gradedPlays >= f.playCount ? 'done' : 'progress')
const title = (f: FilmLibraryItem) => `${f.game.awayTeam} @ ${f.game.homeTeam}`

function sortRows(rows: FilmLibraryItem[], sort: SortState): FilmLibraryItem[] {
  const dir = sort.dir === 'asc' ? 1 : -1
  const by: Record<string, (a: FilmLibraryItem, b: FilmLibraryItem) => number> = {
    game: (a, b) => a.game.gameday.localeCompare(b.game.gameday) || a.game.week - b.game.week || a.game.gameId.localeCompare(b.game.gameId),
    team: (a, b) => a.team.localeCompare(b.team),
    clips: (a, b) => a.clipCount - b.clipCount,
    graded: (a, b) => progressOf(a) - progressOf(b) || a.gradedPlays - b.gradedPlays,
    imported: (a, b) => a.importedAt.localeCompare(b.importedAt)
  }
  const cmp = by[sort.column] ?? by.game
  return [...rows].sort((a, b) => cmp(a, b) * dir || by.game(b, a))
}

export function Film() {
  const lib = useLoaded(() => api.filmLibrary(), [])
  useDataEvent(['film', 'grades'], lib.reload)
  useScrollRestore(lib.data !== null)
  const [show, setShow] = useRouteState<Show>('/film', 'show', 'all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useLocalState<SortState>('ui.film.sort', { column: 'game', dir: 'desc' })
  const [sel, setSel] = useRouteState<string | null>('/film', 'selection', null)
  const items = lib.data ?? []
  const needle = q.trim().toLowerCase()
  const rows = useMemo(() => {
    const list = items.filter((f) => {
      if (show !== 'all' && stateOf(f) !== show) return false
      if (!needle) return true
      const hay = [f.game.awayTeam, f.game.homeTeam, TEAM_BY_ABBR[f.game.awayTeam]?.name, TEAM_BY_ABBR[f.game.homeTeam]?.name, String(f.game.season), weekName(f.game)].join(' ').toLowerCase()
      return hay.includes(needle)
    })
    return sortRows(list, sort)
  }, [items, show, needle, sort])
  const selected = items.find((f) => keyOf(f) === sel) ?? null

  const plays = items.reduce((n, f) => n + f.playCount, 0)
  const graded = items.reduce((n, f) => n + f.gradedPlays, 0)
  const subtitle = items.length ? `${plural(items.length, 'game')} · ${plays.toLocaleString()} plays · ${plays ? Math.round((graded / plays) * 100) : 0}% graded` : undefined

  const open = (f: FilmLibraryItem) => navigate(links.tape(f.game.gameId, f.team))
  const reveal = async (f: FilmLibraryItem) => {
    try {
      const film = await api.gameFilm(f.game.gameId)
      const clip = film.clips[0]
      if (clip) await api.revealClip(clip.path)
    } catch (e) {
      errorBanner('Couldn’t show the clips', e)
    }
  }
  const menu = (f: FilmLibraryItem) =>
    gameMenu(f.game, f.team, { hasFilm: true, importFilm: () => openImport({ game: f.game, team: f.team }), revealClips: () => void reveal(f), onRemoved: lib.reload })
  const [checkTick, setCheckTick] = useState(0)
  useCommand('file.checkAlignment', () => setCheckTick((n) => n + 1), { enabled: !!selected })

  if (lib.error && !lib.data) {
    return (
      <Screen name="film">
        <Toolbar title="Film" />
        <LoadError what="your film" error={lib.error} retry={lib.reload} />
      </Screen>
    )
  }
  const empty = lib.data !== null && items.length === 0
  return (
    <Screen
      name="film"
      inspector={
        empty ? undefined : (
          <Inspector title="Game">{selected ? <FilmInspector key={keyOf(selected)} f={selected} checkTick={checkTick} open={() => open(selected)} reveal={() => void reveal(selected)} menu={menu(selected)} /> : undefined}</Inspector>
        )
      }
    >
      <Toolbar
        title="Film"
        subtitle={subtitle}
        collapsesLargeTitle
        center={
          items.length > 0 && <Segmented size="toolbar" value={show} onChange={setShow} label="Show" test="film-show" options={SHOWS.map((s) => ({ ...s, test: `film-show-${s.value}` }))} />
        }
        search={items.length ? { placeholder: 'Search film', value: q, onChange: setQ, test: 'film-search' } : undefined}
        trailing={[{ kind: 'button', command: 'file.importFilm', icon: 'folder-input', label: 'Import Film…', showLabel: true, test: 'film-import' }]}
      />
      {!lib.data ? (
        <Loading label="Loading film…" />
      ) : empty ? (
        <EmptyState
          icon="film"
          title="No film yet"
          body="Import a game’s All-22 clips, or drop a folder of clips anywhere on this window. A watched folder imports new games on its own."
          primary={{ label: 'Import Film…', run: () => openImport() }}
          secondary={<Button variant="borderless" label="Watch a Folder…" onClick={() => void window.shell.openSettings('film')} test="film-watch-folder" />}
          test="film-empty"
        />
      ) : (
        <div className="film-library">
          <LargeTitle>Film</LargeTitle>
          {!rows.length ? (
            needle ? (
              <EmptyState icon="search" title={`No Results for “${q.trim()}”`} body="Search by team, city, season or week." />
            ) : (
              <EmptyState icon="film" title={`No games ${SHOWS.find((s) => s.value === show)?.label.toLowerCase()}`} primary={{ label: 'Show All', run: () => setShow('all') }} />
            )
          ) : (
            <FilmTable rows={rows} sort={sort} onSort={setSort} selection={sel} onSelect={setSel} onOpen={open} menu={menu} />
          )}
        </div>
      )}
    </Screen>
  )
}

function FilmTable({
  rows,
  sort,
  onSort,
  selection,
  onSelect,
  onOpen,
  menu
}: {
  rows: FilmLibraryItem[]
  sort: SortState
  onSort: (s: SortState) => void
  selection: string | null
  onSelect: (k: string) => void
  onOpen: (f: FilmLibraryItem) => void
  menu: (f: FilmLibraryItem) => ReturnType<typeof gameMenu>
}) {
  const seasons = new Set(rows.map((f) => f.game.season))
  const columns: Column<FilmLibraryItem>[] = [
    {
      id: 'poster',
      label: '',
      width: 72,
      render: (f) => (
        <Poster poster={f.poster} width={128} className="film-thumb">
          {f.openedAt === null && <span className="film-thumb__new" title="Not opened yet" />}
        </Poster>
      )
    },
    {
      id: 'game',
      label: 'Game',
      flex: 1,
      minWidth: 200,
      sortable: true,
      render: (f) => (
        <span className="film-game">
          <span className="film-game__title">{title(f)}</span>
          <span className="film-game__detail">
            {weekName(f.game)} · {gameDayLabel(f.game.gameday)}
            {seasons.size > 1 || f.game.season !== new Date().getFullYear() ? `, ${f.game.season}` : ''}
          </span>
        </span>
      )
    },
    { id: 'team', label: 'Studying', width: 80, sortable: true, render: (f) => <TeamChip abbr={f.team} /> },
    {
      id: 'clips',
      label: 'Clips',
      width: 112,
      sortable: true,
      align: 'right',
      render: (f) => (
        <span className="film-clips">
          <span className="num">{f.clipCount}</span>
          <span className="film-clips__angles" title={f.angles.map((a) => ANGLE_LABEL[a]).join(', ')}>
            {f.angles.length > 1 ? `${f.angles.length} angles` : f.angles[0] ? ANGLE_LABEL[f.angles[0]] : ''}
          </span>
        </span>
      )
    },
    {
      id: 'graded',
      label: 'Graded',
      width: 168,
      sortable: true,
      render: (f) => (
        <span className="film-progress">
          <ProgressBar value={progressOf(f)} width={64} label={`${f.gradedPlays} of ${f.playCount} graded`} />
          <span className="film-progress__text">{f.gradedPlays >= f.playCount && f.playCount ? 'Done' : `${f.gradedPlays} of ${f.playCount}`}</span>
        </span>
      )
    },
    {
      id: 'alignment',
      label: 'Alignment',
      width: 96,
      render: (f) =>
        f.suspectClips === null ? (
          <span className="c-label-4">—</span>
        ) : f.suspectClips === 0 ? (
          <span className="film-align film-align--ok">
            <Icon name="check" size={12} /> Fits
          </span>
        ) : (
          <span className="film-align film-align--warn" title="Some clips may be matched to the wrong play">
            <Icon name="triangle-alert" size={12} /> {f.suspectClips} to check
          </span>
        )
    },
    {
      id: 'imported',
      label: 'Imported',
      width: 112,
      sortable: true,
      render: (f) => (
        <span className="film-imported">
          {relativeDay(f.importedAt)}
          {f.source === 'watch' && (
            <span className="film-imported__src" title="Imported by the watch folder">
              <Icon name="folder-sync" size={12} />
            </span>
          )}
        </span>
      )
    }
  ]
  return (
    <Table
      className="film-table"
      columns={columns}
      rows={rows}
      rowKey={keyOf}
      sort={sort}
      onSort={onSort}
      selection={selection}
      onSelect={(k) => onSelect(k)}
      onOpen={onOpen}
      onContextMenu={(f, e) => void showMenu(e, menu(f))}
      density="tall"
      rowTest="film-row"
      test="film-table"
      typeSelect={(f) => TEAM_BY_ABBR[f.game.awayTeam]?.name ?? f.game.awayTeam}
    />
  )
}

const REASON: Record<string, string> = {
  tooShort: 'Too short for the play',
  tooLong: 'Too long for the play',
  angleMismatch: 'Angles disagree',
  shifted: 'Looks shifted by a play'
}

function FilmInspector({ f, checkTick, open, reveal, menu }: { f: FilmLibraryItem; checkTick: number; open: () => void; reveal: () => void; menu: ReturnType<typeof gameMenu> }) {
  const stored = useLoaded(() => api.alignment(f.game.gameId).catch(() => null), [f.game.gameId])
  const [checking, setChecking] = useState(false)
  const [fresh, setFresh] = useState<AlignmentResult | null>(null)
  const result = fresh ?? stored.data ?? null
  const check = async () => {
    setChecking(true)
    try {
      setFresh(await api.checkAlignment(f.game.gameId))
    } catch (e) {
      errorBanner('Couldn’t check the clips', e)
    } finally {
      setChecking(false)
    }
  }
  // File › Check Clip Alignment runs the check for the selected game.
  const firstTick = useRef(checkTick)
  useEffect(() => {
    if (checkTick !== firstTick.current) void check()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkTick])
  const remove = menu.find((m) => m.item.label === 'Remove Film…')
  const team = TEAM_BY_ABBR[f.team]
  return (
    <div className="film-inspector" data-test="film-inspector">
      <Poster poster={f.poster} width={560} className="film-inspector__poster" />
      <div className="film-inspector__head">
        <div className="film-inspector__title">{title(f)}</div>
        <div className="film-inspector__sub">
          {weekName(f.game)} · {gameDayLabel(f.game.gameday)}, {f.game.season}
        </div>
      </div>
      <div className="film-inspector__actions">
        <Button variant="primary" label={f.gradedPlays ? 'Resume Grading' : 'Open'} icon="play" onClick={open} test="film-open" />
        <Button label="Show in Finder" onClick={reveal} test="film-reveal" />
      </div>
      <InspectorSection id="film" title="Film">
        <InspectorForm
          rows={[
            ['Studying', team?.name ?? f.team],
            ['Clips', `${f.clipCount} · ${f.angles.map((a) => ANGLE_LABEL[a]).join(', ')}`],
            ['Graded', `${f.gradedPlays} of ${f.playCount} plays`],
            ['Imported', `${relativeDay(f.importedAt)}${f.source === 'watch' ? ' · watch folder' : ''}`],
            ['Opened', f.openedAt ? relativeDay(f.openedAt) : 'Never']
          ]}
        />
        <div className="film-inspector__progress">
          <ProgressBar value={progressOf(f)} />
        </div>
      </InspectorSection>
      <InspectorSection id="alignment" title="Alignment">
        <div data-test="film-alignment">
          {checking ? (
            <div className="film-inspector__note">
              <Spinner size={12} /> Checking clips…
            </div>
          ) : !result ? (
            <div className="film-inspector__note">Not checked yet.</div>
          ) : result.suspects.length === 0 ? (
            <div className="film-inspector__note film-inspector__note--ok">
              <Icon name="check" size={12} /> All {plural(result.checked, 'clip')} fit their plays
              {result.unknown ? ` · ${result.unknown} couldn’t be read` : ''}.
            </div>
          ) : (
            <>
              <div className="film-inspector__note film-inspector__note--warn">
                <Icon name="triangle-alert" size={12} /> {plural(result.suspects.length, 'clip')} may be matched to the wrong play.
              </div>
              <ul className="film-suspects">
                {result.suspects.slice(0, 8).map((s) => (
                  <li key={`${s.path}:${s.playId}`} className="film-suspect" title={s.message}>
                    <a className="film-suspect__play" onClick={() => navigate(links.tape(f.game.gameId, f.team, { play: s.playId }))}>
                      Play {s.playId} · {ANGLE_LABEL[s.angle]}
                    </a>
                    <span className="film-suspect__why">{REASON[s.reason] ?? s.message}</span>
                  </li>
                ))}
              </ul>
              {result.suspects.length > 8 && <div className="film-inspector__note">and {result.suspects.length - 8} more</div>}
            </>
          )}
          <Button variant="borderless" size="sm" label={result ? 'Check Again' : 'Check Clip Alignment'} disabled={checking} onClick={() => void check()} test="film-check" />
        </div>
      </InspectorSection>
      <div className="film-inspector__footer">
        <Button variant="borderless" size="sm" label="Remove Film…" onClick={() => remove?.run?.()} test="film-remove" />
      </div>
    </div>
  )
}

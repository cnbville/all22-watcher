import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import initSqlJs, { type Database, type SqlValue } from 'sql.js'
import { DEFAULT_CHART_FIELDS, DEFAULT_TAGS, POSITION_GROUPS } from '@shared/teams'
import { migrateDrawing } from '@shared/drawing'
import type {
  AlignmentResult,
  Angle,
  ChartField,
  Clip,
  ClipMatchRow,
  Cutup,
  CutupFocus,
  CutupKind,
  CutupRules,
  Grade,
  GradeEntry,
  ImportLogEntry,
  PlayNote,
  PlayRef,
  PositionGroup,
  Settings,
  TagDef
} from '@shared/types'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  angle TEXT NOT NULL,
  sort_index INTEGER NOT NULL,
  play_id INTEGER,
  snap_ms INTEGER,
  duration_ms INTEGER,
  UNIQUE (game_id, path)
);
CREATE INDEX IF NOT EXISTS clips_game ON clips (game_id);
CREATE TABLE IF NOT EXISTS grades (
  game_id TEXT NOT NULL,
  play_id INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  team TEXT NOT NULL,
  grade INTEGER,
  tags TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  critical INTEGER NOT NULL DEFAULT 0,
  off_field INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, play_id, player_id)
);
CREATE INDEX IF NOT EXISTS grades_player ON grades (player_id);
CREATE INDEX IF NOT EXISTS grades_team ON grades (team);
CREATE TABLE IF NOT EXISTS play_notes (
  game_id TEXT NOT NULL,
  play_id INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  chart TEXT NOT NULL DEFAULT '{}',
  drawing TEXT NOT NULL DEFAULT '{}',
  flagged INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, play_id)
);
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grp TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  sort INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chart_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  options TEXT NOT NULL,
  sort INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS film_games (
  game_id TEXT PRIMARY KEY,
  team TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  opened_at TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  alignment TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cutups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  rules TEXT,
  focus TEXT,
  sort INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cutup_plays (
  cutup_id TEXT NOT NULL REFERENCES cutups (id) ON DELETE CASCADE,
  game_id TEXT NOT NULL,
  play_id INTEGER NOT NULL,
  sort INTEGER NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (cutup_id, game_id, play_id)
);
CREATE TABLE IF NOT EXISTS import_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder TEXT NOT NULL,
  signature TEXT,
  game_id TEXT,
  team TEXT,
  source TEXT NOT NULL,
  state TEXT NOT NULL,
  clip_count INTEGER NOT NULL DEFAULT 0,
  play_count INTEGER NOT NULL DEFAULT 0,
  suspect_clips INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS import_log_folder ON import_log (folder);
`

/** Columns added after v1, per table: added by `migrate()` to databases made before them. */
const MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: 'clips', column: 'snap_ms', ddl: 'ALTER TABLE clips ADD COLUMN snap_ms INTEGER' },
  { table: 'clips', column: 'duration_ms', ddl: 'ALTER TABLE clips ADD COLUMN duration_ms INTEGER' },
  { table: 'grades', column: 'critical', ddl: 'ALTER TABLE grades ADD COLUMN critical INTEGER NOT NULL DEFAULT 0' },
  { table: 'grades', column: 'off_field', ddl: 'ALTER TABLE grades ADD COLUMN off_field INTEGER NOT NULL DEFAULT 0' },
  { table: 'film_games', column: 'source', ddl: "ALTER TABLE film_games ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'" },
  { table: 'film_games', column: 'alignment', ddl: 'ALTER TABLE film_games ADD COLUMN alignment TEXT' }
]

export const DEFAULT_SETTINGS: Settings = {
  autoAdvance: false,
  defaultSpeed: 1,
  pinned: {},
  startAtSnap: true,
  preRoll: 1,
  welcomeSeen: false,
  myTeams: [],
  myTeamsRemoved: [],
  watchFolder: null,
  watchPaused: false,
  autoUpdateSeasons: true
}

type Params = SqlValue[] | Record<string, SqlValue>

/**
 * The user's own data (clips, grades, notes, tags) in one SQLite file. sql.js keeps the database
 * in memory; every change schedules an atomic write back to disk.
 */
export class Store {
  private saveTimer: NodeJS.Timeout | null = null

  private constructor(
    private db: Database,
    readonly file: string
  ) {}

  static async open(file: string, wasmDir?: string): Promise<Store> {
    const SQL = await initSqlJs(wasmDir ? { locateFile: (f: string) => join(wasmDir, f) } : undefined)
    const db = existsSync(file) ? new SQL.Database(readFileSync(file)) : new SQL.Database()
    db.run('PRAGMA foreign_keys = ON')
    db.exec(SCHEMA)
    const store = new Store(db, file)
    store.migrate()
    store.seedDefaults()
    store.flush()
    return store
  }

  /**
   * Opens the store, but if SQLite can't read the file (damaged, or not a database at all) it's moved
   * aside, never deleted, and a fresh store is started. `movedTo` says where the old file went.
   */
  static async openOrRecover(file: string, wasmDir?: string): Promise<{ store: Store; movedTo: string | null }> {
    try {
      return { store: await Store.open(file, wasmDir), movedTo: null }
    } catch (e) {
      if (!existsSync(file) || !/file is not a database|malformed|unsupported file format/.test(String(e))) throw e
      const movedTo = `${file}.corrupt-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}`
      renameSync(file, movedTo)
      return { store: await Store.open(file, wasmDir), movedTo }
    }
  }

  /**
   * Adds the columns v2 needs to a database made by an earlier version. Idempotent: it reads each table's columns and
   * adds only what is missing. Before the first change it keeps one copy of the old file next to it
   * (`grades.sqlite.v1-backup`), since an earlier version can't open the database afterwards.
   */
  migrate(): string[] {
    const columns = new Map<string, Set<string>>()
    const has = (table: string, column: string) => {
      if (!columns.has(table)) columns.set(table, new Set(this.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name)))
      return columns.get(table)!.has(column)
    }
    const missing = MIGRATIONS.filter((m) => !has(m.table, m.column))
    if (!missing.length) return []
    const backup = `${this.file}.v1-backup`
    if (existsSync(this.file) && !existsSync(backup)) copyFileSync(this.file, backup)
    for (const m of missing) this.db.run(m.ddl)
    return missing.map((m) => `${m.table}.${m.column}`)
  }

  /** Bumped by every write, so cached results (smart cut-ups) know when to recompute. */
  changeCount = 0

  private all<T = Record<string, SqlValue>>(sql: string, params: Params = []): T[] {
    const stmt = this.db.prepare(sql)
    try {
      stmt.bind(params)
      const rows: T[] = []
      while (stmt.step()) rows.push(stmt.getAsObject() as T)
      return rows
    } finally {
      stmt.free()
    }
  }

  private run(sql: string, params: Params = []) {
    this.db.run(sql, params)
    this.scheduleSave()
  }

  private transaction(fn: () => void) {
    this.db.run('BEGIN')
    try {
      fn()
      this.db.run('COMMIT')
    } catch (e) {
      this.db.run('ROLLBACK')
      throw e
    }
    this.scheduleSave()
  }

  private scheduleSave() {
    this.changeCount++
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), 400)
  }

  /** Writes the database to disk now (temp file + rename, so a crash never leaves half a file). */
  flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    const tmp = join(dirname(this.file), `.${Date.now()}.tmp`)
    writeFileSync(tmp, Buffer.from(this.db.export()))
    renameSync(tmp, this.file)
  }

  /** Fills in the starter tags and chart fields once, so emptying either list in Settings sticks. */
  private seedDefaults() {
    if (this.all("SELECT 1 FROM settings WHERE key = 'seeded'").length) return
    if (!this.all('SELECT 1 FROM tags LIMIT 1').length) {
      this.saveTagsNoFlush(
        POSITION_GROUPS.flatMap((group) => DEFAULT_TAGS[group].map(([label, kind]) => ({ group, label, kind })))
      )
    }
    if (!this.all('SELECT 1 FROM chart_fields LIMIT 1').length) {
      DEFAULT_CHART_FIELDS.forEach(([name, options], i) =>
        this.db.run('INSERT INTO chart_fields (name, options, sort) VALUES (?, ?, ?)', [name, JSON.stringify(options), i])
      )
    }
    this.db.run("INSERT INTO settings (key, value) VALUES ('seeded', 'true')")
  }

  // Clips

  clipsForGame(gameId: string): Clip[] {
    return this.all<Record<string, SqlValue>>('SELECT * FROM clips WHERE game_id = ? ORDER BY angle, sort_index', [gameId]).map(toClip)
  }

  clipById(id: number): Clip | null {
    const row = this.all('SELECT * FROM clips WHERE id = ?', [id])[0]
    return row ? toClip(row) : null
  }

  /** Whether any game's film has a clip at this path. */
  hasClipPath(path: string): boolean {
    return this.all('SELECT 1 FROM clips WHERE path = ? LIMIT 1', [path]).length > 0
  }

  clipCounts(gameIds: string[]): Map<string, number> {
    const out = new Map<string, number>()
    if (!gameIds.length) return out
    const rows = this.all<{ game_id: string; n: number }>(
      `SELECT game_id, COUNT(*) AS n FROM clips WHERE game_id IN (${gameIds.map(() => '?').join(',')}) GROUP BY game_id`,
      gameIds
    )
    for (const r of rows) out.set(r.game_id, r.n)
    return out
  }

  /** Replaces a game's clips. Grades and notes are keyed by play, so they survive a re-import. */
  replaceClips(gameId: string, rows: ClipMatchRow[]) {
    // Snap points and durations belong to the file, so a clip re-imported from the same path keeps them.
    const kept = new Map(
      this.all<{ path: string; snap_ms: number | null; duration_ms: number | null }>(
        'SELECT path, snap_ms, duration_ms FROM clips WHERE game_id = ?',
        [gameId]
      ).map((r) => [r.path, r])
    )
    this.transaction(() => {
      this.db.run('DELETE FROM clips WHERE game_id = ?', [gameId])
      const counters = new Map<Angle, number>()
      for (const row of rows) {
        const i = counters.get(row.angle) ?? 0
        counters.set(row.angle, i + 1)
        const old = kept.get(row.path)
        this.db.run(
          'INSERT INTO clips (game_id, path, file_name, angle, sort_index, play_id, snap_ms, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [gameId, row.path, row.fileName, row.angle, i, row.playId, old?.snap_ms ?? null, old?.duration_ms ?? null]
        )
      }
    })
  }

  setClipSnap(clipId: number, snapMs: number | null) {
    this.db.run('UPDATE clips SET snap_ms = ? WHERE id = ?', [snapMs === null ? null : Math.round(snapMs), clipId])
    if (!this.db.getRowsModified()) throw new Error('That clip is no longer in your film.')
    this.scheduleSave()
  }

  /** Stores clip lengths (seconds) read at import, by path. */
  setClipDurations(gameId: string, durations: Map<string, number | null>) {
    this.transaction(() => {
      for (const [path, d] of durations) {
        this.db.run('UPDATE clips SET duration_ms = ? WHERE game_id = ? AND path = ?', [d === null ? null : Math.round(d * 1000), gameId, path])
      }
    })
  }

  /** Every game with film: studied team, when imported and opened, and how. */
  filmGames(): { gameId: string; team: string; importedAt: string; openedAt: string | null; source: 'manual' | 'watch'; clipCount: number }[] {
    return this.all<{ game_id: string; team: string; imported_at: string; opened_at: string | null; source: string; n: number }>(
      `SELECT f.game_id, f.team, f.imported_at, f.opened_at, f.source, COUNT(c.id) AS n FROM film_games f
       JOIN clips c ON c.game_id = f.game_id GROUP BY f.game_id ORDER BY f.game_id DESC`
    ).map((r) => ({
      gameId: r.game_id,
      team: r.team,
      importedAt: r.imported_at,
      openedAt: r.opened_at,
      source: r.source === 'watch' ? 'watch' : 'manual',
      clipCount: r.n
    }))
  }

  /** The studied team of each game that has a film_games row (with or without clips). */
  studiedTeams(): Map<string, string> {
    return new Map(this.all<{ game_id: string; team: string }>('SELECT game_id, team FROM film_games').map((r) => [r.game_id, r.team]))
  }

  setFilmSource(gameId: string, source: 'manual' | 'watch') {
    this.run('UPDATE film_games SET source = ? WHERE game_id = ?', [source, gameId])
  }

  saveAlignment(gameId: string, result: AlignmentResult) {
    this.run('UPDATE film_games SET alignment = ? WHERE game_id = ?', [JSON.stringify(result), gameId])
  }

  alignment(gameId: string): AlignmentResult | null {
    const raw = this.all<{ alignment: string | null }>('SELECT alignment FROM film_games WHERE game_id = ?', [gameId])[0]?.alignment
    return raw ? (JSON.parse(raw) as AlignmentResult) : null
  }

  // Import log

  logImport(e: Omit<ImportLogEntry, 'id' | 'at'> & { signature?: string | null }): ImportLogEntry {
    const at = new Date().toISOString()
    this.run(
      `INSERT INTO import_log (folder, signature, game_id, team, source, state, clip_count, play_count, suspect_clips, error, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [e.folder, e.signature ?? null, e.gameId, e.team, e.source, e.state, e.clipCount, e.playCount, e.suspectClips, e.error, at]
    )
    // Keep the log short.
    this.db.run('DELETE FROM import_log WHERE id NOT IN (SELECT id FROM import_log ORDER BY id DESC LIMIT 200)')
    const id = this.all<{ id: number }>('SELECT MAX(id) AS id FROM import_log')[0].id
    return { ...e, id, at }
  }

  importLog(limit = 5, source?: 'manual' | 'watch'): ImportLogEntry[] {
    return this.all<Record<string, SqlValue>>(
      `SELECT * FROM import_log ${source ? 'WHERE source = ?' : ''} ORDER BY id DESC LIMIT ?`,
      source ? [source, limit] : [limit]
    ).map(toImportLog)
  }

  /** The last import of a folder by the watcher, with the folder signature it saw then. */
  lastWatchImport(folder: string): (ImportLogEntry & { signature: string | null }) | null {
    const r = this.all<Record<string, SqlValue>>("SELECT * FROM import_log WHERE folder = ? AND source = 'watch' ORDER BY id DESC LIMIT 1", [folder])[0]
    return r ? { ...toImportLog(r), signature: (r.signature as string | null) ?? null } : null
  }

  /**
   * Remembers which team you study in a game and when you last opened it, for the home screen. A fresh import
   * (`opened` false) counts as new again until it's opened.
   */
  touchFilm(gameId: string, team: string, opened: boolean, source: 'manual' | 'watch' = 'manual') {
    const now = new Date().toISOString()
    if (opened) {
      this.run(
        `INSERT INTO film_games (game_id, team, imported_at, opened_at, source) VALUES (?, ?, ?, ?, 'manual')
         ON CONFLICT (game_id) DO UPDATE SET team = excluded.team, opened_at = excluded.opened_at`,
        [gameId, team, now, now]
      )
    } else {
      this.run(
        `INSERT INTO film_games (game_id, team, imported_at, opened_at, source) VALUES (?, ?, ?, NULL, ?)
         ON CONFLICT (game_id) DO UPDATE SET team = excluded.team, imported_at = excluded.imported_at, source = excluded.source`,
        [gameId, team, now, source]
      )
    }
  }

  recentFilm(limit = 8): { gameId: string; team: string; openedAt: string | null }[] {
    return this.all<{ game_id: string; team: string; opened_at: string | null }>(
      `SELECT f.game_id, f.team, f.opened_at FROM film_games f
       WHERE EXISTS (SELECT 1 FROM clips c WHERE c.game_id = f.game_id)
       ORDER BY COALESCE(f.opened_at, f.imported_at) DESC LIMIT ?`,
      [limit]
    ).map((r) => ({ gameId: r.game_id, team: r.team, openedAt: r.opened_at }))
  }

  relinkClip(clipId: number, playId: number | null) {
    this.run('UPDATE clips SET play_id = ? WHERE id = ?', [playId, clipId])
  }

  removeClips(gameId: string) {
    this.db.run('DELETE FROM film_games WHERE game_id = ?', [gameId])
    this.run('DELETE FROM clips WHERE game_id = ?', [gameId])
  }

  // Grades

  gradesForGame(gameId: string): GradeEntry[] {
    return this.all('SELECT * FROM grades WHERE game_id = ?', [gameId]).map(toGrade)
  }

  gradesForPlayer(playerId: string, season: number): GradeEntry[] {
    return this.all('SELECT * FROM grades WHERE player_id = ? AND game_id LIKE ? ORDER BY game_id, play_id', [
      playerId,
      `${season}_%`
    ]).map(toGrade)
  }

  gradesForTeam(team: string, season: number): GradeEntry[] {
    return this.all("SELECT * FROM grades WHERE team = ? AND game_id LIKE ? ORDER BY game_id, play_id", [
      team,
      `${season}_%`
    ]).map(toGrade)
  }

  /** Plays with at least one grade for `team`, per game. */
  gradedPlayCounts(gameIds: string[], team: string): Map<string, number> {
    const out = new Map<string, number>()
    if (!gameIds.length) return out
    const rows = this.all<{ game_id: string; n: number }>(
      `SELECT game_id, COUNT(DISTINCT play_id) AS n FROM grades WHERE grade IS NOT NULL AND team = ? AND game_id IN (${gameIds
        .map(() => '?')
        .join(',')}) GROUP BY game_id`,
      [team, ...gameIds]
    )
    for (const r of rows) out.set(r.game_id, r.n)
    return out
  }

  /** Every grade of a season (leaderboards, smart cut-ups). */
  gradesForSeason(season: number): GradeEntry[] {
    return this.all('SELECT * FROM grades WHERE game_id LIKE ? ORDER BY game_id, play_id', [`${season}_%`]).map(toGrade)
  }

  gradesForGames(gameIds: string[]): GradeEntry[] {
    if (!gameIds.length) return []
    return this.all(`SELECT * FROM grades WHERE game_id IN (${gameIds.map(() => '?').join(',')}) ORDER BY game_id, play_id`, gameIds).map(toGrade)
  }

  /** Every game that has any grade or note (the cut-up universe, with games that have film). */
  gamesWithGrades(): string[] {
    return this.all<{ game_id: string }>('SELECT DISTINCT game_id FROM grades UNION SELECT DISTINCT game_id FROM play_notes').map((r) => r.game_id)
  }

  /** Players by their newest grade, per season. */
  recentlyGradedPlayers(limit: number): { playerId: string; season: number; at: string; team: string }[] {
    return this.all<{ player_id: string; season: string; at: string; team: string }>(
      `SELECT player_id, substr(game_id, 1, 4) AS season, MAX(updated_at) AS at, team FROM grades
       WHERE grade IS NOT NULL GROUP BY player_id, season ORDER BY at DESC LIMIT ?`,
      [limit]
    ).map((r) => ({ playerId: r.player_id, season: Number(r.season), at: r.at, team: r.team }))
  }

  /**
   * Saves one player's entry on a play. The row is deleted only when nothing is left: no grade, tags, note, critical
   * mark or Not on Field. Not on Field clears the grade and critical; critical without a grade is kept (it counts once graded).
   */
  saveGrade(e: GradeEntry) {
    const offField = !!e.offField
    const grade = offField ? null : e.grade
    const critical = offField ? false : !!e.critical
    if (grade === null && !e.tags.length && !e.note.trim() && !critical && !offField) {
      this.run('DELETE FROM grades WHERE game_id = ? AND play_id = ? AND player_id = ?', [e.gameId, e.playId, e.playerId])
      return
    }
    this.run(
      `INSERT INTO grades (game_id, play_id, player_id, team, grade, tags, note, updated_at, critical, off_field)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (game_id, play_id, player_id) DO UPDATE SET
         team = excluded.team, grade = excluded.grade, tags = excluded.tags, note = excluded.note, updated_at = excluded.updated_at,
         critical = excluded.critical, off_field = excluded.off_field`,
      [e.gameId, e.playId, e.playerId, e.team, grade, JSON.stringify(e.tags), e.note, new Date().toISOString(), critical ? 1 : 0, offField ? 1 : 0]
    )
  }

  // Play notes

  notesForGame(gameId: string): PlayNote[] {
    return this.all('SELECT * FROM play_notes WHERE game_id = ?', [gameId]).map(toNote)
  }

  notesForGames(gameIds: string[]): PlayNote[] {
    if (!gameIds.length) return []
    return this.all(`SELECT * FROM play_notes WHERE game_id IN (${gameIds.map(() => '?').join(',')})`, gameIds).map(toNote)
  }

  // Cut-ups

  cutups(): Cutup[] {
    return this.all('SELECT * FROM cutups ORDER BY sort, created_at').map(toCutup)
  }

  cutupById(id: string): Cutup | null {
    const r = this.all('SELECT * FROM cutups WHERE id = ?', [id])[0]
    return r ? toCutup(r) : null
  }

  private uniqueCutupName(base: string, except?: string): string {
    const taken = new Set(this.cutups().filter((c) => c.id !== except).map((c) => c.name.toLowerCase()))
    if (!taken.has(base.toLowerCase())) return base
    for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`
  }

  /** Creates a cut-up at the end of the list (or right after `after`). A blank name gets the default, de-duplicated. */
  createCutup(input: { name?: string; kind: CutupKind; rules?: CutupRules | null; focus?: CutupFocus | null; plays?: PlayRef[] }, after?: string): Cutup {
    const id = `cu_${randomCode()}`
    const now = new Date().toISOString()
    const trimmed = (input.name ?? '').trim().slice(0, 80)
    const name = trimmed || this.uniqueCutupName(input.kind === 'smart' ? 'Untitled Smart Cut-up' : 'Untitled Cut-up')
    this.transaction(() => {
      const list = this.cutups()
      let sort = list.length ? Math.max(...list.map((c) => c.sort)) + 1 : 0
      if (after) {
        const prev = list.find((c) => c.id === after)
        if (prev) {
          this.db.run('UPDATE cutups SET sort = sort + 1 WHERE sort > ?', [prev.sort])
          sort = prev.sort + 1
        }
      }
      this.db.run('INSERT INTO cutups (id, name, kind, rules, focus, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
        id,
        name,
        input.kind,
        input.kind === 'smart' ? JSON.stringify(input.rules ?? { match: 'all', rules: [], limit: null, order: 'game' }) : null,
        input.focus ? JSON.stringify(input.focus) : null,
        sort,
        now,
        now
      ])
      if (input.kind === 'manual' && input.plays?.length) this.insertCutupPlays(id, input.plays, 0)
    })
    return this.cutupById(id)!
  }

  updateCutup(id: string, patch: { name?: string; rules?: CutupRules; focus?: CutupFocus | null }): Cutup {
    const c = this.cutupById(id)
    if (!c) throw new Error('That cut-up no longer exists.')
    const name = patch.name === undefined ? c.name : patch.name.trim().slice(0, 80) || c.name
    const rules = patch.rules === undefined ? c.rules : patch.rules
    const focus = patch.focus === undefined ? c.focus : patch.focus
    this.run('UPDATE cutups SET name = ?, rules = ?, focus = ?, updated_at = ? WHERE id = ?', [
      name,
      c.kind === 'smart' && rules ? JSON.stringify(rules) : null,
      focus ? JSON.stringify(focus) : null,
      new Date().toISOString(),
      id
    ])
    return this.cutupById(id)!
  }

  deleteCutup(id: string) {
    // Deleted explicitly too: the cascade needs foreign keys on, which a database opened elsewhere may not have.
    this.transaction(() => {
      this.db.run('DELETE FROM cutup_plays WHERE cutup_id = ?', [id])
      this.db.run('DELETE FROM cutups WHERE id = ?', [id])
    })
  }

  /** Copies a cut-up right after the original; `plays` turns it into a manual cut-up holding those plays. */
  duplicateCutup(id: string, asManualWith?: PlayRef[]): Cutup {
    const c = this.cutupById(id)
    if (!c) throw new Error('That cut-up no longer exists.')
    if (asManualWith) {
      return this.createCutup({ name: this.uniqueCutupName(`${c.name} (fixed)`), kind: 'manual', focus: c.focus, plays: asManualWith }, id)
    }
    const copy = this.createCutup({ name: this.uniqueCutupName(`${c.name} copy`), kind: c.kind, rules: c.rules, focus: c.focus }, id)
    if (c.kind === 'manual') this.addToCutup(copy.id, this.cutupPlays(id))
    return copy
  }

  cutupPlays(id: string): (PlayRef & { addedAt: string })[] {
    return this.all<{ game_id: string; play_id: number; added_at: string }>('SELECT * FROM cutup_plays WHERE cutup_id = ? ORDER BY sort', [id]).map(
      (r) => ({ gameId: r.game_id, playId: r.play_id, addedAt: r.added_at })
    )
  }

  private insertCutupPlays(id: string, plays: PlayRef[], from: number): number {
    const now = new Date().toISOString()
    let sort = from
    let added = 0
    for (const p of plays) {
      this.db.run('INSERT OR IGNORE INTO cutup_plays (cutup_id, game_id, play_id, sort, added_at) VALUES (?, ?, ?, ?, ?)', [id, p.gameId, p.playId, sort, now])
      if (this.db.getRowsModified()) {
        added++
        sort++
      }
    }
    return added
  }

  private requireManual(id: string): Cutup {
    const c = this.cutupById(id)
    if (!c) throw new Error('That cut-up no longer exists.')
    if (c.kind !== 'manual') throw new Error('Plays can’t be added to a smart cut-up; it collects plays from its rules.')
    return c
  }

  /** Appends plays in order; plays already in the cut-up keep their place. */
  addToCutup(id: string, plays: PlayRef[]): { added: number; already: number } {
    this.requireManual(id)
    const unique = [...new Map(plays.map((p) => [`${p.gameId}#${p.playId}`, p])).values()]
    let added = 0
    this.transaction(() => {
      const max = this.all<{ m: number | null }>('SELECT MAX(sort) AS m FROM cutup_plays WHERE cutup_id = ?', [id])[0].m
      added = this.insertCutupPlays(id, unique, (max ?? -1) + 1)
      this.touchCutup(id)
    })
    return { added, already: unique.length - added }
  }

  removeFromCutup(id: string, plays: PlayRef[]) {
    this.requireManual(id)
    this.transaction(() => {
      for (const p of plays) this.db.run('DELETE FROM cutup_plays WHERE cutup_id = ? AND game_id = ? AND play_id = ?', [id, p.gameId, p.playId])
      this.touchCutup(id)
    })
  }

  /** Takes the complete new order; plays not listed keep their relative order after the listed ones. */
  reorderCutup(id: string, plays: PlayRef[]) {
    this.requireManual(id)
    const key = (p: PlayRef) => `${p.gameId}#${p.playId}`
    const current = this.cutupPlays(id)
    const listed = new Set(plays.map(key))
    const order = [...plays.filter((p) => current.some((c) => key(c) === key(p))), ...current.filter((c) => !listed.has(key(c)))]
    this.transaction(() => {
      order.forEach((p, i) => this.db.run('UPDATE cutup_plays SET sort = ? WHERE cutup_id = ? AND game_id = ? AND play_id = ?', [i, id, p.gameId, p.playId]))
      this.touchCutup(id)
    })
  }

  reorderCutups(ids: string[]) {
    const rest = this.cutups().filter((c) => !ids.includes(c.id)).map((c) => c.id)
    this.transaction(() => [...ids, ...rest].forEach((id, i) => this.db.run('UPDATE cutups SET sort = ? WHERE id = ?', [i, id])))
  }

  private touchCutup(id: string) {
    this.db.run('UPDATE cutups SET updated_at = ? WHERE id = ?', [new Date().toISOString(), id])
  }

  savePlayNote(n: PlayNote) {
    this.run(
      `INSERT INTO play_notes (game_id, play_id, note, chart, drawing, flagged) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (game_id, play_id) DO UPDATE SET
         note = excluded.note, chart = excluded.chart, drawing = excluded.drawing, flagged = excluded.flagged`,
      [n.gameId, n.playId, n.note, JSON.stringify(n.chart), JSON.stringify(n.drawing), n.flagged ? 1 : 0]
    )
  }

  // Tags, chart fields, settings

  tags(): TagDef[] {
    return this.all<{ id: number; grp: string; label: string; kind: string }>('SELECT * FROM tags ORDER BY sort, id').map(
      (r) => ({ id: r.id, group: r.grp as PositionGroup, label: r.label, kind: r.kind as TagDef['kind'] })
    )
  }

  private saveTagsNoFlush(tags: (Omit<TagDef, 'id'> & { id?: number })[]) {
    this.db.run('DELETE FROM tags')
    tags.forEach((t, i) =>
      this.db.run('INSERT INTO tags (id, grp, label, kind, sort) VALUES (?, ?, ?, ?, ?)', [t.id ?? null, t.group, t.label, t.kind, i])
    )
  }

  /**
   * Replaces the tag list. A tag that keeps its id under a new label is a rename, and grades tagged with the
   * old label get the new one. Labels repeat across groups ('Drop' is an RB, WR and TE tag) and grades don't
   * record the group, so a label still used by another tag, or renamed two different ways, is left as is.
   */
  saveTags(tags: (Omit<TagDef, 'id'> & { id?: number })[]): TagDef[] {
    const old = new Map(this.tags().map((t) => [t.id, t.label]))
    const next = knownIds(tags, old)
    const labels = new Set(next.map((t) => t.label))
    const renames = new Map<string, string | null>()
    for (const t of next) {
      const from = t.id === undefined ? undefined : old.get(t.id)!
      if (from === undefined || from === t.label || labels.has(from)) continue
      renames.set(from, renames.has(from) && renames.get(from) !== t.label ? null : t.label)
    }
    this.transaction(() => {
      this.saveTagsNoFlush(next)
      this.renameGradeTags(new Map([...renames].filter((r): r is [string, string] => r[1] !== null)))
    })
    return this.tags()
  }

  private renameGradeTags(renames: Map<string, string>) {
    if (!renames.size) return
    const rows = this.all<{ game_id: string; play_id: number; player_id: string; tags: string }>(
      "SELECT game_id, play_id, player_id, tags FROM grades WHERE tags != '[]'"
    )
    for (const r of rows) {
      const tags: string[] = JSON.parse(r.tags)
      if (!tags.some((t) => renames.has(t))) continue
      this.db.run('UPDATE grades SET tags = ? WHERE game_id = ? AND play_id = ? AND player_id = ?', [
        JSON.stringify([...new Set(tags.map((t) => renames.get(t) ?? t))]),
        r.game_id,
        r.play_id,
        r.player_id
      ])
    }
  }

  chartFields(): ChartField[] {
    return this.all<{ id: number; name: string; options: string }>('SELECT * FROM chart_fields ORDER BY sort, id').map((r) => ({
      id: r.id,
      name: r.name,
      options: JSON.parse(r.options)
    }))
  }

  /**
   * Replaces the charting fields. Play charts are keyed by field name, so a field that keeps its id under a
   * new name has its charted values moved to the new name, and an option renamed in place (same spot in
   * the list) has its charted values renamed too.
   */
  saveChartFields(fields: (Omit<ChartField, 'id'> & { id?: number })[]): ChartField[] {
    const old = new Map(this.chartFields().map((f) => [f.id, f]))
    const next = knownIds(fields, old)
    const names = new Set(next.map((f) => f.name))
    const moves: { from: string; to: string; options: Map<string, string> }[] = []
    for (const f of next) {
      const prev = f.id === undefined ? undefined : old.get(f.id)!
      if (!prev) continue
      const options = new Map<string, string>()
      for (let i = 0; i < Math.min(prev.options.length, f.options.length); i++) {
        const [a, b] = [prev.options[i], f.options[i]]
        if (a !== b && !f.options.includes(a) && !prev.options.includes(b)) options.set(a, b)
      }
      if (prev.name !== f.name || options.size) moves.push({ from: prev.name, to: f.name, options })
    }
    this.transaction(() => {
      this.db.run('DELETE FROM chart_fields')
      next.forEach((f, i) =>
        this.db.run('INSERT INTO chart_fields (id, name, options, sort) VALUES (?, ?, ?, ?)', [f.id ?? null, f.name, JSON.stringify(f.options), i])
      )
      if (!moves.length) return
      for (const r of this.all<{ game_id: string; play_id: number; chart: string }>("SELECT game_id, play_id, chart FROM play_notes WHERE chart != '{}'")) {
        const chart: Record<string, string> = JSON.parse(r.chart)
        const moved = { ...chart }
        for (const m of moves) if (m.from !== m.to && !names.has(m.from)) delete moved[m.from]
        // Read from the old chart so fields that swap names don't overwrite each other.
        for (const m of moves) {
          const v = chart[m.from]
          if (v === undefined) delete moved[m.to]
          else moved[m.to] = m.options.get(v) ?? v
        }
        if (JSON.stringify(moved) === JSON.stringify(chart)) continue
        this.db.run('UPDATE play_notes SET chart = ? WHERE game_id = ? AND play_id = ?', [JSON.stringify(moved), r.game_id, r.play_id])
      }
    })
    return this.chartFields()
  }

  settings(): Settings {
    const out: Settings = structuredClone(DEFAULT_SETTINGS)
    for (const r of this.all<{ key: string; value: string }>('SELECT * FROM settings')) {
      if (r.key in out) (out as unknown as Record<string, unknown>)[r.key] = JSON.parse(r.value)
    }
    return out
  }

  saveSettings(patch: Partial<Settings>): Settings {
    this.transaction(() => {
      for (const [key, value] of Object.entries(patch)) {
        if (!(key in DEFAULT_SETTINGS) || value === undefined) continue
        this.db.run(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
          [key, JSON.stringify(value)]
        )
      }
    })
    return this.settings()
  }

  close() {
    this.flush()
    this.db.close()
  }
}

/** Drops ids that aren't in the table or are repeated, so those rows are saved as new. */
function knownIds<T extends { id?: number }>(items: T[], existing: Map<number, unknown>): T[] {
  const seen = new Set<number>()
  return items.map((t) => {
    if (t.id === undefined || !existing.has(t.id) || seen.has(t.id)) return { ...t, id: undefined }
    seen.add(t.id)
    return t
  })
}

function toClip(r: Record<string, SqlValue>): Clip {
  return {
    id: r.id as number,
    gameId: r.game_id as string,
    path: r.path as string,
    fileName: r.file_name as string,
    angle: r.angle as Angle,
    sortIndex: r.sort_index as number,
    playId: (r.play_id as number | null) ?? null,
    snapMs: (r.snap_ms as number | null) ?? null,
    duration: r.duration_ms === null || r.duration_ms === undefined ? null : (r.duration_ms as number) / 1000
  }
}

function toGrade(r: Record<string, SqlValue>): GradeEntry {
  return {
    gameId: r.game_id as string,
    playId: r.play_id as number,
    playerId: r.player_id as string,
    team: r.team as string,
    grade: (r.grade as Grade | null) ?? null,
    tags: JSON.parse((r.tags as string) || '[]'),
    note: (r.note as string) ?? '',
    critical: !!r.critical,
    offField: !!r.off_field
  }
}

function toNote(r: Record<string, SqlValue>): PlayNote {
  return {
    gameId: r.game_id as string,
    playId: r.play_id as number,
    note: (r.note as string) ?? '',
    chart: JSON.parse((r.chart as string) || '{}'),
    // v1 strokes are read as pen shapes; the note is written back in the new form the next time it's saved.
    drawing: migrateDrawing((r.drawing as string) || '{}'),
    flagged: !!r.flagged
  }
}

function toCutup(r: Record<string, SqlValue>): Cutup {
  const json = <T>(v: SqlValue): T | null => {
    if (typeof v !== 'string' || !v) return null
    try {
      return JSON.parse(v) as T
    } catch {
      return null
    }
  }
  return {
    id: r.id as string,
    name: r.name as string,
    kind: r.kind === 'smart' ? 'smart' : 'manual',
    rules: r.kind === 'smart' ? json<CutupRules>(r.rules) ?? { match: 'all', rules: [], limit: null, order: 'game' } : null,
    focus: json<CutupFocus>(r.focus),
    sort: r.sort as number,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string
  }
}

function toImportLog(r: Record<string, SqlValue>): ImportLogEntry {
  return {
    id: r.id as number,
    folder: r.folder as string,
    gameId: (r.game_id as string | null) ?? null,
    team: (r.team as string | null) ?? null,
    source: r.source === 'watch' ? 'watch' : 'manual',
    state: r.state === 'failed' ? 'failed' : 'done',
    clipCount: (r.clip_count as number) ?? 0,
    playCount: (r.play_count as number) ?? 0,
    suspectClips: (r.suspect_clips as number) ?? 0,
    error: (r.error as string | null) ?? null,
    at: r.at as string
  }
}

/** 10 random base-36 characters. */
function randomCode(): string {
  const bytes = randomBytes(10)
  return [...bytes].map((b) => (b % 36).toString(36)).join('')
}

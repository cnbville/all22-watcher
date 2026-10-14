import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import initSqlJs, { type Database, type SqlValue } from 'sql.js'
import { DEFAULT_CHART_FIELDS, DEFAULT_TAGS, POSITION_GROUPS } from '@shared/teams'
import type {
  Angle,
  ChartField,
  Clip,
  ClipMatchRow,
  Grade,
  GradeEntry,
  PlayNote,
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
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

const DEFAULT_SETTINGS: Settings = {
  autoAdvance: false,
  includeSpecialTeams: true,
  defaultSpeed: 1,
  pinned: {}
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
    store.seedDefaults()
    store.flush()
    return store
  }

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

  private seedDefaults() {
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
  }

  // Clips

  clipsForGame(gameId: string): Clip[] {
    return this.all<Record<string, SqlValue>>('SELECT * FROM clips WHERE game_id = ? ORDER BY angle, sort_index', [gameId]).map(toClip)
  }

  clipById(id: number): Clip | null {
    const row = this.all('SELECT * FROM clips WHERE id = ?', [id])[0]
    return row ? toClip(row) : null
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
    this.transaction(() => {
      this.db.run('DELETE FROM clips WHERE game_id = ?', [gameId])
      const counters = new Map<Angle, number>()
      for (const row of rows) {
        const i = counters.get(row.angle) ?? 0
        counters.set(row.angle, i + 1)
        this.db.run(
          'INSERT INTO clips (game_id, path, file_name, angle, sort_index, play_id) VALUES (?, ?, ?, ?, ?, ?)',
          [gameId, row.path, row.fileName, row.angle, i, row.playId]
        )
      }
    })
  }

  relinkClip(clipId: number, playId: number | null) {
    this.run('UPDATE clips SET play_id = ? WHERE id = ?', [playId, clipId])
  }

  removeClips(gameId: string) {
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

  gradedPlayCounts(gameIds: string[]): Map<string, number> {
    const out = new Map<string, number>()
    if (!gameIds.length) return out
    const rows = this.all<{ game_id: string; n: number }>(
      `SELECT game_id, COUNT(DISTINCT play_id) AS n FROM grades WHERE grade IS NOT NULL AND game_id IN (${gameIds
        .map(() => '?')
        .join(',')}) GROUP BY game_id`,
      gameIds
    )
    for (const r of rows) out.set(r.game_id, r.n)
    return out
  }

  saveGrade(e: GradeEntry) {
    if (e.grade === null && !e.tags.length && !e.note.trim()) {
      this.run('DELETE FROM grades WHERE game_id = ? AND play_id = ? AND player_id = ?', [e.gameId, e.playId, e.playerId])
      return
    }
    this.run(
      `INSERT INTO grades (game_id, play_id, player_id, team, grade, tags, note, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (game_id, play_id, player_id) DO UPDATE SET
         team = excluded.team, grade = excluded.grade, tags = excluded.tags, note = excluded.note, updated_at = excluded.updated_at`,
      [e.gameId, e.playId, e.playerId, e.team, e.grade, JSON.stringify(e.tags), e.note, new Date().toISOString()]
    )
  }

  // Play notes

  notesForGame(gameId: string): PlayNote[] {
    return this.all('SELECT * FROM play_notes WHERE game_id = ?', [gameId]).map(toNote)
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

  private saveTagsNoFlush(tags: Omit<TagDef, 'id'>[]) {
    this.db.run('DELETE FROM tags')
    tags.forEach((t, i) => this.db.run('INSERT INTO tags (grp, label, kind, sort) VALUES (?, ?, ?, ?)', [t.group, t.label, t.kind, i]))
  }

  saveTags(tags: Omit<TagDef, 'id'>[]): TagDef[] {
    this.transaction(() => this.saveTagsNoFlush(tags))
    return this.tags()
  }

  chartFields(): ChartField[] {
    return this.all<{ id: number; name: string; options: string }>('SELECT * FROM chart_fields ORDER BY sort, id').map((r) => ({
      id: r.id,
      name: r.name,
      options: JSON.parse(r.options)
    }))
  }

  saveChartFields(fields: Omit<ChartField, 'id'>[]): ChartField[] {
    this.transaction(() => {
      this.db.run('DELETE FROM chart_fields')
      fields.forEach((f, i) =>
        this.db.run('INSERT INTO chart_fields (name, options, sort) VALUES (?, ?, ?)', [f.name, JSON.stringify(f.options), i])
      )
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

function toClip(r: Record<string, SqlValue>): Clip {
  return {
    id: r.id as number,
    gameId: r.game_id as string,
    path: r.path as string,
    fileName: r.file_name as string,
    angle: r.angle as Angle,
    sortIndex: r.sort_index as number,
    playId: (r.play_id as number | null) ?? null
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
    note: (r.note as string) ?? ''
  }
}

function toNote(r: Record<string, SqlValue>): PlayNote {
  return {
    gameId: r.game_id as string,
    playId: r.play_id as number,
    note: (r.note as string) ?? '',
    chart: JSON.parse((r.chart as string) || '{}'),
    drawing: JSON.parse((r.drawing as string) || '{}'),
    flagged: !!r.flagged
  }
}

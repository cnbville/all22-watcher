import { useCallback, useEffect, useRef, useState } from 'react'
import type { Clip, GameFilm, GradeEntry, PlayNote } from '@shared/types'
import { api } from '../../api'
import { errorBanner } from '../../shell/Banners'
import { applyEntryChange, entryKey } from './grading'
import type { UndoStack, UndoTarget } from './undo'

/**
 * The tape room's editable data (02 §7.6, §10, §11.11): grade entries, play notes (flag, note, chart, drawings) and
 * clip snap points. Every change is optimistic: state updates at once, the save runs in the background, and a failed
 * save rolls back and shows an error banner with Try Again. Changes that undo push one entry on the room's stack.
 */

export type NoteKind = 'note' | 'drawing' | 'flag' | 'chart'

const NOTE_ERROR: Record<NoteKind, string> = {
  note: 'Couldn’t save the note',
  drawing: 'Couldn’t save the drawing',
  flag: 'Couldn’t save the note',
  chart: 'Couldn’t save the note'
}

export function emptyNote(gameId: string, playId: number): PlayNote {
  return { gameId, playId, note: '', chart: {}, drawing: {}, flagged: false }
}

export interface TapeData {
  clips: Clip[]
  grades: Map<string, GradeEntry>
  notes: Map<number, PlayNote>
  /** Bumps on every change, for memo keys. */
  version: number
  entryOf(playId: number, playerId: string): GradeEntry | undefined
  noteOf(playId: number): PlayNote
  /** Writes entries (with one undo entry when `label` is given). */
  changeEntries(next: GradeEntry[], opts?: { label?: string; target?: UndoTarget }): void
  /** Applies `patch` to a play's note now; `inverse` (from the note before) undoes it. */
  changeNote(
    playId: number,
    patch: (n: PlayNote) => PlayNote,
    opts: { kind: NoteKind; label?: string; target?: UndoTarget; inverse?: (n: PlayNote) => PlayNote; debounce?: boolean }
  ): void
  /** Saves pending drawing changes now (play or angle change, leaving). */
  flushNotes(): void
  setSnap(clipId: number, snapMs: number | null, opts?: { label?: string; target?: UndoTarget; mergeKey?: string }): void
  /** True while a `film` data event is the room's own snap save (so it doesn't reload itself). */
  consumeOwnFilmEvent(): boolean
}

export function useTapeData(film: GameFilm, undo: UndoStack, reveal: (t: UndoTarget) => void): TapeData {
  const gameId = film.game.gameId
  const grades = useRef(new Map<string, GradeEntry>())
  const notes = useRef(new Map<number, PlayNote>())
  const saved = useRef(new Map<number, PlayNote>())
  const [clips, setClips] = useState<Clip[]>(film.clips)
  const clipsRef = useRef(film.clips)
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])
  const pending = useRef(new Map<number, { kind: NoteKind; timer: ReturnType<typeof setTimeout> | null }>())
  const ownFilmEvents = useRef(0)
  const revealRef = useRef(reveal)
  revealRef.current = reveal

  // A reloaded film replaces everything (the database has every saved change).
  const loaded = useRef<GameFilm | null>(null)
  if (loaded.current !== film) {
    loaded.current = film
    grades.current = new Map(film.grades.map((g) => [entryKey(g.playId, g.playerId), g]))
    notes.current = new Map(film.notes.map((n) => [n.playId, n]))
    saved.current = new Map(notes.current)
    clipsRef.current = film.clips
  }
  useEffect(() => setClips(film.clips), [film])

  const entryOf = useCallback((playId: number, playerId: string) => grades.current.get(entryKey(playId, playerId)), [])
  const noteOf = useCallback((playId: number) => notes.current.get(playId) ?? emptyNote(gameId, playId), [gameId])

  const writeEntries = useCallback(
    (list: GradeEntry[]) => {
      for (const e of list) {
        const k = entryKey(e.playId, e.playerId)
        const before = grades.current.get(k)
        grades.current.set(k, e)
        api.saveGrade(e).catch((err) => {
          if (grades.current.get(k) === e) {
            if (before) grades.current.set(k, before)
            else grades.current.delete(k)
            bump()
          }
          errorBanner('Couldn’t save the grade', err, () => writeEntries([e]))
        })
      }
      bump()
    },
    [bump]
  )

  const changeEntries = useCallback(
    (next: GradeEntry[], opts: { label?: string; target?: UndoTarget } = {}) => {
      const prev = next.map(
        (e) => grades.current.get(entryKey(e.playId, e.playerId)) ?? { ...e, grade: null, tags: [], note: '', critical: false, offField: false }
      )
      writeEntries(next)
      if (opts.label) {
        const target = opts.target
        // Only the fields this change touched go back and forth; a note typed since stays.
        const apply = (from: GradeEntry[], to: GradeEntry[]) =>
          writeEntries(to.map((e, i) => applyEntryChange(grades.current.get(entryKey(e.playId, e.playerId)) ?? from[i], from[i], e)))
        undo.push({
          label: opts.label,
          target,
          undo: () => {
            if (target) revealRef.current(target)
            apply(next, prev)
          },
          redo: () => {
            if (target) revealRef.current(target)
            apply(prev, next)
          }
        })
      }
    },
    [undo, writeEntries]
  )

  const saveNote = useCallback(
    (playId: number, kind: NoteKind) => {
      const n = notes.current.get(playId)
      if (!n) return
      pending.current.delete(playId)
      api.savePlayNote(n).then(
        () => {
          saved.current.set(playId, n)
        },
        (err) => {
          // Roll back to what the database has, unless something newer was typed since.
          if (notes.current.get(playId) === n) {
            const last = saved.current.get(playId)
            if (last) notes.current.set(playId, last)
            else notes.current.delete(playId)
            bump()
          }
          errorBanner(NOTE_ERROR[kind], err, () => {
            notes.current.set(playId, n)
            bump()
            saveNote(playId, kind)
          })
        }
      )
    },
    [bump]
  )

  const writeNote = useCallback(
    (playId: number, patch: (n: PlayNote) => PlayNote, kind: NoteKind, debounce: boolean) => {
      const next = patch(notes.current.get(playId) ?? emptyNote(gameId, playId))
      notes.current.set(playId, next)
      bump()
      const p = pending.current.get(playId)
      if (p?.timer) clearTimeout(p.timer)
      if (debounce) {
        pending.current.set(playId, { kind, timer: setTimeout(() => saveNote(playId, kind), 300) })
      } else saveNote(playId, kind)
    },
    [bump, gameId, saveNote]
  )

  const changeNote = useCallback<TapeData['changeNote']>(
    (playId, patch, opts) => {
      writeNote(playId, patch, opts.kind, !!opts.debounce)
      if (opts.label && opts.inverse) {
        const inverse = opts.inverse
        const target = opts.target
        undo.push({
          label: opts.label,
          target,
          undo: () => {
            if (target) revealRef.current(target)
            writeNote(playId, inverse, opts.kind, false)
          },
          redo: () => {
            if (target) revealRef.current(target)
            writeNote(playId, patch, opts.kind, false)
          }
        })
      }
    },
    [undo, writeNote]
  )

  const flushNotes = useCallback(() => {
    for (const [playId, p] of [...pending.current]) {
      if (p.timer) clearTimeout(p.timer)
      saveNote(playId, p.kind)
    }
  }, [saveNote])
  useEffect(() => () => flushNotes(), [flushNotes])

  const writeSnap = useCallback(
    (clipId: number, snapMs: number | null) => {
      const before = clipsRef.current.find((c) => c.id === clipId)
      if (!before) return
      const nextClips = clipsRef.current.map((c) => (c.id === clipId ? { ...c, snapMs } : c))
      clipsRef.current = nextClips
      setClips(nextClips)
      ownFilmEvents.current++
      api.setClipSnap(clipId, snapMs).catch((err) => {
        ownFilmEvents.current = Math.max(0, ownFilmEvents.current - 1)
        const now = clipsRef.current.find((c) => c.id === clipId)
        if (now?.snapMs === snapMs) {
          clipsRef.current = clipsRef.current.map((c) => (c.id === clipId ? { ...c, snapMs: before.snapMs } : c))
          setClips(clipsRef.current)
        }
        errorBanner('Couldn’t save the snap point', err, () => writeSnap(clipId, snapMs))
      })
    },
    []
  )

  const setSnap = useCallback<TapeData['setSnap']>(
    (clipId, snapMs, opts = {}) => {
      const prev = clipsRef.current.find((c) => c.id === clipId)?.snapMs ?? null
      if (prev === snapMs) return
      writeSnap(clipId, snapMs)
      if (opts.label) {
        const target = opts.target
        undo.push({
          label: opts.label,
          target,
          mergeKey: opts.mergeKey,
          undo: () => {
            if (target) revealRef.current(target)
            writeSnap(clipId, prev)
          },
          redo: () => {
            if (target) revealRef.current(target)
            writeSnap(clipId, snapMs)
          }
        })
      }
    },
    [undo, writeSnap]
  )

  const consumeOwnFilmEvent = useCallback(() => {
    if (ownFilmEvents.current <= 0) return false
    ownFilmEvents.current--
    return true
  }, [])

  return {
    clips,
    grades: grades.current,
    notes: notes.current,
    version,
    entryOf,
    noteOf,
    changeEntries,
    changeNote,
    flushNotes,
    setSnap,
    consumeOwnFilmEvent
  }
}

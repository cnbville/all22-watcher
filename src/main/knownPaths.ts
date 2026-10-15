import { isAbsolute, normalize } from 'node:path'

export interface KnownPathSources {
  /** Whether a clip in the library has this exact path. */
  isClip(path: string): boolean
  /** Folders the app shows on its own (the watch folder, the data folder). */
  folders(): (string | null | undefined)[]
}

/**
 * The files and folders a window may ask main to reveal or open. Paths come from the renderer, so they are checked
 * against what the app itself knows about (its clips, the files it saved, its folders) instead of being trusted:
 * `shell.openPath` on an arbitrary path would launch it.
 */
export class KnownPaths {
  private saved = new Set<string>()

  constructor(private sources: KnownPathSources) {}

  /** A file the app just wrote where the user chose (an export, a CSV, a PDF). */
  remember(path: string | null | undefined) {
    if (typeof path === 'string' && isAbsolute(path)) this.saved.add(normalize(path))
  }

  /** Files the app saved this session: the only ones a window may open. */
  canOpen(path: unknown): path is string {
    return typeof path === 'string' && isAbsolute(path) && this.saved.has(normalize(path))
  }

  /** Anything the app knows about may be shown in Finder. */
  canReveal(path: unknown): path is string {
    if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) return false
    const p = normalize(path)
    if (this.saved.has(p)) return true
    if (this.sources.folders().some((f) => !!f && normalize(f) === p)) return true
    return this.sources.isClip(path) || (p !== path && this.sources.isClip(p))
  }
}

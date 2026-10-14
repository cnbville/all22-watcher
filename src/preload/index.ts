import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from '@shared/api'
import type { DataProgress } from '@shared/types'

const METHODS = [
  'seasons', 'downloadSeason', 'teamSummaries', 'teamOverview', 'gameFilm', 'openedFilm', 'recentFilm', 'pickClips', 'previewMatch',
  'importClips', 'canConvert', 'convertClips', 'relinkClip', 'removeFilm', 'revealClip', 'saveGrade', 'savePlayNote', 'playerProfile',
  'tags', 'saveTags', 'chartFields', 'saveChartFields', 'settings', 'saveSettings', 'exportGradesCsv',
  'exportPlayerReport', 'dataFolder', 'openDataFolder'
] as const satisfies readonly Exclude<keyof Api, 'onDataProgress' | 'onConvertProgress'>[]

const api = Object.fromEntries(
  METHODS.map((m) => [m, (...args: unknown[]) => ipcRenderer.invoke('api', m, ...args)])
) as Omit<Api, 'onDataProgress' | 'onConvertProgress'>

const full: Api = {
  ...api,
  onDataProgress(cb) {
    const listener = (_e: unknown, p: DataProgress) => cb(p)
    ipcRenderer.on('data-progress', listener)
    return () => ipcRenderer.removeListener('data-progress', listener)
  },
  onConvertProgress(cb) {
    const listener = (_e: unknown, p: { done: number; total: number }) => cb(p)
    ipcRenderer.on('convert-progress', listener)
    return () => ipcRenderer.removeListener('convert-progress', listener)
  }
}

contextBridge.exposeInMainWorld('api', full)

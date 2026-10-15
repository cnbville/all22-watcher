import type { ApiEvent, DataKind } from '@shared/api'
import type {
  Activity,
  Cutup,
  CutupKind,
  CutupSummary,
  DataStatus,
  ImportLogEntry,
  PlayRef,
  SearchIndex,
  SeasonStatus,
  SidebarBadges,
  WatchStatus
} from '@shared/types'
import { api, rawApi } from '../api'

/**
 * Thin wrappers kept for the call sites written before the data layer was merged (03 §2.2.2, §9.2; 01 §1.2, §6.24).
 * Every API they wrapped now exists, so each one calls `window.api` directly; new code should use `api` itself.
 * Writes go through the `api` wrapper so they still emit data events.
 */

export type { ApiEvent, CutupKind, CutupSummary, DataKind, DataStatus, ImportLogEntry, SearchIndex, SeasonStatus, SidebarBadges, WatchStatus }

/** Every bridge method is present now; kept for older call sites. */
export const has = (name: string) => typeof (rawApi as unknown as Record<string, unknown>)[name] === 'function'

export const dataStatus = (season: number): Promise<DataStatus> => rawApi.dataStatus(season)
export const updateSeasonNow = async (season: number): Promise<void> => {
  await rawApi.updateSeasonNow(season)
}
export const watchStatus = (): Promise<WatchStatus | null> => rawApi.watchStatus()
export const checkWatchFolder = async (): Promise<void> => {
  await rawApi.checkWatchFolder()
}
/** `myTeams` is no longer needed (main reads the setting); kept for older call sites. */
export const sidebarBadges = (season: number, _myTeams?: string[]): Promise<SidebarBadges> => rawApi.sidebarBadges(season)

export const cutups = (): Promise<CutupSummary[]> => rawApi.cutups()
export const cutupsAvailable = () => true
export const createCutup = (input: { name?: string; kind: CutupKind }): Promise<Cutup> => api.createCutup(input)
export const updateCutup = async (id: string, patch: { name?: string }): Promise<void> => {
  await api.updateCutup(id, patch)
}
export const deleteCutup = (id: string): Promise<void> => api.deleteCutup(id)
export const duplicateCutup = (id: string, asManual?: boolean): Promise<Cutup> => api.duplicateCutup(id, asManual)
export const addToCutup = (id: string, plays: PlayRef[]): Promise<{ added: number; already: number }> => api.addToCutup(id, plays)
export const reorderCutups = (ids: string[]): Promise<void> => api.reorderCutups(ids)

export const activities = (): Promise<Activity[]> => rawApi.activities()
export const cancelActivity = (id: string): Promise<void> => rawApi.cancelActivity(id)
export const onApiEvent = (cb: (e: ApiEvent) => void): (() => void) => rawApi.onApiEvent(cb)
export const apiEventsAvailable = () => true

/** `myTeams` is no longer needed (main builds the whole index); kept for older call sites. */
export const searchIndex = (season: number, _myTeams?: string[]): Promise<SearchIndex> => rawApi.searchIndex(season)

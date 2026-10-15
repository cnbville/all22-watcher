import { contextBridge, ipcRenderer } from 'electron'
import { API_EVENT_CHANNEL, API_METHODS, type Api, type ApiEvent, type ApiMethod } from '@shared/api'
import type { DataProgress } from '@shared/types'

const api = Object.fromEntries(
  API_METHODS.map((m) => [m, (...args: unknown[]) => ipcRenderer.invoke('api', m, ...args)])
) as unknown as Pick<Api, ApiMethod>

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
  },
  onApiEvent(cb) {
    const listener = (_e: unknown, event: ApiEvent) => cb(event)
    ipcRenderer.on(API_EVENT_CHANNEL, listener)
    return () => ipcRenderer.removeListener(API_EVENT_CHANNEL, listener)
  }
}

contextBridge.exposeInMainWorld('api', full)

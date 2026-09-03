import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  PlayerPosition,
  QuestLogEvent,
  RaidEvent,
  WindowMode
} from '../shared/types'

export interface Api {
  getSettings: () => Promise<AppSettings>
  saveSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>
  getWindowState: () => Promise<{ mode: WindowMode; clickThrough: boolean }>
  setWindowMode: (mode: WindowMode) => Promise<void>
  setClickThrough: (enabled: boolean) => Promise<void>
  onPlayerPosition: (cb: (pos: PlayerPosition) => void) => void
  onRaidEvent: (cb: (event: RaidEvent) => void) => void
  onClickThroughChanged: (cb: (enabled: boolean) => void) => void
  onLogWatcherStatus: (cb: (status: string) => void) => void
  onQuestEvents: (cb: (events: QuestLogEvent[]) => void) => void
  /** Full backfill from the archive + live logs. */
  syncQuests: () => Promise<QuestLogEvent[]>
  /** URL for a file bundled under data/ (served by the appdata:// protocol). */
  dataUrl: (relPath: string) => string
}

const api: Api = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  getWindowState: () => ipcRenderer.invoke('window:get-state'),
  setWindowMode: (mode) => ipcRenderer.invoke('window:set-mode', mode),
  setClickThrough: (enabled) => ipcRenderer.invoke('overlay:set-clickthrough', enabled),
  onPlayerPosition: (cb) => ipcRenderer.on('player-position', (_e, pos) => cb(pos)),
  onRaidEvent: (cb) => ipcRenderer.on('raid-event', (_e, event) => cb(event)),
  onClickThroughChanged: (cb) => ipcRenderer.on('click-through-changed', (_e, v) => cb(v)),
  onLogWatcherStatus: (cb) => ipcRenderer.on('log-watcher-status', (_e, s) => cb(s)),
  onQuestEvents: (cb) => ipcRenderer.on('quest-events', (_e, events) => cb(events)),
  syncQuests: () => ipcRenderer.invoke('quests:sync'),
  dataUrl: (relPath) => `appdata://data/${relPath.replace(/^\/+/, '')}`
}

contextBridge.exposeInMainWorld('api', api)

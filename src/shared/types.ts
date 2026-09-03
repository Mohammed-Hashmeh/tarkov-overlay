// Shared between main and renderer (via preload IPC payloads).

export interface PlayerPosition {
  x: number
  y: number // height (Unity Y)
  z: number
  /** Yaw in degrees, 0 = north (game +Z), clockwise. */
  yaw: number
  timestamp: number
}

export interface RaidEvent {
  /** tarkov.dev map normalizedName, e.g. "customs" */
  map: string | null
  /** raw scene bundle path from the log line */
  scenePath: string
  kind: 'map-loading' | 'raid-ended'
}

export type QuestLogStatus = 'started' | 'failed' | 'finished'

export interface QuestLogEvent {
  questId: string
  status: QuestLogStatus
  /** Unix seconds from the log's message.dt — orders events across sessions. */
  timestamp: number
  /** Stable id used to avoid re-applying the same event. */
  eventId: string
}

export interface MiniBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface AppSettings {
  screenshotsPath: string
  logsPath: string
  deleteScreenshots: boolean
  hotkeyToggleOverlay: string
  hotkeyToggleClickThrough: string
  hotkeyToggleMini: string
  windowMode: 'normal' | 'overlay' | 'mini'
  miniBounds: MiniBounds | null
  /** Apply quest start/finish events from the game log as they happen. */
  autoSyncQuests: boolean
  /** Mirror game logs into userData so quest history survives log cleanup. */
  archiveLogs: boolean
}

export type WindowMode = 'normal' | 'overlay' | 'mini'

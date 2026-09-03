import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { QuestLogEvent, RaidEvent } from '../shared/types'
import { dedupeQuestEvents, parseQuestEvents } from './questLogParser'
import { archiveRoot, archiveSessionLogs, sessionDirs } from './logArchive'
import { extractScenePath } from './sceneParser'

export { extractScenePath } from './sceneParser'

const REGISTRY_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EscapeFromTarkov',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EscapeFromTarkov'
]

function queryRegistry(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', 'InstallLocation'], (err, stdout) => {
      if (err) return resolve(null)
      const m = /InstallLocation\s+REG_SZ\s+(.+)/.exec(stdout)
      resolve(m ? m[1].trim() : null)
    })
  })
}

export async function findLogsFolder(configuredPath: string): Promise<string | null> {
  if (configuredPath) {
    return fs.existsSync(configuredPath) ? configuredPath : null
  }
  for (const key of REGISTRY_KEYS) {
    const install = await queryRegistry(key)
    if (install) {
      const logs = path.join(install, 'Logs')
      if (fs.existsSync(logs)) return logs
    }
  }
  return null
}

function newestSessionDir(logsPath: string): string | null {
  let newest: { p: string; t: number } | null = null
  for (const entry of fs.readdirSync(logsPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const p = path.join(logsPath, entry.name)
    const t = fs.statSync(p).mtimeMs
    if (!newest || t > newest.t) newest = { p, t }
  }
  return newest?.p ?? null
}

function findLogInDir(dir: string, match: (file: string) => boolean): string | null {
  for (const file of fs.readdirSync(dir)) {
    if (match(file)) return path.join(dir, file)
  }
  return null
}

/** Newest session folder inside Logs/, then its application log file. */
function findCurrentApplicationLog(logsPath: string): string | null {
  const dir = newestSessionDir(logsPath)
  if (!dir) return null
  return findLogInDir(dir, (f) => f.includes('application') && f.endsWith('.log'))
}

// EFT names this file "push-notifications_000.log" in current versions;
// older/other builds use "notifications_000.log".
const NOTIFICATION_RE = /notifications.*\.log$/i

function findCurrentNotificationLog(logsPath: string): string | null {
  const dir = newestSessionDir(logsPath)
  if (!dir) return null
  return findLogInDir(dir, (f) => NOTIFICATION_RE.test(f))
}

/**
 * All quest events ever recorded: every session folder in the archive plus the
 * live logs folder, deduped and ordered. Used for the one-shot backfill.
 */
export async function collectAllQuestEvents(configuredLogsPath: string): Promise<QuestLogEvent[]> {
  const roots = [archiveRoot()]
  const live = await findLogsFolder(configuredLogsPath)
  if (live) roots.push(live)
  const events: QuestLogEvent[] = []
  for (const root of roots) {
    for (const dir of sessionDirs(root)) {
      let file: string | null = null
      try {
        file = findLogInDir(dir, (f) => NOTIFICATION_RE.test(f))
      } catch {
        continue
      }
      if (!file) continue
      try {
        events.push(...parseQuestEvents(fs.readFileSync(file, 'utf-8')))
      } catch (err) {
        console.error(`Failed reading ${file}:`, err)
      }
    }
  }
  return dedupeQuestEvents(events)
}

export interface LogWatcherOptions {
  getLogsPath: () => string // '' = auto-detect
  onRaidEvent: (event: RaidEvent) => void
  onStatus: (status: string) => void
  onQuestEvents: (events: QuestLogEvent[]) => void
  shouldSyncQuests: () => boolean
  shouldArchive: () => boolean
}

let timer: ReturnType<typeof setInterval> | null = null
let currentFile: string | null = null
let offset = 0
let pending = ''
// Notification logs are small (tens of KB), so each poll re-parses the whole
// file and filters by event id. Chunked reads would split the multi-line JSON
// blocks the quest events live in.
let seenQuestEvents = new Set<string>()

function processChunk(chunk: string, opts: LogWatcherOptions, emitOnlyLast: boolean): void {
  pending += chunk
  const lines = pending.split('\n')
  pending = lines.pop() ?? ''
  let lastScene: string | null = null
  for (const line of lines) {
    const scenePath = extractScenePath(line)
    if (!scenePath) continue
    if (emitOnlyLast) {
      lastScene = scenePath
    } else {
      opts.onRaidEvent({ map: null, scenePath, kind: 'map-loading' })
    }
  }
  if (emitOnlyLast && lastScene) {
    opts.onRaidEvent({ map: null, scenePath: lastScene, kind: 'map-loading' })
  }
}

function pollQuestEvents(logsPath: string, opts: LogWatcherOptions): void {
  if (!opts.shouldSyncQuests()) return
  const file = findCurrentNotificationLog(logsPath)
  if (!file) return
  const events = parseQuestEvents(fs.readFileSync(file, 'utf-8'))
  const fresh = events.filter((e) => !seenQuestEvents.has(e.eventId))
  for (const e of fresh) seenQuestEvents.add(e.eventId)
  if (fresh.length) opts.onQuestEvents(fresh)
}

/**
 * Suppress live emission for events already applied (e.g. by the startup
 * backfill), so the same quest change isn't reported twice.
 */
export function markQuestEventsSeen(events: QuestLogEvent[]): void {
  for (const e of events) seenQuestEvents.add(e.eventId)
}

export function startLogWatcher(opts: LogWatcherOptions): void {
  stopLogWatcher()
  let logsPath: string | null = null
  let resolving = false

  const tick = async (): Promise<void> => {
    if (!logsPath) {
      if (resolving) return
      resolving = true
      logsPath = await findLogsFolder(opts.getLogsPath())
      resolving = false
      if (!logsPath) {
        opts.onStatus('logs-not-found')
        return
      }
      opts.onStatus('watching-logs')
    }
    try {
      if (opts.shouldArchive()) archiveSessionLogs(logsPath)
      pollQuestEvents(logsPath, opts)
    } catch (err) {
      console.error('Quest log poll error:', err)
    }
    try {
      const file = findCurrentApplicationLog(logsPath)
      if (!file) return
      if (file !== currentFile) {
        // New game session: read it from the start so we pick up the current
        // raid's map even if the app launched mid-raid (emit only the latest).
        currentFile = file
        offset = 0
        pending = ''
        const content = fs.readFileSync(file, 'utf-8')
        offset = Buffer.byteLength(content, 'utf-8')
        processChunk(content, opts, true)
        return
      }
      const size = fs.statSync(file).size
      if (size < offset) {
        offset = 0 // truncated/rotated
        pending = ''
      }
      if (size > offset) {
        const fd = fs.openSync(file, 'r')
        try {
          const buf = Buffer.alloc(size - offset)
          fs.readSync(fd, buf, 0, buf.length, offset)
          offset = size
          processChunk(buf.toString('utf-8'), opts, false)
        } finally {
          fs.closeSync(fd)
        }
      }
    } catch (err) {
      console.error('Log watcher error:', err)
    }
  }

  timer = setInterval(tick, 2000)
  void tick()
}

export function stopLogWatcher(): void {
  if (timer) clearInterval(timer)
  timer = null
  currentFile = null
  offset = 0
  pending = ''
  seenQuestEvents = new Set()
}

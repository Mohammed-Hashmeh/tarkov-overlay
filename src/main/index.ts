import { app, ipcMain, globalShortcut, protocol, net, session, shell } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadSettings, saveSettings } from './settings'
import {
  createWindow,
  getWindow,
  getMode,
  isClickThrough,
  toggleVisibility,
  toggleClickThrough,
  setClickThrough,
  setMiniBoundsListener,
  miniToggleTarget
} from './windows'
import { startScreenshotWatcher } from './screenshotWatcher'
import { startLogWatcher, collectAllQuestEvents, markQuestEventsSeen } from './logWatcher'
import type { AppSettings, WindowMode } from '../shared/types'

// Bundled map data lives in <project>/data (dev) or resources/data (packaged).
function dataRoot(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'data')
  return path.join(app.getAppPath(), 'data')
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'appdata',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
  }
])

function sendToRenderer(channel: string, payload: unknown): void {
  getWindow()?.webContents.send(channel, payload)
}

/**
 * The app is offline by design: all map data is bundled and read through the
 * appdata:// protocol. This cancels every http/https/ws request at the session
 * level so that stays true even if a future change (or a dependency) tries to
 * reach the network. In dev the Vite server and its HMR socket run on
 * localhost and are the only exception.
 */
function enforceOfflineOperation(): void {
  const filter = { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }
  const localhost = /^(https?|wss?):\/\/(localhost|127\.0\.0\.1)([:/]|$)/
  session.defaultSession.webRequest.onBeforeRequest(filter, (details, callback) => {
    if (!app.isPackaged && localhost.test(details.url)) {
      callback({ cancel: false })
      return
    }
    console.warn(`[network] blocked outbound request: ${details.url}`)
    callback({ cancel: true })
  })
}

function registerHotkeys(settings: AppSettings): void {
  globalShortcut.unregisterAll()
  try {
    globalShortcut.register(settings.hotkeyToggleOverlay, () => toggleVisibility())
  } catch (err) {
    console.error('Failed to register overlay hotkey:', err)
  }
  try {
    globalShortcut.register(settings.hotkeyToggleClickThrough, () => toggleClickThrough())
  } catch (err) {
    console.error('Failed to register click-through hotkey:', err)
  }
  try {
    globalShortcut.register(settings.hotkeyToggleMini, () => switchMode(miniToggleTarget()))
  } catch (err) {
    console.error('Failed to register mini hotkey:', err)
  }
}

function switchMode(mode: WindowMode): void {
  saveSettings({ windowMode: mode })
  createWindow(mode, loadSettings().miniBounds)
}

function startWatchers(): void {
  startScreenshotWatcher({
    screenshotsPath: loadSettings().screenshotsPath,
    deleteScreenshots: () => loadSettings().deleteScreenshots,
    onPosition: (pos) => sendToRenderer('player-position', pos)
  })
  startLogWatcher({
    getLogsPath: () => loadSettings().logsPath,
    onRaidEvent: (event) => sendToRenderer('raid-event', event),
    onStatus: (status) => sendToRenderer('log-watcher-status', status),
    onQuestEvents: (events) => sendToRenderer('quest-events', events),
    shouldSyncQuests: () => loadSettings().autoSyncQuests,
    shouldArchive: () => loadSettings().archiveLogs
  })
}

app.whenReady().then(() => {
  // Ties the running window to the pinned taskbar shortcut; without a matching
  // AppUserModelID Windows treats them as two separate taskbar entries.
  app.setAppUserModelId('com.tarkov-overlay.app')
  enforceOfflineOperation()
  protocol.handle('appdata', (request) => {
    const url = new URL(request.url)
    // appdata://data/<relative path under the data dir>
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const root = dataRoot()
    const target = path.normalize(path.join(root, rel))
    // path.relative (not startsWith) so a sibling like "<root>x" can't match
    // the prefix and escape the data directory.
    const inside = path.relative(root, target)
    if (inside.startsWith('..') || path.isAbsolute(inside)) {
      return new Response('forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(target).toString())
  })

  const settings = loadSettings()

  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:save', (_e, patch: Partial<AppSettings>) => {
    const before = loadSettings()
    const merged = saveSettings(patch)
    registerHotkeys(merged)
    if (
      merged.screenshotsPath !== before.screenshotsPath ||
      merged.logsPath !== before.logsPath
    ) {
      startWatchers()
    }
    return merged
  })
  ipcMain.handle('window:get-state', () => ({ mode: getMode(), clickThrough: isClickThrough() }))
  ipcMain.handle('window:set-mode', (_e, mode: WindowMode) => switchMode(mode))
  ipcMain.handle('overlay:set-clickthrough', (_e, enabled: boolean) => setClickThrough(enabled))
  ipcMain.handle('quests:sync', async () => {
    const events = await collectAllQuestEvents(loadSettings().logsPath)
    // Don't re-emit these through the live tail.
    markQuestEventsSeen(events)
    return events
  })

  setMiniBoundsListener((b) => saveSettings({ miniBounds: b }))
  createWindow(settings.windowMode, settings.miniBounds)
  registerHotkeys(settings)
  startWatchers()
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

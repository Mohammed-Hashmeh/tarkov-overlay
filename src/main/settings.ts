import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { AppSettings } from '../shared/types'

const settingsFile = (): string => path.join(app.getPath('userData'), 'settings.json')

/**
 * The real Documents folder. This must come from the Windows known-folder API,
 * not homedir()/Documents: when Documents is redirected (OneDrive Backup, which
 * is on by default for many users) the game writes to the redirected location,
 * and a hardcoded path would watch an empty folder forever.
 */
function documentsDir(): string {
  try {
    return app.getPath('documents')
  } catch {
    return path.join(os.homedir(), 'Documents')
  }
}

export const defaultSettings = (): AppSettings => ({
  screenshotsPath: path.join(documentsDir(), 'Escape From Tarkov', 'Screenshots'),
  logsPath: '',
  deleteScreenshots: true,
  hotkeyToggleOverlay: 'F9',
  hotkeyToggleClickThrough: 'F10',
  hotkeyToggleMini: 'F8',
  windowMode: 'normal',
  miniBounds: null,
  autoSyncQuests: true,
  archiveLogs: true
})

let cached: AppSettings | null = null

export function loadSettings(): AppSettings {
  if (cached) return cached
  const defaults = defaultSettings()
  try {
    // strip a UTF-8 BOM in case the file was edited by hand
    const text = fs.readFileSync(settingsFile(), 'utf-8').replace(/^﻿/, '')
    cached = { ...defaults, ...JSON.parse(text) }
  } catch {
    cached = defaults
  }
  // Builds before the known-folder fix persisted homedir()/Documents, which is
  // the wrong place when Documents is redirected to OneDrive. Replace that
  // exact stale value — never a path the user chose themselves.
  const legacyPath = path.join(os.homedir(), 'Documents', 'Escape From Tarkov', 'Screenshots')
  if (cached!.screenshotsPath === legacyPath && defaults.screenshotsPath !== legacyPath) {
    cached!.screenshotsPath = defaults.screenshotsPath
  }
  return cached!
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const merged = { ...loadSettings(), ...patch }
  cached = merged
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
    fs.writeFileSync(settingsFile(), JSON.stringify(merged, null, 2))
  } catch (err) {
    console.error('Failed to save settings:', err)
  }
  return merged
}

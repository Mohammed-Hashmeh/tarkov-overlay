import { app, BrowserWindow, screen, shell } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { WindowMode } from '../shared/types'

let win: BrowserWindow | null = null
let mode: WindowMode = 'normal'
let clickThrough = false
// Where the F8 mini toggle returns to.
let lastFullMode: Exclude<WindowMode, 'mini'> = 'normal'
let onMiniBounds: ((b: { x: number; y: number; width: number; height: number }) => void) | null = null
let boundsTimer: ReturnType<typeof setTimeout> | null = null

export function setMiniBoundsListener(cb: typeof onMiniBounds): void {
  onMiniBounds = cb
}

export function miniToggleTarget(): WindowMode {
  return mode === 'mini' ? lastFullMode : 'mini'
}

export function getWindow(): BrowserWindow | null {
  return win
}

export function getMode(): WindowMode {
  return mode
}

export function isClickThrough(): boolean {
  return clickThrough
}

function loadContent(w: BrowserWindow): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    w.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    w.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// `transparent` cannot be changed on an existing BrowserWindow, so switching
// modes recreates the window. Renderer state (selected map, quest progress,
// layer toggles) lives in localStorage and survives the reload.
export function createWindow(
  newMode: WindowMode,
  miniBounds?: { x: number; y: number; width: number; height: number } | null
): BrowserWindow {
  mode = newMode
  if (newMode !== 'mini') lastFullMode = newMode
  clickThrough = false
  if (boundsTimer) clearTimeout(boundsTimer)
  // The old window is destroyed only AFTER the new one exists — a gap with
  // zero windows would fire 'window-all-closed' and quit the app.
  const old = win
  win = null

  // Shipped via build.files, so this resolves in dev and inside the asar
  // alike. Without it the window wears Electron's default icon and mismatches
  // the taskbar shortcut.
  const iconPath = path.join(app.getAppPath(), 'build', 'icon.ico')

  const common = {
    show: false,
    autoHideMenuBar: true,
    ...(existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      // sandbox off so the preload can use Node; the renderer itself gets no
      // Node access and is isolated from the preload's context.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      webSecurity: true
    }
  }

  if (newMode === 'overlay') {
    const display = screen.getPrimaryDisplay()
    win = new BrowserWindow({
      ...common,
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      hasShadow: false
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  } else if (newMode === 'mini') {
    // Opaque (transparent frameless windows can't be natively resized on
    // Windows), small, draggable via the renderer's drag strip.
    const area = screen.getPrimaryDisplay().workArea
    const size = 460
    const b = miniBounds ?? {
      width: size,
      height: size,
      x: area.x + area.width - size - 16,
      y: area.y + area.height - size - 16
    }
    win = new BrowserWindow({
      ...common,
      ...b,
      frame: false,
      resizable: true,
      skipTaskbar: true,
      minWidth: 220,
      minHeight: 220,
      backgroundColor: '#14161a'
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    const reportBounds = (): void => {
      if (boundsTimer) clearTimeout(boundsTimer)
      boundsTimer = setTimeout(() => {
        if (win && !win.isDestroyed() && mode === 'mini') onMiniBounds?.(win.getBounds())
      }, 500)
    }
    win.on('moved', reportBounds)
    win.on('resized', reportBounds)
  } else {
    win = new BrowserWindow({
      ...common,
      width: 1280,
      height: 800,
      minWidth: 700,
      minHeight: 500
    })
  }

  win.once('ready-to-show', () => win?.show())
  if (!app.isPackaged) {
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) console.log(`[renderer:${level}] ${message}`)
    })
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Only ever hand https links to the browser — never file://, custom
    // protocol handlers, or anything else that could execute locally.
    if (/^https:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  // The renderer only ever loads its own bundled page.
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  loadContent(win)
  old?.destroy()
  return win
}

export function toggleVisibility(): void {
  if (!win) return
  if (win.isVisible()) {
    win.hide()
  } else {
    win.show()
    if (mode !== 'normal') win.setAlwaysOnTop(true, 'screen-saver')
  }
}

/** In click-through mode the overlay/minimap ignores the mouse so the game gets it. */
export function setClickThrough(enabled: boolean): void {
  if (!win || mode === 'normal') return
  clickThrough = enabled
  win.setIgnoreMouseEvents(enabled, { forward: true })
  win.webContents.send('click-through-changed', enabled)
}

export function toggleClickThrough(): void {
  setClickThrough(!clickThrough)
}

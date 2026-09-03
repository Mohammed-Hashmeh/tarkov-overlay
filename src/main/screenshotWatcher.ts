import { watch, type FSWatcher } from 'chokidar'
import fs from 'node:fs'
import path from 'node:path'
import type { PlayerPosition } from '../shared/types'

// EFT screenshot filenames embed position + rotation, e.g.:
// 2024-01-01[12-34]_-107.42, 2.51, -110.91_0.0, -0.1, 0.0, -1.0_12.29 (0).png
// (same format TarkovMonitor parses)
const FILE_RE = /^\d{4}-\d{2}-\d{2}\[\d{2}-\d{2}\]_?(?<pos>.+) \(\d+\)\.png$/
const POS_RE =
  /(?<x>-?\d+\.\d+), (?<y>-?\d+\.\d+), (?<z>-?\d+\.\d+)_(?<rx>-?[\d.]+), (?<ry>-?[\d.]+), (?<rz>-?[\d.]+), (?<rw>-?[\d.]+)/

export function parseScreenshotName(filename: string): PlayerPosition | null {
  const fileMatch = FILE_RE.exec(filename)
  if (!fileMatch?.groups) return null
  const posMatch = POS_RE.exec(fileMatch.groups.pos)
  if (!posMatch?.groups) return null
  const g = posMatch.groups
  const [x, y, z] = [Number(g.x), Number(g.y), Number(g.z)]
  const [rx, ry, rz, rw] = [Number(g.rx), Number(g.ry), Number(g.rz), Number(g.rw)]
  if ([x, y, z, rx, ry, rz, rw].some(Number.isNaN)) return null
  // Unity quaternion -> yaw about the Y (up) axis, degrees clockwise from
  // north (+Z). Same formula as TarkovMonitor's QuarternionsToYaw (which it
  // calls with reordered args, so the denominator uses ry and rz).
  const yawRad = Math.atan2(2 * (rw * ry + rx * rz), 1 - 2 * (rz * rz + ry * ry))
  const yaw = ((yawRad * 180) / Math.PI + 360) % 360
  return { x, y, z, yaw, timestamp: Date.now() }
}

export interface ScreenshotWatcherOptions {
  screenshotsPath: string
  deleteScreenshots: () => boolean
  onPosition: (pos: PlayerPosition) => void
}

let watcher: FSWatcher | null = null

export function startScreenshotWatcher(opts: ScreenshotWatcherOptions): void {
  stopScreenshotWatcher()
  const dir = opts.screenshotsPath
  // Watch the parent too, so the watcher survives the folder not existing yet
  // (EFT creates it on the first screenshot).
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    // ignore; chokidar will just report an error for a bad path
  }
  watcher = watch(dir, {
    ignoreInitial: true,
    depth: 0,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
  })
  watcher.on('add', (filePath) => {
    const name = path.basename(filePath)
    if (!name.toLowerCase().endsWith('.png')) return
    const pos = parseScreenshotName(name)
    if (!pos) return
    opts.onPosition(pos)
    if (opts.deleteScreenshots()) {
      // The game may still be releasing the file handle; retry briefly.
      const tryDelete = (attempt: number): void => {
        fs.unlink(filePath, (err) => {
          if (err && attempt < 5) setTimeout(() => tryDelete(attempt + 1), 500)
        })
      }
      tryDelete(0)
    }
  })
  watcher.on('error', (err) => console.error('Screenshot watcher error:', err))
}

export function stopScreenshotWatcher(): void {
  watcher?.close()
  watcher = null
}

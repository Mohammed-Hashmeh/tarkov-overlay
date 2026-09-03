import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

// Mirrors EFT session logs into userData so quest history survives the game's
// Logs folder being cleaned or the game being reinstalled. Copies are local
// only — these files contain profile identifiers and never leave the machine.

const KEEP_RE = /(application|notifications).*\.log$/i

export function archiveRoot(): string {
  return path.join(app.getPath('userData'), 'log-archive')
}

/** Session directories inside a logs root. */
export function sessionDirs(root: string): string[] {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(root, e.name))
  } catch {
    return []
  }
}

/**
 * Copy application/notification logs from the live logs folder into the
 * archive. Idempotent: files already archived at the same size are skipped, so
 * this is cheap to call repeatedly. Never deletes anything.
 */
export function archiveSessionLogs(logsPath: string): { copied: number } {
  let copied = 0
  const root = archiveRoot()
  for (const dir of sessionDirs(logsPath)) {
    const destDir = path.join(root, path.basename(dir))
    let entries: string[]
    try {
      entries = fs.readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      if (!KEEP_RE.test(name)) continue
      const src = path.join(dir, name)
      const dest = path.join(destDir, name)
      try {
        const srcStat = fs.statSync(src)
        if (fs.existsSync(dest) && fs.statSync(dest).size === srcStat.size) continue
        fs.mkdirSync(destDir, { recursive: true })
        fs.copyFileSync(src, dest)
        copied++
      } catch (err) {
        // A locked or vanished file is not fatal — try again next pass.
        console.error(`Failed to archive ${src}:`, err)
      }
    }
  }
  return { copied }
}

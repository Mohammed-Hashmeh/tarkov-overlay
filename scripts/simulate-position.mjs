#!/usr/bin/env node
// Drops a fake EFT screenshot into the Screenshots folder so the app plots a
// position without the game running.
//
//   node scripts/simulate-position.mjs <x> <y> <z> [yawDegrees]
//   node scripts/simulate-position.mjs 180 2.5 175 90
//
// Optional: set SCREENSHOTS_DIR to override the default folder.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

const [x = '0', y = '0', z = '0', yawDeg = '0'] = process.argv.slice(2)

// Match the app: resolve the real Documents folder, which may be redirected to
// OneDrive, rather than assuming homedir()/Documents.
function documentsDir() {
  if (process.platform === 'win32') {
    try {
      const out = execFileSync(
        'reg',
        ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders', '/v', 'Personal'],
        { encoding: 'utf-8' }
      )
      const m = /Personal\s+REG_(?:EXPAND_)?SZ\s+(.+)/.exec(out)
      if (m) return m[1].trim()
    } catch {
      // fall through
    }
  }
  return path.join(os.homedir(), 'Documents')
}

const dir =
  process.env.SCREENSHOTS_DIR ?? path.join(documentsDir(), 'Escape From Tarkov', 'Screenshots')
fs.mkdirSync(dir, { recursive: true })

const fmt = (n) => Number(n).toFixed(2)
const yaw = (Number(yawDeg) * Math.PI) / 180
// yaw-only Unity quaternion: (0, sin(yaw/2), 0, cos(yaw/2))
const qy = Math.sin(yaw / 2)
const qw = Math.cos(yaw / 2)
const q = (n) => (Math.round(n * 10000) / 10000).toFixed(4)

const now = new Date()
const pad = (n) => String(n).padStart(2, '0')
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}[${pad(now.getHours())}-${pad(now.getMinutes())}]`

const name = `${stamp}_${fmt(x)}, ${fmt(y)}, ${fmt(z)}_0.0000, ${q(qy)}, 0.0000, ${q(qw)}_0.00 (0).png`
const file = path.join(dir, name)
fs.writeFileSync(file, Buffer.alloc(8)) // content is irrelevant; only the name matters
console.log(`wrote ${file}`)

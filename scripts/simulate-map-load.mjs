#!/usr/bin/env node
// Simulates EFT writing a "scene preset path" log line, so the app's auto map
// detection can be tested without the game.
//
//   node scripts/simulate-map-load.mjs customs
//   node scripts/simulate-map-load.mjs maps/factory_day_preset.bundle
//
// It appends to dev-logs/log_dev/dev application.log in the project folder.
// In the app: Settings -> "EFT Logs folder" -> point it at <project>/dev-logs.

import fs from 'node:fs'
import path from 'node:path'

const arg = process.argv[2]
if (!arg) {
  console.error('usage: node scripts/simulate-map-load.mjs <map normalizedName | maps/*.bundle>')
  process.exit(1)
}

let scenePath = arg
if (!arg.startsWith('maps/')) {
  // look the scene path up in the bundled data
  try {
    const data = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'data', 'maps.json'), 'utf-8'))
    const map = data.maps.find((m) => m.normalizedName === arg)
    if (!map || !map.scenePaths?.length) {
      console.error(`no scenePaths for "${arg}" in data/maps.json`)
      process.exit(1)
    }
    scenePath = map.scenePaths[0]
  } catch (err) {
    console.error(`could not read data/maps.json (${err.message}); pass a maps/*.bundle path directly`)
    process.exit(1)
  }
}

const dir = path.join(import.meta.dirname, '..', 'dev-logs', 'log_dev')
fs.mkdirSync(dir, { recursive: true })
const file = path.join(dir, 'dev application.log')
const stamp = new Date().toISOString().replace('T', ' ').slice(0, 23)
const line = `${stamp}|0.0.0.0|Info|application|scene preset path:${scenePath}\n`
fs.appendFileSync(file, line)
console.log(`appended to ${file}:\n  ${line.trim()}`)
console.log('If the app is not picking it up, set Settings -> EFT Logs folder to:')
console.log(`  ${path.resolve(path.join(import.meta.dirname, '..', 'dev-logs'))}`)

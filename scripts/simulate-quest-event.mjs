#!/usr/bin/env node
// Appends a fake quest status notification so quest sync can be tested without
// the game.
//
//   node scripts/simulate-quest-event.mjs <questId|questName> started|finished|failed
//   node scripts/simulate-quest-event.mjs "Debut" started
//
// Writes to dev-logs/log_dev/dev push-notifications.log. Point the app's
// Settings -> "EFT Logs folder" at <project>/dev-logs first.

import fs from 'node:fs'
import path from 'node:path'

const [target, status = 'started'] = process.argv.slice(2)
if (!target) {
  console.error('usage: node scripts/simulate-quest-event.mjs <questId|questName> [started|finished|failed]')
  process.exit(1)
}

const TYPES = { started: 10, failed: 11, finished: 12 }
const type = TYPES[status]
if (!type) {
  console.error(`unknown status "${status}" (use started, finished, or failed)`)
  process.exit(1)
}

const questsPath = path.join(import.meta.dirname, '..', 'data', 'quests.json')
const quests = JSON.parse(fs.readFileSync(questsPath, 'utf-8')).quests
const quest =
  quests.find((q) => q.id === target) ||
  quests.find((q) => q.name.toLowerCase() === target.toLowerCase())
if (!quest) {
  console.error(`no quest matching "${target}" in data/quests.json`)
  process.exit(1)
}

const dir = path.join(import.meta.dirname, '..', 'dev-logs', 'log_dev')
fs.mkdirSync(dir, { recursive: true })
const file = path.join(dir, 'dev push-notifications.log')

const dt = Math.floor(Date.now() / 1000)
const suffix = status === 'finished' ? 'successMessageText' : 'description'
const stamp = new Date().toISOString().replace('T', ' ').slice(0, 23)
// Matches the real log shape: message line, then a JSON block at column 0.
// Note the game writes text:"quest started" even for finished events.
const entry = `${stamp}|0.0.0.0|Info|push-notifications|Got notification | ChatMessageReceived
{
  "type": "new_message",
  "eventId": "${dt.toString(16)}sim${Math.floor(Math.random() * 1e6)}",
  "dialogId": "simulated",
  "message": {
    "_id": "sim-${dt}-${Math.floor(Math.random() * 1e6)}",
    "uid": "simulated",
    "type": ${type},
    "dt": ${dt},
    "text": "quest started",
    "templateId": "${quest.id} ${suffix}",
    "hasRewards": false,
    "maxStorageTime": 604800
  }
}
`
fs.appendFileSync(file, entry)
console.log(`${status}: ${quest.name} (${quest.id})`)
console.log(`appended to ${file}`)

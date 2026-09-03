import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseQuestEvents, dedupeQuestEvents } from '../src/main/questLogParser.ts'

// Shape mirrors a real EFT push-notifications_000.log; every id and timestamp
// below is synthetic.
const block = (id: string, type: number, dt: number, questId: string, suffix: string): string =>
  `2024-01-01 00:00:00.000|0.0.0.0.00000|Info|push-notifications|Got notification | ChatMessageReceived
{
  "type": "new_message",
  "eventId": "aaaaaaaaaaaaaaaaaaaaaaaa",
  "dialogId": "bbbbbbbbbbbbbbbbbbbbbbbb",
  "message": {
    "_id": "${id}",
    "uid": "bbbbbbbbbbbbbbbbbbbbbbbb",
    "type": ${type},
    "dt": ${dt},
    "text": "quest started",
    "templateId": "${questId} ${suffix}",
    "hasRewards": false,
    "maxStorageTime": 604800
  }
}`

test('parses started and finished events from a real-shaped log', () => {
  const log = [
    block('a1', 10, 1700000000, '5ae449c386f7744bde357697', 'description'),
    block('a2', 12, 1700001000, '5ae449c386f7744bde357697', 'successMessageText')
  ].join('\n')
  const events = parseQuestEvents(log)
  assert.equal(events.length, 2)
  assert.deepEqual(events.map((e) => e.status), ['started', 'finished'])
  assert.equal(events[0].questId, '5ae449c386f7744bde357697')
  assert.equal(events[1].timestamp, 1700001000)
})

test('status comes from the numeric type, never the text field', () => {
  // Real logs carry text:"quest started" even on a type 12 (finished) event.
  const events = parseQuestEvents(block('b1', 12, 100, 'quest1', 'successMessageText'))
  assert.equal(events.length, 1)
  assert.equal(events[0].status, 'finished')
})

test('maps type 11 to failed', () => {
  const events = parseQuestEvents(block('c1', 11, 100, 'quest1', 'failMessageText'))
  assert.equal(events[0].status, 'failed')
})

test('quest id is the first token of templateId', () => {
  const events = parseQuestEvents(block('d1', 10, 5, '657315ddab5a49b71f098853', 'description'))
  assert.equal(events[0].questId, '657315ddab5a49b71f098853')
})

test('ignores non-quest notifications, chat messages, and malformed blocks', () => {
  const log = [
    block('e1', 10, 10, 'quest1', 'description'),
    // player chat message (type 1) — not a quest event
    '{\n  "message": {\n    "type": 1,\n    "dt": 11,\n    "templateId": "nope x"\n  }\n}',
    // unrelated JSON block
    '{\n  "location": "bigmap",\n  "shortId": "ABC123"\n}',
    // truncated JSON
    '{\n  "message": {\n    "type": 10,\n'
  ].join('\n')
  const events = parseQuestEvents(log)
  assert.equal(events.length, 1)
  assert.equal(events[0].questId, 'quest1')
})

test('events are ordered oldest first regardless of file order', () => {
  const log = [
    block('f2', 12, 2000, 'quest2', 'successMessageText'),
    block('f1', 10, 1000, 'quest1', 'description')
  ].join('\n')
  const events = parseQuestEvents(log)
  assert.deepEqual(events.map((e) => e.timestamp), [1000, 2000])
})

test('empty log yields no events', () => {
  assert.deepEqual(parseQuestEvents(''), [])
})

test('dedupe drops events seen in both archive and live logs', () => {
  const log = block('g1', 10, 500, 'quest1', 'description')
  const merged = dedupeQuestEvents([...parseQuestEvents(log), ...parseQuestEvents(log)])
  assert.equal(merged.length, 1)
})

test('events without _id still dedupe by quest, time, and status', () => {
  const noId = `{
  "message": {
    "type": 10,
    "dt": 700,
    "templateId": "questX description"
  }
}`
  const merged = dedupeQuestEvents([...parseQuestEvents(noId), ...parseQuestEvents(noId)])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].eventId, 'questX:700:started')
})

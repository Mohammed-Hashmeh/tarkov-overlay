import type { QuestLogEvent, QuestLogStatus } from '../shared/types'

// EFT writes quest state changes to the session's push-notifications log:
//
//   ...|push-notifications|Got notification | ChatMessageReceived
//   {
//     "type": "new_message",          <- outer type is a STRING, not the status
//     "message": { "_id": ..., "type": 10, "dt": 1700000000,
//                  "text": "quest started",
//                  "templateId": "<questId> description" }
//   }
//
// The status is the NUMERIC message.type. Do not branch on message.text — a
// verified type 12 (finished) event still reads "quest started".
const STATUS_BY_TYPE: Record<number, QuestLogStatus> = {
  10: 'started',
  11: 'failed',
  12: 'finished'
}

// JSON blocks start with '{' and end with '}' at column 0.
const JSON_BLOCK_RE = /^\{[\s\S]*?^\}/gm

interface RawMessage {
  _id?: unknown
  type?: unknown
  dt?: unknown
  templateId?: unknown
}

function toEvent(raw: unknown): QuestLogEvent | null {
  if (typeof raw !== 'object' || raw === null) return null
  const message = (raw as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) return null
  const m = message as RawMessage
  if (typeof m.type !== 'number') return null
  const status = STATUS_BY_TYPE[m.type]
  if (!status) return null
  if (typeof m.templateId !== 'string') return null
  const questId = m.templateId.split(' ')[0]
  if (!questId) return null
  const timestamp = typeof m.dt === 'number' ? m.dt : 0
  const eventId = typeof m._id === 'string' && m._id ? m._id : `${questId}:${timestamp}:${status}`
  return { questId, status, timestamp, eventId }
}

/** Extract quest status changes from a notification log's text. */
export function parseQuestEvents(logText: string): QuestLogEvent[] {
  const events: QuestLogEvent[] = []
  for (const match of logText.matchAll(JSON_BLOCK_RE)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(match[0])
    } catch {
      continue // truncated or non-JSON block
    }
    const event = toEvent(parsed)
    if (event) events.push(event)
  }
  events.sort((a, b) => a.timestamp - b.timestamp)
  return events
}

/** Merge event lists, dropping duplicates (same event seen in archive + live). */
export function dedupeQuestEvents(events: QuestLogEvent[]): QuestLogEvent[] {
  const seen = new Set<string>()
  const out: QuestLogEvent[] = []
  for (const e of events) {
    if (seen.has(e.eventId)) continue
    seen.add(e.eventId)
    out.push(e)
  }
  out.sort((a, b) => a.timestamp - b.timestamp)
  return out
}

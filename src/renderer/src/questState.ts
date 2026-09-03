import type { Quest } from './data'
import type { QuestLogEvent } from '../../shared/types'

// Local quest checklist: quest ids the user has marked completed.
// Persisted in localStorage (survives window-mode switches, which reload).

const KEY = 'questState.v1'
const TRACKED_KEY = 'questTracked.v1'

let completed = new Set<string>()
let tracked = new Set<string>()

export function loadQuestState(): void {
  try {
    const raw = localStorage.getItem(KEY)
    completed = raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    completed = new Set()
  }
  try {
    const raw = localStorage.getItem(TRACKED_KEY)
    tracked = raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    tracked = new Set()
  }
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...completed]))
    localStorage.setItem(TRACKED_KEY, JSON.stringify([...tracked]))
  } catch {
    // storage full/unavailable — checklist just won't persist
  }
}

export function isCompleted(questId: string): boolean {
  return completed.has(questId)
}

export function setCompleted(questId: string, value: boolean): void {
  if (value) {
    completed.add(questId)
    tracked.delete(questId) // a finished quest no longer needs tracking
  } else {
    completed.delete(questId)
  }
  persist()
}

export function isTracked(questId: string): boolean {
  return tracked.has(questId)
}

export function setTracked(questId: string, value: boolean): void {
  if (value) tracked.add(questId)
  else tracked.delete(questId)
  persist()
}

export function trackedCount(): number {
  return tracked.size
}

export interface QuestSyncResult {
  tracked: number
  completed: number
  unknown: number
}

/**
 * Apply quest status events from the game log, oldest first.
 *
 * The game is authoritative for what it reports, but this never un-completes a
 * quest — anything the log is silent about keeps whatever you set by hand.
 */
export function applyQuestEvents(events: QuestLogEvent[], knownIds: Set<string>): QuestSyncResult {
  const result: QuestSyncResult = { tracked: 0, completed: 0, unknown: 0 }
  const ordered = [...events].sort((a, b) => a.timestamp - b.timestamp)
  for (const event of ordered) {
    if (!knownIds.has(event.questId)) {
      result.unknown++
      continue
    }
    if (event.status === 'finished') {
      setCompleted(event.questId, true) // also untracks
    } else if (event.status === 'started') {
      if (!isCompleted(event.questId)) setTracked(event.questId, true)
    } else {
      setTracked(event.questId, false) // failed
    }
  }
  for (const id of knownIds) {
    if (isCompleted(id)) result.completed++
    else if (isTracked(id)) result.tracked++
  }
  return result
}

/** A quest is "available" when every prerequisite quest is marked completed. */
export function isAvailable(quest: Quest): boolean {
  return (quest.prerequisites ?? []).every((id) => completed.has(id))
}

/**
 * Quests selectable for the given map: incomplete, with at least one objective
 * marker there, respecting the availableOnly toggle. NOT filtered by tracking
 * (this feeds the selection UI); tracked quests sort first, then by name.
 */
export function questsOnMap(quests: Quest[], mapNormalizedName: string, availableOnly: boolean): Quest[] {
  return quests
    .filter(
      (q) =>
        !isCompleted(q.id) &&
        (!availableOnly || isAvailable(q)) &&
        q.objectives.some((o) => o.markers?.some((mk) => mk.map === mapNormalizedName))
    )
    .sort(
      (a, b) =>
        Number(isTracked(b.id)) - Number(isTracked(a.id)) || a.name.localeCompare(b.name)
    )
}

/**
 * Quests whose markers should show on the map. When any quests are tracked,
 * only those show; otherwise all incomplete quests do.
 */
export function visibleQuests(quests: Quest[], availableOnly: boolean): Quest[] {
  return quests.filter(
    (q) =>
      !isCompleted(q.id) &&
      (!availableOnly || isAvailable(q)) &&
      (tracked.size === 0 || tracked.has(q.id))
  )
}

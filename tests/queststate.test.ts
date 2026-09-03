import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// questState runs in the renderer; give it a minimal localStorage in Node.
const store = new Map<string, string>()
;(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k)
}

const {
  loadQuestState,
  setCompleted,
  isCompleted,
  isAvailable,
  visibleQuests,
  isTracked,
  setTracked,
  trackedCount,
  questsOnMap,
  applyQuestEvents
} = await import('../src/renderer/src/questState.ts')

const knownIds = new Set(['q1', 'q2', 'q3'])
const ev = (questId: string, status: 'started' | 'failed' | 'finished', timestamp: number) => ({
  questId,
  status,
  timestamp,
  eventId: `${questId}:${timestamp}:${status}`
})

const mk = (map: string) => ({ id: 'o', markers: [{ map, position: { x: 0, y: 0, z: 0 } }] })
const quests = [
  { id: 'q1', name: 'Debut', objectives: [mk('customs')] },
  { id: 'q2', name: 'Checking', prerequisites: ['q1'], objectives: [mk('customs')] },
  { id: 'q3', name: 'Shootout', prerequisites: ['q1', 'q2'], objectives: [mk('woods')] }
]

beforeEach(() => {
  store.clear()
  loadQuestState()
  // reset in-module state: mark everything incomplete and untracked
  for (const q of quests) {
    setCompleted(q.id, false)
    setTracked(q.id, false)
  }
})

test('completion round-trips through storage', () => {
  setCompleted('q1', true)
  assert.equal(isCompleted('q1'), true)
  loadQuestState() // re-read from storage
  assert.equal(isCompleted('q1'), true)
})

test('quest with no prerequisites is available', () => {
  assert.equal(isAvailable(quests[0]), true)
  assert.equal(isAvailable(quests[1]), false)
})

test('availability unlocks as prerequisites complete', () => {
  setCompleted('q1', true)
  assert.equal(isAvailable(quests[1]), true)
  assert.equal(isAvailable(quests[2]), false)
  setCompleted('q2', true)
  assert.equal(isAvailable(quests[2]), true)
})

test('tracking round-trips through storage', () => {
  setTracked('q2', true)
  assert.equal(isTracked('q2'), true)
  assert.equal(trackedCount(), 1)
  loadQuestState()
  assert.equal(isTracked('q2'), true)
})

test('completing a quest untracks it', () => {
  setTracked('q1', true)
  setCompleted('q1', true)
  assert.equal(isTracked('q1'), false)
  assert.equal(trackedCount(), 0)
})

test('tracked-only rule: tracked quests filter the map, empty tracking shows all', () => {
  setTracked('q3', true)
  assert.deepEqual(visibleQuests(quests, false).map((q) => q.id), ['q3'])
  setTracked('q3', false)
  assert.deepEqual(visibleQuests(quests, false).map((q) => q.id), ['q1', 'q2', 'q3'])
})

test('tracked-only rule combines with availableOnly', () => {
  setTracked('q2', true)
  setTracked('q1', true)
  // q2's prerequisite q1 is incomplete, so availableOnly drops it
  assert.deepEqual(visibleQuests(quests, true).map((q) => q.id), ['q1'])
})

test('visibleQuests hides completed and respects availableOnly', () => {
  setCompleted('q1', true)
  const all = visibleQuests(quests, false)
  assert.deepEqual(all.map((q) => q.id), ['q2', 'q3'])
  const avail = visibleQuests(quests, true)
  assert.deepEqual(avail.map((q) => q.id), ['q2'])
})

test('questsOnMap filters by map markers and completion', () => {
  // name sort: 'Checking' (q2) before 'Debut' (q1)
  assert.deepEqual(questsOnMap(quests, 'customs', false).map((q) => q.id), ['q2', 'q1'])
  assert.deepEqual(questsOnMap(quests, 'woods', false).map((q) => q.id), ['q3'])
  setCompleted('q1', true)
  assert.deepEqual(questsOnMap(quests, 'customs', false).map((q) => q.id), ['q2'])
})

test('questsOnMap respects availableOnly but ignores tracking as a filter', () => {
  // q2's prereq q1 incomplete -> availableOnly drops q2
  assert.deepEqual(questsOnMap(quests, 'customs', true).map((q) => q.id), ['q1'])
  // tracking must not hide untracked quests (this list is for selecting)
  setTracked('q2', true)
  assert.deepEqual(questsOnMap(quests, 'customs', false).map((q) => q.id), ['q2', 'q1'])
})

test('started events track quests, finished events complete them', () => {
  const result = applyQuestEvents(
    [ev('q1', 'started', 100), ev('q2', 'started', 101), ev('q2', 'finished', 200)],
    knownIds
  )
  assert.equal(isTracked('q1'), true)
  assert.equal(isCompleted('q2'), true)
  assert.equal(isTracked('q2'), false, 'completing untracks')
  assert.equal(result.tracked, 1)
  assert.equal(result.completed, 1)
})

test('events apply chronologically even when passed out of order', () => {
  applyQuestEvents([ev('q1', 'finished', 300), ev('q1', 'started', 100)], knownIds)
  assert.equal(isCompleted('q1'), true, 'the later finish wins')
})

test('a started event never un-completes a quest', () => {
  setCompleted('q1', true)
  applyQuestEvents([ev('q1', 'started', 999)], knownIds)
  assert.equal(isCompleted('q1'), true)
})

test('failed events untrack without completing', () => {
  setTracked('q3', true)
  applyQuestEvents([ev('q3', 'failed', 100)], knownIds)
  assert.equal(isTracked('q3'), false)
  assert.equal(isCompleted('q3'), false)
})

test('manual state for quests the log never mentions is preserved', () => {
  setTracked('q3', true)
  setCompleted('q1', true)
  applyQuestEvents([ev('q2', 'started', 100)], knownIds)
  assert.equal(isTracked('q3'), true)
  assert.equal(isCompleted('q1'), true)
})

test('unknown quest ids are counted and skipped', () => {
  const result = applyQuestEvents([ev('not-a-quest', 'finished', 100)], knownIds)
  assert.equal(result.unknown, 1)
  assert.equal(isCompleted('not-a-quest'), false)
})

test('questsOnMap sorts tracked first, beating name order', () => {
  // 'Debut' (q1) loses the name sort, but tracking must put it first
  setTracked('q1', true)
  assert.deepEqual(questsOnMap(quests, 'customs', false).map((q) => q.id), ['q1', 'q2'])
  setTracked('q1', false)
  assert.deepEqual(questsOnMap(quests, 'customs', false).map((q) => q.id), ['q2', 'q1'])
})

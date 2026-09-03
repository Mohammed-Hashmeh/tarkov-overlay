import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  pickNearestObjective,
  pickNearestObjectives,
  type MapPoint
} from '../src/renderer/src/nearestObjective.ts'

const pt = (x: number, z: number, floor: string, name = 'Q'): MapPoint => ({
  x,
  y: 0,
  z,
  floor,
  name,
  description: ''
})

test('returns null with no points', () => {
  assert.equal(pickNearestObjective([], { x: 0, z: 0, floor: 'base' }), null)
})

test('picks the closest point by horizontal distance', () => {
  const result = pickNearestObjective(
    [pt(10, 0, 'base', 'far'), pt(3, 4, 'base', 'near')],
    { x: 0, z: 0, floor: 'base' }
  )
  assert.ok(result)
  assert.equal(result.point.name, 'near')
  assert.equal(result.distanceMeters, 5)
  assert.equal(result.sameFloor, true)
})

test('same-floor objective beats a closer one on another floor', () => {
  const result = pickNearestObjective(
    [pt(1, 0, '2nd Floor', 'closer-other-floor'), pt(50, 0, 'base', 'same-floor')],
    { x: 0, z: 0, floor: 'base' }
  )
  assert.ok(result)
  assert.equal(result.point.name, 'same-floor')
  assert.equal(result.sameFloor, true)
})

test('falls back to nearest on any floor when current floor has none', () => {
  const result = pickNearestObjective(
    [pt(100, 0, '2nd Floor', 'far-2nd'), pt(20, 0, 'Underground', 'near-under')],
    { x: 0, z: 0, floor: 'base' }
  )
  assert.ok(result)
  assert.equal(result.point.name, 'near-under')
  assert.equal(result.sameFloor, false)
})

test('returns the three nearest, closest first', () => {
  const results = pickNearestObjectives(
    [pt(40, 0, 'base', 'd'), pt(10, 0, 'base', 'a'), pt(30, 0, 'base', 'c'), pt(20, 0, 'base', 'b')],
    { x: 0, z: 0, floor: 'base' },
    3
  )
  assert.deepEqual(results.map((r) => r.point.name), ['a', 'b', 'c'])
  assert.deepEqual(results.map((r) => r.distanceMeters), [10, 20, 30])
})

test('same-floor points all rank above other-floor ones', () => {
  const results = pickNearestObjectives(
    [pt(1, 0, 'Underground', 'under-close'), pt(80, 0, 'base', 'base-far'), pt(60, 0, 'base', 'base-near')],
    { x: 0, z: 0, floor: 'base' },
    3
  )
  assert.deepEqual(results.map((r) => r.point.name), ['base-near', 'base-far', 'under-close'])
  assert.deepEqual(results.map((r) => r.sameFloor), [true, true, false])
})

test('fills from other floors when the current floor has too few', () => {
  const results = pickNearestObjectives(
    [pt(5, 0, 'base', 'only-base'), pt(70, 0, '2nd Floor', 'far-2nd'), pt(30, 0, '2nd Floor', 'near-2nd')],
    { x: 0, z: 0, floor: 'base' },
    3
  )
  assert.deepEqual(results.map((r) => r.point.name), ['only-base', 'near-2nd', 'far-2nd'])
  assert.deepEqual(results.map((r) => r.sameFloor), [true, false, false])
})

test('a quest with several markers contributes only its closest one', () => {
  const results = pickNearestObjectives(
    [
      pt(60, 0, 'base', 'Fuel Crisis'),
      pt(10, 0, 'base', 'Fuel Crisis'),
      pt(30, 0, 'base', 'Fuel Crisis'),
      pt(50, 0, 'base', 'Debut'),
      pt(70, 0, 'base', 'Checking')
    ],
    { x: 0, z: 0, floor: 'base' },
    3
  )
  assert.deepEqual(results.map((r) => r.point.name), ['Fuel Crisis', 'Debut', 'Checking'])
  assert.equal(results[0].distanceMeters, 10, 'keeps the closest marker of that quest')
})

test('dedupe prefers the same-floor marker of a quest', () => {
  const results = pickNearestObjectives(
    [pt(5, 0, 'Underground', 'Fuel Crisis'), pt(40, 0, 'base', 'Fuel Crisis')],
    { x: 0, z: 0, floor: 'base' },
    3
  )
  assert.equal(results.length, 1)
  assert.equal(results[0].sameFloor, true)
  assert.equal(results[0].distanceMeters, 40)
})

test('returns fewer than requested when there are not enough points', () => {
  const results = pickNearestObjectives([pt(1, 0, 'base', 'a')], { x: 0, z: 0, floor: 'base' }, 3)
  assert.equal(results.length, 1)
})

test('returns an empty list for zero or no points', () => {
  assert.deepEqual(pickNearestObjectives([pt(1, 0, 'base')], { x: 0, z: 0, floor: 'base' }, 0), [])
  assert.deepEqual(pickNearestObjectives([], { x: 0, z: 0, floor: 'base' }, 3), [])
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseScreenshotName } from '../src/main/screenshotWatcher.ts'
import { extractScenePath } from '../src/main/sceneParser.ts'

test('parses a standard EFT screenshot filename', () => {
  const pos = parseScreenshotName('2024-01-01[12-34]_-107.42, 2.51, -110.91_0.0, -0.1, 0.0, -1.0 (0).png')
  assert.ok(pos)
  assert.equal(pos.x, -107.42)
  assert.equal(pos.y, 2.51)
  assert.equal(pos.z, -110.91)
})

test('parses filename with trailing extra segment', () => {
  const pos = parseScreenshotName('2023-11-12[10-33]_444.87, 22.51, 108.32_0.0, 0.7071, 0.0, 0.7071_12.29 (1).png')
  assert.ok(pos)
  assert.equal(pos.x, 444.87)
  // quaternion (0, sin45°, 0, cos45°) is a 90° yaw
  assert.ok(Math.abs(pos.yaw - 90) < 0.1, `yaw was ${pos.yaw}`)
})

test('identity quaternion gives yaw 0', () => {
  const pos = parseScreenshotName('2024-06-15[20-05]_100.00, 0.00, 200.00_0.0, 0.0, 0.0, 1.0 (0).png')
  assert.ok(pos)
  assert.equal(pos.yaw, 0)
})

test('rejects non-screenshot filenames', () => {
  assert.equal(parseScreenshotName('random.png'), null)
  assert.equal(parseScreenshotName('2024-01-01[12-34]_garbage (0).png'), null)
  assert.equal(parseScreenshotName('desktop.ini'), null)
})

test('extracts scene path from application log line', () => {
  const line =
    '2024-01-01 12:00:00.000|0.14.9.0.29456|Info|application|scene preset path:maps/customs.bundle'
  assert.equal(extractScenePath(line), 'maps/customs.bundle')
})

test('extracts scene path with underscores', () => {
  const line = 'blah|application|scene preset path:maps/factory_day_preset.bundle extra'
  assert.equal(extractScenePath(line), 'maps/factory_day_preset.bundle')
})

test('returns null for unrelated log lines', () => {
  assert.equal(extractScenePath('2024-01-01 12:00:00.000|Info|application|LocationLoaded:12.3'), null)
})

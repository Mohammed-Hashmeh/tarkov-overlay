// Pure parsing for the application log's map-load lines. Kept free of electron
// imports so Node can run it directly in tests.

const SCENE_RE = /scene preset path:(?<scenePath>maps\/[a-zA-Z0-9_]+\.bundle)/

/** e.g. "...|application|scene preset path:maps/customs_preset.bundle" */
export function extractScenePath(line: string): string | null {
  return SCENE_RE.exec(line)?.groups?.scenePath ?? null
}

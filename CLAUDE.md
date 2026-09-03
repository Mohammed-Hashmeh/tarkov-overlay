# Tarkov Overlay

Local Electron app: interactive Escape from Tarkov map with three window modes (normal / transparent
overlay / mini-map), live player position from in-game screenshots, auto map detection from game
logs, quest tracking with a nearest-objective arrow. Anti-cheat-safe by design: **never touches the
game process** — no memory reads, no injection, no screen capture. Position comes from screenshot
*filenames* (the game embeds coordinates), map detection from tailing EFT's own log files. Keep
that constraint for any new feature.

## Commands

```
npm run dev          # run with HMR (renderer) — main-process changes need a restart
npm test             # node --test, TS run natively by Node 24 (no build step)
npm run typecheck    # tsc over tsconfig.node.json + tsconfig.web.json
npm run fetch-data   # refresh data/ from tarkov.dev sources (run after game wipes/patches)
                     #   flags after --: --no-images (~4s), --max-zoom=N, --refresh-missing
npm run package      # electron-vite build + electron-builder portable exe -> dist/
```

## Architecture

Electron + electron-vite + TypeScript + Leaflet. No runtime network access — everything reads the
bundled `data/` snapshot, served to the renderer via the custom `appdata://data/<path>` protocol
(`src/main/index.ts`; in packaged builds `data/` ships as extraResources, NOT inside the asar).

- `src/main/windows.ts` — the three window modes. Mode switches **recreate** the BrowserWindow
  (transparent can't be toggled live). CRITICAL: create the new window before destroying the old —
  a zero-window gap fires `window-all-closed` and quits the app. Mini mode is opaque because
  transparent frameless windows can't be natively resized on Windows. Mini bounds persist via a
  debounced moved/resized listener.
- `src/main/screenshotWatcher.ts` — chokidar on `Documents\Escape From Tarkov\Screenshots`; parses
  position + rotation quaternion from filenames (regexes match TarkovMonitor's); yaw formula is
  TarkovMonitor's `QuarternionsToYaw` exactly (denominator uses ry, rz — don't "fix" it). Deletes
  screenshots after reading (setting).
- `src/main/logWatcher.ts` — finds EFT install via registry (or settings override), tails newest
  `* application.log`; `scene preset path:maps/<x>.bundle` lines → map detection (matched against
  each map's `scenePaths` in data). On first attach reads the whole file but emits only the last
  scene (handles app started mid-raid).
- `src/main/questLogParser.ts` — pure parser for quest state changes. EFT writes them to the
  session's **`push-notifications_000.log`** (not `notifications.log`, despite TarkovMonitor's
  naming — their `EndsWith` check matches either). A `Got notification | ChatMessageReceived` line
  is followed by a JSON block (`{` … `}` at column 0) shaped
  `{type:"new_message", message:{_id, type:<int>, dt:<unix>, text, templateId:"<questId> <suffix>"}}`.
  **Status is the NUMERIC `message.type`: 10 started, 11 failed, 12 finished. Never branch on
  `message.text` — a real type-12 event still reads "quest started".** The outer `type` is the
  string `"new_message"`; parse the nested one. `templateId.split(' ')[0]` is the quest id and
  matches `data/quests.json` ids exactly.
- `src/main/logArchive.ts` — mirrors `*application*.log` / `*notifications*.log` into
  `<userData>/log-archive/<sessionFolder>/`, so quest history survives the game's Logs folder being
  cleaned. Idempotent (skips same-size files), never deletes. These files contain profile
  identifiers (`uid`, `dialogId`) and stay local — never upload them.
- `src/main/settings.ts` — plain JSON at `%APPDATA%/tarkov-overlay/settings.json`; BOM-tolerant
  (PowerShell writes BOMs).
- `src/renderer/src/map.ts` — the coordinate system, ported VERBATIM from tarkov-dev
  `src/pages/map/index.jsx` (`getCRS`/`applyRotation`): game (x,z) used directly as Leaflet
  (lng,lat) — `latLng = [z, x]` — with the per-map affine `transform` + `coordinateRotation` baked
  into a custom CRS. If markers misalign, compare against that file, not intuition. SVG maps load
  **inline** (svgOverlay) because floor layers are `<g>` groups *inside the base SVG*
  (`svgLayer` id), toggled by display; some floors are separate tile pyramids. Reserve needs
  `render.svgBounds` (differs from playable bounds). Floor auto-select
  (`floorForPosition(y,x,z)`) checks extent height ranges AND area bounds.
- `src/renderer/src/markers.ts` — layer groups per marker type; quest markers rebuilt from
  checklist state; records `questPoints()` for the arrow. Name labels: permanent Leaflet tooltips
  (`.marker-label`) on extracts (always) and quest markers (only when tracking filter active);
  CSS hides them in overlay/mini modes (`body.overlay-mode`/`body.mini-mode` classes — window
  recreation means no dynamic rebinding needed).
- `src/renderer/src/questState.ts` — completed + tracked sets in localStorage. Rule: tracking
  empty → all incomplete quests show; any tracked → only tracked. Completing untracks.
  `questsOnMap()` feeds the sidebar quick panel (never filtered by tracking). `applyQuestEvents()`
  folds game-log events in chronologically: finished → complete, started → track (unless already
  complete), failed → untrack. **It never un-completes**, so manual edits to quests the log doesn't
  mention survive.
- `src/renderer/src/nearestObjective.ts` — pure (no leaflet import) so Node tests can import it;
  same-floor preference then 2D distance. `objectiveArrow.ts` renders the HUD chip; arrow angle is
  computed in projected screen space (correct on rotated maps).
- `src/renderer/src/player.ts` — dot + facing cone; screen yaw = player yaw + coordinateRotation,
  +180 extra when rotation is 90/270 (tarkov-dev does this).
- `scripts/fetch-data.mjs` — data pipeline. **tarkov.dev's GraphQL API is dead** (422 for
  everything); the working source is `https://json.tarkov.dev/regular/{maps,tasks,traders,items}`
  where names are translation keys resolved against `…_en` docs (the script implements a JSONPath
  subset for this). Render configs come from the tarkov-dev repo `maps.json` (interactive
  projection only). `data/tiles/.missing.json` caches legit-404 tile coords; warm re-run ~1s.

## Data contract

`data/maps.json`: `{maps:[{id,name,normalizedName,scenePaths,render:{transform,coordinateRotation,
bounds,svgBounds,minZoom,maxZoom,tileSize,heightRange,base:{kind:'svg'|'tiles',path,svgLayer,
maxNativeZoom},layers:[{name,show,base,extents:[{height:[lo,hi],bounds:[[[x,z],[x,z],label?]]}]}],
labels},extracts,transits,spawns,bosses,lootContainers,locks,hazards,switches}]}`.
`data/quests.json`: `{quests:[{id,name,trader,minPlayerLevel,kappaRequired,wikiLink,prerequisites,
objectives:[{id,type,description,optional,maps,markers:[{map,position,outline,top,bottom}]}]}]}`.
Positions are game coords: x/z horizontal, y = height (drives floor selection).

## Testing without the game

```
node scripts/simulate-position.mjs <x> <y> <z> [yawDeg]        # drops a fake screenshot
node scripts/simulate-map-load.mjs <normalizedName>            # appends a scene-load log line
node scripts/simulate-quest-event.mjs "<quest>" started|finished|failed
```
The log sim needs the app's logs folder pointed at `<project>/dev-logs` — write
`%APPDATA%/tarkov-overlay/settings.json` as `{"logsPath":"<project>/dev-logs"}` (forward slashes;
reset to `{}` when done). Dev builds forward renderer console to the terminal; grep the dev output
for `[app]`, `[arrow]`, `[panel]`, `[labels]`, `[quests]` lines to verify headlessly. Good test
spot: Customs Dorms 2nd floor is x≈200 y≈5 z≈150 (exercises floor auto-select).

Note the quest backfill reads the **archive as well as** the live folder, so it still reports real
history even when `logsPath` points at `dev-logs`.

## Hotkeys / modes

F9 show-hide, F10 click-through (overlay + mini), F8 toggle mini ↔ previous mode. All rebindable
in Settings. Overlay requires the game in borderless windowed mode. localStorage carries UI state
across the window recreations that mode switches cause.

## Offline / privacy invariants

The app is offline by design and must stay that way — treat these as invariants, not preferences:

- **No runtime network access.** There are no `http(s)://` URLs anywhere in `src/`. The only
  `fetch` calls target `appdata://`, a custom protocol that reads bundled files. Network access is
  additionally *enforced*: `enforceOfflineOperation()` in `src/main/index.ts` cancels every
  http/https/ws request at the session level (localhost is allowed only in dev, for Vite HMR), and
  `index.html` carries a CSP that lists no remote origin. Adding a network call means deliberately
  removing both guards.
- `scripts/fetch-data.mjs` is the sole networked code and is **build-time only** — it never ships.
- The `appdata://` handler must keep using `path.relative` (not `startsWith`) to confine reads to
  `data/`; a prefix check lets a sibling directory escape.
- Renderer windows keep `contextIsolation: true` / `nodeIntegration: false`; the preload exposes
  only fixed IPC channel names, never `ipcRenderer` or filesystem access.
- **Data written, all local:** `%APPDATA%/tarkov-overlay/` holds `settings.json`, `Local Storage`
  (quest + UI state), and `log-archive/`. The archive contains copies of EFT logs, which include
  BSG profile identifiers (`uid`, `dialogId`) — never upload or paste these. The only write outside
  userData is deleting screenshots in `Documents\Escape From Tarkov\Screenshots` (toggleable).
- The archive mirrors whatever `logsPath` points at, so testing with `dev-logs` writes a `log_dev`
  session into it — delete that folder after simulation runs or fake quests persist in history.

## Gotchas

- Don't add features that touch the EFT process (anti-cheat stance; see README notes).
- electron-builder: `data/` must stay in `extraResources` (main reads `process.resourcesPath/data`
  when packaged; files inside asar are invisible to it).
- Node runs the `.ts` test files directly, so any module a test imports must be resolvable outside
  Electron/Vite: no CSS or leaflet imports, no `electron` import anywhere in its import chain, and
  no extensionless relative imports. Pure logic therefore lives in its own module —
  `nearestObjective.ts`, `questLogParser.ts`, `sceneParser.ts`. (`extractScenePath` was moved out of
  `logWatcher.ts` for exactly this reason once the watcher started importing electron code.)
- **Documents may be redirected.** OneDrive Backup relocates Documents to `%USERPROFILE%\OneDrive\
  Documents`, and EFT writes screenshots to the redirected location. Always resolve it through the
  known-folder API (`app.getPath('documents')`, or the `Shell Folders\Personal` registry value in
  plain-Node scripts) — never `homedir()/Documents`, which silently watches an empty folder.
- If the repo lives under OneDrive, expect sync noise on node_modules/data; both are gitignored.
- CRLF warnings from git are normal here (files authored with LF).

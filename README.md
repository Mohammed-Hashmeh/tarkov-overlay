# Tarkov Overlay

A local, interactive Escape from Tarkov map — like tarkov.dev's maps or Tarkov Map Pro, but running
on your own machine so it can sit **on top of the game** and track **your live position**.

Everything works offline from a bundled data snapshot. Nothing touches the game process: position
comes from the filenames of in-game screenshots and map detection from the game's own log files —
the same anti-cheat-safe techniques used by TarkovMonitor.

## Features

- **All interactive maps** from the tarkov.dev open data: extracts (PMC/Scav/shared, with switch
  requirements), spawns, boss spawn points with chances, loot containers, locked doors + required
  keys, hazards, switches, and quest objective zones — all toggleable layers with popups.
- **Live player position** — press your in-game screenshot key (default `PrtScn`) and your position,
  facing direction, and a movement trail appear on the map. The right floor is selected
  automatically from your height. Screenshots are deleted after reading (configurable).
- **Auto map switching** — the app tails EFT's `application.log` and switches to whatever map you
  load into.
- **Two window modes**, switchable in the sidebar:
  - **Normal** — a regular window for a second monitor.
  - **Overlay** — frameless, transparent, always-on-top over the game (run EFT in *borderless*
    windowed mode). `F9` shows/hides it, `F10` toggles click-through so your clicks go to the game.
    A slider controls how see-through it is.
  - **Mini** — a small always-on-top minimap (drag its top edge to move, resize from corners;
    position is remembered). `F8` toggles it from any mode and back. It always recenters on you
    with each screenshot; hover it for floor ▲▼ and back-to-normal buttons. `F9`/`F10` work here
    too.
- **Quest checklist** — every quest, grouped by trader, with a local checkbox list. Completed quests
  drop off the map; optionally show only quests whose prerequisites you've finished.
- **Automatic quest sync** — the app reads quest start/finish events straight from the game's own
  notification log, so the checklist fills itself in: quests you accept get tracked, quests you turn
  in get checked off, live and without any action from you. On first launch it backfills your whole
  history from every past session log. It never un-checks something you ticked by hand. Logs are
  mirrored into `%APPDATA%\tarkov-overlay\log-archive\` so that history survives clearing the game's
  Logs folder (local only — they contain profile identifiers). Both behaviors are toggleable in
  Settings, and "sync from game logs" in the sidebar re-runs the backfill on demand.
- **Quest quick panel** — the sidebar lists the open quests on the current map, each with a ★
  track button and a ✓ check-off button, so you can select quests without opening the full list.
- **Quest tracking + objective arrow** — star (★) quests in the checklist to show only their
  objectives on the map. A HUD chip (visible even in click-through overlay) points an arrow at the
  nearest objective with its distance, preferring objectives on your current floor — objectives on
  another floor are labeled with the floor you need (popups show it too).

## Install

**Requirements:** Windows, and [Node.js](https://nodejs.org) 20.19+ or 22.12+ (`node -v` to check).
Escape from Tarkov itself is only needed to *use* the overlay, not to build it. Expect roughly
500 MB on disk once dependencies and map imagery are downloaded.

```
git clone https://github.com/Mohammed-Hashmeh/tarkov-overlay.git
cd tarkov-overlay
npm install
npm run fetch-data   # map data + images from tarkov.dev (~50 MB, takes a couple of minutes)
npm run build
npm run shortcut     # puts a "Tarkov Overlay" shortcut on your Desktop
```

That last command creates a **Tarkov Overlay** shortcut on your Desktop — double-click it to play.
To keep it on the taskbar, right-click the shortcut → **Show more options** → **Pin to taskbar**
(Windows 11 hides pinning behind that legacy menu).

The shortcut launches the app through Electron's own `electron.exe` rather than a compiled binary.
That is deliberate on two counts: Windows Smart App Control blocks freshly built unsigned
executables but permits `electron.exe`, and the taskbar refuses to pin `.cmd`/`.bat` scripts at all,
so a shortcut to a real executable is the only pinnable option. `npm run shortcut` checks that
dependencies, the build, and map data are all present, and tells you which command to run if any is
missing.

### Keeping it current

- After a wipe or game patch, re-run `npm run fetch-data` to refresh maps and quests.
- After a `git pull`, re-run `npm install` and `npm run build`. The shortcut keeps working; you only
  need `npm run shortcut` again if you move the project folder.

### Running from source

`npm run dev` starts the app with hot reload for editing the code. It serves the interface from a
local dev server, so the Desktop shortcut won't work standalone until you run `npm run build` again.

### Building a distributable copy

`npm run package` writes an unpacked application folder and a `.zip` of it into `dist/`, for moving
the app to another machine. There is no installer and no single-file portable exe — the packaged
executable is unsigned and Smart App Control will likely refuse to run it, which is exactly why the
shortcut above is the recommended route.

## Using it in game

1. Run Escape from Tarkov in **borderless** mode (Settings → Graphics → Screen mode).
2. Start the app, click **Overlay** in the Window panel.
3. `F9` hides/shows the map, `F10` toggles click-through. Adjust the background slider to taste.
4. In raid, tap your screenshot key any time you want your position updated.

If auto map detection says "logs not found", set the EFT Logs folder manually in Settings
(`<EFT install>\Logs`). Screenshots are read from `Documents\Escape From Tarkov\Screenshots`.

## Testing without the game

```
npm test                                        # parser + quest-state unit tests
node scripts/simulate-position.mjs 180 2.5 175 90   # fake a screenshot at x=180 y=2.5 z=175 facing 90°
node scripts/simulate-map-load.mjs customs          # fake a map load (point Settings logs folder at dev-logs/)
node scripts/simulate-quest-event.mjs "Debut" finished   # fake a quest turn-in
```

## Privacy and offline operation

The app never talks to the internet. All map and quest data is bundled at build time, so it works
with no connection at all. That isn't just a promise about the code — outbound http/https/ws
requests are cancelled at the engine level, and the page runs under a Content-Security-Policy that
names no remote origin. The only networked code, `scripts/fetch-data.mjs`, runs when *you* choose to
refresh data and is not part of the app.

Nothing is uploaded, and there is no telemetry, analytics, crash reporting, or auto-updater.
Everything it stores stays in `%APPDATA%\tarkov-overlay\`: your settings, your quest checklist, and
the archived copies of your game logs. Those archived logs contain your BSG profile identifiers, so
treat that folder as personal data — don't share it. You can turn archiving off in Settings.

## Notes

- **Anti-cheat**: this is a separate window; it never reads game memory or injects anything.
  Position tracking only sees screenshot filenames. This is the same approach the tolerated
  community tools use — but as with any third-party tool, use at your own discretion.
- Data and map imagery come from the excellent open-source [tarkov.dev](https://tarkov.dev)
  project (the-hideout). Re-run `npm run fetch-data` whenever the game updates.
- If this folder lives in OneDrive, consider excluding `node_modules/` and `data/tiles/` from sync.

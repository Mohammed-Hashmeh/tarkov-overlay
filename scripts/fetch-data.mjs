#!/usr/bin/env node
/**
 * tarkov-overlay data pipeline.
 *
 * Produces:
 *   data/maps.json    render config + markers for every interactive map
 *   data/quests.json  every task with its map markers
 *   data/tiles/...    map imagery (single SVGs, or tile pyramids)
 *
 * Sources (all public, no auth):
 *   1. https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json
 *      -> Leaflet render config (transform, bounds, layers, labels).
 *   2. https://json.tarkov.dev/regular/{maps,tasks,traders,items}
 *      -> marker + quest data. This is the JSON API that both tarkov.dev's
 *         frontend (src/modules/api-request.mjs) and TarkovMonitor (TarkovDev.cs)
 *         now use. The old api.tarkov.dev/graphql endpoint is proxy-only and its
 *         origin was returning `GraphQL server unavailable` while this was written,
 *         so we use the same JSON API the official clients use.
 *   3. Map imagery from assets.tarkov.dev.
 *
 * Node built-ins only. Idempotent: existing files on disk are not re-downloaded.
 *
 * Flags:
 *   --no-images        skip all imagery, only regenerate the JSON
 *   --max-zoom=N       override the native tile zoom cap (default 4)
 *   --refresh-missing  re-probe tiles previously recorded as 404
 */

import { mkdir, writeFile, readFile, stat, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
const TILES_DIR = path.join(DATA_DIR, "tiles");

const REPO_MAPS_URL = "https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json";
const JSON_API = "https://json.tarkov.dev/";
const GAME_MODE = "regular";
const LANG = "en";

const args = process.argv.slice(2);
const SKIP_IMAGES = args.includes("--no-images");
const REFRESH_MISSING = args.includes("--refresh-missing");
const MAX_NATIVE_ZOOM_CAP = Number(
  (args.find((a) => a.startsWith("--max-zoom=")) || "--max-zoom=4").split("=")[1],
);

const DOWNLOAD_CONCURRENCY = 8;
const RETRIES = 2; // retry a failed download twice (3 attempts total)

const warnings = [];
function warn(msg) {
  warnings.push(msg);
  console.warn(`  ! ${msg}`);
}

// ---------------------------------------------------------------------------
// http helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch with retries. Returns the Response, or null for a hard 404. */
async function fetchWithRetry(url, { attempts = RETRIES + 1, accept } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: accept ? { Accept: accept } : undefined,
        redirect: "follow",
      });
      if (res.status === 404) return null; // missing, not an error worth retrying
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return res;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(400 * (i + 1));
    }
  }
  throw new Error(`${url}: ${lastErr?.message ?? "failed"}`);
}

async function fetchJson(url) {
  const res = await fetchWithRetry(url, { accept: "application/json" });
  if (!res) throw new Error(`${url}: 404`);
  return res.json();
}

// ---------------------------------------------------------------------------
// minimal JSONPath, enough for json.tarkov.dev's `translations` array
//
// The API returns translation *keys* in string fields plus a `translations`
// list of JSONPath expressions naming which fields are keys. The official
// client (tarkov-dev src/modules/api-request.mjs) resolves them with
// jsonpath-plus; we only need the handful of syntaxes actually used:
//   $        root
//   .name    child            [0]     index
//   .*  [*]  wildcard         ..name  recursive descent
//   ['a','b'] child union
// ---------------------------------------------------------------------------

function parseJsonPath(expr) {
  const steps = [];
  let i = 0;
  if (expr[i] === "$") i++;
  while (i < expr.length) {
    if (expr[i] === "." && expr[i + 1] === ".") {
      i += 2;
      const start = i;
      while (i < expr.length && /[\w$-]/.test(expr[i])) i++;
      steps.push({ t: "desc", keys: [expr.slice(start, i)] });
    } else if (expr[i] === ".") {
      i++;
      if (expr[i] === "*") {
        i++;
        steps.push({ t: "wild" });
      } else {
        const start = i;
        while (i < expr.length && /[\w$-]/.test(expr[i])) i++;
        steps.push({ t: "child", keys: [expr.slice(start, i)] });
      }
    } else if (expr[i] === "[") {
      const end = expr.indexOf("]", i);
      const body = expr.slice(i + 1, end);
      i = end + 1;
      if (body.trim() === "*") steps.push({ t: "wild" });
      else if (/^-?\d+$/.test(body.trim())) steps.push({ t: "child", keys: [body.trim()] });
      else {
        const keys = [...body.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]);
        steps.push({ t: "child", keys });
      }
    } else {
      i++; // unexpected char; skip defensively
    }
  }
  return steps;
}

/** Resolve a parsed path to a list of {obj, key} references. */
function selectRefs(root, steps) {
  let values = [root];
  for (let si = 0; si < steps.length; si++) {
    const step = steps[si];
    const isLast = si === steps.length - 1;
    const next = [];
    const refs = [];
    const take = (obj, key) => {
      if (obj == null || typeof obj !== "object" || !(key in obj)) return;
      if (isLast) refs.push({ obj, key });
      else next.push(obj[key]);
    };
    for (const value of values) {
      if (value == null || typeof value !== "object") continue;
      if (step.t === "wild") {
        for (const key of Object.keys(value)) take(value, key);
      } else if (step.t === "child") {
        for (const key of step.keys) take(value, key);
      } else if (step.t === "desc") {
        const stack = [value];
        while (stack.length) {
          const node = stack.pop();
          if (node == null || typeof node !== "object") continue;
          for (const key of Object.keys(node)) {
            if (step.keys.includes(key)) take(node, key);
            const child = node[key];
            if (child && typeof child === "object") stack.push(child);
          }
        }
      }
    }
    if (isLast) return refs;
    values = next;
  }
  return [];
}

/**
 * GET `<path>` plus `<path>_en` and substitute translation keys in place,
 * mirroring tarkov-dev's apiRequest().
 */
async function apiRequest(apiPath, { translate = true } = {}) {
  const [body, lang] = await Promise.all([
    fetchJson(JSON_API + apiPath),
    translate
      ? fetchJson(`${JSON_API}${apiPath}_${LANG}`).catch(() => null)
      : Promise.resolve(null),
  ]);
  if (lang?.data) {
    for (const expr of body.translations ?? []) {
      try {
        for (const { obj, key } of selectRefs(body, parseJsonPath(expr))) {
          const value = obj[key];
          if (typeof value === "string" && lang.data[value] !== undefined) {
            obj[key] = lang.data[value];
          }
        }
      } catch (err) {
        warn(`translation path "${expr}" failed for ${apiPath}: ${err.message}`);
      }
    }
  }
  return body.data;
}

// ---------------------------------------------------------------------------
// leaflet tile-grid math
//
// Verbatim port of tarkov-dev's src/pages/map/index.jsx getCRS()/applyRotation():
// a CRS.Simple variant whose projection first rotates (x, z) by
// `coordinateRotation`, then applies L.Transformation(a, b, c, d) with
//   a = transform[0], b = transform[1], c = -transform[2], d = transform[3]
// CRS.Simple scale(zoom) === 2 ** zoom, so pixel = scale * (a * x + b).
// ---------------------------------------------------------------------------

function gameToPixel(gameX, gameZ, zoom, entry) {
  const [t0, t1, t2, t3] = entry.transform ?? [1, 0, 1, 0];
  const scaleX = t0;
  const marginX = t1;
  const scaleY = t2 * -1;
  const marginY = t3;
  const radians = ((entry.coordinateRotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rotatedX = gameX * cos - gameZ * sin;
  const rotatedY = gameX * sin + gameZ * cos;
  const scale = 2 ** zoom;
  return [scale * (scaleX * rotatedX + marginX), scale * (scaleY * rotatedY + marginY)];
}

/** Tile x/y range covering the map's game-coordinate bounds at `zoom`. */
function tileRange(entry, zoom) {
  const tileSize = entry.tileSize || 256; // index.jsx: `mapData.tileSize || 256`
  const [[ax, az], [bx, bz]] = entry.bounds;
  const corners = [
    [ax, az],
    [bx, bz],
    [ax, bz],
    [bx, az],
  ].map(([x, z]) => gameToPixel(x, z, zoom, entry));
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  return {
    x0: Math.floor(Math.min(...xs) / tileSize),
    x1: Math.floor(Math.max(...xs) / tileSize),
    y0: Math.floor(Math.min(...ys) / tileSize),
    y1: Math.floor(Math.max(...ys) / tileSize),
  };
}

// ---------------------------------------------------------------------------
// download queue
// ---------------------------------------------------------------------------

const stats = { downloaded: 0, skipped: 0, missing: 0, failed: 0, bytes: 0 };
const queue = [];

/**
 * The tile grid is derived from the map's bounding box, which over-estimates
 * coverage: a good third of the probed tiles legitimately 404. Remember them so
 * re-runs don't re-probe thousands of URLs. `--refresh-missing` clears it.
 */
const MISSING_MANIFEST = path.join(TILES_DIR, ".missing.json");
const knownMissing = new Set();

async function loadMissingManifest() {
  if (REFRESH_MISSING) return;
  try {
    for (const url of JSON.parse(await readFile(MISSING_MANIFEST, "utf8"))) knownMissing.add(url);
  } catch {
    /* first run */
  }
}

async function saveMissingManifest() {
  try {
    await mkdir(TILES_DIR, { recursive: true });
    await writeFile(MISSING_MANIFEST, JSON.stringify([...knownMissing].sort()));
  } catch (err) {
    warn(`could not write ${MISSING_MANIFEST}: ${err.message}`);
  }
}

function enqueue(url, destAbs) {
  queue.push({ url, destAbs });
}

async function exists(file) {
  try {
    const s = await stat(file);
    return s.size > 0;
  } catch {
    return false;
  }
}

async function downloadOne({ url, destAbs }) {
  if (knownMissing.has(url)) {
    stats.missing++;
    return;
  }
  if (await exists(destAbs)) {
    stats.skipped++;
    return;
  }
  let res;
  try {
    res = await fetchWithRetry(url);
  } catch (err) {
    stats.failed++;
    warn(`download failed: ${err.message}`);
    return;
  }
  if (!res) {
    // 404 — tile grid corners over-estimate coverage, so this is normal.
    knownMissing.add(url);
    stats.missing++;
    return;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(path.dirname(destAbs), { recursive: true });
  // write to a temp name then rename, so an interrupted run never leaves a
  // truncated file that a later idempotent run would treat as complete
  const tmp = `${destAbs}.part`;
  await writeFile(tmp, buf);
  await rename(tmp, destAbs);
  stats.downloaded++;
  stats.bytes += buf.length;
}

async function drainQueue() {
  const total = queue.length;
  if (!total) return;
  console.log(`\nDownloading ${total} image file(s) with concurrency ${DOWNLOAD_CONCURRENCY}...`);
  let cursor = 0;
  let done = 0;
  let lastReport = Date.now();
  const worker = async () => {
    while (cursor < queue.length) {
      const job = queue[cursor++];
      await downloadOne(job);
      done++;
      if (Date.now() - lastReport > 5000) {
        lastReport = Date.now();
        console.log(
          `  ${done}/${total}  new:${stats.downloaded} cached:${stats.skipped} ` +
            `404:${stats.missing} err:${stats.failed} ${(stats.bytes / 1e6).toFixed(1)}MB`,
        );
      }
    }
  };
  await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, worker));
  console.log(
    `  done. new:${stats.downloaded} cached:${stats.skipped} 404:${stats.missing} ` +
      `err:${stats.failed} ${(stats.bytes / 1e6).toFixed(1)}MB`,
  );
  queue.length = 0;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "layer";

const posix = (p) => p.split(path.sep).join("/");

/** {x,y,z} passthrough, tolerating nulls. */
const vec = (p) => (p ? { x: p.x, y: p.y, z: p.z } : null);
const vecList = (list) => (Array.isArray(list) ? list.map(vec) : null);

/**
 * Queue the imagery for one "base" (a map's main image, or a floor layer)
 * and return the render descriptor with data/-relative paths.
 *
 * Mirrors index.jsx's own preference order: an SVG is used when available,
 * tiles otherwise. Floor layers of an SVG map are *groups inside the same
 * SVG file* (`svgLayer`), not separate files.
 */
function buildBase({ svgPath, svgLayer, tilePath, entry, mapDir, name }) {
  if (svgPath) {
    const rel = posix(path.join("tiles", mapDir, `${name}.svg`));
    if (!SKIP_IMAGES) enqueue(svgPath, path.join(DATA_DIR, rel));
    return { kind: "svg", path: rel, svgLayer: svgLayer ?? null, maxNativeZoom: null };
  }
  if (tilePath) {
    const ext = (tilePath.match(/\.(\w+)$/)?.[1] ?? "png").toLowerCase();
    const maxNativeZoom = Math.min(entry.maxZoom ?? MAX_NATIVE_ZOOM_CAP, MAX_NATIVE_ZOOM_CAP);
    const relTemplate = posix(path.join("tiles", mapDir, name, `{z}/{x}/{y}.${ext}`));
    if (!SKIP_IMAGES) {
      for (let z = 0; z <= maxNativeZoom; z++) {
        const { x0, x1, y0, y1 } = tileRange(entry, z);
        for (let x = x0; x <= x1; x++) {
          for (let y = y0; y <= y1; y++) {
            const url = tilePath.replace("{z}", z).replace("{x}", x).replace("{y}", y);
            const dest = path.join(DATA_DIR, "tiles", mapDir, name, String(z), String(x), `${y}.${ext}`);
            enqueue(url, dest);
          }
        }
      }
    }
    return { kind: "tiles", path: relTemplate, maxNativeZoom, svgLayer: null };
  }
  return null;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const startedAt = Date.now();
  await mkdir(DATA_DIR, { recursive: true });

  console.log("Fetching sources...");
  const [repoMaps, apiMapsData, apiTasksData, apiTraders] = await Promise.all([
    fetchJson(REPO_MAPS_URL),
    apiRequest(`${GAME_MODE}/maps`),
    apiRequest(`${GAME_MODE}/tasks`),
    apiRequest(`${GAME_MODE}/traders`, { translate: false }),
  ]);

  // trader + item names: their `name` fields are translation keys resolved via
  // the sibling `_en` dictionary. Items are only needed for lock key names.
  const traderLang = await fetchJson(`${JSON_API}${GAME_MODE}/traders_${LANG}`).catch(() => null);
  const traderName = new Map(
    Object.values(apiTraders).map((t) => [t.id, traderLang?.data?.[t.name] ?? t.name]),
  );

  let itemName = new Map();
  try {
    const [items, itemsLang] = await Promise.all([
      fetchJson(`${JSON_API}${GAME_MODE}/items`),
      fetchJson(`${JSON_API}${GAME_MODE}/items_${LANG}`),
    ]);
    itemName = new Map(
      Object.values(items.data?.items ?? {}).map((it) => [
        it.id,
        itemsLang?.data?.[it.name] ?? it.name,
      ]),
    );
  } catch (err) {
    warn(`could not load item names (lock keyName will be null): ${err.message}`);
  }

  const apiMaps = Object.values(apiMapsData.maps);
  const mobs = apiMapsData.mobs ?? {};
  const containers = apiMapsData.lootContainers ?? {};
  const mapById = new Map(apiMaps.map((m) => [m.id, m]));
  const mapByName = new Map(apiMaps.map((m) => [m.normalizedName, m]));
  console.log(
    `  render configs: ${repoMaps.length} groups | api maps: ${apiMaps.length} | ` +
      `tasks: ${Object.keys(apiTasksData.tasks).length} | traders: ${traderName.size} | items: ${itemName.size}`,
  );

  // -- maps ----------------------------------------------------------------

  const outMaps = [];
  const usedApiMaps = new Set();

  for (const group of repoMaps) {
    const entry = group.maps.find((m) => m.projection === "interactive");
    if (!entry) continue; // "transits" and "openworld" are 2D-only

    const mapDir = group.normalizedName;

    // imagery, shared by the primary map and any altMaps
    const base = buildBase({
      svgPath: entry.svgPath,
      svgLayer: entry.svgLayer,
      tilePath: entry.tilePath,
      entry,
      mapDir,
      name: "base",
    });
    if (!base) warn(`${group.normalizedName}: no svgPath or tilePath on the interactive entry`);

    const layers = [];
    for (const layer of entry.layers ?? []) {
      // index.jsx: an svgLayer is only usable when the base image is the SVG.
      const useSvgGroup = base?.kind === "svg" && Boolean(layer.svgLayer);
      let layerBase = null;
      if (useSvgGroup) {
        // no extra download: the floor lives inside the base SVG as a <g id=...>
        layerBase = { kind: "svg", path: base.path, svgLayer: layer.svgLayer, maxNativeZoom: null };
      } else if (layer.tilePath) {
        layerBase = buildBase({ tilePath: layer.tilePath, entry, mapDir, name: slug(layer.name) });
      } else {
        warn(`${group.normalizedName}: layer "${layer.name}" has no usable image source; skipped`);
        continue;
      }
      layers.push({
        name: layer.name,
        show: layer.show ?? false,
        base: layerBase,
        extents: layer.extents ?? null,
      });
    }

    const render = {
      transform: entry.transform ?? null,
      coordinateRotation: entry.coordinateRotation ?? 0,
      bounds: entry.bounds ?? null,
      svgBounds: entry.svgBounds ?? null, // only Reserve has this
      minZoom: entry.minZoom ?? 1,
      maxZoom: entry.maxZoom ?? 5,
      tileSize: entry.tileSize ?? 256,
      heightRange: entry.heightRange ?? null,
      base,
      layers,
      labels: (entry.labels ?? []).map((l) => ({
        position: l.position,
        text: l.text,
        size: l.size ?? 100, // index.jsx: `label.size ? label.size : 100`
        rotation: l.rotation ?? 0,
        top: l.top ?? null,
        bottom: l.bottom ?? null,
      })),
    };

    // The render config may serve several API maps (e.g. factory + night-factory)
    const targets = [group.normalizedName, ...(entry.altMaps ?? [])];
    for (const normalizedName of targets) {
      const apiMap = mapByName.get(normalizedName);
      if (!apiMap) {
        warn(`render config "${normalizedName}" has no matching API map; skipped`);
        continue;
      }
      usedApiMaps.add(apiMap.normalizedName);
      outMaps.push(buildMapEntry(apiMap, render, { mobs, containers, itemName }));
    }
  }

  for (const m of apiMaps) {
    if (!usedApiMaps.has(m.normalizedName)) {
      warn(`API map "${m.normalizedName}" has no interactive render config; omitted`);
    }
  }

  // -- quests --------------------------------------------------------------

  const outQuests = Object.values(apiTasksData.tasks).map((task) => ({
    id: task.id,
    name: task.name,
    trader: traderName.get(task.trader) ?? task.trader ?? null,
    minPlayerLevel: task.minPlayerLevel ?? null,
    kappaRequired: task.kappaRequired ?? false,
    wikiLink: task.wikiLink ?? null,
    map: mapById.get(task.map)?.normalizedName ?? null,
    prerequisites: (task.taskRequirements ?? []).map((r) => r.task).filter(Boolean),
    objectives: (task.objectives ?? []).map((obj) => {
      const markers = [];
      // zone-shaped objectives (visit / plantItem / mark / shoot / useItem / plantQuestItem)
      for (const zone of obj.zones ?? []) {
        const nn = mapById.get(zone.map)?.normalizedName;
        if (!nn) continue;
        markers.push({
          map: nn,
          position: vec(zone.position),
          outline: vecList(zone.outline),
          top: zone.top ?? null,
          bottom: zone.bottom ?? null,
        });
      }
      // findQuestItem objectives carry discrete spawn points instead of zones
      for (const loc of obj.possibleLocations ?? []) {
        const nn = mapById.get(loc.map)?.normalizedName;
        if (!nn) continue;
        for (const p of loc.positions ?? []) {
          markers.push({ map: nn, position: vec(p), outline: null, top: null, bottom: null });
        }
      }
      return {
        id: obj.id,
        type: obj.type,
        description: obj.description ?? null,
        optional: obj.optional ?? false,
        maps: (obj.maps ?? []).map((id) => mapById.get(id)?.normalizedName).filter(Boolean),
        markers,
      };
    }),
  }));

  // -- write ---------------------------------------------------------------

  const generatedAt = new Date().toISOString();
  await writeFile(
    path.join(DATA_DIR, "maps.json"),
    JSON.stringify({ generatedAt, maps: outMaps }, null, 1),
  );
  await writeFile(
    path.join(DATA_DIR, "quests.json"),
    JSON.stringify({ generatedAt, quests: outQuests }, null, 1),
  );
  console.log(`\nWrote data/maps.json (${outMaps.length} maps) and data/quests.json (${outQuests.length} quests)`);

  await mkdir(TILES_DIR, { recursive: true });
  if (SKIP_IMAGES) {
    console.log("Skipping imagery (--no-images)");
  } else {
    await loadMissingManifest();
    await drainQueue();
    await saveMissingManifest();
  }

  console.log(`\nFinished in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  if (warnings.length) {
    console.log(`\n${warnings.length} warning(s):`);
    for (const w of new Set(warnings)) console.log(`  - ${w}`);
  }
}

/** Marker payload for a single API map, merged with its render config. */
function buildMapEntry(apiMap, render, { mobs, containers, itemName }) {
  const switchNameById = new Map((apiMap.switches ?? []).map((s) => [s.id, s.name]));
  return {
    id: apiMap.id,
    name: apiMap.name,
    normalizedName: apiMap.normalizedName,
    // TarkovMonitor matches "scene preset path:maps/<x>.bundle" from the game log
    // against Map.scenePath from this same API (GameWatcher.cs:846-864).
    scenePaths: apiMap.scenePath ? [apiMap.scenePath] : [],
    render,
    extracts: (apiMap.extracts ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      faction: e.faction ?? null,
      position: vec(e.position),
      outline: vecList(e.outline),
      top: e.top ?? null,
      bottom: e.bottom ?? null,
      switches: (e.switches ?? []).map((id) => switchNameById.get(id) ?? id),
    })),
    transits: (apiMap.transits ?? []).map((t) => ({
      id: t.id,
      description: t.description ?? null,
      position: vec(t.position),
    })),
    spawns: (apiMap.spawns ?? []).map((s) => ({
      zoneName: s.zoneName ?? null,
      position: vec(s.position),
      sides: s.sides ?? [],
      categories: s.categories ?? [],
    })),
    bosses: (apiMap.bosses ?? []).map((b) => {
      const mob = mobs[b.mob] ?? {};
      return {
        name: mob.name ?? b.mob,
        normalizedName: mob.normalizedName ?? null,
        spawnChance: b.spawnChance ?? null,
        locations: (b.spawnLocations ?? []).map((l) => ({ name: l.name, chance: l.chance })),
      };
    }),
    lootContainers: (apiMap.lootContainers ?? []).map((c) => {
      const def = containers[c.lootContainer] ?? {};
      return {
        name: def.name ?? null,
        normalizedName: def.normalizedName ?? null,
        position: vec(c.position),
      };
    }),
    locks: (apiMap.locks ?? []).map((l) => ({
      lockType: l.lockType ?? null,
      needsPower: l.needsPower ?? false,
      keyId: l.key ?? null,
      keyName: (l.key && itemName.get(l.key)) ?? null,
      position: vec(l.position),
    })),
    hazards: (apiMap.hazards ?? []).map((h) => ({ name: h.name, position: vec(h.position) })),
    switches: (apiMap.switches ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      position: vec(s.position),
    })),
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

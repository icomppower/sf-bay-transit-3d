#!/usr/bin/env node
/* =====================================================================
 *  tools/fetch_tiles.mjs — download the terrain + imagery tiles for a
 *  battle's map box, cross-platform (Node 18+, no PowerShell, no API key).
 *
 *    node tools/fetch_tiles.mjs                 # fetch for ../data.js
 *    node tools/fetch_tiles.mjs data.example.js # fetch for another battle file
 *    node tools/fetch_tiles.mjs --dry           # print the tile range + count, download nothing
 *
 *  SINGLE SOURCE OF TRUTH: the bounding box is read from the battle's own
 *  `meta.geo` — the SAME object the engine and the validator read.
 *
 *  --- PolyU fork note (why this differs from the series default) ---
 *  A campus-scale documentary needs sub-metre imagery; EOX Sentinel-2 (~10 m/px)
 *  is far too coarse at z15 (the campus was unrecognisable). So:
 *    IMG : Esri World Imagery (ArcGIS World_Imagery, sub-metre) {z}/{y}/{x} JPEG
 *    DEM : AWS Terrarium terrain-RGB {z}/{x}/{y}  — BUT Terrarium caps at z15.
 *          The Hung Hom campus is at/near sea level and flat, so at z>15 we write
 *          a synthetic FLAT 0 m DEM tile (solid rgb(128,0,0), the exact sea-level
 *          baseline terrain.js pre-fills). Elevation ≈ R*256+G+B/256-32768; 128,0,0 → 0 m.
 * ===================================================================== */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dry = args.includes("--dry") || args.includes("--dry-run") || args.includes("--count");
const dataArg = args.find(a => !a.startsWith("--")) || "data.js";

/* ---- read meta.geo from the battle file (one bbox source) ---- */
let geo;
try {
  globalThis.window = {};
  eval(readFileSync(resolve(root, dataArg), "utf8"));
  geo = globalThis.window.BATTLE_DATA && globalThis.window.BATTLE_DATA.meta && globalThis.window.BATTLE_DATA.meta.geo;
} catch (e) {
  console.error(`Could not load ${dataArg}: ${e.message}`);
  process.exit(2);
}
const need = ["minLng", "maxLng", "minLat", "maxLat", "Z"];
if (!geo || need.some(k => typeof geo[k] !== "number" || !isFinite(geo[k]))) {
  console.error(`${dataArg} meta.geo must define finite ${need.join("/")} — run \`node tools/validate.mjs ${dataArg}\` first.`);
  process.exit(2);
}

/* ---- derive the slippy-tile range from the box (standard Web-Mercator) ---- */
const { minLng, maxLng, minLat, maxLat, Z: z } = geo;
const lng2x = (l) => Math.floor((l + 180) / 360 * 2 ** z);
const lat2y = (l) => { const r = l * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };
const x0 = lng2x(minLng), x1 = lng2x(maxLng), y0 = lat2y(maxLat), y1 = lat2y(minLat);   // north = smaller y
const nx = x1 - x0 + 1, ny = y1 - y0 + 1;
const TERRARIUM_MAX_Z = 15;                 // AWS Terrarium DEM has no tiles above z15
const flatDemOnly = z > TERRARIUM_MAX_Z;    // near-sea-level flat campus → synthetic 0 m DEM at high zoom
console.log(`${dataArg}: zoom ${z}  x ${x0}..${x1} (${nx})  y ${y0}..${y1} (${ny})  => ${nx * ny} tiles/layer, ${nx * ny * 2} total`
  + `\n  imagery: Esri World Imagery` + (flatDemOnly ? `\n  DEM: synthetic flat 0 m (z${z} > Terrarium z${TERRARIUM_MAX_Z})` : `\n  DEM: AWS Terrarium`));
if (dry) process.exit(0);

/* ---- a synthetic flat 0 m DEM tile: solid rgb(128,0,0) 256×256 PNG (Terrarium encoding: 128*256 = 32768 → 0 m) ---- */
function crc32(buf) { let c = ~0; for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return (~c) >>> 0; }
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
const FLAT_DEM = (() => {
  const W = 256, H = 256;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; /* 8-bit RGB */ ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.alloc(1 + W * 3); for (let x = 0; x < W; x++) { row[1 + x * 3] = 128; row[1 + x * 3 + 1] = 0; row[1 + x * 3 + 2] = 0; }
  const raw = Buffer.concat(Array.from({ length: H }, () => row));
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
})();

/* ---- build the job list ---- */
const demDir = resolve(root, "lib/tiles/dem"), imgDir = resolve(root, "lib/tiles/img");
mkdirSync(demDir, { recursive: true });
mkdirSync(imgDir, { recursive: true });
const jobs = [];
for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
  jobs.push({ kind: "dem", url: `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, path: join(demDir, `${z}_${x}_${y}.png`) });
  jobs.push({ kind: "img", url: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, path: join(imgDir, `${z}_${x}_${y}.jpg`) });
}

/* ---- download with a concurrency cap + retries ---- */
const LIMIT = 12;
let done = 0, skipped = 0, demSynth = 0;
const fails = [];
async function fetchOne(job) {
  if (existsSync(job.path)) { skipped++; return; }   // idempotent: never re-download a tile already on disk
  if (job.kind === "dem" && flatDemOnly) { writeFileSync(job.path, FLAT_DEM); demSynth++; return; }   // high zoom → flat 0 m tile, no fetch
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(job.url, { signal: AbortSignal.timeout(45000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      writeFileSync(job.path, Buffer.from(await res.arrayBuffer()));
      return;
    } catch (e) {
      if (job.kind === "dem" && String(e.message).includes("404")) { writeFileSync(job.path, FLAT_DEM); demSynth++; return; }   // no DEM here → sea-level baseline
      if (attempt === 4) {
        if (job.kind === "dem") { writeFileSync(job.path, FLAT_DEM); demSynth++; return; }   // DEM unreachable → flat rather than a hole
        fails.push(`${job.url} -> ${e.message}`);
      } else await new Promise(r => setTimeout(r, 1500));
    }
  }
}
const queue = [...jobs];
const workers = Array.from({ length: LIMIT }, async () => {
  while (queue.length) { await fetchOne(queue.shift()); process.stdout.write(`\r${++done}/${jobs.length}`); }
});
await Promise.all(workers);
process.stdout.write("\n");
if (fails.length) {
  console.error(`\n${fails.length} imagery tile(s) failed:`);
  fails.slice(0, 20).forEach(f => console.error("  " + f));
  process.exit(1);
}
console.log(`OK — ${skipped} already present, ${jobs.length - skipped} written into lib/tiles/ (${demSynth} synthetic flat DEM tiles).`);

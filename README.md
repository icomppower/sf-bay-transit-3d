# SF Bay Area 3D — 舊金山灣區立體交通路網 (v2)

Interactive 3D map of BART + Caltrain over **real terrain** (Esri World Imagery + AWS Terrarium elevation) — same engine as [HK MTR 3D](https://icomppower.github.io/hk-mtr-3d) v2 (`cinematic-3d-battle-engine`, forked via hk-mtr-3d's own copy). Click any station for its real next departures; trains are positioned by the real published weekday GTFS schedule at the Bay Area's actual current local time — not a decorative loop, not a slider.

**Live:** https://icomppower.github.io/sf-bay-transit-3d

v1 (the schematic black-background build, real geometry but no terrain) is archived to `v1/` and no longer deployed.

## What's real vs. approximated

- **Real**: BART's official GTFS (`bart.gov`) + Caltrain's GTFS (via 511.org) — route geometry, all 81 stations, and the full weekday timetable (767 trips, 16k+ stop times).
- **Not modeled**: tunnel depth. Unlike HK MTR 3D (which bakes a per-station/per-track underground/elevated height offset into the data), this build doesn't give lines or stations their own elevation — they sit exactly at ground level and simply follow the real terrain's relief underneath them. The terrain itself is real SRTM elevation, so hills read correctly, but BART's actual tunnels (Transbay Tube, Market St subway, Berkeley Hills Tunnel) aren't rendered diving below grade.
- Full sourcing and caveats are in the map's own Notes panel (data.js `notes`).

## Rebuild

1. Fetch GTFS (gitignored, not committed):
   - BART: `curl -sL https://www.bart.gov/dev/schedules/google_transit.zip -o bart-gtfs.zip && unzip -o bart-gtfs.zip -d gtfs-bart`
   - Caltrain: `curl -sL "http://api.511.org/transit/datafeeds?api_key=YOUR_511_TOKEN&operator_id=CT" -o caltrain-gtfs.zip && unzip -o caltrain-gtfs.zip -d gtfs-caltrain`
2. `node tools/gen-terrain-data.mjs` — extracts `tools/terrain-data.json` (points/lines/schedule) straight from GTFS lat/lon, no projection inversion needed.
3. `node tools/build-data.mjs` — assembles `data.js` (meta/factions/storyboard/notes + the generated geography/schedule).
4. `node tools/validate.mjs data.js` — checks the engine's data contract.
5. Tiles (gitignored raw GTFS aside, `lib/tiles/` IS committed): `node tools/fetch_tiles.mjs data.js` (Esri World Imagery + AWS Terrarium DEM, zoom 12, ~442 tiles for the whole Bay).
6. `node tools/serve.js` to preview locally (must be served over http — `file://` can't load the tiles).

## How the schedule-accurate trains work

`data.js` carries one extra field beyond the engine's normal data contract: `schedule` — one representative weekday's real trips (`{r: routeId, b: branchIndex, s: [[u, secondsSinceMidnight, stationIndex], ...]}`). `entities.js`'s `buildLiveTrains()`/`updateLiveTrains()` (a fork-only addition, engine modules otherwise unedited) drive each train by finding the two real stops bracketing the *current Bay Area local time* (always `America/Los_Angeles`, regardless of the visitor's own timezone) and interpolating position between them — so the number of visible trains genuinely rises and falls with real rush-hour service, and is zero outside real operating hours.

Clicking a station (`terrain.js`'s `buildLabels()` now takes an optional click callback) opens a small popup listing that station's next real departures, built from the same schedule data, pre-indexed by station in `buildLiveTrains()`.

## The "BART Runner" pinned-route card

A glanceable, text-first commuter overlay on top of the 3D canvas — for the "looking at your phone running down the escalator" case, not just visualization. Pin an Origin → Destination (via the ▸ ROUTE card's dropdowns, or a station popup's **From here / To here** buttons) and the card shows, ticking every second:

- the next real departures that actually serve that journey — trip-level filtering, so of Red/Yellow/Blue through Balboa Park only the lines that really reach 12th St show, and a Caltrain limited that skips your stop never appears (this also makes it time-aware: late evening, Balboa → 12th St correctly offers only Yellow);
- a **down-to-the-second countdown** per departure, colour-coded green (>5 min) / amber (2–5) / flashing red (<2 — "you need to run");
- a **one-transfer suggestion** when no direct line exists (Berkeley → San Jose via Millbrae, BART → fare gates → Caltrain) or when transferring genuinely beats waiting for the direct train by a minute or more.

The pinned route persists in `localStorage`, so a commuter's card is already loaded on open — no panning or zooming needed. Split: `route-logic.js` is pure reasoning (line filtering, trip search, co-located-station grouping — Millbrae is one BART point + one Caltrain point ~30 m apart — transfer valuation, countdown bands) with no DOM and no engine imports, designed so live ETAs (BART `etd`, 511 StopMonitoring via the deployed proxy) can later replace schedule times without touching it; `route-ui.js` owns the DOM card.

## Backlog

- Muni Metro / SF Muni light rail as a 4th layer (also on 511.org).
- A visible clock/time-of-day readout in the HUD (currently only surfaces in the click popup).

# SF Bay Area 3D — 舊金山灣區立體交通路網

Interactive 3D map of BART + Caltrain in a single HTML file (Three.js, no build). Real GTFS route geometry, 81 stations with approximate underground/elevated depth, and trains positioned by the **real published weekday timetable** — not a decorative loop.

**Live:** https://icomppower.github.io/sf-bay-transit-3d

Third entry in the 3D Transit Maps series, sister to [HK MTR 3D](https://icomppower.github.io/hk-mtr-3d) and [NYC Subway 3D](https://icomppower.github.io/nyc-subway-3d) — same single-HTML/WebGL engine (forked from the NYC template), new region.

## Data

- **BART**: official GTFS, `bart.gov/dev/schedules/google_transit.zip`. 6 color lines (Yellow/Orange/Green/Red/Blue + the Grey Oakland Airport Connector), 50 stations.
- **Caltrain**: GTFS via 511.org's regional feed (`api.511.org/transit/datafeeds?operator_id=CT`). All service patterns (Local/Limited/Express/South County) collapse into one physical line, 31 stations.
- Route geometry is real GTFS `shapes.txt`, simplified (Douglas-Peucker) and picked per-route via the same greedy-coverage heuristic as the HK/NYC builds (handles branches without duplicate overlapping track).
- Station → line membership derived from `stop_times.txt` + `trips.txt`, not guessed.

Rebuild: `node process-sf.mjs` (needs `gtfs-bart/` and `gtfs-caltrain/`, gitignored — re-download with the URLs above), then `node inject.mjs` to produce `index.html` from `index.template.html`.

## Schedule-accurate trains

Unlike HK MTR 3D / NYC Subway 3D (whose trains are a decorative even-spaced loop, not tied to any real timetable), this build extracts the real weekday schedule from `stop_times.txt` for one representative service day (BART's core Mon–Fri calendar, Caltrain's `service_id 72982`) — 767 real trips, 16k+ real stop times. Each stop's real (lat, lon) is projected onto the nearest matching output route curve to get its position `u ∈ [0,1]` along the track; a trip's train then moves by linearly interpolating `u` between its two bracketing real stop times as a virtual clock advances (the existing "Time-lapse" speed slider now controls how fast that virtual clock runs, ×80 default ≈ a full day every ~30s). A train only exists between its trip's first and last real stop time, so the number of visible trains rises and falls with actual rush-hour service (~30 midday → ~60+ at peak → 0 overnight) — same glowing box visual as before, just positioned by the real timetable instead of a loop.

## Known simplification: elevation

GTFS carries no tunnel/bridge/at-grade tag (unlike NYC's `stations.csv` "Structure" field or HK's OSM way tags), so depth is approximated from real-world knowledge of the network as a handful of known-underground corridor bounding boxes (Transbay Tube, SF Market St subway, downtown Oakland subway, Berkeley Hills Tunnel, Daly City/Colma, SFO/Millbrae approach), smoothed the same way as the other builds. Caltrain today has no tunnels, so it's rendered flat. This is an approximation, not surveyed depth — a few individual stations may be off (e.g. a station right at a corridor's edge).

## Backlog

- Bay/land outline layer (the NYC build's "boroughs" water-vs-land silhouette) — skipped for v1, `data.boroughs` is `[]`.
- Live data: BART's `api.bart.gov` ETD endpoint is CORS-open and needs no proxy; Caltrain needs the `sf-bay-transit-proxy` Vercel proxy (511.org has no CORS headers) — see that repo.
- Muni Metro / SF Muni light rail as a 4th layer (also on 511.org, same proxy would cover it).

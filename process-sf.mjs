// Build compact embedded dataset for the SF Bay Area 3D map (BART + Caltrain).
// Inputs: gtfs-bart/, gtfs-caltrain/ (official GTFS, real route geometry + real stations)
// Output: data.json  { routes:[{id,color,name,shapes:[[[x,y,z],...]]}], stations:[...] }
import fs from 'fs';

const LAT0 = 37.75, LON0 = -122.25;   // centered roughly on the Bay
const KY = 111.32, KX = 111.32 * Math.cos(LAT0 * Math.PI / 180);
const proj = (lat, lon) => [(lon - LON0) * KX, (LAT0 - lat) * KY];   // x east, z south → km

// ---- quoted-CSV parser (values may contain commas) ----
const csvRow = (line) => {
  const out = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur); return out;
};
const readCsv = (path) => {
  const rows = fs.readFileSync(path, 'utf8').split(/\r?\n/).filter(l => l.length);
  const head = csvRow(rows[0].replace(/^﻿/, '')).map(h => h.replace(/^"|"$/g, ''));
  return rows.slice(1).map(r => { const c = csvRow(r).map(v => v.replace(/^"|"$/g, '')); const o = {}; head.forEach((h, i) => o[h] = c[i]); return o; });
};

// ---- Douglas-Peucker on [lat,lon] pairs ----
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    const [ay, ax] = pts[a], [by, bx] = pts[b];
    const dy = by - ay, dx = bx - ax, len2 = dy * dy + dx * dx || 1e-12;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((pts[i][0] - ay) * dy + (pts[i][1] - ax) * dx) / len2));
      const py = ay + t * dy, px = ax + t * dx;
      const d = (pts[i][0] - py) ** 2 + (pts[i][1] - px) ** 2;
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol * tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// ---- elevation heuristic (no OSM tunnel/bridge tags in GTFS; approximate known
//  underground corridors by real-world knowledge of the network, then smooth).
//  Caltrain today is entirely at-grade/elevated (no tunnels), so these BART-only
//  corridors are skipped for it — otherwise the SF Market St bbox would wrongly
//  swallow the surface 4th & King terminal a few blocks south of it. ----
function elevFor(lat, lon, isBart) {
  if (!isBart) return 0;
  if (lon > -122.40 && lon < -122.29 && lat > 37.79 && lat < 37.815) return -30;   // Transbay Tube (deep, underwater)
  if (lon > -122.435 && lon < -122.40 && lat > 37.775 && lat < 37.795) return -14; // SF Market St downtown subway
  if (lon > -122.31 && lon < -122.26 && lat > 37.80 && lat < 37.835) return -14;   // Downtown Oakland subway
  if (lon > -122.25 && lon < -122.17 && lat > 37.83 && lat < 37.885) return -12;   // Berkeley Hills Tunnel (Rockridge <-> Orinda)
  if (lon > -122.47 && lon < -122.44 && lat > 37.68 && lat < 37.71) return -10;    // Daly City / Colma underground segment
  if (lon > -122.41 && lon < -122.38 && lat > 37.60 && lat < 37.625) return -8;    // SFO / Millbrae underground approach
  return 0;
}
function smoothElev(elev) {
  for (let pass = 0; pass < 3; pass++)
    elev = elev.map((e, i) => (elev[Math.max(0, i - 1)] + e * 2 + elev[Math.min(elev.length - 1, i + 1)]) / 4);
  return elev;
}

// ==================== load one GTFS feed ====================
function loadFeed(dir, opts) {
  const stopsRaw = readCsv(`${dir}/stops.txt`);
  const stations = stopsRaw.filter(s => s.location_type === '1');
  const platformParent = {};   // stop_id (platform) -> parent_station id
  for (const s of stopsRaw) if (s.parent_station) platformParent[s.stop_id] = s.parent_station;

  const routesRaw = readCsv(`${dir}/routes.txt`).filter(r => opts.routeFilter ? opts.routeFilter(r) : true);
  const trips = readCsv(`${dir}/trips.txt`);
  const shapeRoute = {};
  for (const t of trips) if (t.shape_id) shapeRoute[t.shape_id] = opts.mergeRoute ? opts.mergeRoute(t.route_id) : t.route_id;

  const shapes = {};
  for (const s of readCsv(`${dir}/shapes.txt`)) (shapes[s.shape_id] ||= []).push([+s.shape_pt_sequence, +s.shape_pt_lat, +s.shape_pt_lon]);
  for (const id in shapes) shapes[id].sort((a, b) => a[0] - b[0]);

  // station -> route membership, via stop_times.txt -> trips.txt -> stops.txt(parent_station)
  const tripRoute = {};
  for (const t of trips) tripRoute[t.trip_id] = opts.mergeRoute ? opts.mergeRoute(t.route_id) : t.route_id;
  const stationRoutes = {};   // parent_station id -> Set(mergedRouteId)
  for (const st of readCsv(`${dir}/stop_times.txt`)) {
    const parent = platformParent[st.stop_id] || st.stop_id;
    const r = tripRoute[st.trip_id];
    if (!r) continue;
    (stationRoutes[parent] ||= new Set()).add(r);
  }

  return { stations, routesRaw, shapeRoute, shapes, stationRoutes };
}

const BART_MERGE = { '1': 'YEL', '2': 'YEL', '3': 'ORG', '4': 'ORG', '5': 'GRN', '6': 'GRN', '7': 'RED', '8': 'RED', '11': 'BLU', '12': 'BLU', '19': 'GRY', '20': 'GRY' };
const bart = loadFeed('gtfs-bart', {
  routeFilter: r => r.route_type === '1',   // rail only, drop bus-bridge substitutions
  mergeRoute: id => BART_MERGE[id] || id,
});
const caltrain = loadFeed('gtfs-caltrain', {
  routeFilter: () => true,
  mergeRoute: () => 'CT',   // one physical corridor — all service patterns collapse into a single line
});

// ==================== build output routes (greedy shape coverage per merged route) ====================
const covKey = (lat, lon) => `${Math.round(lat * 700)}:${Math.round(lon * 700)}`;   // ~150m cells
function buildRoutes(feed, colorOf, nameOf, ids, isBart) {
  const byRoute = {};
  for (const sid in feed.shapes) { const r = feed.shapeRoute[sid]; if (r) (byRoute[r] ||= []).push(sid); }
  const out = [];
  for (const rid of ids) {
    const sids = (byRoute[rid] || []).sort((a, b) => feed.shapes[b].length - feed.shapes[a].length);
    if (!sids.length) continue;
    const covered = new Set(); const picked = [];
    for (const sid of sids) {
      const pts = feed.shapes[sid];
      let fresh = 0;
      for (const [, lat, lon] of pts) if (!covered.has(covKey(lat, lon))) fresh++;
      if ((fresh / pts.length > 0.35 && fresh > 40) || picked.length === 0) {
        picked.push(sid);
        for (const [, lat, lon] of pts) covered.add(covKey(lat, lon));
      }
      if (picked.length >= 3) break;
    }
    const outShapes = picked.map(sid => {
      const raw = feed.shapes[sid].map(p => [p[1], p[2]]);
      const simp = simplify(raw, 0.00006);
      const elev = smoothElev(simp.map(([lat, lon]) => elevFor(lat, lon, isBart)));
      return simp.map(([lat, lon], i) => { const [x, z] = proj(lat, lon); return [+x.toFixed(3), +elev[i].toFixed(1), +z.toFixed(3)]; });
    });
    out.push({ id: rid, color: colorOf(rid), name: nameOf(rid), shapes: outShapes });
  }
  return out;
}

const BART_COLOR = { YEL: '#FFFF33', ORG: '#FF9933', GRN: '#339933', RED: '#FF0000', BLU: '#0099CC', GRY: '#B0BEC7' };
const BART_NAME = { YEL: 'Yellow Line (Antioch ↔ SFO/Millbrae)', ORG: 'Orange Line (Berryessa ↔ Richmond)', GRN: 'Green Line (Berryessa ↔ Daly City)', RED: 'Red Line (Richmond ↔ SFO/Millbrae)', BLU: 'Blue Line (Dublin/Pleasanton ↔ Daly City)', GRY: 'Grey Line (Oakland Airport Connector)' };
const bartRoutes = buildRoutes(bart, id => BART_COLOR[id], id => BART_NAME[id], Object.keys(BART_COLOR), true);
const caltrainRoutes = buildRoutes(caltrain, () => '#CE202F', () => 'Caltrain (San Francisco ↔ Gilroy)', ['CT'], false);

// ==================== stations out ====================
function outStations(feed, prefix, isBart) {
  return feed.stations.map(s => {
    const [x, z] = proj(+s.stop_lat, +s.stop_lon);
    const routes = [...(feed.stationRoutes[s.stop_id] || [])];
    return { n: s.stop_name, r: routes.length ? routes : [prefix], x: +x.toFixed(3), y: +smoothElev([elevFor(+s.stop_lat, +s.stop_lon, isBart)])[0].toFixed(1), z: +z.toFixed(3) };
  });
}
const stations = [...outStations(bart, 'BART', true), ...outStations(caltrain, 'CT', false)];

const data = { routes: [...bartRoutes, ...caltrainRoutes], stations, boroughs: [] };   // no bay/land outline yet — fast-follow, see README
fs.writeFileSync('data.json', JSON.stringify(data));
const kb = (fs.statSync('data.json').size / 1024).toFixed(0);
console.log(`routes: ${data.routes.length}, shapes: ${data.routes.reduce((a, r) => a + r.shapes.length, 0)}, pts: ${data.routes.reduce((a, r) => a + r.shapes.reduce((b, s) => b + s.length, 0), 0)}`);
console.log(`stations: ${stations.length} (BART ${bart.stations.length}, Caltrain ${caltrain.stations.length}), data.json: ${kb} KB`);
for (const r of data.routes) console.log(` ${r.id}: ${r.shapes.map(s => s.length).join('+')} pts ${r.color}`);

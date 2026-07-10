// Build geography.points / geography.lines / schedule for the terrain-fork engine's data.js,
// straight from real BART + Caltrain GTFS lat/lon (no projection inversion needed — the engine
// does its own lng/lat -> world-unit projection in projection.js).
import fs from 'fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => resolve(root, ...a);

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
const KY = 111.32, KX = 111.32 * Math.cos(37.6 * Math.PI / 180);

function loadFeed(dir, opts) {
  const stopsRaw = readCsv(P(dir, 'stops.txt'));
  const stations = stopsRaw.filter(s => s.location_type === '1');
  const stopById = {}; for (const s of stopsRaw) stopById[s.stop_id] = s;
  const platformParent = {};
  for (const s of stopsRaw) if (s.parent_station) platformParent[s.stop_id] = s.parent_station;
  const routesRaw = readCsv(P(dir, 'routes.txt')).filter(r => opts.routeFilter ? opts.routeFilter(r) : true);
  const trips = readCsv(P(dir, 'trips.txt'));
  const shapeRoute = {};
  for (const t of trips) if (t.shape_id) shapeRoute[t.shape_id] = opts.mergeRoute(t.route_id);
  const shapes = {};
  for (const s of readCsv(P(dir, 'shapes.txt'))) (shapes[s.shape_id] ||= []).push([+s.shape_pt_sequence, +s.shape_pt_lat, +s.shape_pt_lon]);
  for (const id in shapes) shapes[id].sort((a, b) => a[0] - b[0]);
  const tripRoute = {}; for (const t of trips) tripRoute[t.trip_id] = opts.mergeRoute(t.route_id);
  const stopTimesRaw = readCsv(P(dir, 'stop_times.txt'));
  const stationRoutes = {};
  for (const st of stopTimesRaw) {
    const parent = platformParent[st.stop_id] || st.stop_id;
    const r = tripRoute[st.trip_id]; if (!r) continue;
    (stationRoutes[parent] ||= new Set()).add(r);
  }
  return { stations, shapeRoute, shapes, stationRoutes, stopById, trips, tripRoute, stopTimesRaw };
}

const BART_MERGE = { '1': 'yel', '2': 'yel', '3': 'org', '4': 'org', '5': 'grn', '6': 'grn', '7': 'red', '8': 'red', '11': 'blu', '12': 'blu', '19': 'gry', '20': 'gry' };
const bart = loadFeed('gtfs-bart', { routeFilter: r => r.route_type === '1', mergeRoute: id => BART_MERGE[id] || id });
const caltrain = loadFeed('gtfs-caltrain', { routeFilter: () => true, mergeRoute: () => 'ct' });

const covKey = (lat, lon) => `${Math.round(lat * 700)}:${Math.round(lon * 700)}`;
function buildRoutes(feed, ids) {
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
    const branches = picked.map(sid => simplify(feed.shapes[sid].map(p => [p[1], p[2]]), 0.00006));
    out.push({ id: rid, branches });
  }
  return out;
}
const bartRoutes = buildRoutes(bart, ['yel', 'org', 'grn', 'red', 'blu', 'gry']);
const caltrainRoutes = buildRoutes(caltrain, ['ct']);

function projectToPolyline(poly, lat, lon) {
  const lens = [0];
  for (let i = 1; i < poly.length; i++) {
    const dy = (poly[i][0] - poly[i - 1][0]) * KY, dx = (poly[i][1] - poly[i - 1][1]) * KX;
    lens.push(lens[i - 1] + Math.hypot(dy, dx));
  }
  const total = lens[lens.length - 1] || 1;
  let best = { u: 0, d2: Infinity };
  for (let i = 0; i < poly.length - 1; i++) {
    const [ay, ax] = poly[i], [by, bx] = poly[i + 1];
    const dy = by - ay, dx = bx - ax, len2 = dy * dy + dx * dx || 1e-12;
    const t = Math.max(0, Math.min(1, ((lat - ay) * dy + (lon - ax) * dx) / len2));
    const py = ay + t * dy, px = ax + t * dx;
    const ddy = (lat - py) * KY, ddx = (lon - px) * KX;
    const d2 = ddy * ddy + ddx * ddx;
    if (d2 < best.d2) best = { u: (lens[i] + t * (lens[i + 1] - lens[i])) / total, d2 };
  }
  return best;
}

function buildSchedule(feed, routes, serviceId, stationIndexOf) {
  const byRoute = {}; for (const r of routes) byRoute[r.id] = r;
  const tripIds = new Set(feed.trips.filter(t => t.service_id === serviceId).map(t => t.trip_id));
  const byTrip = {};
  for (const st of feed.stopTimesRaw) { if (tripIds.has(st.trip_id)) (byTrip[st.trip_id] ||= []).push(st); }
  const parseT = (s) => { const [h, m, sec] = s.split(':').map(Number); return h * 3600 + m * 60 + sec; };
  const trips = [];
  for (const tripId in byTrip) {
    const rid = feed.tripRoute[tripId];
    const route = byRoute[rid]; if (!route || !route.branches.length) continue;
    const sts = byTrip[tripId].sort((a, b) => (+a.stop_sequence) - (+b.stop_sequence));
    if (sts.length < 2) continue;
    const coords = sts.map(st => { const s = feed.stopById[st.stop_id]; return s ? [+s.stop_lat, +s.stop_lon] : null; }).filter(Boolean);
    if (coords.length < 2) continue;
    let bestBranch = 0, bestAvg = Infinity;
    route.branches.forEach((poly, bi) => {
      const avg = coords.reduce((a, [lat, lon]) => a + projectToPolyline(poly, lat, lon).d2, 0) / coords.length;
      if (avg < bestAvg) { bestAvg = avg; bestBranch = bi; }
    });
    const poly = route.branches[bestBranch];
    const stops = sts.map(st => {
      const s = feed.stopById[st.stop_id]; if (!s) return null;
      const u = projectToPolyline(poly, +s.stop_lat, +s.stop_lon).u;
      const parent = s.parent_station || s.stop_id;
      const si = stationIndexOf[parent];
      return [+u.toFixed(4), parseT(st.arrival_time), si != null ? si : -1];
    }).filter(Boolean);
    if (stops.length < 2) continue;
    trips.push({ r: rid, b: bestBranch, s: stops });
  }
  return trips;
}

// ---- stations (points) ----
const BART_NAME = { yel: 'Yellow', org: 'Orange', grn: 'Green', red: 'Red', blu: 'Blue', gry: 'Grey (OAK)' };
function outStations(feed, prefix) {
  return feed.stations.map(s => ({
    name_zh: s.stop_name, name_en: s.stop_name,
    lng: +(+s.stop_lon).toFixed(5), lat: +(+s.stop_lat).toFixed(5),
    r: [...(feed.stationRoutes[s.stop_id] || new Set([prefix]))],
  }));
}
const bartPoints = outStations(bart, 'yel');
const ctPoints = outStations(caltrain, 'ct');
const points = [...bartPoints, ...ctPoints];
const stationIndexOfBart = {}; bart.stations.forEach((s, i) => stationIndexOfBart[s.stop_id] = i);
const stationIndexOfCt = {}; caltrain.stations.forEach((s, i) => stationIndexOfCt[s.stop_id] = i + bartPoints.length);

// ---- lines ----
const BART_COLOR = { yel: '#FFFF33', org: '#FF9933', grn: '#339933', red: '#FF0000', blu: '#0099CC', gry: '#B0BEC7' };
const lines = [];
for (const r of bartRoutes) r.branches.forEach((poly, bi) => lines.push({
  name_zh: BART_NAME[r.id] + ' Line', name_en: BART_NAME[r.id] + ' Line' + (r.branches.length > 1 ? ` (branch ${bi + 1})` : ''),
  color: BART_COLOR[r.id], path: poly.map(([lat, lon]) => [+lon.toFixed(5), +lat.toFixed(5)]), route: r.id, branch: bi,
}));
for (const r of caltrainRoutes) r.branches.forEach((poly, bi) => lines.push({
  name_zh: 'Caltrain', name_en: 'Caltrain' + (r.branches.length > 1 ? ` (branch ${bi + 1})` : ''),
  color: '#CE202F', path: poly.map(([lat, lon]) => [+lon.toFixed(5), +lat.toFixed(5)]), route: 'ct', branch: bi,
}));

// ---- schedule ----
const BART_WEEKDAY = bart.trips.find(t => /-DX-MVS-Weekday-001$/.test(t.service_id))?.service_id;
const bartSchedule = buildSchedule(bart, bartRoutes, BART_WEEKDAY, stationIndexOfBart);
const ctSchedule = buildSchedule(caltrain, caltrainRoutes, '72982', stationIndexOfCt);
const schedule = [...bartSchedule, ...ctSchedule];

fs.writeFileSync(P('tools/terrain-data.json'), JSON.stringify({ points, lines, schedule }));
console.log(`points: ${points.length} (BART ${bartPoints.length}, Caltrain ${ctPoints.length})`);
console.log(`lines: ${lines.length}`);
console.log(`schedule: ${schedule.length} trips, ${schedule.reduce((a, t) => a + t.s.length, 0)} stop-events`);
console.log('lng range', Math.min(...points.map(p => p.lng)), Math.max(...points.map(p => p.lng)));
console.log('lat range', Math.min(...points.map(p => p.lat)), Math.max(...points.map(p => p.lat)));

/* =====================================================================
 *  route-logic.js — "BART Runner" commuter routing (fork-only, pure logic)
 *
 *  Point-to-point route reasoning over this fork's D.schedule (one real
 *  weekday of BART + Caltrain trips, seconds-since-midnight Pacific).
 *  Pure module: no DOM, no THREE, no engine imports — every function takes
 *  its data and the current clock as arguments, so the same logic can later
 *  be fed LIVE ETAs (BART etd / 511 StopMonitoring) instead of schedule
 *  times without changing a line here. route-ui.js owns the DOM overlay.
 *
 *  Time base: seconds since midnight, America/Los_Angeles (the same clock
 *  entities.js nowSeconds() returns and D.schedule stop times use).
 * ===================================================================== */

/* ---- countdown + urgency ------------------------------------------- *
 *  Thresholds are the "looking at your phone running down the escalator"
 *  bands: >5 min relax (green), 2–5 min hurry (amber), <2 min run (red —
 *  the UI flashes it). Second-precision by design: both BART's ETD feed
 *  and 511's StopMonitoring carry full timestamps under the hood; the
 *  official apps' minute rounding is a UI choice, not a feed limit. */
export const URGENCY = { GREEN_ABOVE: 300, RED_BELOW: 120 };
export function countdownFrom(departSec, nowSec){
  const raw = departSec - nowSec;
  const s = Math.max(0, Math.round(raw));
  const mm = Math.floor(s/60), ss = s%60;
  return {
    seconds: s,
    label: s >= 3600 ? Math.floor(s/3600) + "h" + String(mm%60).padStart(2,"0") : mm + ":" + String(ss).padStart(2,"0"),
    urgency: s > URGENCY.GREEN_ABOVE ? "green" : s >= URGENCY.RED_BELOW ? "amber" : "red",
    departed: raw < 0,
  };
}

/* ---- co-located station groups --------------------------------------- *
 *  The data models a physical interchange complex as one point PER SYSTEM
 *  (Millbrae is index 42 for BART and 64 for Caltrain, ~30 m apart), so
 *  cross-system journeys need "same place" knowledge. Group any points
 *  within maxKm of each other; every group includes the point itself.
 *  groupKey() gives a stable representative (min index) for dedup. */
function kmBetween(a, b){
  const dLat = (a.lat - b.lat) * 111.32;
  const dLng = (a.lng - b.lng) * 111.32 * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180);
  return Math.sqrt(dLat*dLat + dLng*dLng);
}
export function buildStationGroups(points, maxKm = 0.25){
  const groups = points.map((_, i) => [i]);
  for(let i = 0; i < points.length; i++)
    for(let j = i + 1; j < points.length; j++)
      if(kmBetween(points[i], points[j]) <= maxKm){ groups[i].push(j); groups[j].push(i); }
  return groups;
}
export const groupKey = (groups, i) => Math.min(...groups[i]);

/* ---- line-membership filtering (the Balboa Park → 12th St problem) -- *
 *  Of Red/Yellow/Blue northbound through Balboa Park, only Red and Yellow
 *  actually reach 12th St Oakland — hide the lines that don't serve both
 *  ends instead of showing every line through the origin. points is
 *  D.geography.points; each carries r: [lineIds]. */
export function findDirectLines(originIdx, destIdx, points){
  const dl = new Set(points[destIdx].r);
  return points[originIdx].r.filter(r => dl.has(r));
}

/* ---- trip-level direct search --------------------------------------- *
 *  Stronger than line membership: scans the actual trips, so direction
 *  (origin stop time strictly before destination stop time on the SAME
 *  trip) and skip-stop patterns (a Caltrain limited that skips your
 *  station) are handled for free. A trip's stop list holds a station
 *  twice when it dwells (arrival + departure rows): board at the LAST
 *  time at the origin, alight at the FIRST time at the destination. */
function tripTimesAt(trip, si){
  let first = null, last = null;
  for(const stop of trip.s){ if(stop[2] === si){ if(first === null) first = stop[1]; last = stop[1]; } }
  return first === null ? null : { first, last };
}
export function findDirectTrips(schedule, originIdx, destIdx, nowSec, limit = 3){
  const out = [];
  for(const trip of schedule){
    const o = tripTimesAt(trip, originIdx); if(!o) continue;
    const d = tripTimesAt(trip, destIdx);  if(!d) continue;
    if(d.first <= o.last) continue;          // wrong direction on this trip
    if(o.last < nowSec) continue;            // already departed
    out.push({ r: trip.r, b: trip.b, dep: o.last, arr: d.first });
  }
  out.sort((a,b) => a.dep - b.dep);
  return limit ? out.slice(0, limit) : out;
}

/* Grouped variant: origin/destination mean the whole physical complex
 *  (either Millbrae point boards either system). Merges member pairs. */
export function findDirectTripsGrouped(schedule, groups, originIdx, destIdx, nowSec, limit = 3){
  const out = [];
  for(const o of groups[originIdx])
    for(const d of groups[destIdx])
      out.push(...findDirectTrips(schedule, o, d, nowSec, limit).map(t => ({ ...t, o, d })));
  out.sort((a,b) => a.dep - b.dep);
  return limit ? out.slice(0, limit) : out;
}

/* ---- one-transfer routing ------------------------------------------- *
 *  Candidate interchanges = station complexes reachable direct from the
 *  origin that also reach the destination direct. For each: earliest
 *  boardable leg 1, then the earliest leg 2 from any point in the via
 *  complex departing ≥ the transfer buffer after leg 1 arrives — 120 s
 *  same-platform-complex default (BART cross-platform transfers are
 *  timed), 240 s when leg 2 leaves from a different co-located point
 *  (Millbrae BART → Caltrain means fare gates + a walk).
 *  Same route+branch on both legs is staying on the train, not a transfer.
 *  Feed it live ETAs later by passing a schedule built from feed data. */
export function findTransferRoutes(schedule, points, originIdx, destIdx, nowSec, opts = {}){
  const { bufferSec = 120, walkBufferSec = 240, limit = 3, groups = points.map((_, i) => [i]) } = opts;
  const oMembers = new Set(groups[originIdx]), dMembers = new Set(groups[destIdx]);
  const oLines = new Set(), dLines = new Set();
  for(const i of oMembers) points[i].r.forEach(x => oLines.add(x));
  for(const i of dMembers) points[i].r.forEach(x => dLines.add(x));
  const bestByVia = new Map();   // via group key -> best route through that complex
  for(let via = 0; via < points.length; via++){
    if(oMembers.has(via) || dMembers.has(via)) continue;
    if(!points[via].r.some(x => oLines.has(x))) continue;   // leg 1 can't reach this point
    if(!groups[via].some(w => points[w].r.some(x => dLines.has(x)))) continue;   // complex can't reach dest
    let leg1 = null;
    for(const o of oMembers){ const t = findDirectTrips(schedule, o, via, nowSec, 1)[0];
      if(t && (!leg1 || t.arr < leg1.arr)) leg1 = { ...t, o }; }
    if(!leg1) continue;
    let best = null;
    for(const w of groups[via]){
      if(oMembers.has(w) || dMembers.has(w)) continue;
      const ready = leg1.arr + (w === via ? bufferSec : walkBufferSec);
      for(const d of dMembers){
        const t = findDirectTrips(schedule, w, d, ready, 1)[0];
        if(!t) continue;
        if(t.r === leg1.r && t.b === leg1.b && w === via) continue;   // staying on the same train
        if(!best || t.arr < best.arr) best = { ...t, w, d };
      }
    }
    if(!best) continue;
    const route = { via, viaFrom: best.w, leg1, leg2: best, dep: leg1.dep, arr: best.arr };
    const key = groupKey(groups, via);
    const prev = bestByVia.get(key);
    if(!prev || route.arr < prev.arr) bestByVia.set(key, route);
  }
  return [...bestByVia.values()].sort((a,b) => a.arr - b.arr || a.dep - b.dep).slice(0, limit);
}

/* ---- is the transfer worth it? --------------------------------------- *
 *  Compares best direct vs best one-transfer arrival — e.g. if Red/Yellow
 *  are a long wait, a Blue train + transfer at West Oakland might beat
 *  standing on the platform. Recommend only when it wins by a clear
 *  minute; nobody transfers to save 20 seconds. */
export function estimateTransferValue(directTrips, transferRoutes, minSavingSec = 60){
  const direct = directTrips[0] || null, transfer = transferRoutes[0] || null;
  if(!transfer) return { recommendTransfer: false, savingSec: 0, direct, transfer: null };
  if(!direct)   return { recommendTransfer: true, savingSec: Infinity, direct: null, transfer };
  const savingSec = direct.arr - transfer.arr;
  return { recommendTransfer: savingSec >= minSavingSec, savingSec, direct, transfer };
}

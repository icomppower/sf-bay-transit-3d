/* =====================================================================
 *  route-ui.js — "BART Runner" pinned-route overlay (fork-only)
 *
 *  The glanceable commuter card on top of the 3D canvas: pin an
 *  Origin → Destination once and the card shows, live, the next real
 *  departures that actually serve that journey — down-to-the-second
 *  countdowns colour-coded by urgency (green > 5 min, amber 2–5, flashing
 *  red < 2 — "you need to run"), plus a one-transfer suggestion when no
 *  direct line exists or when a transfer genuinely beats waiting.
 *
 *  All reasoning lives in route-logic.js (pure); this module owns only the
 *  DOM. Times come from the real weekday GTFS schedule via D.schedule and
 *  the Pacific-time clock (entities.js nowSeconds) — the same sources as
 *  the click-a-station popup, which feeds this card its "From here /
 *  To here" pins via the "route-pin" CustomEvent. The pinned route
 *  persists in localStorage, so a commuter's card is already loaded on
 *  open — no panning, zooming, or clicking required.
 * ===================================================================== */
import { D, FAC } from "./config.js";
import { nowSeconds } from "./entities.js";
import { countdownFrom, buildStationGroups, groupKey, findDirectTripsGrouped,
         findTransferRoutes, estimateTransferValue } from "./route-logic.js";

const LS_KEY = "sfbay3d_route";
const pts = () => D.geography.points;

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
const fmtHM = t => String(Math.floor(t/3600)%24).padStart(2,"0") + ":" + String(Math.floor(t%3600/60)).padStart(2,"0");
const lineDot = r => { const f = FAC[r];
  return `<span class="rdot" style="background:${f ? f.css : "#888"}"></span>`; };
const lineName = r => { const f = FAC[r]; return esc(f ? f.name_en : r); };

export function initRouteUI(){
  const sched = D.schedule || [];
  if(!sched.length || !pts().length) return;   // nothing to route over (engine base, not this fork)
  const groups = buildStationGroups(pts());

  /* one select entry per physical station complex (Millbrae once, not twice) */
  const stations = pts().map((p, i) => ({ i, name: p.name_en || p.name_zh }))
    .filter(s => groupKey(groups, s.i) === s.i)
    .sort((a, b) => a.name.localeCompare(b.name));

  const saved = (() => { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch(e){ return {}; } })();
  const byName = n => { const s = stations.find(s => s.name === n); return s ? s.i : -1; };
  const state = { o: byName(saved.o), d: byName(saved.d), open: !!saved.open && byName(saved.o) >= 0 };
  const save = () => { try { localStorage.setItem(LS_KEY, JSON.stringify({
    o: state.o >= 0 ? pts()[state.o].name_en : null,
    d: state.d >= 0 ? pts()[state.d].name_en : null,
    open: state.open })); } catch(e){} };

  /* ---- chrome ---- */
  const style = document.createElement("style");
  style.textContent = `
    #route-pill{position:fixed;z-index:8;right:18px;bottom:64px;font-family:var(--mono);font-size:11px;
      letter-spacing:1px;color:var(--accent);background:var(--panel);border:1px solid var(--panel-edge);
      border-radius:20px;padding:7px 14px;cursor:pointer;backdrop-filter:blur(6px);box-shadow:0 6px 22px rgba(0,0,0,.5)}
    #route-pill:hover{background:rgba(216,192,138,.2)}
    #route-card{position:fixed;z-index:8;right:18px;bottom:64px;width:min(304px,94vw);display:none;
      flex-direction:column;background:rgba(8,12,24,0.93);border:1px solid rgba(140,170,240,0.35);border-radius:12px;
      backdrop-filter:blur(8px);box-shadow:0 10px 34px rgba(0,0,0,.6);font:12px/1.5 var(--mono);color:#dfe8ff}
    #route-card.open{display:flex}
    #route-card .rhd{display:flex;justify-content:space-between;align-items:center;padding:9px 12px 7px;
      border-bottom:1px solid rgba(140,170,240,0.22);font-size:10px;letter-spacing:2px;color:#9fb4e4}
    #route-card .rhd button{background:none;border:none;color:#8b9bc0;font-size:14px;cursor:pointer;padding:0 2px}
    #route-card .rio{display:grid;grid-template-columns:1fr auto;gap:5px 7px;padding:9px 12px 4px;align-items:center}
    #route-card select{width:100%;background:rgba(20,28,48,0.9);color:#dfe8ff;border:1px solid rgba(140,170,240,0.3);
      border-radius:6px;padding:4px 5px;font:11px var(--mono);max-width:238px}
    #route-card .swap{grid-row:span 2;background:rgba(140,170,240,0.12);border:1px solid rgba(140,170,240,0.3);
      border-radius:7px;color:#aecdff;font-size:13px;cursor:pointer;padding:6px 8px}
    #route-card .swap:hover{background:rgba(140,170,240,0.25)}
    #route-card .rbody{padding:5px 12px 11px}
    #route-card .rsec{margin-top:6px;font-size:9px;letter-spacing:1.5px;color:#7d8fb8}
    #route-card .rrow{display:flex;align-items:baseline;gap:7px;margin-top:5px;white-space:nowrap}
    #route-card .rdot{width:9px;height:9px;border-radius:50%;display:inline-block;flex:0 0 auto;align-self:center}
    #route-card .rline{overflow:hidden;text-overflow:ellipsis;max-width:96px}
    #route-card .rtimes{color:#aebdde;font-size:11px}
    #route-card .cd{margin-left:auto;font-weight:700;font-size:14px;font-variant-numeric:tabular-nums}
    #route-card .cd.green{color:#5fd97a}
    #route-card .cd.amber{color:#ffc44d}
    #route-card .cd.red{color:#ff5a5a;animation:route-blink 0.85s steps(2,start) infinite}
    @keyframes route-blink{50%{opacity:0.25}}
    #route-card .rhint{margin-top:7px;color:#8b9bc0;font-size:11px;white-space:normal}
    #route-card .rvia{margin-top:3px;padding:6px 8px;border:1px solid rgba(140,170,240,0.22);border-radius:8px;background:rgba(140,170,240,0.06)}
    #route-card .rvia .leg{display:flex;align-items:baseline;gap:6px;white-space:nowrap;font-size:11px;margin-top:2px}
    #route-card .rnow{color:#7d8fb8;font-size:9px;letter-spacing:1px}
    @media (max-width:600px){ #route-pill{right:10px;bottom:88px} #route-card{right:10px;bottom:88px} }
    #stopop .pinbtn{font:10px var(--mono);letter-spacing:.5px;color:#aecdff;background:rgba(140,170,240,0.12);
      border:1px solid rgba(140,170,240,0.35);border-radius:6px;padding:3px 8px;cursor:pointer;flex:1}
    #stopop .pinbtn:hover{background:rgba(140,170,240,0.28)}`;
  document.head.appendChild(style);

  const pill = document.createElement("button");
  pill.id = "route-pill"; pill.textContent = "▸ ROUTE";
  const card = document.createElement("div");
  card.id = "route-card";
  const opts = ph => `<option value="-1">— ${ph} —</option>` +
    stations.map(s => `<option value="${s.i}">${esc(s.name)}</option>`).join("");
  card.innerHTML =
    `<div class="rhd"><span>PINNED ROUTE · <span class="rnow" id="route-now"></span></span><button id="route-close" aria-label="Collapse">✕</button></div>` +
    `<div class="rio">` +
      `<select id="route-o" aria-label="Origin station">${opts("origin")}</select>` +
      `<button class="swap" id="route-swap" title="Swap origin and destination" aria-label="Swap">⇅</button>` +
      `<select id="route-d" aria-label="Destination station">${opts("destination")}</select>` +
    `</div>` +
    `<div class="rbody" id="route-body"></div>`;
  document.body.appendChild(pill); document.body.appendChild(card);

  const selO = card.querySelector("#route-o"), selD = card.querySelector("#route-d"),
        body = card.querySelector("#route-body"), nowEl = card.querySelector("#route-now");
  const syncSelects = () => { selO.value = String(state.o); selD.value = String(state.d); };
  const setOpen = o => { state.open = o; card.classList.toggle("open", o); pill.style.display = o ? "none" : "block"; save(); if(o) render(); };
  pill.onclick = () => setOpen(true);
  card.querySelector("#route-close").onclick = () => setOpen(false);
  card.querySelector("#route-swap").onclick = () => { const t = state.o; state.o = state.d; state.d = t; syncSelects(); save(); render(); };
  selO.onchange = () => { state.o = +selO.value; save(); render(); };
  selD.onchange = () => { state.d = +selD.value; save(); render(); };

  /* pins arriving from the click-a-station popup (entities.js) */
  document.addEventListener("route-pin", e => {
    const { si, role } = e.detail;
    state[role] = groupKey(groups, si);   // popup gives a raw point; pin its complex
    syncSelects(); save(); setOpen(true);
  });

  /* ---- render: recompute the plan + tick every countdown ------------- *
   *  The full plan is ~0.1 ms over 767 trips, so it simply recomputes each
   *  1 s tick — departed trips fall off and the countdowns stay honest. */
  const row = (t, now) => { const cd = countdownFrom(t.dep, now);
    return `<div class="rrow">${lineDot(t.r)}<span class="rline">${lineName(t.r)}</span>` +
      `<span class="rtimes">${fmtHM(t.dep)} → ${fmtHM(t.arr)}</span>` +
      `<span class="cd ${cd.urgency}">${cd.label}</span></div>`; };
  const legRow = (t, now) => { const cd = countdownFrom(t.dep, now);
    return `<div class="leg">${lineDot(t.r)}<span class="rline">${lineName(t.r)}</span>` +
      `<span class="rtimes">${fmtHM(t.dep)} → ${fmtHM(t.arr)}</span>` +
      `<span class="cd ${cd.urgency}" style="margin-left:auto">${cd.label}</span></div>`; };
  function render(){
    if(!state.open) return;
    const now = nowSeconds();
    nowEl.textContent = "now " + fmtHM(now) + " PT";
    if(state.o < 0 || state.d < 0){
      body.innerHTML = `<div class="rhint">Pick both ends above — or click any station on the map and use “From here / To here”.</div>`;
      return;
    }
    if(state.o === state.d){ body.innerHTML = `<div class="rhint">Origin and destination are the same station.</div>`; return; }
    const direct = findDirectTripsGrouped(sched, groups, state.o, state.d, now, 3);
    const transfers = findTransferRoutes(sched, pts(), state.o, state.d, now, { groups, limit: 1 });
    const ev = estimateTransferValue(direct, transfers);
    let html = "";
    if(direct.length){
      html += `<div class="rsec">DIRECT · ${esc(pts()[state.o].name_en)} → ${esc(pts()[state.d].name_en)}</div>`;
      html += direct.map(t => row(t, now)).join("");
    }
    if(ev.recommendTransfer && ev.transfer){
      const tr = ev.transfer;
      const faster = direct.length ? ` · ${Math.round(ev.savingSec/60)} min faster` : "";
      html += `<div class="rsec">${direct.length ? "⚡ FASTER" : "NO DIRECT LINE —"} VIA ${esc(pts()[tr.via].name_en).toUpperCase()}${faster}</div>` +
        `<div class="rvia">${legRow(tr.leg1, now)}${legRow(tr.leg2, now)}</div>`;
    }
    if(!html) html = `<div class="rhint">No more scheduled service today between these stations (weekday timetable).</div>`;
    body.innerHTML = html;
  }
  setInterval(render, 1000);
  if(state.open) setOpen(true); else pill.style.display = "block";
  syncSelects(); render();
}

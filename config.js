/* =====================================================================
 *  config.js: Battle 3D engine · tunables, data handle, utilities
 *  The loud-failure guard (No Fallback), the engine CFG constants, the
 *  small math, and the boot helpers. Imported by every other module;
 *  imports only ./validate.js (the shared data contract).
 *
 *  THIN ADAPTER: the battle-specific values (the map box, the clock window,
 *  the factions) ORIGINATE in the battle's data.js (D.meta / D.factions).
 *  This file re-exposes them as CFG.GEO/DAY and FAC so every engine module
 *  keeps importing them unchanged — but the engine itself names no battle,
 *  no faction, and no language. A fork edits data.js, never this file.
 * ===================================================================== */

import { validateBattleData } from "./validate.js";   // the shared data contract (also run by tools/validate.mjs)

/* ---- fail loudly, never silently ----------------------------------- *
 *  First error wins (shown-once) so the root cause is what the user sees.
 *  English only: this runs before the battle's language pack is available. */
let shown = false;
export function fatal(e){
  if(shown) return; shown=true;
  const el=document.getElementById("err");
  el.style.display="block";
  const msg=(e&&e.stack?e.stack:String(e));
  // The remedy depends on the error: a WebGL-context failure means too many live 3D contexts (NOT a server/file:// problem,
  // which is the common-but-wrong assumption); a tile/load failure usually means the page was opened over file://.
  const hint=/WebGL context/i.test(msg)
    ? "\n\nToo many open 3D tabs/contexts — close other browser tabs (or fully restart your browser) and reload."
    : "\n\nThis needs an http(s) server; opening the file directly via file:// can't read the "+
      "terrain tiles (browser security). Run `node tools/serve.js` or use a local preview.";
  el.textContent="⚠ Initialization error:\n\n"+msg+hint;
  const boot=document.getElementById("boot"); if(boot) boot.classList.add("gone");
  console.error(e);
}
window.addEventListener("error", ev=>fatal(ev.error||ev.message));

/* ---- dependency guard: a missing vendored lib (or data.js) must fail *
 *  loud here, before any module touches THREE / BATTLE_DATA. English-only
 *  (D / the language pack is not yet guaranteed at this point). */
try {
  if(typeof THREE==="undefined") throw new Error("THREE not loaded (lib/three.min.js)");
  if(!THREE.OrbitControls) throw new Error("OrbitControls not loaded");
  if(!THREE.CSS2DRenderer) throw new Error("CSS2DRenderer not loaded");
  if(!window.BATTLE_DATA) throw new Error("BATTLE_DATA not loaded (data.js)");
}catch(e){ fatal(e); throw e; }   // throw aborts module loading so the broken engine never half-renders

export const D = window.BATTLE_DATA;
export const bootMsg = t => { const m=document.getElementById("boot-msg"); if(m) m.textContent=t; };

/* ---- data-contract validator, defined in ./validate.js (imported above, shared with
 *  tools/validate.mjs). A fork that omits/mistypes a required field fails LOUD here, naming it, instead of a silent
 *  NaN/undefined render. Optional UI strings default below; optional scenario arrays are guarded by the engine. */
try { validateBattleData(D); }catch(e){ fatal(e); throw e; }   // abort module load → the engine never half-renders bad data

/* ---- engine UI DEFAULTS (English) --------------------------------- *
 *  Every engine-rendered string, defaulted so a fork that omits one shows the
 *  English default — never the literal word "undefined" (these are interpolated
 *  into innerHTML, where undefined stringifies). A battle overrides what it
 *  translates; a fully-localized battle overrides them all. Same deep-merge as DEFAULT_THEME. */
const DEFAULT_UI = {
  boot:{ dem:"Loading terrain elevation (DEM)…", imagery:"Loading satellite imagery…", terrain:"Building terrain…", music:"Loading music…", starting:"Starting…" },
  err:{ tileLoad:"map tile failed to load: ", tilesMissing:"too many map tiles are missing", tilesMissingHint:"re-run the tile fetch", tileGaps:"map tiles" },
  frontLine:{ zh:"Front line", en:"Front line" },
  strengthUnit:"", endLabel:"END",
  notesCaveatsHeader:"Caveats", notesSourcesHeader:"Sources",
  langToggle:{ both:"A·B", zh:"A", en:"B" },
  // HUD chrome the engine paints via buildChrome() — index.html carries no battle text; a fork omits these → English.
  notesBtn:"ⓘ Notes", notesHeader:"NOTES & SOURCES", resume:"▶ Resume tour",
  hint:{ autoplay:"Auto-playing", drag:"Drag to free-look (pauses the tour)" },
  legend:{ symbolsHeader:"Symbols", flagsHeader:"Flags",
    advance:"Advance", hq:"Headquarters", infantry:"Infantry", air:"Air", navy:"Naval", artillery:"Artillery",
    contact:"In contact", strength:"Strength",
    movement:"Movement", combat:"Combat / fire", lost:"Lost / surrendered" },
  disclaimer:"Present-day satellite imagery — terrain/coastline may differ from the battle period.<br>"
    +"Imagery © EOX Sentinel-2 cloudless 2016 (CC BY 4.0, s2maps.eu, modified Copernicus Sentinel data) · elevation SRTM courtesy USGS",
};
const mergeUI=(dft,o)=>{ const r={...dft,...(o||{})}; for(const k of ["boot","err","frontLine","langToggle","hint","legend"]) r[k]={...dft[k],...((o&&o[k])||{})}; return r; };
D.ui = mergeUI(DEFAULT_UI, D.ui);

/* ---- engine DEFAULTS (used only when a battle declares nothing) ---- *
 *  A battle restyles its look + typography purely via data (D.meta.theme / D.meta.fonts);
 *  these are a broad, neutral fallback so an unset fork still renders. They are the ONLY
 *  battle-flavoured literals the engine carries, and only as a last resort. */
const DEFAULT_THEME = {
  sky:{ day:0x6f9fd0, dayB:0xcad9e2, night:0x10182c, nightB:0x243349, over:0x5a6470, overB:0x808a92 },
  smoke:0x4a3f3a, sea:0x14323f, sun:{ day:0xfff1d6, night:0x8ea6cf }, amb:{ day:0x404a55, night:0x1c2a44 },
  grade:{ filter:"sepia(0.32) saturate(0.6) contrast(1.05) brightness(0.97)", vignette:0.42, grain:0.045 },
};
const DEFAULT_FONTS = {
  display:'"Microsoft JhengHei","PingFang TC","Noto Sans TC","Segoe UI",system-ui,sans-serif',  // broad: covers CJK + Latin
  mono:'"Consolas","SFMono-Regular",ui-monospace,monospace',
};
// deep-merge the battle's theme over the default (one nested level → a fork can override a single colour)
const mergeTheme=(d,o)=>{ const r={...d,...(o||{})}; for(const k of ["sky","sun","amb","grade"]) r[k]={...d[k],...((o&&o[k])||{})}; return r; };
const THEME = mergeTheme(DEFAULT_THEME, D.meta.theme);
const FONTS = { ...DEFAULT_FONTS, ...(D.meta.fonts||{}) };

/* ========================= CONFIG ================================== */
export const CFG = {
  GEO: D.meta.geo,      // the battle's map box + zoom (from data.js; == tools/fetch_tiles.mjs)
  TARGET_UNITS: 2000,   // world width of the map (height derived → to scale)
  VEXAG: 2.0,           // vertical exaggeration (Y only; XZ stays true to scale). DEFAULT before tiles; terrain.js AUTO-DERIVES
                        // it from the real relief so any-size theatre reads with sane relief (flat → more, alpine → less):
                        // VEXAG = clamp(RELIEF_UNITS / (reliefRange_metres * M2U), VEXAG_MIN, VEXAG_MAX), unless a battle pins meta.vexag.
  RELIEF_UNITS: 84,     // target world-unit height of the relief in the cinematic look — the anchor (chosen so a ~950 m relief over a
                        // ~30 km bbox derives ≈ 2.0); a pure aesthetic, no battle/coordinate in it.
  VEXAG_MIN: 0.6, VEXAG_MAX: 6.0,   // noise-floor clamp: a perfectly flat or alpine theatre can't spike or flatten absurdly.
  TERR_SEG: 420,        // terrain mesh resolution
  SSAA: 1.0,            // supersample factor → render above display res to calm aliasing under the orbit (capped so retina never regresses). 1.0 keeps the framebuffer light enough for integrated GPUs (~1GB); antialias MSAA still smooths edges.
  MAX_IMAGERY_TEX: 4096,// cap the composited imagery texture's LONG side so a wide bbox can't exceed an integrated GPU's memory (e.g. an 8448-wide source caps to 4096 ≈ 138MB→31MB). Clamps only the long side → battles with native texture ≤4096 are untouched.
  // archival film grade on the (present-day) satellite imagery; ages modern colour cues toward
  // period footage. Noise floor: saturation ≥0.55, vignette ≤0.5 so the battle area (centre) stays legible.
  GRADE: THEME.grade,   // the archival film grade (from the battle's theme, or the default)
  DAY_MIN: D.meta.dayMin, DAY_MAX: D.meta.dayMax,   // the battle's clock window (from data.js)
  TWEEN: 2.4,            // camera move duration between shots (s)
  ZOOM: 0.45,           // multiplies each shot's camera distance → tighter framing on the action
  FOCUS:{ UNIT_DIM:0.12, PLACE_NEAR:300, PLACE_FAR:950, MAX_PLACES:6 }, // show only the nearest few place names
  FLASH_K: 0.26,        // muzzle/explosion flash-light dampening (was blowing out the scene)
  // entity scale (tuned to the ~2000-unit metric extent)
  FLAG_H: 30, FLAG_W: 26, FLAG_TH: 16,   // shorter staff + smaller cloth → less "stadium banner / km-pole" clash
  RING_IN: 5, RING_OUT: 8, TOKEN_R: 6.5, TOKEN_H: 7, POLE_R: 0.6, FINIAL_R: 1.2,   // TOKEN_R kept → wedge footprint unchanged
  LBL_REGION: 80, LBL_PEAK: 44, LBL_TOWN: 34, LBL_FORT: 38, LBL_UNIT: 34,
  EU: 5.0,              // effect spatial unit
  GLOW_PSCALE: 400,     // bright additive points (smaller → less glare)
  SMOKE_PSCALE: 340,    // smoke kept modest so it reads as a column, not a dark canopy
  // ---- semantic / scale constants the engine reads (a battle can restyle these without touching the engine) ----
  FRONT_COLOR: "#ffb24a",            // the advancing front-line tube + label colour
  UNIT_STRENGTH_CEIL: 2200,          // per-unit strength → token-scale ceiling (largest formation → full size)
  DEAD_COLOR: 0x55585c, RETREAT_COLOR: 0x888888,   // semantic token/ring tints (destroyed / retreating)
  THEME, FONTS,         // the battle's cinematic palette (sky/sun/amb/sea/smoke) + typography (display/mono fonts)
};
// The battle's factions (colours, roles, names, ceilings) — defined in data.js.
// The engine iterates Object.keys(FAC) and reads FAC[key].* + role; it never names a faction.
export const FAC = D.factions;
export const REDUCE_MOTION = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);  // honour the OS "reduce motion" preference → drop the cinematic auto-orbit

/* ---- small math --------------------------------------------------- */
export const clamp=(v,a,b)=>v<a?a:v>b?b:v;
export const lerp=(a,b,t)=>a+(b-a)*t;
export const smooth=(e0,e1,x)=>{ const t=clamp((x-e0)/(e1-e0||1e-6),0,1); return t*t*(3-2*t); };
export const easeIO=t=>t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
export const deg=Math.PI/180;
export const sameLang=(a,b)=>(""+(a??"")).trim()===(""+(b??"")).trim();   // the two language slots hold the same text → render the label/legend once, not twice (single-language battles)

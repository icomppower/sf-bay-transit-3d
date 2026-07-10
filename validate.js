/* =====================================================================
 *  validate.js: the battle DATA CONTRACT, enforced.
 *  ---------------------------------------------------------------------
 *  ONE source of truth for "is this battle renderable?". A fork that omits or
 *  mis-types a required field fails LOUD here — naming the exact field — instead
 *  of rendering silent NaN/undefined garbage. Optional UI strings are NOT checked
 *  (they default in config.js); optional scenario arrays (fronts/weather/hotspots/
 *  geography.regions/points) may be absent (the engine guards them) but are checked
 *  if present.
 *
 *  Used in TWO places, so the contract can never drift:
 *    • config.js  — calls it at boot (browser); a failure becomes the fatal() overlay.
 *    • tools/validate.mjs — runs it from the command line (node, no browser, no tiles)
 *      so a contributor can validate a data.js in a tight edit loop.
 *  English-only: this runs before the battle's own language pack is available.
 *  Imports nothing; references no faction/coordinate/language — only the contract shape.
 * ===================================================================== */

/* The selectable VOCABULARIES the engine can depict. The contract owns the valid SELECTIONS (these lists);
 * entities.js owns the DEPICTION (the matching FORM shapes + HOTSPOT_FX particle recipes) and imports these
 * so there is one source. A battle picks from them — it never has to program a new effect. Fail-loud here on
 * an unknown pick, so a typo ("atack", "tankfire") is named at boot/CLI instead of silently doing the wrong thing. */
export const UNIT_STATES  = ["march", "hold", "attack", "retreat", "landing", "dead"];           // a track keyframe's st
export const HOTSPOT_KINDS = ["firefight", "artillery", "explosion", "landing", "air", "oilfire"]; // a hotspot's combat FX

export function validateBattleData(d){
  if(!d || typeof d!=="object") throw new Error("BATTLE_DATA (data.js) did not produce an object.");
  const errs=[];
  const num=v=>typeof v==="number" && isFinite(v);
  const str=v=>typeof v==="string" && v.length>0;
  const pair=p=>Array.isArray(p) && num(p[0]) && num(p[1]);                 // a [lng,lat] coordinate
  const polyline=p=>Array.isArray(p) && p.length>=2 && p.every(pair);      // a path of [lng,lat] points
  const cam=(c,label,fields)=>{ if(!c||typeof c!=="object"){ errs.push(`${label} is missing`); return; }
    for(const k of fields) if(!num(c[k])) errs.push(`${label}.${k} must be a finite number`); };
  // ---- a D.meta.fx custom effect spec (see fx.js): validate the shape so a malformed effect fails loud, not NaN ----
  const isObj=v=>v && typeof v==="object" && !Array.isArray(v);
  const vAxis=(a,at)=>{ if(!isObj(a)) errs.push(`${at} must be an object {b?,j?,r?}`);
    else if(a.j!=null && !(Array.isArray(a.j) && num(a.j[0]) && num(a.j[1]))) errs.push(`${at}.j must be [lo,hi]`); };
  const vEmit=(em,at)=>{ if(!isObj(em)){ errs.push(`${at} must be an object`); return; }
    if(em.sys!=="glow" && em.sys!=="smoke") errs.push(`${at}.sys must be "glow" or "smoke"`);
    if(!Array.isArray(em.pos)||em.pos.length!==3) errs.push(`${at}.pos must be [axis,axis,axis]`); else em.pos.forEach((a,i)=>vAxis(a,`${at}.pos[${i}]`));
    if(em.vel && em.vel.radial){ const sp=em.vel.radial.speed; if(!(Array.isArray(sp)&&num(sp[0])&&num(sp[1]))) errs.push(`${at}.vel.radial.speed must be [lo,hi]`); }
    else if(!Array.isArray(em.vel)||em.vel.length!==3) errs.push(`${at}.vel must be [axis,axis,axis] or {radial,y}`);
    for(const k of ["size","life","color"]) if(em[k]==null) errs.push(`${at}.${k} is required`); };
  const vSpec=(spec,at)=>{ if(!isObj(spec)){ errs.push(`${at} must be an object`); return; }
    if(spec.continuous!=null){ if(!Array.isArray(spec.continuous)) errs.push(`${at}.continuous must be an array`); else spec.continuous.forEach((em,i)=>vEmit(em,`${at}.continuous[${i}]`)); }
    if(spec.onFire!=null){ if(!isObj(spec.onFire)) errs.push(`${at}.onFire must be an object`);
      else if(spec.onFire.emit!=null){ if(!Array.isArray(spec.onFire.emit)) errs.push(`${at}.onFire.emit must be an array`); else spec.onFire.emit.forEach((em,i)=>vEmit(em,`${at}.onFire.emit[${i}]`)); } }
    if(spec.cadence!=null && !(isObj(spec.cadence)&&Array.isArray(spec.cadence.range)&&num(spec.cadence.range[0])&&num(spec.cadence.range[1]))) errs.push(`${at}.cadence.range must be [lo,hi]`); };

  /* ---- meta (required) ---- */
  const m=d.meta;
  if(!m || typeof m!=="object") errs.push("meta (map box + clock + identity) is missing");
  else {
    const g=m.geo;
    if(!g || typeof g!=="object") errs.push("meta.geo (the map bounding box) is missing");
    else for(const k of ["minLng","maxLng","minLat","maxLat","Z"]) if(!num(g[k])) errs.push(`meta.geo.${k} must be a finite number`);
    for(const k of ["dayMin","dayMax","year","month","lastDay"]) if(!num(m[k])) errs.push(`meta.${k} must be a finite number`);
    for(const k of ["title","subtitle"]) if(!str(m[k])) errs.push(`meta.${k} (string) is missing`);
    if(m.vexag!=null && !num(m.vexag)) errs.push("meta.vexag must be a finite number if set");
    if(m.fx!=null){ if(!isObj(m.fx)) errs.push("meta.fx must be an object of effect specs"); else for(const k of Object.keys(m.fx)) vSpec(m.fx[k], `meta.fx.${k}`); }
  }

  /* ---- factions (required, ≥1; CSS-safe non-reserved keys) ---- */
  const f=d.factions, facKeys=(f&&typeof f==="object")?Object.keys(f):[];
  if(!facKeys.length) errs.push("factions must be a non-empty object (at least one side)");
  else for(const k of facKeys){
    if(!/^[a-zA-Z_][\w-]*$/.test(k)) errs.push(`faction key "${k}" is not a valid CSS identifier (letters/digits/_/-, no leading digit, no spaces)`);
    if(k==="both") errs.push(`faction key "both" is reserved (storyboard side="both" means all factions)`);
    const fa=f[k]||{};
    for(const p of ["css","role","name_zh","name_en"]) if(!str(fa[p])) errs.push(`faction "${k}".${p} (string) is missing`);
    for(const p of ["glow","dim","maxStrength"]) if(!num(fa[p])) errs.push(`faction "${k}".${p} (number) is missing`);
  }
  const isFac=k=>facKeys.includes(k);
  const customFx=(d.meta && isObj(d.meta.fx)) ? Object.keys(d.meta.fx) : [];   // battle-declared effect kinds, selectable like the built-ins

  /* ---- intro / outro cameras (the engine reads exactly these fields per beat) ---- */
  cam(d.intro && d.intro.cam, "intro.cam (the opening title camera)", ["lng","lat","dist","az","el"]);
  cam(d.outro && d.outro.cam, "outro.cam (the closing camera)", ["lng","lat","dist","az","el","orbit","tween"]);

  /* ---- storyboard (required, ≥1 shot; each shot drives a camera move + caption) ---- */
  if(!Array.isArray(d.storyboard) || !d.storyboard.length) errs.push("storyboard must be a non-empty array (the tour needs at least one shot)");
  else d.storyboard.forEach((sh,i)=>{ const at=`storyboard[${i}]`;
    if(!sh||typeof sh!=="object"){ errs.push(`${at} must be an object`); return; }
    for(const k of ["day","hold"]) if(!num(sh[k])) errs.push(`${at}.${k} must be a finite number`);
    for(const k of ["title_zh","title_en","dateLabel"]) if(!str(sh[k])) errs.push(`${at}.${k} (string) is missing`);
    cam(sh.cam, `${at}.cam`, ["lng","lat","dist","az","el","orbit"]);
  });

  /* ---- units + their movement tracks (the timeline substrate) ---- */
  if(!Array.isArray(d.units)) errs.push("units must be an array (may be empty)");
  else d.units.forEach((u,i)=>{ const at=`units[${i}]${u&&u.id?` ("${u.id}")`:""}`;
    if(!u||typeof u!=="object"){ errs.push(`${at} must be an object`); return; }
    if(!str(u.id)) errs.push(`${at}.id (string) is missing`);
    if(!isFac(u.faction)) errs.push(`${at}.faction "${u.faction}" is not a declared faction key`);
    if(!str(u.name_zh)) errs.push(`${at}.name_zh (string) is missing`);
    if(!str(u.flag)) errs.push(`${at}.flag (string) is missing`);
    if(!Array.isArray(u.track) || !u.track.length) errs.push(`${at}.track must be a non-empty array of keyframes`);
    else u.track.forEach((kf,j)=>{ const kat=`${at}.track[${j}]`;
      if(!kf||typeof kf!=="object"){ errs.push(`${kat} must be an object`); return; }
      for(const k of ["d","lng","lat","s"]) if(!num(kf[k])) errs.push(`${kat}.${k} must be a finite number`);
      if(!str(kf.st)) errs.push(`${kat}.st (state) is missing`);
      else if(!UNIT_STATES.includes(kf.st)) errs.push(`${kat}.st "${kf.st}" is not a supported state — use one of: ${UNIT_STATES.join(", ")}`);
    });
  });

  /* ---- movement arrows (array may be empty) ---- */
  if(!Array.isArray(d.arrows)) errs.push("arrows must be an array (may be empty)");
  else d.arrows.forEach((a,i)=>{ const at=`arrows[${i}]`;
    if(!a||typeof a!=="object"){ errs.push(`${at} must be an object`); return; }
    if(!isFac(a.f)) errs.push(`${at}.f "${a.f}" is not a declared faction key`);
    if(!pair(a.from)) errs.push(`${at}.from must be a [lng,lat] pair`);
    if(!pair(a.to)) errs.push(`${at}.to must be a [lng,lat] pair`);
    if(!num(a.d)) errs.push(`${at}.d (day) must be a finite number`);
    if(!str(a.kind)) errs.push(`${at}.kind (string) is missing`);
    if(!str(a.label)) errs.push(`${at}.label (string) is missing`);
  });

  /* ---- geography (object required; regions/points/lines each optional, validated if present) ---- */
  const geo=d.geography;
  if(!geo || typeof geo!=="object") errs.push("geography must be an object");
  else {
    const places=key=>{ const list=geo[key]; if(list==null) return; if(!Array.isArray(list)){ errs.push(`geography.${key} must be an array`); return; }
      list.forEach((p,i)=>{ const at=`geography.${key}[${i}]`;
        if(!p||typeof p!=="object"){ errs.push(`${at} must be an object`); return; }
        if(!num(p.lng)||!num(p.lat)) errs.push(`${at} needs finite lng/lat`);
        if(!str(p.name_zh)||!str(p.name_en)) errs.push(`${at} needs name_zh/name_en`); }); };
    places("regions"); places("points");
    if(geo.lines!=null){ if(!Array.isArray(geo.lines)) errs.push("geography.lines must be an array");
      else geo.lines.forEach((ln,i)=>{ const at=`geography.lines[${i}]`;
        if(!ln||typeof ln!=="object"){ errs.push(`${at} must be an object`); return; }
        if(!polyline(ln.path)) errs.push(`${at}.path must be a polyline of [lng,lat] points`);
        if(!str(ln.name_zh)||!str(ln.name_en)) errs.push(`${at} needs name_zh/name_en`);
        if(!str(ln.color)) errs.push(`${at}.color (css colour string) is missing`); }); }
  }

  /* ---- optional scenario arrays — absent is fine (engine guards them); validated if present ---- */
  if(d.fronts!=null){ if(!Array.isArray(d.fronts)) errs.push("fronts must be an array");
    else d.fronts.forEach((fr,i)=>{ const at=`fronts[${i}]`;
      if(!fr||typeof fr!=="object"){ errs.push(`${at} must be an object`); return; }
      if(!num(fr.d)) errs.push(`${at}.d (day) must be a finite number`);
      if(!polyline(fr.path)) errs.push(`${at}.path must be a polyline of [lng,lat] points`); }); }
  if(d.weather!=null){ if(!Array.isArray(d.weather)) errs.push("weather must be an array");
    else d.weather.forEach((w,i)=>{ const at=`weather[${i}]`;
      if(!w||typeof w!=="object"){ errs.push(`${at} must be an object`); return; }
      for(const k of ["d","night","fog","rain","smoke"]) if(!num(w[k])) errs.push(`${at}.${k} must be a finite number (0..1 for night/fog/rain/smoke)`); }); }
  if(d.hotspots!=null){ if(!Array.isArray(d.hotspots)) errs.push("hotspots must be an array");
    else d.hotspots.forEach((h,i)=>{ const at=`hotspots[${i}]`;
      if(!h||typeof h!=="object"){ errs.push(`${at} must be an object`); return; }
      for(const k of ["a","b","i","lng","lat"]) if(!num(h[k])) errs.push(`${at}.${k} must be a finite number`);
      if(!str(h.kind)) errs.push(`${at}.kind is missing`);
      else if(!HOTSPOT_KINDS.includes(h.kind) && !customFx.includes(h.kind)) errs.push(`${at}.kind "${h.kind}" is not a built-in effect or a meta.fx effect — built-ins: ${HOTSPOT_KINDS.join(", ")}`); }); }

  /* ---- notes (REQUIRED — sourcing is the anti-fabrication backbone, not optional) ---- */
  const n=d.notes;
  if(!n || typeof n!=="object") errs.push("notes (summary + caveats[] + sources) is missing — sourcing is required, history must not be fabricated");
  else { if(!str(n.summary)) errs.push("notes.summary (string) is missing");
    if(!Array.isArray(n.caveats)) errs.push("notes.caveats must be an array (may be empty)");
    if(!str(n.sources)) errs.push("notes.sources (string) is missing — cite your sources (no fabricated history)"); }

  /* ---- flagLegend (array; may be empty) ---- */
  if(!Array.isArray(d.flagLegend)) errs.push("flagLegend must be an array (may be empty)");

  if(errs.length) throw new Error("Battle data (data.js) is invalid:\n  • "+errs.join("\n  • ")+"\n\nFix data.js and reload.");
}

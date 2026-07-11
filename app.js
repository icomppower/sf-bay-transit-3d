/* =====================================================================
 *  app.js: cinematic-3d-battle-engine · self-playing 3D battle documentary (entry)
 *  REAL terrain: AWS Terrarium DEM + Esri World Imagery, Web-Mercator,
 *  to scale. Reads window.BATTLE_DATA (real lng/lat). Three.js r128.
 *
 *  This is the thin entry point: it wires the ES modules together, owns the
 *  per-frame loop, and runs the async init() boot sequence. The engine itself
 *  lives in the modules: config · state · core · projection · flags ·
 *  terrain · entities · director, each a single cohesive concern.
 *  (Loaded as <script type="module">; the vendored THREE libs + data.js are
 *  classic <script>s above it, so global THREE / BATTLE_DATA exist at eval.)
 * ===================================================================== */
import { CFG, D, FAC, fatal, bootMsg } from "./config.js";
import { Clock, Time, unitById } from "./state.js";
import { scene, camera, renderer, labelRenderer, controls } from "./core.js";
import { loadTiles, buildTerrain, buildLabels, buildLine, updateLines, updateFront,
         updateLabels, placeLabels, lineObjs, frontLabel } from "./terrain.js";
import { buildUnit, buildArrow, buildRain, buildLiveTrains, buildAmbientTrains, updateUnits, updateArrows, updateFlags,
         updateEffects, updateLiveTrains, updateAmbientTrains, showStationPopup, applyWeather, stepRain, unitObjs, arrowObjs } from "./entities.js";
import { Director, wireUI, buildChrome, updatePlayBtn } from "./director.js";
import { initRouteUI } from "./route-ui.js";   // fork-only: the "BART Runner" pinned-route commuter overlay

/* ===================== ANIMATION LOOP ============================= */
let last=performance.now();
// screen-space label de-collision: after CSS2DRenderer positions the labels,
// push any overlapping ones downward (units have priority, place names yield).
function decollide(){
  const items=[];
  for(const o of unitObjs) if(o.visible && o.lbl.visible && (+o.div.style.opacity||0)>0.05) items.push(o.div);
  for(const o of arrowObjs) if((+o.div.style.opacity||0)>0.05) items.push(o.div);
  for(const L of lineObjs) if(L.label.o.visible && (+L.label.div.style.opacity||0)>0.05) items.push(L.label.div);
  if(frontLabel && frontLabel.o.visible) items.push(frontLabel.div);
  for(const l of placeLabels) if(l.div.style.display!=="none" && (+l.div.style.opacity||0)>0.05) items.push(l.div);
  if(items.length<1) return;
  const R=items.map(el=>el.getBoundingClientRect());   // batched reads (one reflow)
  const placed=[];
  // fixed HUD panels are immovable obstacles; a map label must never hide under them
  for(const hudId of ["hud-tl","key"]){ const el=document.getElementById(hudId);
    if(el){ const hb=el.getBoundingClientRect(); if(hb.width>0) placed.push({top:hb.top,bottom:hb.bottom,left:hb.left,right:hb.right}); } }
  for(let i=0;i<items.length;i++){
    const r={top:R[i].top,bottom:R[i].bottom,left:R[i].left,right:R[i].right}; let dy=0, guard=0, moved=true;
    while(moved && guard++<24){ moved=false;
      for(const p of placed){ if(r.left<p.right && r.right>p.left && r.top<p.bottom+3 && r.bottom>p.top){
        const push=p.bottom-r.top+4; dy+=push; r.top+=push; r.bottom+=push; moved=true; } } }
    if(dy) items[i].style.transform+=` translateY(${dy.toFixed(1)}px)`;
    placed.push(r);
  }
}
function renderScene(){ controls.update(); renderer.render(scene,camera); labelRenderer.render(scene,camera); decollide(); }
function frame(dt){
  Director.update(dt);                  // drives camera + clock + captions + focus
  const w=applyWeather(Clock.day);
  updateFront(Clock.day); updateLines(Clock.day); updateUnits(Clock.day); updateArrows(Clock.day);
  updateLiveTrains(); updateAmbientTrains(); updateFlags(); updateEffects(Clock.day,dt); stepRain(dt,w); updateLabels();
  renderScene();
}
let captureFrozen=false;   // capture mode (?capture=1) holds the loop on a settled frame so a headless tool can seek + composite deterministically
function animate(){
  requestAnimationFrame(animate);
  if(captureFrozen) return;            // capture mode: hold on the settled frame (deterministic; also lets a headless screenshot settle)
  const t=performance.now(); let dt=(t-last)/1000; last=t; if(dt>0.1) dt=0.1; Time.now+=dt;
  frame(dt);
}

/* ---- screenshot: press "P" to save the current 3D view as a PNG. capturePNG() renders a FRESH frame on demand
 *  (renderScene() right before toBlob), so it works without preserveDrawingBuffer. For README / og:image — size the window to the ratio you want first.
 *  The CSS2D place/unit labels + the HUD are DOM (not in the canvas), so the capture is the clean 3D scene: terrain,
 *  units, flags, arrows, lines. For a fully composited shot (with captions) or a GIF, screen-record the auto-playing
 *  tour and convert (e.g. with ffmpeg). No dependencies, no build. */
function capturePNG(){
  renderScene();                                            // ensure the canvas holds a fresh frame
  renderer.domElement.toBlob(blob=>{ if(!blob) return;
    const name=((D.meta.title||"battle").replace(/[^\w]+/g,"_").replace(/^_+|_+$/g,"")||"battle");
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
    a.download=`${name}_d${Math.floor(Clock.day)}.png`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  }, "image/png");
}
addEventListener("keydown", e=>{ if((e.key==="p"||e.key==="P") && !e.metaKey && !e.ctrlKey && !e.altKey) capturePNG(); });

/* ---- headless capture API (opt-in via ?capture=1) -----------------------------------------------------------------
 *  A small, dependency-free API so an external headless driver (Puppeteer/Playwright) or the preview tool can
 *  deterministically seek to a storyboard shot, freeze the loop on a settled frame, and read a COMPOSITED still
 *  (the 3D scene PLUS the HUD/caption DOM) as a data URL. This is what makes docs/og.jpg + docs/demo.gif reachable on
 *  the AI-agent path (no screen to record). Exposed ONLY under ?capture=1, so normal use is untouched. See AGENTS.md. */
function compositeCapture(withUI=true, type="image/jpeg", quality=0.92){
  renderScene();                                           // fresh frame on demand (no preserveDrawingBuffer needed)
  const glc=renderer.domElement, W=glc.width, H=glc.height, sx=W/innerWidth, sy=H/innerHeight, S=(sx+sy)/2;
  const c=document.createElement("canvas"); c.width=W; c.height=H;
  const x=c.getContext("2d"); x.drawImage(glc,0,0,W,H);
  if(withUI){
    const px=v=>parseFloat(v)||0;
    const grad=x.createLinearGradient(0,H,0,H*0.6); grad.addColorStop(0,"rgba(4,7,12,0.86)"); grad.addColorStop(1,"rgba(4,7,12,0)");
    x.fillStyle=grad; x.fillRect(0,H*0.6,W,H*0.4);
    const panel=el=>{ if(!el) return; const r=el.getBoundingClientRect(); if(r.width<2) return;
      const X=r.left*sx-8*S,Y=r.top*sy-7*S,Wd=r.width*sx+16*S,Hd=r.height*sy+14*S,rad=9*S;
      x.fillStyle="rgba(9,12,18,0.66)"; x.beginPath(); x.moveTo(X+rad,Y);
      x.arcTo(X+Wd,Y,X+Wd,Y+Hd,rad); x.arcTo(X+Wd,Y+Hd,X,Y+Hd,rad); x.arcTo(X,Y+Hd,X,Y,rad); x.arcTo(X,Y,X+Wd,Y,rad); x.closePath(); x.fill(); };
    panel(document.getElementById("title")); panel(document.getElementById("key"));
    const drawNode=(n,st)=>{ const t=n.textContent.replace(/\s+/g," ").trim(); if(!t) return;
      const rg=document.createRange(); rg.selectNodeContents(n); const r=rg.getBoundingClientRect();
      if(r.width<1||r.bottom<0||r.top>innerHeight+30) return;
      const fs=px(st.fontSize)*sy, lh=(px(st.lineHeight)||fs*1.3)*sy;
      x.font=(parseInt(st.fontWeight)>=600?"700 ":"400 ")+(st.fontStyle==="italic"?"italic ":"")+fs+"px "+st.fontFamily;
      x.fillStyle=st.color; x.textAlign="left"; x.shadowColor="rgba(0,0,0,0.95)"; x.shadowBlur=5*S; x.shadowOffsetY=1*S;
      const maxW=r.width*sx+2*S, cjk=/[\u3000-\u9fff]/.test(t); let y=r.top*sy+fs*0.84;
      if(x.measureText(t).width>maxW+2){ const toks=cjk?t.split(""):t.split(" "); let line="";
        for(const tok of toks){ const tl=cjk?line+tok:(line?line+" "+tok:tok);
          if(x.measureText(tl).width>maxW && line){ x.fillText(line,r.left*sx,y); y+=lh; line=tok; } else line=tl; }
        if(line) x.fillText(line,r.left*sx,y);
      } else x.fillText(t,r.left*sx,y);
      x.shadowColor="transparent"; };
    const walk=el=>{ const st=getComputedStyle(el); if(st.display==="none"||st.visibility==="hidden"||+st.opacity<0.06) return;
      for(const n of el.childNodes){ if(n.nodeType===3) drawNode(n,st); else if(n.nodeType===1) walk(n); } };
    ["labels","caption","hud-tl","key","credit"].forEach(id=>{ const e=document.getElementById(id); if(e) walk(e); });
  }
  return c.toDataURL(type,quality);
}
if(/[?&]capture=1\b/.test(location.search)){
  const noAnim=document.createElement("style");   // snap CSS transitions/animations so the caption + HUD opacity reach their target on a frozen frame (the caption fades in over REAL time, which a synchronous frame-pump does not advance)
  noAnim.textContent="*{transition:none!important;animation:none!important}"; document.head.appendChild(noAnim);
  window.__capture={
    shots:()=>Director.shots.length,
    seekToShot(i,settle=85,dt=1/30){ captureFrozen=true; Director.goToShot(i); Director.userFree=false; Director.playing=true; for(let k=0;k<settle;k++) frame(dt); renderScene(); return {shot:i, day:+Clock.day.toFixed(2)}; },
    step(n=1,dt=1/30){ captureFrozen=true; for(let k=0;k<n;k++) frame(dt); renderScene(); return +Clock.day.toFixed(2); },
    freeze(){ captureFrozen=true; }, play(){ captureFrozen=false; },
    composite:compositeCapture,
  };
}

/* ===================== ASYNC INIT ================================= */
function awaitAudio(){   // hold boot until the background mp3 is buffered (10s hard cap so audio can never hang the experience)
  const a=document.getElementById("bgm");
  if(!a || !a.getAttribute("src") || a.readyState>=4) return Promise.resolve();   // no soundtrack bundled → don't wait
  return new Promise(res=>{ let done=false; const finish=()=>{ if(!done){done=true;res();} };
    a.addEventListener("canplaythrough",finish,{once:true});
    a.addEventListener("error",finish,{once:true});            // failed load → degrade, don't hang
    setTimeout(finish, 10000);
    try{ a.load(); }catch(e){}
  });
}
// Generate ALL battle-derived styling at boot from the data layer, so index.html carries no battle colour/font and the
// engine names no faction or script: typography (--font-display/--mono) + reading direction (--text-dir) from D.meta;
// the --fac-<key>/--fac-<key>-glow vars + per-faction label/legend/strength-bar rules from FAC (ANY number of sides); the
// progress ribbon as an N-stop role gradient (defenders → accent → attackers, reducing to 2 stops for a 2-side battle);
// and the favicon as N equal colour bars. Faction text tints derive uniformly from each glow (lighten 0.45).
function injectBattleStyles(){
  const hx=n=>"#"+n.toString(16).padStart(6,"0");
  const lighten=(c,t)=>{ const r=(c>>16)&255,g=(c>>8)&255,b=c&255, m=v=>Math.round(v+(255-v)*t); return `rgb(${m(r)},${m(g)},${m(b)})`; };
  const rs=document.documentElement.style;
  rs.setProperty("--font-display", CFG.FONTS.display);              // the primary-narration-script font (any script)
  rs.setProperty("--mono", CFG.FONTS.mono);                         // the Latin / technical font (English + UI)
  rs.setProperty("--text-dir", D.meta.dir==="rtl"?"rtl":"ltr");     // RTL flows the primary-language text (Arabic/Hebrew)
  document.documentElement.setAttribute("data-text-dir", D.meta.dir==="rtl"?"rtl":"ltr");   // a selectable hook for the RTL glyph/chip mirroring (CSS cannot match on a var value)
  const keys=Object.keys(FAC); let css="";
  for(const k of keys){ const f=FAC[k], tint=lighten(f.glow,0.45);
    rs.setProperty("--fac-"+k,f.css); rs.setProperty("--fac-"+k+"-glow",hx(f.glow));   // namespaced: --fac-* can never collide with engine chrome vars (--accent/--ink/…)
    css+=`.unit.${k} .name{color:${tint}}`
       + `#key .${k}{color:${f.css}} #key .${k} .sw{background:${f.css}}`
       + `#caption .str.${k} .bar>i{background:linear-gradient(90deg,${hx(f.dim)},${f.css})}`
       + `#caption .str.${k}{color:${tint}}`;
  }
  // role-grouped colours → the progress ribbon: defenders, accent, attackers, then any role-less sides. Generalises to
  // N sides and reduces to the exact 2-stop `var(--fac-def),var(--accent),var(--fac-att)` for a 2-side battle.
  const defSide=keys.filter(k=>FAC[k].role==="defender"); if(!defSide.length) defSide.push(keys[0]);
  const attSide=keys.filter(k=>FAC[k].role==="attacker" && !defSide.includes(k));
  const rest=keys.filter(k=>!defSide.includes(k) && !attSide.includes(k));
  const facVar=k=>`var(--fac-${k})`;
  const stops=[...defSide.map(facVar), "var(--accent)", ...attSide.map(facVar), ...rest.map(facVar)];
  if(stops.length<2) stops.push("var(--accent)");                  // 1-faction battle → never an empty/1-stop gradient
  css+=`#key .gl.mini>i{background:linear-gradient(90deg,${hx(FAC[defSide[0]].dim)},${facVar(defSide[0])})}`
     + `#prog > i{background:linear-gradient(90deg,${stops.join(",")})}`;
  const st=document.createElement("style"); st.textContent=css; document.head.appendChild(st);
  // favicon: N equal vertical colour bars, one per faction (was 2 hardcoded rects)
  const n=keys.length, bw=16/n;
  const bars=keys.map((k,i)=>`<rect x='${(i*bw).toFixed(2)}' width='${bw.toFixed(2)}' height='16' fill='${encodeURIComponent(FAC[k].css)}'/>`).join("");
  const fav=`data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' fill='%2306080c'/>${bars}</svg>`;
  let link=document.querySelector("link[rel=icon]"); if(!link){ link=document.createElement("link"); link.rel="icon"; document.head.appendChild(link); } link.setAttribute("href",fav);
}
(async function init(){
  try{
    injectBattleStyles();   // all colours, fonts + reading direction come from the data layer — index.html names no battle
    buildChrome();          // paint the HUD chrome (title, boot, legend, hint, disclaimer…) from data — before loadTiles so the boot splash shows the battle's name
    renderer.domElement.setAttribute("role","img");
    renderer.domElement.setAttribute("aria-label", D.meta.title+" · "+D.meta.subtitle+" — interactive 3D battle map");
    await loadTiles();
    buildTerrain(); buildLabels(showStationPopup); buildLine(); buildLiveTrains(); buildAmbientTrains(); buildRain();
    D.units.forEach(buildUnit); D.arrows.forEach(buildArrow);
    unitObjs.forEach(o=>{ unitById[o.u.id]=o; });
    const kickMusic = wireUI(); applyWeather(D.storyboard[0].day);   // wireUI returns syncMusic → starts the muted, in-sync soundtrack timeline once the tour begins
    initRouteUI();   // pinned-route commuter card (restores a saved Origin→Destination from localStorage)
    bootMsg(D.ui.boot.music); await awaitAudio();   // mp3 buffered before the tour begins
    // fork-only: NO autoplay tour — a live transit map opens straight into free-look. Director.start()
    // still sets the clock, the overview framing, and the welcome card; the camera is then handed to
    // OrbitControls permanently (userFree), and the tour transport bar is dropped as dead chrome.
    Director.start(); Director.userFree = true; Director.playing = false;
    const bar = document.getElementById("controls"); if(bar) bar.style.display = "none";
    setTimeout(()=>document.getElementById("caption").classList.remove("show"), 7000);   // welcome card fades; the top-left hint keeps the controls guidance
    updatePlayBtn(); kickMusic();
    bootMsg(D.ui.boot.starting); renderScene(); animate();
    if(window.__capture){ for(let k=0;k<60;k++) frame(1/30); renderScene(); captureFrozen=true; }   // capture mode: settle on the first shot and hold (the headless driver then seeks/steps deterministically)
    setTimeout(()=>{ const b=document.getElementById("boot"); if(b) b.classList.add("gone"); }, 600);
  }catch(e){ fatal(e); }
})();

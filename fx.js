/* =====================================================================
 *  fx.js — the declarative combat-effect interpreter + the built-in effect specs.
 *  ---------------------------------------------------------------------
 *  A hotspot's `kind` resolves to a SPEC: one of the built-ins below, OR one the
 *  BATTLE declares in `D.meta.fx[<name>]`. The engine PLAYS a spec; a battle never
 *  programs particles — it selects a built-in or declares a new effect in data.
 *  Names no faction / coordinate / language: pure depiction data + a reader.
 *
 *  SPEC = { continuous?:[emitter], onFire?:{ flash?:{…}, emit?:[emitter] }, cadence?:{range:[lo,hi], byI?} }
 *    continuous  — emitters played EVERY frame (probability / count gated)
 *    onFire      — the flash + emitters played on the cadence "fire" beat
 *    cadence     — resets the per-hotspot timer to rnd(range) [ / hs.i if byI]
 *  EMITTER = { sys:"glow"|"smoke", n?:count(=1), prob?:number|{iMul},
 *              pos:[axis,axis,axis], vel:[axis,axis,axis] | {radial:{speed},y:axis},
 *              size:num|[lo,hi], life:num|[lo,hi], color:[comp,comp,comp]|{choice:[[r,g,b],…]}, grow?, kind? }
 *    POS axis {b?,j?:[lo,hi],r?} : value = base + (b + i*r + rnd(j)) * G   (r = per-emit ramp → streaks/trajectories)
 *    VEL axis {b?,j?:[lo,hi]}    : value = (b + rnd(j)) * G                 (radial mode → cos/sin burst in XZ)
 *    comp : number | [lo,hi]
 *  The six built-ins are a behavior-preserving transcription of the prior imperative recipes;
 *  a node harness proves the equivalence.
 * ===================================================================== */
export function playFX(spec, ctx) {
  const { gx, gy, gz, G, hs, fire, h, emit, flash, GLOW, SMOKE, rnd, hotTimers } = ctx;
  const rng = v => Array.isArray(v) ? rnd(v[0], v[1]) : v;
  const pAxis = (a, i, base) => base + (((a.b || 0) + i * (a.r || 0)) + (a.j ? rnd(a.j[0], a.j[1]) : 0)) * G;
  const vAxis = a => ((a.b || 0) + (a.j ? rnd(a.j[0], a.j[1]) : 0)) * G;
  const colour = c => c.choice ? c.choice[Math.floor(Math.random() * c.choice.length)] : [rng(c[0]), rng(c[1]), rng(c[2])];

  function run(em) {
    const sys = em.sys === "smoke" ? SMOKE : GLOW, N = em.n || 1;
    for (let i = 0; i < N; i++) {
      if (em.prob != null) { const p = (typeof em.prob === "object") ? hs.i * em.prob.iMul : em.prob; if (Math.random() >= p) continue; }
      const px = pAxis(em.pos[0], i, gx), py = pAxis(em.pos[1], i, gy), pz = pAxis(em.pos[2], i, gz);
      let vx, vy, vz;
      if (em.vel && em.vel.radial) { const a = Math.random() * 7, sp = rng(em.vel.radial.speed) * G; vx = Math.cos(a) * sp; vz = Math.sin(a) * sp; vy = vAxis(em.vel.y || {}); }
      else { vx = vAxis(em.vel[0]); vy = vAxis(em.vel[1]); vz = vAxis(em.vel[2]); }
      const [cr, cg, cb] = colour(em.color);
      emit(sys, px, py, pz, vx, vy, vz, rng(em.size), rng(em.life), cr, cg, cb, em.grow || 0, em.kind || 0);
    }
  }

  if (spec.continuous) for (const em of spec.continuous) run(em);
  if (fire) {
    const of = spec.onFire;
    if (of) {
      if (of.flash) { const f = of.flash; flash(gx, gy + (f.y || 0) * G, gz, f.color, rng(f.intensity) * (f.byI ? hs.i : 1)); }
      if (of.emit) for (const em of of.emit) run(em);
    }
    if (spec.cadence) hotTimers[h] = rnd(spec.cadence.range[0], spec.cadence.range[1]) / (spec.cadence.byI ? hs.i : 1);
  }
}

export const BUILTIN_FX = {
  firefight: {
    continuous: [{ sys: "glow", prob: { iMul: 0.9 }, pos: [{ j: [-3, 3] }, { j: [0.5, 3] }, { j: [-3, 3] }], vel: [{ j: [-6, 6] }, { j: [4, 12] }, { j: [-6, 6] }], size: [8, 16], life: [0.3, 0.6], color: { choice: [[1, 0.8, 0.3], [1, 0.5, 0.2]] } }],
    onFire: { flash: { y: 2, color: 0xffcc66, intensity: [120, 260] }, emit: [{ sys: "smoke", pos: [{}, { b: 1 }, {}], vel: [{ j: [-1, 1] }, { b: 2 }, { j: [-1, 1] }], size: 16, life: [1.2, 2], color: [0.22, 0.21, 0.2], grow: 12, kind: 1 }] },
    cadence: { range: [0.12, 0.28], byI: true },
  },
  artillery: {
    onFire: {
      flash: { y: 3, color: 0xffd27a, intensity: [220, 360] },
      emit: [
        { sys: "glow", n: 8, pos: [{}, { b: 2.5 }, {}], vel: [{ j: [-10, 10] }, { j: [6, 16] }, { j: [-10, 10] }], size: [10, 18], life: 0.4, color: [1, 0.75, 0.35] },
        { sys: "smoke", pos: [{}, { b: 2 }, {}], vel: [{ j: [-1, 1] }, { b: 2.5 }, { j: [-1, 1] }], size: 22, life: 2.2, color: [0.26, 0.25, 0.23], grow: 16, kind: 1 },
        { sys: "glow", n: 6, pos: [{ j: [-2, 2] }, { b: 5, r: 4 }, { b: 10, r: 7 }], vel: [{ j: [-2, 2] }, { b: 3 }, { b: 18 }], size: 9, life: 0.5, color: [1, 0.9, 0.5], grow: 0.5 },
      ],
    },
    cadence: { range: [0.4, 0.9], byI: true },
  },
  explosion: {
    onFire: {
      flash: { y: 2, color: 0xffaa44, intensity: [300, 520] },
      emit: [
        { sys: "glow", n: 14, pos: [{}, { b: 1.5 }, {}], vel: { radial: { speed: [6, 20] }, y: { j: [8, 20] } }, size: [10, 22], life: [0.3, 0.6], color: [1, 0.6, 0.2], kind: 3 },
        { sys: "smoke", pos: [{}, { b: 2 }, {}], vel: [{ j: [-2, 2] }, { b: 3 }, { j: [-2, 2] }], size: 30, life: 2.4, color: [0.2, 0.19, 0.18], grow: 20, kind: 1 },
      ],
    },
    cadence: { range: [0.7, 1.6], byI: true },
  },
  landing: {
    continuous: [{ sys: "glow", prob: 0.7, pos: [{ j: [-6, 6] }, { j: [0, 2] }, { j: [-4, 4] }], vel: [{ j: [-4, 4] }, { j: [6, 12] }, { j: [-4, 4] }], size: [8, 14], life: 0.4, color: [0.7, 0.85, 1], grow: 1 }],
    onFire: { flash: { y: 1.5, color: 0xfff0c0, intensity: [120, 220] }, emit: [{ sys: "glow", n: 6, pos: [{ j: [-8, 8] }, { b: 0.5 }, { j: [-6, 6] }], vel: [{ j: [-3, 3] }, { j: [3, 7] }, { j: [-3, 3] }], size: 11, life: 0.4, color: [0.6, 0.8, 1] }] },
    cadence: { range: [0.3, 0.6] },
  },
  oilfire: {
    continuous: [{ sys: "glow", n: 3, pos: [{ j: [-4, 4] }, { j: [0, 4] }, { j: [-4, 4] }], vel: [{ j: [-2, 2] }, { j: [8, 16] }, { j: [-2, 2] }], size: [18, 30], life: [0.4, 0.8], color: [1, [0.35, 0.6], 0.12], grow: -12, kind: 2 }],
    onFire: { flash: { y: 3, color: 0xff7733, intensity: [120, 200], byI: true }, emit: [{ sys: "smoke", n: 2, pos: [{ j: [-2, 2] }, { b: 3 }, { j: [-2, 2] }], vel: [{ j: [0, 2] }, { j: [4, 7] }, { j: [-1, 1] }], size: [22, 34], life: [2, 3], color: [0.15, 0.14, 0.13], grow: 16, kind: 1 }] },
    cadence: { range: [0.2, 0.34] },
  },
  air: {
    onFire: {
      flash: { y: 2, color: 0xffcc66, intensity: 300 },
      emit: [
        { sys: "glow", n: 10, pos: [{}, { b: 1.5 }, {}], vel: { radial: { speed: [8, 16] }, y: { j: [6, 14] } }, size: [10, 18], life: 0.5, color: [1, 0.7, 0.3], kind: 3 },
        { sys: "smoke", pos: [{}, { b: 2 }, {}], vel: [{}, { b: 2.5 }, {}], size: 26, life: 2.4, color: [0.2, 0.19, 0.18], grow: 18, kind: 1 },
        { sys: "glow", n: 6, pos: [{ b: 24, r: -4, j: [-3, 3] }, { b: 30, r: -4 }, { b: -30, r: 4 }], vel: [{ j: [-2, 2] }, { b: -6 }, { b: 6 }], size: 8, life: 0.4, color: [1, 0.9, 0.4] },
      ],
    },
    cadence: { range: [0.8, 1.6] },
  },
};

/* =====================================================================
 *  flags.js — SF Bay Area 3D · neutral plain-colour swatches.
 *  Each line flies a flat swatch matching its official BART/Caltrain
 *  colour. Same contract as hk-mtr-3d/poly2019 flags.js: export
 *  flagTexture(unit) keyed by unit.flag.
 * ===================================================================== */
const W = 230, H = 150;
const SWATCH = {
  yel: "#FFFF33", org: "#FF9933", grn: "#339933", red: "#FF0000",
  blu: "#0099CC", gry: "#B0BEC7", ct: "#CE202F",
};

const flagTexCache = {};
export function flagTexture(unit) {
  if (flagTexCache[unit.id]) return flagTexCache[unit.id];
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const c = cv.getContext("2d");
  const fill = SWATCH[unit.flag];
  if (!fill) console.warn(`unknown flag "${unit.flag}" for ${unit.id}`);
  c.fillStyle = fill || SWATCH.ct; c.fillRect(0, 0, W, H);
  const sh = c.createLinearGradient(0, 0, W * 0.18, 0);
  sh.addColorStop(0, "rgba(0,0,0,0.28)"); sh.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = sh; c.fillRect(0, 0, W * 0.18, H);
  c.strokeStyle = "rgba(0,0,0,0.42)"; c.lineWidth = 3; c.strokeRect(1.5, 1.5, W - 3, H - 3);
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4; tex.needsUpdate = true;
  flagTexCache[unit.id] = tex; return tex;
}

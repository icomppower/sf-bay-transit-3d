#!/usr/bin/env node
/* =====================================================================
 *  tools/check-agnostic.mjs — the SOURCE-TEXT agnosticism guard.
 *
 *  Asserts the engine + the page shell carry NO battle text, so a fork
 *  reskins by editing the battle layer (data.js / flags.js / <title>+og) only:
 *    • the engine ES-modules contain no CJK (Han / Kana / Hangul / full-width) literal;
 *    • index.html's <body> contains no CJK (the <head> <title>/og is the
 *      documented per-deploy branding exception);
 *    • the data-driven HUD chrome containers in index.html are EMPTY —
 *      director.js buildChrome() paints them at runtime, so any hardcoded
 *      text there is a leak (catches a Latin leak the CJK scan cannot).
 *
 *  Orthogonal to validate.js: the validator checks a battle's DATA against the
 *  contract; this checks the engine/shell SOURCE carries no battle text.
 *    node tools/check-agnostic.mjs   →  exit 0 clean / 1 leak found / 2 load error
 * ===================================================================== */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// CJK ranges by codepoint (numeric, so this file holds no CJK literal of its own):
// CJK punctuation · Hiragana+Katakana · CJK ext-A · CJK unified · Hangul syllables · CJK compat · half/full-width forms.
const CJK = /[　-〿぀-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/;

// The engine "never touch" modules (mirrors AGENTS.md). The battle layer (data*.js, flags*.js),
// lib/* (vendored) and tools/* (dev) are intentionally NOT scanned — they may carry battle text.
const ENGINE = ["config.js", "validate.js", "app.js", "core.js", "projection.js", "state.js", "terrain.js", "entities.js", "director.js", "fx.js"];

// The index.html containers buildChrome() owns — they must be EMPTY in the static HTML.
const CONTAINERS = [
  ["#title h1",        /<h1>([\s\S]*?)<\/h1>/],
  ["#title .sub",      /<div class="sub"[^>]*>([\s\S]*?)<\/div>/],
  ["#boot .bt",        /<div class="bt">([\s\S]*?)<\/div>/],
  ["#boot .bs",        /<div class="bs">([\s\S]*?)<\/div>/],
  ["#key",             /<div id="key"[^>]*>([\s\S]*?)<\/div>/],
  ["#hint",            /<div id="hint"[^>]*>([\s\S]*?)<\/div>/],
  ["#disclaimer",      /<div id="disclaimer"[^>]*>([\s\S]*?)<\/div>/],
  ["#resume",          /<div id="resume"[^>]*>([\s\S]*?)<\/div>/],
  ["#notes .nhd span", /<div class="nhd"><span>([\s\S]*?)<\/span>/],
  ["#notes-btn",       /<button id="notes-btn"[^>]*>([\s\S]*?)<\/button>/],
  ["#lang-btn",        /<button id="lang-btn"[^>]*>([\s\S]*?)<\/button>/],
];

const fails = [];
const scanCJK = (label, text, baseLine = 0) => {
  text.split("\n").forEach((ln, i) => { if (CJK.test(ln)) fails.push(`${label}:${baseLine + i + 1}  CJK literal -> ${ln.trim().slice(0, 80)}`); });
};

// 1) engine modules — no CJK anywhere
for (const f of ENGINE) {
  let src; try { src = readFileSync(resolve(root, f), "utf8"); } catch (e) { console.error(`could not read ${f}: ${e.message}`); process.exit(2); }
  scanCJK(f, src);
}

// 2) index.html
let html; try { html = readFileSync(resolve(root, "index.html"), "utf8"); } catch (e) { console.error(`could not read index.html: ${e.message}`); process.exit(2); }
const lines = html.split("\n");
const bodyLine = lines.findIndex(l => /<body[\s>]/.test(l));
if (bodyLine < 0) { console.error("index.html: no <body> tag found"); process.exit(2); }
// 2a) the <body> carries no CJK (the <head> <title>/og is the documented branding exception)
scanCJK("index.html", lines.slice(bodyLine).join("\n"), bodyLine);
// 2b) the chrome containers are empty (buildChrome owns their content)
for (const [label, re] of CONTAINERS) {
  const m = html.match(re);
  if (!m) fails.push(`index.html  ${label} — container not located (markup changed? update this guard)`);
  else if (m[1].trim() !== "") fails.push(`index.html  ${label} is NOT empty -> "${m[1].trim().slice(0, 60)}" (buildChrome owns it; move the text to data.js D.ui / D.meta)`);
}

if (fails.length) {
  console.error(`FAIL  battle text leaked into the agnostic engine/shell (${fails.length}):\n  - ${fails.join("\n  - ")}\n`);
  process.exit(1);
}
console.log("OK  engine modules + index.html body are battle-agnostic (no CJK; chrome containers empty).");
process.exit(0);

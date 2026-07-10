#!/usr/bin/env node
/* =====================================================================
 *  tools/validate.mjs — validate a battle's data.js against the engine's
 *  REAL data contract, from the command line, with NO browser and NO tiles.
 *
 *  The author / AI-agent validation loop:
 *    node tools/validate.mjs                  # validates ../data.js (the active battle)
 *    node tools/validate.mjs data.example.js  # validates the skeleton
 *    node tools/validate.mjs path/to/data.js
 *
 *  It runs the SHIPPED validate.js — the exact validator config.js runs at boot —
 *  so the command line and the browser can never disagree. Exit 0 = valid;
 *  exit 1 = invalid (with the offending field named); exit 2 = could not load.
 * ===================================================================== */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAgainstSchema } from "./jsonschema.mjs";   // the declarative schema's checker (structural mirror)

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv[2] || "data.js";
const dataPath = resolve(root, arg);

// Load the real validator. Strip the ESM `export` so it runs here as a plain function; the trailing
// reference makes the eval's completion value the function itself (works in strict module scope).
let validateBattleData;
try {
  const src = readFileSync(resolve(root, "validate.js"), "utf8").replace(/^export\s+/gm, "");   // strip ESM exports (const + function)
  validateBattleData = eval(src + "\nvalidateBattleData");
} catch (e) {
  console.error("Could not load validate.js:", e.message);
  process.exit(2);
}

// Load the battle data exactly like the browser does (data.js assigns window.BATTLE_DATA).
let data;
try {
  globalThis.window = {};
  eval(readFileSync(dataPath, "utf8"));
  data = globalThis.window.BATTLE_DATA;
} catch (e) {
  console.error(`Could not load ${arg}: ${e.message}`);
  process.exit(2);
}

// Also check the declarative schema (battle.schema.json) — the structural mirror. The validator is the authority
// (it adds cross-references the schema cannot express); a schema mismatch here means schema↔validator drift to fix.
let schemaErrs = [];
try {
  const schema = JSON.parse(readFileSync(resolve(root, "schema/battle.schema.json"), "utf8"));
  schemaErrs = validateAgainstSchema(data, schema);
} catch (e) {
  schemaErrs = ["could not run the schema check: " + e.message];
}

try {
  validateBattleData(data);
  if (schemaErrs.length) {
    console.error(`${arg} passes the validator but MISMATCHES battle.schema.json (schema/validator drift):\n  • ${schemaErrs.join("\n  • ")}`);
    process.exit(1);
  }
  console.log(`OK  ${arg} is valid — passes the data contract (validator + schema).`);
  process.exit(0);
} catch (e) {
  console.error(`FAIL  ${arg} is INVALID:\n\n${e.message}\n`);
  if (schemaErrs.length) console.error(`(the schema also flags: ${schemaErrs.slice(0, 6).join("; ")})`);
  process.exit(1);
}

/* =====================================================================
 *  tools/jsonschema.mjs — a tiny, dependency-free JSON-Schema checker for
 *  EXACTLY the draft-07 subset battle.schema.json uses. NOT a general
 *  validator (Architect §3, fit-for-purpose): no allOf/anyOf/oneOf/if.
 *  Supports: type (number = finite), required, properties, additionalProperties
 *  (bool | schema), items, enum, const, minItems/maxItems, minLength,
 *  minProperties, pattern, propertyNames, and $ref to "#/$defs/<name>".
 *  Returns a list of path-named error strings (empty = valid).
 * ===================================================================== */
export function validateAgainstSchema(data, schema) {
  const errs = [];
  const root = schema;
  const typeOf = v => v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
  const resolve = ref => ref.replace(/^#\//, "").split("/").reduce((s, p) => s && s[p], root);

  function check(v, sch, path) {
    if (!sch || typeof sch !== "object") return;
    if (sch.$ref) { const r = resolve(sch.$ref); if (!r) { errs.push(`${path}: unresolved $ref ${sch.$ref}`); return; } check(v, r, path); return; }

    if (sch.type) {
      const t = typeOf(v);
      const ok = sch.type === "number" ? (t === "number" && isFinite(v))
        : sch.type === "integer" ? (t === "number" && Number.isInteger(v))
        : t === sch.type;
      if (!ok) { errs.push(`${path}: expected ${sch.type}, got ${t === "number" && !isFinite(v) ? "non-finite number" : t}`); return; }
    }
    if ("const" in sch && v !== sch.const) errs.push(`${path}: must equal ${JSON.stringify(sch.const)}`);
    if (sch.enum && !sch.enum.includes(v)) errs.push(`${path}: ${JSON.stringify(v)} is not one of ${JSON.stringify(sch.enum)}`);

    if (typeOf(v) === "string") {
      if (sch.minLength != null && v.length < sch.minLength) errs.push(`${path}: string is shorter than minLength ${sch.minLength}`);
      if (sch.pattern && !new RegExp(sch.pattern).test(v)) errs.push(`${path}: "${v}" does not match ${sch.pattern}`);
    }
    if (typeOf(v) === "array") {
      if (sch.minItems != null && v.length < sch.minItems) errs.push(`${path}: array shorter than minItems ${sch.minItems}`);
      if (sch.maxItems != null && v.length > sch.maxItems) errs.push(`${path}: array longer than maxItems ${sch.maxItems}`);
      if (sch.items) v.forEach((it, i) => check(it, sch.items, `${path}[${i}]`));
    }
    if (typeOf(v) === "object") {
      if (sch.minProperties != null && Object.keys(v).length < sch.minProperties) errs.push(`${path}: fewer than minProperties ${sch.minProperties}`);
      if (Array.isArray(sch.required)) for (const k of sch.required) if (!(k in v)) errs.push(`${path ? path : "(root)"}.${k}: required`);
      if (sch.propertyNames) for (const k of Object.keys(v)) check(k, sch.propertyNames, `${path} key "${k}"`);
      const props = sch.properties || {};
      for (const k of Object.keys(v)) {
        if (k in props) check(v[k], props[k], `${path}.${k}`);
        else if (sch.additionalProperties && typeof sch.additionalProperties === "object") check(v[k], sch.additionalProperties, `${path}.${k}`);
        else if (sch.additionalProperties === false) errs.push(`${path}.${k}: additional property not allowed`);
      }
    }
  }
  check(data, schema, "");
  return errs.map(e => e.replace(/^\./, ""));
}

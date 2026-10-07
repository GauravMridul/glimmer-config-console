/**
 * Decide which probe body templates can be filled from Salesforce <Object.field> data only
 * (leave ((service…)) and other ESA templates for manual suggestions).
 */

const NUMERIC_ANGLE_ONLY = /^\{\{\s*NUMERIC\s*:\s*<([^>]+)>\s*\}\}$/i;

/** True if template has no (( )) service paths — Salesforce fill may apply. */
export function templateHasServicePaths(s: string): boolean {
  return /\(\(/.test(s);
}

/**
 * True when the whole leaf can be derived from angle-bracket refs only:
 * - `<Obj.f>` or `<a> || <b> || …`
 * - `{{NUMERIC:<Obj.f>}}`
 */
export function canAutoFillFromSalesforceAngles(templateFull: string): boolean {
  const t = templateFull.trim();
  if (!t || templateHasServicePaths(t)) return false;
  if (/\{\{/.test(t)) {
    return NUMERIC_ANGLE_ONLY.test(t);
  }
  const parts = t.split(/\s*\|\|\s*/).map((x) => x.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((p) => /^<[^>]+>$/.test(p));
}

export function lookupAngleValue(
  angleValues: Record<string, unknown>,
  refKey: string,
): unknown {
  if (refKey in angleValues) return angleValues[refKey];
  const lower = refKey.toLowerCase();
  for (const [k, v] of Object.entries(angleValues)) {
    if (k.toLowerCase() === lower) return v;
  }
  const dot = refKey.indexOf(".");
  if (dot < 1) return undefined;
  const obj = refKey.slice(0, dot);
  const field = refKey.slice(dot + 1);
  // Common typo: custom field written as `LoanCategory_c` instead of `LoanCategory__c`
  if (/_c$/i.test(field) && !/__c$/i.test(field)) {
    const altField = field.replace(/_c$/i, "__c");
    const altKey = `${obj}.${altField}`;
    if (altKey in angleValues) return angleValues[altKey];
    for (const [k, v] of Object.entries(angleValues)) {
      if (k.toLowerCase() === altKey.toLowerCase()) return v;
    }
  }
  return undefined;
}

function formatProbeLiteral(v: unknown): string {
  if (typeof v === "boolean") {
    return JSON.stringify(String(v));
  }
  if (typeof v === "string") {
    const tr = v.trim();
    if (tr === "true" || tr === "false" || tr === "null") {
      return JSON.stringify(v);
    }
    if (/^\d$/.test(tr)) return JSON.stringify(v);
    if (tr === "50" || tr === "10" || /^0\d+$/.test(tr)) return JSON.stringify(v);
    if (/^\+?\d{6,}$/.test(tr)) return JSON.stringify(v);
    return v;
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return JSON.stringify(String(v));
    return JSON.stringify(v);
  }
  if (v == null) return JSON.stringify("");
  return JSON.stringify(String(v));
}

/**
 * Returns a suggestion input string, or null if not all required refs were returned from SOQL.
 */
export function valueFromAngleValues(
  templateFull: string,
  angleValues: Record<string, unknown>,
): string | null {
  const t = templateFull.trim();
  const num = NUMERIC_ANGLE_ONLY.exec(t);
  if (num) {
    const key = num[1].trim();
    const v = lookupAngleValue(angleValues, key);
    if (v === undefined) return null;
    const n =
      typeof v === "number"
        ? v
        : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))
          ? Number(v)
          : NaN;
    if (!Number.isFinite(n)) return null;
    return JSON.stringify(n);
  }

  const parts = t.split(/\s*\|\|\s*/).map((x) => x.trim()).filter(Boolean);
  if (parts.every((p) => /^<[^>]+>$/.test(p))) {
    for (const p of parts) {
      const m = /^<([^>]+)>$/.exec(p);
      if (!m) continue;
      const key = m[1].trim();
      const v = lookupAngleValue(angleValues, key);
      if (v !== undefined && v !== null && v !== "") {
        return formatProbeLiteral(v);
      }
    }
    return null;
  }

  const single = /^\s*<([^>]+)>\s*$/.exec(t);
  if (single) {
    const key = single[1].trim();
    const v = lookupAngleValue(angleValues, key);
    if (v === undefined) return null;
    return formatProbeLiteral(v);
  }

  return null;
}

/**
 * Like {@link valueFromAngleValues} for whole-leaf templates, then falls back to the first
 * `<Object.field>` in the string that has a value in `angleValues` (order preserved, first match).
 * Use for suggestion drafts after `resolve-probe-templates` so embedded refs still pick up SOQL.
 */
export function valueFromAngleValuesAny(
  templateFull: string,
  angleValues: Record<string, unknown>,
  persistedAngleRefKeys?: readonly string[],
): string | null {
  const strict = valueFromAngleValues(templateFull, angleValues);
  if (strict != null) return strict;
  const refs = [...String(templateFull).matchAll(/<([^>]+)>/g)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    const v = valueFromAngleValues(`<${ref}>`, angleValues);
    if (v != null) return v;
  }
  if (persistedAngleRefKeys?.length) {
    for (const ref of persistedAngleRefKeys) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      const raw = lookupAngleValue(angleValues, ref);
      if (raw !== undefined && raw !== null && raw !== "") {
        return formatProbeLiteral(raw);
      }
    }
  }
  return null;
}

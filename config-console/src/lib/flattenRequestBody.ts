/** One segment: object key, numeric index, or `[*]` for a dynamic array template row. */
export type PathSegment = string | number | "*";

/**
 * Object keys whose subtree is usually one ESA injection (e.g.
 * `"Cibil_Data": "{{JSON:((CIBIL))}}"`). The mapper lists **only** that key — not nested paths.
 */
export const ESA_JSON_BLOB_SUBTREE_KEYS = new Set<string>(["Cibil_Data", "Crif_Data"]);

function isJsonBlobSubtreeKey(key: string): boolean {
  return ESA_JSON_BLOB_SUBTREE_KEYS.has(key);
}

/**
 * Flatten nested JSON into dot/bracket paths for leaf scalars and empty containers.
 */
export function flattenLeaves(
  value: unknown,
  prefix = "",
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (value === null || value === undefined) {
    if (prefix) out[prefix] = value;
    return out;
  }

  if (typeof value !== "object") {
    if (prefix) out[prefix] = value;
    return out;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      if (prefix) out[prefix] = [];
      return out;
    }
    value.forEach((item, i) => {
      const p = prefix ? `${prefix}[${i}]` : `[${i}]`;
      Object.assign(out, flattenLeaves(item, p));
    });
    return out;
  }

  const keys = Object.keys(value as object);
  if (keys.length === 0) {
    if (prefix) out[prefix] = {};
    return out;
  }

  for (const k of keys) {
    const v = (value as Record<string, unknown>)[k];
    const p = prefix ? `${prefix}.${k}` : k;
    if (isJsonBlobSubtreeKey(k) && v !== null && typeof v === "object") {
      out[p] = v;
      continue;
    }
    if (v !== null && typeof v === "object") {
      Object.assign(out, flattenLeaves(v, p));
    } else {
      out[p] = v;
    }
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Deep-merge object keys so every key that appears in any object is present (first wins on scalar conflicts).
 * Used so array-wildcard paths include fields that only appear in some rows (e.g. Underwriting_Score vs Underwriting_score).
 */
function deepMergeUnionKeys(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (!(k in out)) {
      out[k] = v;
    } else if (isPlainObject(v) && isPlainObject(out[k])) {
      out[k] = deepMergeUnionKeys(
        out[k] as Record<string, unknown>,
        v as Record<string, unknown>,
      );
    }
  }
  return out;
}

/** Union of keys from every plain object in the array (deep). Non-objects are ignored. */
function unionObjectArraySamples(arr: unknown[]): Record<string, unknown> {
  const objs = arr.filter(isPlainObject);
  if (objs.length === 0) return {};
  return objs.reduce((acc, o) => deepMergeUnionKeys(acc, o), {} as Record<string, unknown>);
}

/**
 * Same as {@link flattenLeaves}, but non-empty arrays of **objects** are collapsed using a **union of keys**
 * across all elements (so inconsistent field names across rows still get one path each, and optional keys
 * only present on some row types — e.g. income `prediction` vs bureau `Underwriting_Score` — all appear).
 * Primitives / mixed arrays still use the first element only. Paths use `[*]` instead of `[0]`, `[1]`, …
 */
export function flattenLeavesWildcard(
  value: unknown,
  prefix = "",
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (value === null || value === undefined) {
    if (prefix) out[prefix] = value;
    return out;
  }

  if (typeof value !== "object") {
    if (prefix) out[prefix] = value;
    return out;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      if (prefix) out[prefix] = [];
      return out;
    }
    const p = prefix ? `${prefix}[*]` : "[*]";
    const merged = unionObjectArraySamples(value);
    if (Object.keys(merged).length > 0) {
      Object.assign(out, flattenLeavesWildcard(merged, p));
    } else {
      Object.assign(out, flattenLeavesWildcard(value[0], p));
    }
    return out;
  }

  const keys = Object.keys(value as object);
  if (keys.length === 0) {
    if (prefix) out[prefix] = {};
    return out;
  }

  for (const k of keys) {
    const v = (value as Record<string, unknown>)[k];
    const p = prefix ? `${prefix}.${k}` : k;
    if (isJsonBlobSubtreeKey(k) && v !== null && typeof v === "object") {
      out[p] = v;
      continue;
    }
    if (v !== null && typeof v === "object") {
      Object.assign(out, flattenLeavesWildcard(v, p));
    } else {
      out[p] = v;
    }
  }
  return out;
}

export type FlattenMode = "top-level" | "all-leaves" | "array-wildcards";

export function collectKeys(
  parsed: unknown,
  mode: FlattenMode,
): { path: string; sample: unknown; kind: string }[] {
  if (
    mode === "top-level" &&
    parsed !== null &&
    typeof parsed === "object" &&
    !Array.isArray(parsed)
  ) {
    return Object.entries(parsed as Record<string, unknown>).map(
      ([path, sample]) => ({
        path,
        sample,
        kind: kindOf(sample),
      }),
    );
  }
  const flat =
    mode === "array-wildcards"
      ? flattenLeavesWildcard(parsed)
      : flattenLeaves(parsed);
  return Object.entries(flat).map(([path, sample]) => ({
    path,
    sample,
    kind: kindOf(sample),
  }));
}

function kindOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "object") return "object";
  return typeof v;
}

/** `a.b.c`, `Last12MSalesTransaction[0].key`, `Last12MSalesTransaction[*].key`, `foo[*][*].a` */
export function parseSegments(path: string): PathSegment[] {
  const out: PathSegment[] = [];
  for (const part of path.split(".")) {
    const bare = part.match(/^\[(\d+|\*)\]$/);
    if (bare) {
      out.push(bare[1] === "*" ? "*" : Number(bare[1]));
      continue;
    }
    const m = part.match(/^(.+)\[(\d+|\*)\]$/);
    if (m) {
      out.push(m[1], m[2] === "*" ? "*" : Number(m[2]));
    } else {
      out.push(part);
    }
  }
  return out;
}

/**
 * Build nested object from flat path → SF expression (all values are strings).
 */
export function unflattenMappings(flat: Record<string, string>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [path, expr] of Object.entries(flat)) {
    if (!path.trim()) continue;
    setByPath(root, path, expr);
  }
  return root;
}

function setByPath(root: Record<string, unknown>, path: string, value: string) {
  const segs = parseSegments(path);
  if (segs.length === 0) return;
  let cur: unknown = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i];
    const next = segs[i + 1];
    if (typeof s === "string" && s !== "*") {
      const o = cur as Record<string, unknown>;
      if (o[s] === undefined) {
        const nextIsArray = next === "*" || typeof next === "number";
        o[s] = nextIsArray ? [] : {};
      }
      cur = o[s];
    } else {
      const idx = s === "*" ? 0 : (s as number);
      const arr = cur as unknown[];
      const nextIsNestedArray = next === "*" || typeof next === "number";
      while (arr.length <= idx) {
        arr.push(nextIsNestedArray ? [] : {});
      }
      cur = arr[idx];
    }
  }
  const last = segs[segs.length - 1];
  if (typeof last === "string" && last !== "*") {
    (cur as Record<string, unknown>)[last] = value;
  } else {
    const idx = last === "*" ? 0 : (last as number);
    const arr = cur as unknown[];
    while (arr.length <= idx) arr.push(null);
    arr[idx] = value;
  }
}

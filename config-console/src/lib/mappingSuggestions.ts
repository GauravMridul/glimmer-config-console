import { flattenLeaves } from "@/lib/flattenRequestBody";

/** Normalized path: numeric array indices → [*] so rows align across samples. */
export function normalizeMappingPath(path: string): string {
  return path.replace(/\[\d+\]/g, "[*]");
}

function lastSegment(normalizedPath: string): string {
  const n = normalizedPath;
  const i = n.lastIndexOf(".");
  if (i === -1) return n;
  return n.slice(i + 1);
}

const SUFFIX_STOPLIST = new Set([
  "body",
  "code",
  "data",
  "flag",
  "id",
  "key",
  "name",
  "status",
  "type",
  "value",
]);

/**
 * Whole-object pass-through from an upstream ESA service (see request_body patterns like
 * `"Cibil_Data": "{{JSON:((CIBIL))}}"`). The mapper collapses these keys to one row; suffix
 * hints are only for exact keys (no nested paths).
 */
const PASS_THROUGH_JSON_BLOBS: Array<{
  prefix: string;
  expression: string;
  note: string;
}> = [
  {
    prefix: "Cibil_Data",
    expression: "{{JSON:((CIBIL))}}",
    note:
      "ESA: one field for the whole bureau JSON — map only Cibil_Data (nested paths are not listed).",
  },
  {
    prefix: "Crif_Data",
    expression: "{{JSON:((CRIF))}}",
    note:
      "ESA: one field for the whole CRIF blob — map only Crif_Data (adjust service name to match your pipeline).",
  },
];

function passThroughHint(normalizedPath: string): MappingSuggestion | null {
  for (const b of PASS_THROUGH_JSON_BLOBS) {
    if (normalizedPath === b.prefix) {
      return {
        expression: b.expression,
        count: 0,
        services: [b.note],
      };
    }
  }
  return null;
}

function dedupeSuggestions(
  items: MappingSuggestion[],
  limit: number,
): MappingSuggestion[] {
  const seen = new Set<string>();
  const out: MappingSuggestion[] = [];
  for (const s of items) {
    if (seen.has(s.expression)) continue;
    seen.add(s.expression);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

function valueToExpressionString(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return JSON.stringify(v);
  return JSON.stringify(v);
}

function coerceRequestBody(rb: unknown): Record<string, unknown> | null {
  if (rb == null) return null;
  if (typeof rb === "string") {
    try {
      const p = JSON.parse(rb) as unknown;
      if (p !== null && typeof p === "object" && !Array.isArray(p)) {
        return p as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
  if (typeof rb === "object" && !Array.isArray(rb)) {
    return rb as Record<string, unknown>;
  }
  return null;
}

export type MappingSuggestion = {
  expression: string;
  count: number;
  services: string[];
};

export type CorpusIndex = {
  byPath: Map<string, MappingSuggestion[]>;
  bySuffix: Map<string, MappingSuggestion[]>;
  /** Distinct normalized paths in the corpus. */
  meta: { leafPaths: number };
};

type Acc = Map<string, Map<string, { count: number; services: Set<string> }>>;

function accumulate(
  acc: Acc,
  path: string,
  expression: string,
  serviceName: string,
): void {
  const norm = normalizeMappingPath(path);
  if (!norm) return;
  const inner = acc.get(norm) ?? new Map();
  const cur = inner.get(expression) ?? { count: 0, services: new Set<string>() };
  cur.count += 1;
  cur.services.add(serviceName);
  inner.set(expression, cur);
  acc.set(norm, inner);
}

function accToSortedSuggestions(m: Map<string, { count: number; services: Set<string> }>): MappingSuggestion[] {
  return [...m.entries()]
    .map(([expression, v]) => ({
      expression,
      count: v.count,
      services: [...v.services].sort(),
    }))
    .sort((a, b) => b.count - a.count || a.expression.length - b.expression.length);
}

function buildSuffixIndex(byPath: Map<string, MappingSuggestion[]>): Map<string, MappingSuggestion[]> {
  const suffixAcc: Acc = new Map();

  for (const [path, suggestions] of byPath.entries()) {
    const seg = lastSegment(path);
    if (SUFFIX_STOPLIST.has(seg) || seg.length < 4) continue;
    for (const s of suggestions) {
      const inner = suffixAcc.get(seg) ?? new Map();
      const cur = inner.get(s.expression) ?? { count: 0, services: new Set<string>() };
      cur.count += s.count;
      for (const n of s.services) cur.services.add(n);
      inner.set(s.expression, cur);
      suffixAcc.set(seg, inner);
    }
  }

  const out = new Map<string, MappingSuggestion[]>();
  for (const [suffix, inner] of suffixAcc.entries()) {
    out.set(suffix, accToSortedSuggestions(inner));
  }
  return out;
}

export function buildCorpusIndex(
  rows: { service_name: string; request_body: unknown; is_deleted?: boolean }[],
): CorpusIndex {
  const acc: Acc = new Map();
  for (const row of rows) {
    if (row.is_deleted) continue;
    const obj = coerceRequestBody(row.request_body);
    if (!obj || Object.keys(obj).length === 0) continue;
    const flat = flattenLeaves(obj);
    for (const [path, val] of Object.entries(flat)) {
      accumulate(acc, path, valueToExpressionString(val), row.service_name);
    }
  }

  const byPath = new Map<string, MappingSuggestion[]>();
  for (const [path, inner] of acc.entries()) {
    byPath.set(path, accToSortedSuggestions(inner));
  }

  const bySuffix = buildSuffixIndex(byPath);

  return {
    byPath,
    bySuffix,
    meta: { leafPaths: byPath.size },
  };
}

export function mergeCorpusIndexes(a: CorpusIndex, b: CorpusIndex): CorpusIndex {
  const acc: Acc = new Map();

  function ingest(source: CorpusIndex) {
    for (const [path, suggestions] of source.byPath.entries()) {
      const inner = acc.get(path) ?? new Map();
      for (const s of suggestions) {
        const cur = inner.get(s.expression) ?? { count: 0, services: new Set<string>() };
        cur.count += s.count;
        for (const n of s.services) cur.services.add(n);
        inner.set(s.expression, cur);
      }
      acc.set(path, inner);
    }
  }

  ingest(a);
  ingest(b);

  const byPath = new Map<string, MappingSuggestion[]>();
  for (const [path, inner] of acc.entries()) {
    byPath.set(path, accToSortedSuggestions(inner));
  }

  const bySuffix = buildSuffixIndex(byPath);
  return {
    byPath,
    bySuffix,
    meta: { leafPaths: byPath.size },
  };
}

/**
 * Filter corpus expressions for autocomplete: prefix matches first (preserving corpus order),
 * then substring matches. Caps at `limit` (e.g. 10) for a short dropdown.
 */
export function filterAutocompleteExpressions(
  query: string,
  sortedExpressions: string[],
  limit: number,
): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return sortedExpressions.slice(0, limit);

  const prefix: string[] = [];
  const contains: string[] = [];
  for (const o of sortedExpressions) {
    const ol = o.toLowerCase();
    if (ol.startsWith(q)) prefix.push(o);
  }
  if (prefix.length >= limit) return prefix.slice(0, limit);

  for (const o of sortedExpressions) {
    const ol = o.toLowerCase();
    if (!ol.startsWith(q) && ol.includes(q)) contains.push(o);
    if (prefix.length + contains.length >= limit) break;
  }
  return [...prefix, ...contains].slice(0, limit);
}

/**
 * Distinct mapping expression strings from the corpus (from ESA `request_body` leaves),
 * sorted by total usage count. Use with {@link filterAutocompleteExpressions} for autocomplete.
 */
export function getAllCorpusExpressions(corpus: CorpusIndex, limit = 500): string[] {
  const score = new Map<string, number>();
  for (const suggestions of corpus.byPath.values()) {
    for (const s of suggestions) {
      const e = s.expression.trim();
      if (!e) continue;
      score.set(e, (score.get(e) ?? 0) + s.count);
    }
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([e]) => e);
}

export function getSuggestionsForPath(path: string, corpus: CorpusIndex, limit = 5): MappingSuggestion[] {
  const norm = normalizeMappingPath(path);
  const hint = passThroughHint(norm);

  const exact = corpus.byPath.get(norm);
  if (exact?.length) {
    const merged = hint ? dedupeSuggestions([hint, ...exact], limit) : exact.slice(0, limit);
    return merged;
  }

  if (hint) {
    return [hint];
  }

  const seg = lastSegment(norm);
  if (seg.length >= 3 && !SUFFIX_STOPLIST.has(seg)) {
    const fromSuffix = corpus.bySuffix.get(seg);
    if (fromSuffix?.length) return fromSuffix.slice(0, limit);
  }

  return [];
}

/** Serializable snapshot for bundled seed data. */
export type CorpusIndexJSON = {
  byPath: Record<string, MappingSuggestion[]>;
  bySuffix: Record<string, MappingSuggestion[]>;
  meta: { leafPaths: number };
};

export function corpusIndexToJSON(c: CorpusIndex): CorpusIndexJSON {
  return {
    byPath: Object.fromEntries(c.byPath),
    bySuffix: Object.fromEntries(c.bySuffix),
    meta: c.meta,
  };
}

export function corpusIndexFromJSON(j: CorpusIndexJSON): CorpusIndex {
  return {
    byPath: new Map(Object.entries(j.byPath)),
    bySuffix: new Map(Object.entries(j.bySuffix)),
    meta: j.meta,
  };
}

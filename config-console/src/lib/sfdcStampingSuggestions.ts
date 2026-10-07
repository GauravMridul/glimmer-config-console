import {
  type CorpusIndex,
  mergeCorpusIndexes,
  normalizeMappingPath,
  type MappingSuggestion,
} from "@/lib/mappingSuggestions";

type Acc = Map<string, Map<string, { count: number; services: Set<string> }>>;
type FieldAcc = Map<string, Map<string, { count: number; services: Set<string> }>>;

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

function lastSegment(normalizedPath: string): string {
  const i = normalizedPath.lastIndexOf(".");
  if (i === -1) return normalizedPath;
  return normalizedPath.slice(i + 1);
}

/**
 * Extract JSON-ish paths after `.response.` in template strings (e.g. ((MySvc.response.body.score))).
 */
export function extractResponseSubpaths(expr: string): string[] {
  const paths: string[] = [];
  const needle = ".response.";
  let from = 0;
  while (true) {
    const idx = expr.indexOf(needle, from);
    if (idx === -1) break;
    const j = idx + needle.length;
    let end = j;
    while (end < expr.length) {
      const c = expr[end];
      if (c === ")" || c === "}" || c === "," || c === " " || c === "|") break;
      end++;
    }
    const segment = expr.slice(j, end).replace(/^\./, "").trim();
    if (segment) paths.push(normalizeMappingPath(segment));
    from = idx + 1;
  }
  return paths;
}

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

function accToSortedSuggestions(
  m: Map<string, { count: number; services: Set<string> }>,
): MappingSuggestion[] {
  return [...m.entries()]
    .map(([expression, v]) => ({
      expression,
      count: v.count,
      services: [...v.services].sort(),
    }))
    .sort((a, b) => b.count - a.count || a.expression.length - b.expression.length);
}

export type SfFieldSuggestion = {
  field: string;
  count: number;
  services: string[];
};

export type SfFieldCorpusIndex = {
  byPath: Map<string, SfFieldSuggestion[]>;
  bySuffix: Map<string, SfFieldSuggestion[]>;
  meta: { leafPaths: number };
};

export type SfFieldCorpusIndexJSON = {
  byPath: Record<string, SfFieldSuggestion[]>;
  bySuffix: Record<string, SfFieldSuggestion[]>;
  meta: { leafPaths: number };
};

export function sfFieldCorpusFromJSON(j: SfFieldCorpusIndexJSON): SfFieldCorpusIndex {
  return {
    byPath: new Map(Object.entries(j.byPath)),
    bySuffix: new Map(Object.entries(j.bySuffix)),
    meta: j.meta,
  };
}

function collectBodyFieldPairs(
  body: unknown,
  prefix = "",
): { sfField: string; expr: string }[] {
  if (body === null || body === undefined) return [];
  if (typeof body !== "object" || Array.isArray(body)) return [];
  const out: { sfField: string; expr: string }[] = [];
  for (const k of Object.keys(body as object)) {
    const v = (body as Record<string, unknown>)[k];
    const fieldPath = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      out.push({ sfField: fieldPath, expr: v });
    } else if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      out.push(...collectBodyFieldPairs(v, fieldPath));
    }
  }
  return out;
}

function accumulateSfField(
  acc: FieldAcc,
  apiPath: string,
  sfField: string,
  serviceName: string,
): void {
  const norm = normalizeMappingPath(apiPath);
  if (!norm) return;
  const inner = acc.get(norm) ?? new Map();
  const cur = inner.get(sfField) ?? { count: 0, services: new Set<string>() };
  cur.count += 1;
  cur.services.add(serviceName);
  inner.set(sfField, cur);
  acc.set(norm, inner);
}

function accToSortedSfFields(
  m: Map<string, { count: number; services: Set<string> }>,
): SfFieldSuggestion[] {
  return [...m.entries()]
    .map(([field, v]) => ({
      field,
      count: v.count,
      services: [...v.services].sort(),
    }))
    .sort((a, b) => b.count - a.count || a.field.length - b.field.length);
}

function buildSuffixIndexForSfFields(
  byPath: Map<string, SfFieldSuggestion[]>,
): Map<string, SfFieldSuggestion[]> {
  const suffixAcc: FieldAcc = new Map();

  for (const [path, suggestions] of byPath.entries()) {
    const seg = lastSegment(path);
    if (SUFFIX_STOPLIST.has(seg) || seg.length < 4) continue;
    for (const s of suggestions) {
      const inner = suffixAcc.get(seg) ?? new Map();
      const cur = inner.get(s.field) ?? { count: 0, services: new Set<string>() };
      cur.count += s.count;
      for (const n of s.services) cur.services.add(n);
      inner.set(s.field, cur);
      suffixAcc.set(seg, inner);
    }
  }

  const out = new Map<string, SfFieldSuggestion[]>();
  for (const [suffix, inner] of suffixAcc.entries()) {
    out.set(suffix, accToSortedSfFields(inner));
  }
  return out;
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

function collectBodyStrings(body: unknown, prefix = ""): string[] {
  if (body === null || body === undefined) return [];
  if (typeof body === "string") return [body];
  if (typeof body !== "object") return [];
  if (Array.isArray(body)) {
    const out: string[] = [];
    body.forEach((item, i) => {
      const p = prefix ? `${prefix}[${i}]` : `[${i}]`;
      out.push(...collectBodyStrings(item, p));
    });
    return out;
  }
  const out: string[] = [];
  for (const k of Object.keys(body as object)) {
    const v = (body as Record<string, unknown>)[k];
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.push(v);
    else if (v !== null && typeof v === "object") out.push(...collectBodyStrings(v, p));
  }
  return out;
}

export function buildSfdcStampingCorpus(
  rows: { service_name: string; request_body: unknown; is_deleted?: boolean }[],
): CorpusIndex {
  const acc: Acc = new Map();

  for (const row of rows) {
    if (row.is_deleted) continue;
    let rb = row.request_body;
    if (typeof rb === "string") {
      try {
        rb = JSON.parse(rb) as unknown;
      } catch {
        continue;
      }
    }
    if (!Array.isArray(rb)) continue;

    for (const op of rb) {
      if (op === null || typeof op !== "object") continue;
      const body = (op as Record<string, unknown>).body;
      const strings = collectBodyStrings(body);
      for (const expr of strings) {
        const paths = extractResponseSubpaths(expr);
        if (paths.length === 0) continue;
        for (const p of paths) {
          accumulate(acc, p, expr, row.service_name);
        }
      }
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

export function buildSfFieldCorpus(
  rows: { service_name: string; request_body: unknown; is_deleted?: boolean }[],
): SfFieldCorpusIndex {
  const acc: FieldAcc = new Map();

  for (const row of rows) {
    if (row.is_deleted) continue;
    let rb = row.request_body;
    if (typeof rb === "string") {
      try {
        rb = JSON.parse(rb) as unknown;
      } catch {
        continue;
      }
    }
    if (!Array.isArray(rb)) continue;

    for (const op of rb) {
      if (op === null || typeof op !== "object") continue;
      const body = (op as Record<string, unknown>).body;
      const pairs = collectBodyFieldPairs(body);
      for (const { sfField, expr } of pairs) {
        const paths = extractResponseSubpaths(expr);
        if (paths.length === 0) continue;
        for (const p of paths) {
          accumulateSfField(acc, p, sfField, row.service_name);
        }
      }
    }
  }

  const byPath = new Map<string, SfFieldSuggestion[]>();
  for (const [path, inner] of acc.entries()) {
    byPath.set(path, accToSortedSfFields(inner));
  }

  const bySuffix = buildSuffixIndexForSfFields(byPath);

  return {
    byPath,
    bySuffix,
    meta: { leafPaths: byPath.size },
  };
}

export function mergeSfFieldCorpusIndexes(a: SfFieldCorpusIndex, b: SfFieldCorpusIndex): SfFieldCorpusIndex {
  const acc: FieldAcc = new Map();

  function ingest(source: SfFieldCorpusIndex) {
    for (const [path, suggestions] of source.byPath.entries()) {
      const inner = acc.get(path) ?? new Map();
      for (const s of suggestions) {
        const cur = inner.get(s.field) ?? { count: 0, services: new Set<string>() };
        cur.count += s.count;
        for (const n of s.services) cur.services.add(n);
        inner.set(s.field, cur);
      }
      acc.set(path, inner);
    }
  }

  ingest(a);
  ingest(b);

  const byPath = new Map<string, SfFieldSuggestion[]>();
  for (const [path, inner] of acc.entries()) {
    byPath.set(path, accToSortedSfFields(inner));
  }

  const bySuffix = buildSuffixIndexForSfFields(byPath);
  return {
    byPath,
    bySuffix,
    meta: { leafPaths: byPath.size },
  };
}

export function getSfFieldSuggestionsForPath(
  path: string,
  corpus: SfFieldCorpusIndex,
  limit = 5,
): SfFieldSuggestion[] {
  const norm = normalizeMappingPath(path);
  const exact = corpus.byPath.get(norm);
  if (exact?.length) return exact.slice(0, limit);

  const seg = lastSegment(norm);
  if (seg.length >= 3 && !SUFFIX_STOPLIST.has(seg)) {
    const fromSuffix = corpus.bySuffix.get(seg);
    if (fromSuffix?.length) return fromSuffix.slice(0, limit);
  }

  return [];
}

export { mergeCorpusIndexes };

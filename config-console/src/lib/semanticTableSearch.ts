import { useEffect, useMemo, useState } from "react";
import MiniSearch from "minisearch";

/**
 * MiniSearch-backed row filter: prefix + fuzzy matching with substring fallback.
 * Pass a stable `toDoc` (e.g. from useCallback) so the index is not rebuilt every render.
 */
export function createSemanticRowSearch<T>(
  rows: readonly T[],
  toDoc: (row: T) => { id: string; text: string },
): (query: string) => T[] {
  const list = [...rows];
  const mini = new MiniSearch<{ id: string; text: string }>({
    fields: ["text"],
    storeFields: ["id"],
    searchOptions: { prefix: true, fuzzy: 0.12 },
  });
  const byId = new Map<string, T>();
  for (const r of list) {
    const d = toDoc(r);
    byId.set(d.id, r);
    mini.add({ id: d.id, text: d.text });
  }
  return (query: string) => {
    const q = query.trim();
    if (!q) return list;
    const hits = mini.search(q);
    const out: T[] = [];
    const seen = new Set<string>();
    for (const h of hits) {
      const id = String(h.id);
      if (seen.has(id)) continue;
      seen.add(id);
      const row = byId.get(id);
      if (row) out.push(row);
    }
    if (out.length > 0) return out;
    const low = q.toLowerCase();
    return list.filter((r) => toDoc(r).text.toLowerCase().includes(low));
  };
}

export function useSemanticRowFilter<T>(
  rows: readonly T[],
  toDoc: (row: T) => { id: string; text: string },
  initialQuery = "",
): readonly [string, (value: string) => void, T[]] {
  const searchFn = useMemo(() => createSemanticRowSearch(rows, toDoc), [rows, toDoc]);
  const [query, setQuery] = useState(initialQuery);
  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);
  const filtered = useMemo(() => searchFn(query), [searchFn, query]);
  return [query, setQuery, filtered];
}

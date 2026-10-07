import MiniSearch from "minisearch";
import type { SalesforceDescribeField } from "@/api/backend";

export type OrgFieldMatch = {
  name: string;
  label: string;
  score: number;
};

/** Turn a flattened leaf path into search terms (tail segments, camelCase / underscore split). */
export function leafPathToSearchQuery(path: string): string {
  const norm = path.replace(/\[\*\]/g, " ").replace(/\[\d+\]/g, " ");
  const parts = norm
    .split(".")
    .map((p) => p.trim())
    .filter(Boolean);
  const tail = parts.slice(-4).join(" ");
  const expanded = tail
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ");
  return expanded.replace(/\s+/g, " ").trim().toLowerCase();
}

function lastSegmentToken(path: string): string {
  const norm = path.replace(/\[\*\]/g, ".").replace(/\[\d+\]/g, ".");
  const i = norm.lastIndexOf(".");
  const seg = i === -1 ? norm : norm.slice(i + 1);
  return leafPathToSearchQuery(seg);
}

/**
 * Builds a reusable index for {@link SalesforceDescribeField} rows (one describe load).
 * Matches leaf paths to field API names + labels via MiniSearch (prefix + light fuzzy).
 */
export function buildDescribeFieldIndex(fields: SalesforceDescribeField[]) {
  const mini = new MiniSearch<{ id: string; text: string }>({
    fields: ["text"],
    storeFields: ["id"],
    searchOptions: { prefix: true, fuzzy: 0.15 },
  });

  for (const f of fields) {
    const deSuffix = f.name.replace(/__c$/i, "").replace(/_/g, " ");
    const text = `${f.name} ${f.label} ${deSuffix}`.toLowerCase();
    mini.add({ id: f.name, text });
  }

  const byName = new Map(fields.map((f) => [f.name, f]));

  return {
    /** Rank fields for a JSON/API leaf path; candidates are always from this describe. */
    search(leafPath: string, limit: number): OrgFieldMatch[] {
      const seen = new Set<string>();
      const out: OrgFieldMatch[] = [];

      const pushHits = (q: string) => {
        if (!q.trim() || out.length >= limit) return;
        const hits = mini.search(q);
        for (const h of hits) {
          const id = String(h.id);
          if (seen.has(id)) continue;
          seen.add(id);
          const f = byName.get(id);
          if (f) out.push({ name: f.name, label: f.label, score: h.score });
          if (out.length >= limit) break;
        }
      };

      pushHits(leafPathToSearchQuery(leafPath));
      if (out.length < limit) pushHits(lastSegmentToken(leafPath));
      return out.slice(0, limit);
    },
  };
}

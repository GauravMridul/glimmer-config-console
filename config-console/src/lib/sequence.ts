/**
 * Parses ESA-style sequence strings such as `{1,2;5}` or `1,2;5` into numeric service ids.
 * Semicolons are ignored (flattened) — use {@link parseSequenceGroups} to preserve stages.
 */
export function parseSequenceServiceIds(raw: string): number[] {
  const cleaned = raw
    .replace(/[{}]/g, " ")
    .replace(/;/g, ",")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ids: number[] = [];
  for (const part of cleaned) {
    const n = Number(part);
    if (!Number.isNaN(n)) ids.push(n);
  }
  return ids;
}

/**
 * Parses `service_sequence_string` into ordered stages: comma = parallel within a stage,
 * semicolon = next stage (sequential after previous stage completes).
 * Example: `40,101,88;3;5` → [[40,101,88],[3],[5]]
 */
export function parseSequenceGroups(raw: string): number[][] {
  const s = raw.trim();
  if (!s) return [];
  const cleaned = s.replace(/^\{+/, "").replace(/\}+$/, "").trim();
  const parts = cleaned.split(";").map((p) => p.trim()).filter(Boolean);
  const groups: number[][] = [];
  for (const part of parts) {
    const ids = part
      .split(/[,]+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n));
    if (ids.length) groups.push(ids);
  }
  return groups;
}

/** Inverse of {@link parseSequenceGroups} for editor round-trips. */
export function serializeSequenceGroups(groups: number[][]): string {
  return groups
    .filter((g) => g.length > 0)
    .map((g) => g.join(","))
    .join(";");
}

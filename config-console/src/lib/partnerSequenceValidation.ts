import type { ServiceConfiguration } from "@/types/models";
import { parseSequenceGroups, serializeSequenceGroups } from "@/lib/sequence";

export type SequenceDependencyIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  dependentId?: number;
  dependentName?: string;
  dependencyName?: string;
  dependencyId?: number;
  dependentGroup?: number;
  dependencyGroup?: number;
};

export type PartnerSequenceValidationResult = {
  groups: number[][];
  issues: SequenceDependencyIssue[];
  hasErrors: boolean;
  hasWarnings: boolean;
};

/** Collects text for dependency scanning from ESA templates. */
export function serviceConfigurationScanText(row: ServiceConfiguration): string {
  try {
    return [
      JSON.stringify(row.request_body ?? {}),
      JSON.stringify(row.headers ?? {}),
      JSON.stringify(row.response_body ?? {}),
      JSON.stringify(row.additional_config ?? {}),
      String(row.api_url ?? ""),
    ].join("\n");
  } catch {
    return "";
  }
}

/** Map template spelling → canonical `service_name` from DB (case-insensitive). */
export function resolveCanonicalServiceName(
  raw: string,
  nameToId: Map<string, number>,
): string | undefined {
  if (nameToId.has(raw)) return raw;
  const lower = raw.toLowerCase();
  for (const name of nameToId.keys()) {
    if (name.toLowerCase() === lower) return name;
  }
  return undefined;
}

/**
 * Finds ((ServiceName....)) runtime references. Only names that match a `service_name`
 * row (case-insensitive) are kept (e.g. `((acticoData.body…))` → acticoData).
 * Allows optional spaces: "(( ServiceName ." (some exports use spaces).
 */
export function extractKnownServiceDependencies(
  text: string,
  nameToId: Map<string, number>,
): Set<string> {
  const deps = new Set<string>();
  const reDot = /\(\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\./g;
  const reParen = /\(\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)\)/g;
  let m: RegExpExecArray | null;
  while ((m = reDot.exec(text)) !== null) {
    const canon = resolveCanonicalServiceName(m[1], nameToId);
    if (canon) deps.add(canon);
  }
  while ((m = reParen.exec(text)) !== null) {
    const canon = resolveCanonicalServiceName(m[1], nameToId);
    if (canon) deps.add(canon);
  }
  return deps;
}

/** ESA `service_name` for the actico features payload service (live API only needs Cibil_Data / Crif_Data). */
const ACTICO_DATA_SERVICE_LC = "acticodata";

/** Bureau ESA services that feed acticoData (payload keys Cibil_Data / Crif_Data). */
const ACTICO_BUREAU_SERVICE_NAMES_UC = new Set(["CIBIL", "CRIF"]);

/**
 * Dependency names for sequencing / Recommended / Check.
 * Other services (e.g. PostBureauFinnable) keep `((acticoData.body…))` as **acticoData** — not CIBIL/CRIF.
 * Only the **acticoData** row is narrowed to CIBIL + CRIF (all that must run before that API).
 */
export function esaTemplateDependencyNames(
  row: ServiceConfiguration | undefined,
  scanText: string,
  nameToId: Map<string, number>,
): Set<string> {
  const deps = extractKnownServiceDependencies(scanText, nameToId);
  if (row?.service_name?.toLowerCase() === ACTICO_DATA_SERVICE_LC) {
    const only = new Set<string>();
    for (const n of deps) {
      if (ACTICO_BUREAU_SERVICE_NAMES_UC.has(n.toUpperCase())) only.add(n);
    }
    return only;
  }
  return deps;
}

/** Consistent label: `#90 ServiceName` (id + ESA service_name, fallback when missing). */
function formatSvcLabel(
  svcId: number,
  serviceName: string | undefined | null,
  fallback: string,
): string {
  const n = (serviceName ?? "").trim() || fallback.trim() || "?";
  return `#${svcId} ${n}`;
}

const TEMPLATE_LOCATION_LABELS: Record<string, string> = {
  request: "request body",
  headers: "headers",
  response: "response template",
  additional_config: "additional config",
  api_url: "API URL",
};

/**
 * When the consumer references `providerCanonName` outside `request_body`, returns
 * ` · in …` (e.g. ` · in additional config`). Empty if the reference is only in the request body.
 */
function nonRequestDependencySourceSuffix(
  row: ServiceConfiguration,
  nameToId: Map<string, number>,
  providerCanonName: string | undefined | null,
): string {
  const canon = (providerCanonName ?? "").trim();
  if (!canon) return "";
  const hits: string[] = [];
  const touch = (label: string, text: string) => {
    if (extractKnownServiceDependencies(text, nameToId).has(canon)) hits.push(label);
  };
  try {
    touch("request", JSON.stringify(row.request_body ?? {}));
    touch("headers", JSON.stringify(row.headers ?? {}));
    touch("response", JSON.stringify(row.response_body ?? {}));
    touch("additional_config", JSON.stringify(row.additional_config ?? {}));
    touch("api_url", String(row.api_url ?? ""));
  } catch {
    return "";
  }
  const outsideRequest = hits.filter((h) => h !== "request");
  if (outsideRequest.length === 0) return "";
  const pretty = outsideRequest.map((k) => TEMPLATE_LOCATION_LABELS[k] ?? k);
  return ` · in ${pretty.join(", ")}`;
}

/** Same shape as {@link nonRequestDependencySourceSuffix}, or ` · in sequence` for ordering context. */
function sequenceIssueLocationSuffix(
  row: ServiceConfiguration,
  nameToId: Map<string, number>,
  providerCanonName: string | undefined | null,
): string {
  return (
    nonRequestDependencySourceSuffix(row, nameToId, providerCanonName) || " · in sequence"
  );
}

/** Direct `((ServiceName…))` edges from one ESA row (any known service id, not filtered by sequence). */
function allEsaTemplateDependencyIds(
  svcId: number,
  byId: Map<number, ServiceConfiguration>,
  nameToId: Map<string, number>,
): Set<number> {
  const row = byId.get(svcId);
  if (!row) return new Set();
  const out = new Set<number>();
  const scan = serviceConfigurationScanText(row);
  for (const depName of esaTemplateDependencyNames(row, scan, nameToId)) {
    const d = nameToId.get(depName);
    if (d !== undefined && d !== svcId) out.add(d);
  }
  return out;
}

/**
 * For each consumer in `S`, every other id in `S` that must run first: follow template deps through
 * **any** registered service (including ids not in `S`) until all reachable sequence members are collected.
 */
function buildSequenceMustPrecedeMap(
  S: Set<number>,
  byId: Map<number, ServiceConfiguration>,
  nameToId: Map<string, number>,
): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  for (const consumerId of S) {
    const preds = new Set<number>();
    const stack: number[] = [consumerId];
    const seen = new Set<number>();
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const d of allEsaTemplateDependencyIds(cur, byId, nameToId)) {
        if (S.has(d) && d !== consumerId) preds.add(d);
        stack.push(d);
      }
    }
    out.set(consumerId, preds);
  }
  return out;
}

/** ESA id for ActicoPreBureau — partner flows usually keep it in the first one or two stages. */
const ACTICO_PRE_BUREAU_SERVICE_ID = 3;

function firstGroupIndexForId(groups: number[][], targetId: number): number | undefined {
  for (let gi = 0; gi < groups.length; gi++) {
    if (groups[gi].includes(targetId)) return gi;
  }
  return undefined;
}

/**
 * Uses semicolon stages from the **current** sequence string around id {@link ACTICO_PRE_BUREAU_SERVICE_ID}:
 * - Every other sequence id in an **earlier** stage must finish before 3.
 * - Id 3 must finish before every sequence id in a **later** stage.
 * Merged with ESA-based edges in `mustBefore`.
 */
function mergeActicoPreBureauUserStageHints(
  parsedGroups: number[][],
  S: Set<number>,
  mustBefore: Map<number, Set<number>>,
): void {
  if (!S.has(ACTICO_PRE_BUREAU_SERVICE_ID)) return;
  const gi = firstGroupIndexForId(parsedGroups, ACTICO_PRE_BUREAU_SERVICE_ID);
  if (gi === undefined) return;

  const preds3 = mustBefore.get(ACTICO_PRE_BUREAU_SERVICE_ID);
  if (!preds3) return;

  for (let g = 0; g < gi; g++) {
    for (const id of parsedGroups[g]) {
      if (S.has(id) && id !== ACTICO_PRE_BUREAU_SERVICE_ID) preds3.add(id);
    }
  }

  for (let g = gi + 1; g < parsedGroups.length; g++) {
    for (const id of parsedGroups[g]) {
      if (!S.has(id) || id === ACTICO_PRE_BUREAU_SERVICE_ID) continue;
      const p = mustBefore.get(id);
      if (p) p.add(ACTICO_PRE_BUREAU_SERVICE_ID);
    }
  }
}

/** Reading order within the parsed sequence (first occurrence wins for duplicates). */
function userSequenceStableRank(parsedGroups: number[][]): Map<number, number> {
  const rank = new Map<number, number>();
  let r = 0;
  for (const g of parsedGroups) {
    for (const id of g) {
      if (!rank.has(id)) rank.set(id, r);
      r++;
    }
  }
  return rank;
}

export function validatePartnerSequence(
  serviceSequenceString: string,
  serviceConfigurations: ServiceConfiguration[],
): PartnerSequenceValidationResult {
  const issues: SequenceDependencyIssue[] = [];
  const groups = parseSequenceGroups(serviceSequenceString);
  const active = serviceConfigurations.filter((r) => !r.is_deleted);

  const byId = new Map<number, ServiceConfiguration>();
  const nameToId = new Map<string, number>();
  for (const r of active) {
    byId.set(r.id, r);
    if (r.service_name) nameToId.set(r.service_name, r.id);
  }

  /** id -> first group index */
  const idToGroup = new Map<number, number>();
  for (let gi = 0; gi < groups.length; gi++) {
    for (const id of groups[gi]) {
      if (idToGroup.has(id)) {
        issues.push({
          severity: "warning",
          code: "duplicate_id",
          message: `Id ${id} appears twice (first group wins for ordering).`,
          dependentId: id,
          dependentGroup: idToGroup.get(id),
        });
      } else {
        idToGroup.set(id, gi);
      }
    }
  }

  const sequenceIds = new Set(idToGroup.keys());
  const seqPredMap = buildSequenceMustPrecedeMap(sequenceIds, byId, nameToId);

  for (const id of sequenceIds) {
    const row = byId.get(id);
    if (!row) {
      issues.push({
        severity: "warning",
        code: "unknown_id",
        message: `Unknown id ${id} (not in ESA).`,
        dependentId: id,
        dependentGroup: idToGroup.get(id),
      });
      continue;
    }

    const scan = serviceConfigurationScanText(row);
    const depNames = esaTemplateDependencyNames(row, scan, nameToId);
    const gSelf = idToGroup.get(id)!;
    const conLabel = formatSvcLabel(id, row.service_name, "?");

    for (const depName of depNames) {
      const depId = nameToId.get(depName);
      if (depId === undefined) continue;

      if (depId === id) continue;

      if (!sequenceIds.has(depId)) {
        const depRow = byId.get(depId);
        const depLabel = formatSvcLabel(depId, depRow?.service_name, depName);
        const src = nonRequestDependencySourceSuffix(row, nameToId, depName);
        issues.push({
          severity: "warning",
          code: "dependency_not_in_sequence",
          message: `${conLabel} references ${depLabel} — not in this sequence.${src}`,
          dependentId: id,
          dependentName: row.service_name,
          dependencyName: depName,
          dependencyId: depId,
          dependentGroup: gSelf,
        });
      }
    }

    const preds = seqPredMap.get(id) ?? new Set<number>();
    for (const depId of preds) {
      const gDep = idToGroup.get(depId);
      if (gDep === undefined || gSelf === undefined) continue;

      const depRow = byId.get(depId);
      const depLabel = formatSvcLabel(
        depId,
        depRow?.service_name,
        depRow?.service_name ?? "?",
      );
      const src = sequenceIssueLocationSuffix(row, nameToId, depRow?.service_name);

      if (gDep === gSelf) {
        issues.push({
          severity: "error",
          code: "parallel_conflict",
          message: `${conLabel} needs ${depLabel} to finish before it, but both are in the same stage. Put ${depLabel} in an earlier stage (add a semicolon ";" before it so it runs in a separate step).${src}`,
          dependentId: id,
          dependentName: row.service_name,
          dependencyName: depRow?.service_name,
          dependencyId: depId,
          dependentGroup: gSelf,
          dependencyGroup: gDep,
        });
        continue;
      }

      if (gDep > gSelf) {
        issues.push({
          severity: "error",
          code: "order_violation",
          message: `${conLabel} uses data from ${depLabel}, so ${depLabel} should run first. In your sequence ${depLabel} is in stage ${gDep + 1} and ${conLabel} is in stage ${gSelf + 1} — move ${depLabel} to an earlier stage.${src}`,
          dependentId: id,
          dependentName: row.service_name,
          dependencyName: depRow?.service_name,
          dependencyId: depId,
          dependentGroup: gSelf,
          dependencyGroup: gDep,
        });
      }
    }
  }

  const hasErrors = issues.some((i) => i.severity === "error");
  const hasWarnings = issues.some((i) => i.severity === "warning");

  issues.sort((a, b) => {
    const sev = (s: string) => (s === "error" ? 0 : 1);
    if (sev(a.severity) !== sev(b.severity)) return sev(a.severity) - sev(b.severity);
    return (a.dependentId ?? 0) - (b.dependentId ?? 0);
  });

  return { groups, issues, hasErrors, hasWarnings };
}

export type RecommendedSequenceResult = {
  /** Stages (semicolon) with parallel ids (comma) that respect ((ServiceName)) deps between services in this sequence. */
  groups: number[][];
  /** False if the dependency graph among these ids has a cycle (no valid order). */
  ok: boolean;
};

/**
 * Builds a **recommended** ordering for the same service ids as in `serviceSequenceString`, using
 * dependencies implied by ESA templates (`((ServiceName…))`). Predecessors include every other sequence
 * id reachable by following those edges through **any** registered service (not only direct links among
 * sequence members). Maximizes parallelism: each stage runs every service whose sequence predecessors
 * are already placed.
 *
 * Service id **3** (ActicoPreBureau): semicolon groups in the **input** string are merged in — ids in
 * stages before 3 are recommended before 3; ids in stages after 3 are recommended after 3 — on top of
 * ESA deps, so the suggested order stays aligned with how the sequence already frames ActicoPreBureau.
 */
export function computeRecommendedSequence(
  serviceSequenceString: string,
  serviceConfigurations: ServiceConfiguration[],
): RecommendedSequenceResult {
  const parsed = parseSequenceGroups(serviceSequenceString);
  const ids = [...new Set(parsed.flat())];
  if (ids.length === 0) return { groups: [], ok: true };

  const active = serviceConfigurations.filter((r) => !r.is_deleted);
  const byId = new Map<number, ServiceConfiguration>();
  const nameToId = new Map<string, number>();
  for (const r of active) {
    byId.set(r.id, r);
    if (r.service_name) nameToId.set(r.service_name, r.id);
  }

  const S = new Set(ids);
  const mustBefore = buildSequenceMustPrecedeMap(S, byId, nameToId);
  mergeActicoPreBureauUserStageHints(parsed, S, mustBefore);

  const placed = new Set<number>();
  const layers: number[][] = [];
  const userRank = userSequenceStableRank(parsed);
  const sortByUserThenId = (a: number, b: number) => {
    const ra = userRank.get(a) ?? 0;
    const rb = userRank.get(b) ?? 0;
    if (ra !== rb) return ra - rb;
    return a - b;
  };
  const sortedIds = [...ids].sort(sortByUserThenId);

  while (placed.size < ids.length) {
    const ready: number[] = [];
    for (const id of sortedIds) {
      if (placed.has(id)) continue;
      const preds = mustBefore.get(id) ?? new Set<number>();
      if ([...preds].every((p) => placed.has(p))) {
        ready.push(id);
      }
    }
    if (ready.length === 0) {
      return { groups: [], ok: false };
    }
    ready.sort(sortByUserThenId);
    layers.push(ready);
    for (const id of ready) placed.add(id);
  }

  return { groups: layers, ok: true };
}

/** Canonical string for {@link computeRecommendedSequence} (same syntax as stored `service_sequence_string`). */
export function formatRecommendedSequenceString(
  result: RecommendedSequenceResult,
): string {
  if (!result.ok || result.groups.length === 0) return "";
  return serializeSequenceGroups(result.groups);
}

/**
 * Where a service not yet in the sequence would land if the sequence were re-ordered using the same
 * dependency rules as “Recommended” (maximize safe parallelism). Used for backlog hover tips.
 */
export type StageSuggestionForNewId =
  | { ok: true; stage1Based: number; peerIds: number[] }
  | { ok: false; reason: string };

export function suggestStageForNewServiceId(
  currentGroups: number[][],
  newId: number,
  serviceConfigurations: ServiceConfiguration[],
): StageSuggestionForNewId {
  if (currentGroups.some((g) => g.includes(newId))) {
    return { ok: false, reason: "This service is already in the sequence." };
  }
  const provisional = serializeSequenceGroups([...currentGroups.map((row) => [...row]), [newId]]);
  const rec = computeRecommendedSequence(provisional, serviceConfigurations);
  if (!rec.ok) {
    return {
      ok: false,
      reason:
        "We can’t suggest a step automatically while dependencies look unclear or circular—check the External APIs setup for each service.",
    };
  }
  const layerIdx = rec.groups.findIndex((layer) => layer.includes(newId));
  if (layerIdx < 0) {
    return { ok: false, reason: "We couldn’t fit this service into a suggested order." };
  }
  const peerIds = rec.groups[layerIdx].filter((x) => x !== newId);
  return { ok: true, stage1Based: layerIdx + 1, peerIds };
}

/** True if consumer’s saved templates directly reference provider’s service name. */
function consumerReferencesProviderDirect(
  consumerId: number,
  providerId: number,
  byId: Map<number, ServiceConfiguration>,
  nameToId: Map<string, number>,
): boolean {
  const row = byId.get(consumerId);
  if (!row) return false;
  const scan = serviceConfigurationScanText(row);
  for (const n of esaTemplateDependencyNames(row, scan, nameToId)) {
    if (nameToId.get(n) === providerId) return true;
  }
  return false;
}

function stageIndexOf(groups: number[][], id: number): number {
  return groups.findIndex((g) => g.includes(id));
}

/**
 * Inserts `newId` at the end of the stage where Recommended ordering would place it
 * (same rule as the backlog Tip). Existing services stay in their current stages and order.
 */
export function insertServiceAtRecommendedStage(
  currentGroups: number[][],
  newId: number,
  serviceConfigurations: ServiceConfiguration[],
): number[][] | null {
  if (currentGroups.some((g) => g.includes(newId))) return null;
  const provisional = serializeSequenceGroups([...currentGroups.map((row) => [...row]), [newId]]);
  const rec = computeRecommendedSequence(provisional, serviceConfigurations);
  if (!rec.ok) return null;
  const layerIdx = rec.groups.findIndex((layer) => layer.includes(newId));
  if (layerIdx < 0) return null;
  const g = currentGroups.map((row) => [...row]);
  while (g.length <= layerIdx) g.push([]);
  if (g[layerIdx].includes(newId)) return g;
  g[layerIdx].push(newId);
  return g;
}

const TOOLTIP_MAX = 1400;

/**
 * Hover text for a backlog service: short bullet lines (native tooltips may show line breaks).
 */
export function computePartnerBacklogTooltipPlain(
  currentGroups: number[][],
  newId: number,
  serviceConfigurations: ServiceConfiguration[],
): string {
  if (currentGroups.some((g) => g.includes(newId))) {
    return "• Already in this journey.";
  }

  const provisional = serializeSequenceGroups([...currentGroups.map((row) => [...row]), [newId]]);
  const parsed = parseSequenceGroups(provisional);
  const rec = computeRecommendedSequence(provisional, serviceConfigurations);
  if (!rec.ok) {
    return "• Can’t auto-place—check External APIs (dependencies unclear or circular).";
  }

  const layerIdx = stageIndexOf(rec.groups, newId);
  if (layerIdx < 0) {
    return "• Couldn’t fit this service into a suggested order.";
  }

  const active = serviceConfigurations.filter((r) => !r.is_deleted);
  const byId = new Map<number, ServiceConfiguration>();
  const nameToId = new Map<string, number>();
  for (const r of active) {
    byId.set(r.id, r);
    if (r.service_name) nameToId.set(r.service_name, r.id);
  }

  const S = new Set(parsed.flat());
  const mustBefore = buildSequenceMustPrecedeMap(S, byId, nameToId);
  mergeActicoPreBureauUserStageHints(parsed, S, mustBefore);

  /** `#id Name` for tooltips (matches list cells). */
  const idAndName = (svcId: number): string => {
    const n = byId.get(svcId)?.service_name?.trim();
    const name = n && n.length > 0 ? n : "?";
    return `#${svcId} ${name}`;
  };

  const preds = [...(mustBefore.get(newId) ?? [])];
  const earlier = preds.filter((p) => {
    const sp = stageIndexOf(rec.groups, p);
    return sp >= 0 && sp < layerIdx;
  });

  const later: number[] = [];
  for (const cid of S) {
    if (cid === newId) continue;
    if (!(mustBefore.get(cid)?.has(newId))) continue;
    if (stageIndexOf(rec.groups, cid) > layerIdx) later.push(cid);
  }
  later.sort(
    (a, b) => stageIndexOf(rec.groups, a) - stageIndexOf(rec.groups, b) || a - b,
  );

  const whyMustWaitLine = (pid: number): string => {
    const who = idAndName(pid);
    if (consumerReferencesProviderDirect(newId, pid, byId, nameToId)) {
      return `${who} — ${idAndName(newId)} reads its reply first`;
    }
    return `${who} — must finish first (journey order)`;
  };

  const whyLaterLine = (cid: number): string => {
    const who = idAndName(cid);
    if (consumerReferencesProviderDirect(cid, newId, byId, nameToId)) {
      return `${who} — uses reply from ${idAndName(newId)}`;
    }
    return `${who} — runs after this step`;
  };

  const stepNum = layerIdx + 1;
  const lines: string[] = [];

  lines.push(
    `• Suggested step: ${stepNum} — ${idAndName(newId)} (same row = same moment)`,
  );
  lines.push("• From earlier steps:");

  if (earlier.length === 0) {
    lines.push("  • none needed for the current journey list");
  } else {
    for (const pid of earlier) {
      lines.push(`  • ${whyMustWaitLine(pid)}`);
    }
  }

  lines.push("• Used by later steps:");

  if (later.length === 0) {
    lines.push("  • none in this journey");
  } else {
    for (const cid of later.slice(0, 8)) {
      lines.push(`  • ${whyLaterLine(cid)}`);
    }
    if (later.length > 8) {
      lines.push(`  • … +${later.length - 8} more`);
    }
  }

  const out = lines.join("\n");
  return out.length > TOOLTIP_MAX ? `${out.slice(0, TOOLTIP_MAX - 1)}…` : out;
}

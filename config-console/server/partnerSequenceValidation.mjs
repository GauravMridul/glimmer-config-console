/**
 * Keep in sync with src/lib/partnerSequenceValidation.ts (same rules).
 * Used by POST /api/validate-partner-sequence with fresh ESA rows from Postgres.
 */

export function parseSequenceGroups(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  const cleaned = s.replace(/^\{+/, "").replace(/\}+$/, "").trim();
  const parts = cleaned.split(";").map((p) => p.trim()).filter(Boolean);
  const groups = [];
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

function serviceConfigurationScanText(row) {
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

function resolveCanonicalServiceName(raw, nameToId) {
  if (nameToId.has(raw)) return raw;
  const lower = raw.toLowerCase();
  for (const name of nameToId.keys()) {
    if (name.toLowerCase() === lower) return name;
  }
  return undefined;
}

/** `#90 ServiceName` — id + ESA service_name (fallback if blank). */
function formatSvcLabel(svcId, serviceName, fallback) {
  const n = String(serviceName ?? "").trim() || String(fallback ?? "").trim() || "?";
  return `#${svcId} ${n}`;
}

function allEsaTemplateDependencyIds(svcId, byId, nameToId) {
  const row = byId.get(svcId);
  if (!row) return new Set();
  const out = new Set();
  const scan = serviceConfigurationScanText(row);
  for (const depName of esaTemplateDependencyNames(row, scan, nameToId)) {
    const d = nameToId.get(depName);
    if (d !== undefined && d !== svcId) out.add(d);
  }
  return out;
}

function buildSequenceMustPrecedeMap(S, byId, nameToId) {
  const out = new Map();
  for (const consumerId of S) {
    const preds = new Set();
    const stack = [consumerId];
    const seen = new Set();
    while (stack.length > 0) {
      const cur = stack.pop();
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

function extractKnownServiceDependencies(text, nameToId) {
  const deps = new Set();
  const reDot = /\(\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\./g;
  const reParen = /\(\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)\)/g;
  let m;
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

const ACTICO_DATA_SERVICE_LC = "acticodata";
const ACTICO_BUREAU_SERVICE_NAMES_UC = new Set(["CIBIL", "CRIF"]);

function esaTemplateDependencyNames(row, scanText, nameToId) {
  const deps = extractKnownServiceDependencies(scanText, nameToId);
  if (String(row?.service_name ?? "").toLowerCase() === ACTICO_DATA_SERVICE_LC) {
    const only = new Set();
    for (const n of deps) {
      if (ACTICO_BUREAU_SERVICE_NAMES_UC.has(String(n).toUpperCase())) only.add(n);
    }
    return only;
  }
  return deps;
}

const TEMPLATE_LOCATION_LABELS = {
  request: "request body",
  headers: "headers",
  response: "response template",
  additional_config: "additional config",
  api_url: "API URL",
};

function nonRequestDependencySourceSuffix(row, nameToId, providerCanonName) {
  const canon = String(providerCanonName ?? "").trim();
  if (!canon) return "";
  const hits = [];
  const touch = (label, text) => {
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

function sequenceIssueLocationSuffix(row, nameToId, providerCanonName) {
  return nonRequestDependencySourceSuffix(row, nameToId, providerCanonName) || " · in sequence";
}

/**
 * @param {string} serviceSequenceString
 * @param {Array<{ id: number, service_name: string, request_body?: unknown, headers?: unknown, response_body?: unknown, additional_config?: unknown, api_url?: string, is_deleted?: boolean }>} serviceConfigurations
 */
export function validatePartnerSequence(serviceSequenceString, serviceConfigurations) {
  const issues = [];
  const groups = parseSequenceGroups(serviceSequenceString);
  const active = serviceConfigurations.filter((r) => !r.is_deleted);

  const byId = new Map();
  const nameToId = new Map();
  for (const r of active) {
    byId.set(r.id, r);
    if (r.service_name) nameToId.set(r.service_name, r.id);
  }

  const idToGroup = new Map();
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
    const gSelf = idToGroup.get(id);
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

    const preds = seqPredMap.get(id) ?? new Set();
    for (const depId of preds) {
      const gDep = idToGroup.get(depId);
      if (gDep === undefined || gSelf === undefined) continue;

      const depRow = byId.get(depId);
      const depLabel = formatSvcLabel(depId, depRow?.service_name, depRow?.service_name ?? "?");
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
    const sev = (s) => (s === "error" ? 0 : 1);
    if (sev(a.severity) !== sev(b.severity)) return sev(a.severity) - sev(b.severity);
    return (a.dependentId ?? 0) - (b.dependentId ?? 0);
  });

  return { groups, issues, hasErrors, hasWarnings };
}

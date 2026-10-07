/**
 * Salesforce probe resolution aligned with external-service-adapter:
 * loads `query_object_relationship_map` from the ESA Postgres DB, builds SOQL like
 * `salesforce_client.go` (query_relation + additional_conditions + dependency order).
 */

import { assertSafeSObjectName } from "./salesforceClient.mjs";

function normalizeSoqlWhitespace(s) {
  return String(s).replace(/\s/g, (ch) => (/\s/.test(ch) ? " " : ch));
}

/** SOQL string literal (anchor / static). */
function soqlQuotedLiteral(s) {
  return `'${String(s ?? "").replace(/'/g, "''")}'`;
}

const MAX_PROBE_SF_RECORDS = 50;

/** Cap rows returned in API JSON for the probe UI (full totalSize still reported). */
function sampleQueryRecords(res) {
  const r = Array.isArray(res?.records) ? res.records : [];
  return r.slice(0, MAX_PROBE_SF_RECORDS);
}

export function dedupeFields(fields) {
  const byLower = new Map();
  for (const f of fields) {
    const t = String(f).trim();
    if (!t) continue;
    const low = t.toLowerCase();
    if (!byLower.has(low)) byLower.set(low, t);
  }
  return [...byLower.values()];
}

export function optimizedMergeFields(existing, newFields) {
  const byLower = new Map();
  for (const f of existing) {
    const t = String(f).trim();
    if (!t) continue;
    byLower.set(t.toLowerCase(), t);
  }
  for (const f of newFields) {
    const t = String(f).trim();
    if (!t) continue;
    const low = t.toLowerCase();
    if (!byLower.has(low)) byLower.set(low, t);
  }
  return [...byLower.values()];
}

/** @param {Map<string, object>} queryObjects keyed by LOWER(query_object) */
export function getQueryObjectCaseInsensitive(queryObjects, objectName) {
  return queryObjects.get(String(objectName).toLowerCase());
}

/**
 * @param {import('pg').Pool} pool
 * @param {string[]} objectNames any casing
 */
export async function fetchQueryObjectMaps(pool, objectNames) {
  const lows = [...new Set(objectNames.map((n) => String(n).toLowerCase()).filter(Boolean))];
  /** @type {Map<string, { query_object: string; query_relation: string; additional_fields: string | null; additional_conditions: string | null }>} */
  const map = new Map();
  if (lows.length === 0) return map;

  const placeholders = lows.map((_, i) => `LOWER($${i + 1})`).join(", ");
  const sql = `
    SELECT query_object, query_relation, additional_fields, additional_conditions
    FROM query_object_relationship_map
    WHERE LOWER(query_object) IN (${placeholders}) AND is_deleted = false
  `;
  const res = await pool.query(sql, lows);
  for (const row of res.rows) {
    const key = String(row.query_object).toLowerCase();
    map.set(key, {
      query_object: String(row.query_object),
      query_relation: String(row.query_relation),
      additional_fields: row.additional_fields,
      additional_conditions: row.additional_conditions,
    });
  }
  return map;
}

/**
 * @param {Map<string, string[]>} objectsWithFields object API name -> field list
 * @param {Map<string, { query_object: string; query_relation: string; additional_fields: string | null; additional_conditions: string | null }>} queryObjects keyed lower
 */
export function optimizedDependencyAnalysis(objectsWithFields, queryObjects) {
  /** @type {Map<string, string[]>} */
  const enhanced = new Map();
  for (const [obj, fields] of objectsWithFields.entries()) {
    enhanced.set(obj, [...fields]);
  }
  /** @type {Map<string, Set<string>>} dep object -> fields referenced in someone's additional_conditions */
  const additionalDependencies = new Map();

  for (const objectName of enhanced.keys()) {
    const qo = getQueryObjectCaseInsensitive(queryObjects, objectName);
    if (!qo) continue;

    if (qo.additional_fields) {
      for (const raw of String(qo.additional_fields).split(",")) {
        const field = raw.trim();
        if (!field) continue;
        enhanced.set(
          objectName,
          optimizedMergeFields(enhanced.get(objectName) ?? [], [field]),
        );
      }
    }

    if (qo.additional_conditions) {
      const ac = String(qo.additional_conditions);
      let m;
      const re = /<([^.>]+)\.([^>]+)>/g;
      while ((m = re.exec(ac)) !== null) {
        const depObject = m[1];
        const depField = m[2];
        if (!additionalDependencies.has(depObject)) {
          additionalDependencies.set(depObject, new Set());
        }
        additionalDependencies.get(depObject).add(depField);
      }
    }
  }

  for (const [depObj, fieldSet] of additionalDependencies) {
    const depFields = [...fieldSet];
    if (enhanced.has(depObj)) {
      enhanced.set(depObj, optimizedMergeFields(enhanced.get(depObj) ?? [], depFields));
    } else {
      enhanced.set(depObj, optimizedMergeFields([], depFields));
    }
  }

  return { enhanced, additionalDependencies };
}

/**
 * @param {string[]} allObjectNames keys from enhanced
 * @param {Map<string, Set<string>>} additionalDependencies
 */
export function optimizedDetermineQueryOrder(allObjectNames, additionalDependencies) {
  const dependencyObjects = new Set(
    [...additionalDependencies.keys()].map((k) => k.toLowerCase()),
  );
  const out = [];
  for (const objectName of allObjectNames) {
    if (dependencyObjects.has(objectName.toLowerCase())) out.push(objectName);
  }
  for (const objectName of allObjectNames) {
    if (!dependencyObjects.has(objectName.toLowerCase())) out.push(objectName);
  }
  return out;
}

/** @returns {Record<string, string>} */
function parseObjectLeadFieldMapForPrefetch() {
  const raw = String(process.env.SALESFORCE_PROBE_OBJECT_LEAD_FIELD_JSON ?? "").trim();
  if (!raw) return {};
  try {
    const j = JSON.parse(raw);
    if (j == null || typeof j !== "object" || Array.isArray(j)) return {};
    /** @type {Record<string, string>} */
    const out = {};
    for (const [k, v] of Object.entries(j)) {
      if (typeof v === "string" && /^[A-Za-z][A-Za-z0-9_]*$/.test(v)) {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * @param {Map<string, Set<string>>} additionalDependencies
 * @param {string} objectName
 */
function dependencyFieldList(additionalDependencies, objectName) {
  const low = objectName.toLowerCase();
  for (const [k, fieldSet] of additionalDependencies) {
    if (k.toLowerCase() === low) {
      return dedupeFields(["Id", ...fieldSet]);
    }
  }
  return ["Id"];
}

/**
 * Objects without a map row but listed as keys in additional_dependencies cannot participate in ESA SOQL.
 * When they are only needed to resolve &lt;Obj.field&gt; inside another object's additional_conditions,
 * prefetch one row using the same Lead__c heuristic as the legacy probe so mapped parents are not skipped.
 *
 * @param {{
 *   prefetchNames: string[];
 *   additionalDependencies: Map<string, Set<string>>;
 *   refId: string;
 *   runSoql: (soql: string) => Promise<{ records?: unknown[]; totalSize?: number }>;
 *   warnings: string[];
 *   queries: { object: string; soql: string; totalSize?: number; records?: unknown[]; probeStatus?: string }[];
 *   successfulResults: Record<string, unknown>;
 * }} p
 */
async function prefetchUnmappedDependencyRows(p) {
  const { prefetchNames, additionalDependencies, refId, runSoql, warnings, queries, successfulResults } =
    p;
  if (prefetchNames.length === 0) return;
  const rid = String(refId ?? "").trim();
  if (!/^00Q/i.test(rid)) {
    warnings.push(
      "Some objects lack query_object_relationship_map rows but are required by additional_conditions; legacy prefetch needs a Lead anchor Id (00Q…). Add map rows or use a Lead ref id.",
    );
    return;
  }
  const objectLeadField = parseObjectLeadFieldMapForPrefetch();
  const order = optimizedDetermineQueryOrder(prefetchNames, additionalDependencies);
  for (const rawName of order) {
    let objApi;
    try {
      objApi = assertSafeSObjectName(rawName);
    } catch {
      continue;
    }
    if (successfulResults[objApi] != null || successfulResults[rawName] != null) continue;

    const leadLookup =
      objectLeadField[objApi] || objectLeadField[rawName] || (objApi.endsWith("__c") ? "Lead__c" : "");
    if (!leadLookup) {
      warnings.push(
        `Skipped prefetch for ${objApi} (no map row): add {"${objApi}":"LeadLookup__c"} to SALESFORCE_PROBE_OBJECT_LEAD_FIELD_JSON or a query_object_relationship_map row.`,
      );
      continue;
    }
    const select = dependencyFieldList(additionalDependencies, rawName);
    const soql = `SELECT ${select.join(", ")} FROM ${objApi} WHERE ${leadLookup} = ${soqlQuotedLiteral(rid)} LIMIT 1`;
    try {
      const res = await runSoql(soql);
      queries.push({
        object: objApi,
        soql,
        totalSize: res.totalSize,
        records: sampleQueryRecords(res),
        probeStatus: "prefetch_legacy_no_map_row",
      });
      const rec = Array.isArray(res.records) && res.records[0] ? res.records[0] : null;
      if (!rec) {
        warnings.push(`${objApi}: prefetch (no map row) returned no rows for this Lead.`);
        continue;
      }
      successfulResults[objApi] = rec;
      successfulResults[objApi.toLowerCase()] = rec;
      successfulResults[rawName] = rec;
      successfulResults[rawName.toLowerCase()] = rec;
    } catch (e) {
      warnings.push(`${objApi}: prefetch failed (${String(e?.message || e)}).`);
      queries.push({
        object: objApi,
        soql,
        totalSize: 0,
        records: [],
        probeStatus: "prefetch_error",
        probeError: String(e?.message || e),
      });
    }
  }
}

export async function ensureQueryObjectsForDependencies(pool, enhanced, queryObjects) {
  const missing = [...enhanced.keys()].filter(
    (n) => !getQueryObjectCaseInsensitive(queryObjects, n),
  );
  if (missing.length === 0) return queryObjects;
  const extra = await fetchQueryObjectMaps(pool, missing);
  const merged = new Map(queryObjects);
  for (const [k, v] of extra) merged.set(k, v);
  return merged;
}

function extractFieldValueFromResults(objectName, fieldName, successfulResults) {
  let objectData = successfulResults[objectName];
  if (objectData === undefined) {
    for (const k of Object.keys(successfulResults)) {
      if (k.toLowerCase() === String(objectName).toLowerCase()) {
        objectData = successfulResults[k];
        break;
      }
    }
  }
  if (objectData == null) return undefined;

  if (Array.isArray(objectData) && objectData.length > 0) {
    const record = objectData[0];
    if (record && typeof record === "object") {
      const path = String(fieldName);
      if (path.includes(".")) return nestedObjectKeyLookup(record, path);
      return objectKeyLookup(record, fieldName);
    }
    return undefined;
  }
  if (typeof objectData === "object") {
    const path = String(fieldName);
    if (path.includes(".")) return nestedObjectKeyLookup(objectData, path);
    return objectKeyLookup(objectData, fieldName);
  }
  return undefined;
}

function objectKeyLookup(obj, field) {
  if (obj == null || typeof obj !== "object") return undefined;
  const o = /** @type {Record<string, unknown>} */ (obj);
  if (field in o) return o[field];
  const lower = field.toLowerCase();
  for (const k of Object.keys(o)) {
    if (k.toLowerCase() === lower) return o[k];
  }
  return undefined;
}

/**
 * Salesforce REST rows nest relationship fields (`Campaign__r.Bscore__c` → `Campaign__r: { Bscore__c }`).
 * Each path segment is resolved with the same case-insensitive rules as `objectKeyLookup`.
 *
 * @param {unknown} obj
 * @param {string} fieldPath
 */
function nestedObjectKeyLookup(obj, fieldPath) {
  const parts = String(fieldPath)
    .split(".")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  let cur = obj;
  for (const segment of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = objectKeyLookup(/** @type {Record<string, unknown>} */ (cur), segment);
  }
  return cur;
}

function escapeSoqlValue(value) {
  if (value == null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const str = typeof value === "string" ? value : String(value);
  return `'${str.replace(/'/g, "''")}'`;
}

function processAdditionalConditionsReferences(additionalConditions) {
  return additionalConditions.replace(/<([^.>]+)\.([^>]+)>/g, (_match, obj, field) => {
    return `@{${String(obj).toLowerCase()}_query.records[0].${String(field).toLowerCase()}}`;
  });
}

function replaceCompositeReferencesWithValues(additionalConditions, successfulResults) {
  return additionalConditions.replace(
    /@\{([^_]+)_query\.records\[0\]\.([^}]+)\}/gi,
    (full, depObj, field) => {
      const v = extractFieldValueFromResults(depObj, field, successfulResults);
      if (v === undefined) return full;
      return escapeSoqlValue(v);
    },
  );
}

/**
 * Mirrors `buildSOQLQueryWithValueReplacement` when prior query results exist.
 * @returns {{ query: string; allReplaced: boolean }}
 */
export function buildSoqlWithValueReplacement(
  objectNameForFrom,
  fields,
  qo,
  refId,
  successfulResults,
) {
  const fieldList = dedupeFields(fields).join(", ");
  let query = `SELECT ${fieldList} FROM ${objectNameForFrom} WHERE ${qo.query_relation} = ${soqlQuotedLiteral(refId)}`;
  let allReplaced = true;

  const acRaw = qo.additional_conditions;
  if (acRaw != null && String(acRaw).trim() !== "") {
    const additionalConditions = normalizeSoqlWhitespace(String(acRaw).trim());
    const withCompositeRefs = processAdditionalConditionsReferences(additionalConditions);
    const processedConditions = replaceCompositeReferencesWithValues(
      withCompositeRefs,
      successfulResults,
    );
    if (!processedConditions.trim()) {
      return { query: "", allReplaced: false };
    }
    allReplaced = !processedConditions.includes("@{");

    if (additionalConditions.toUpperCase().startsWith("WHERE")) {
      query = `SELECT ${fieldList} FROM ${objectNameForFrom} ${processedConditions}`;
    } else {
      query += ` ${processedConditions}`;
    }
  }

  return { query, allReplaced };
}

/**
 * @param {Map<string, { object: string; field: string }>} refMap keys "Obj.field"
 * @param {Map<string, unknown>} successfulResults keyed by object name (any casing) + lowercase
 */
export function fillAngleValuesFromRecords(refMap, successfulResults) {
  /** @type {Record<string, unknown>} */
  const angleValues = {};
  for (const { object, field } of refMap.values()) {
    const v = extractFieldValueFromResults(object, field, successfulResults);
    if (v !== undefined) {
      angleValues[`${object}.${field}`] = v;
    }
  }
  return angleValues;
}

/**
 * Build `Object.field` → value for every column the ESA-aligned probe actually SELECTed
 * (merged template fields + `additional_fields` + dependency fields). REST often omits keys
 * for nulls, so absent keys simply do not appear.
 *
 * @param {Record<string, unknown>} successfulResults
 * @param {Map<string, string[]>} enhanced
 */
function fillAngleValuesFromEnhancedSelect(successfulResults, enhanced) {
  /** @type {Record<string, unknown>} */
  const angleValues = {};
  for (const [objectName, fields] of enhanced.entries()) {
    for (const f of fields) {
      const v = extractFieldValueFromResults(objectName, f, successfulResults);
      if (v !== undefined) {
        angleValues[`${objectName}.${f}`] = v;
      }
    }
  }
  return angleValues;
}

/**
 * Run SOQL in dependency order using ESA `query_object_relationship_map` (same rules as
 * `external-service-adapter/pkg/client/salesforce_client.go`).
 *
 * @param {import('pg').Pool} pool
 * @param {{ refId: string; byObject: Map<string, string[]>; refMap: Map<string, { object: string; field: string }>; runSoql: (soql: string) => Promise<{ records?: unknown[]; totalSize?: number }>; warnings: string[] }} ctx
 * @returns {Promise<{ angleValues: Record<string, unknown>; queries: { object: string; soql: string; totalSize?: number; records?: unknown[] }[]; partial?: boolean } | null>} null → caller may fall back to heuristic probe. `partial` is true when some template objects had no mapping row and were skipped.
 */
export async function runEsaAlignedProbe(pool, ctx) {
  const { refId, byObject, refMap, runSoql, warnings } = ctx;
  if (byObject.size === 0) return null;

  let queryObjects;
  try {
    queryObjects = await fetchQueryObjectMaps(pool, [...byObject.keys()]);
  } catch (e) {
    if (e?.code === "42P01") {
      warnings.push(
        "ESA table query_object_relationship_map is missing on this database — using legacy probe rules (no ESA mapping).",
      );
    } else {
      warnings.push(`Could not load query_object_relationship_map: ${String(e?.message || e)}`);
    }
    return null;
  }

  const { enhanced, additionalDependencies } = optimizedDependencyAnalysis(byObject, queryObjects);
  queryObjects = await ensureQueryObjectsForDependencies(pool, enhanced, queryObjects);

  /** Objects that have a `query_object_relationship_map` row (ESA can build SOQL). */
  const enhancedMapped = new Map();
  /** @type {string[]} */
  const unmappedObjects = [];
  for (const [k, v] of enhanced.entries()) {
    if (getQueryObjectCaseInsensitive(queryObjects, k)) {
      enhancedMapped.set(k, v);
    } else {
      unmappedObjects.push(k);
    }
  }

  const depKeysLower = new Set([...additionalDependencies.keys()].map((k) => k.toLowerCase()));
  const prefetchNames = [...new Set(unmappedObjects)].filter((o) => depKeysLower.has(o.toLowerCase()));

  if (unmappedObjects.length > 0) {
    const show = unmappedObjects.slice(0, 15);
    const tail =
      unmappedObjects.length > 15 ? ` (+${unmappedObjects.length - 15} more)` : "";
    warnings.push(
      `No query_object_relationship_map row for ${show.length} object(s): ${show
        .map((x) => `"${x}"`)
        .join(", ")}${tail}. ` +
        (prefetchNames.length > 0
          ? `Objects that appear only as dependencies in additional_conditions are prefetched with legacy Lead__c (Lead 00Q anchor) so mapped parents can still run; add map rows for full ESA. `
          : "") +
        `Template-only objects without rows still use the legacy probe path.`,
    );
  }

  if (enhancedMapped.size === 0) {
    warnings.push(
      "None of the template objects have query_object_relationship_map rows — using legacy probe rules only.",
    );
    return null;
  }

  const partial = unmappedObjects.length > 0;

  /** @type {Record<string, unknown>} */
  const successfulResults = {};
  /** @type {{ object: string; soql: string; totalSize?: number; records?: unknown[]; probeStatus?: string; probeError?: string }[]} */
  const queries = [];

  await prefetchUnmappedDependencyRows({
    prefetchNames,
    additionalDependencies,
    refId,
    runSoql,
    warnings,
    queries,
    successfulResults,
  });

  const ordered = optimizedDetermineQueryOrder([...enhancedMapped.keys()], additionalDependencies);

  for (const objectName of ordered) {
    const qo = getQueryObjectCaseInsensitive(queryObjects, objectName);
    if (!qo) continue;
    const fromName = qo.query_object;
    const fields = enhancedMapped.get(objectName) ?? [];
    const { query, allReplaced } = buildSoqlWithValueReplacement(
      fromName,
      fields,
      qo,
      refId,
      successfulResults,
    );
    if (!query.trim()) {
      warnings.push(`Skipped ${fromName}: empty SOQL (additional_conditions).`);
      queries.push({
        object: fromName,
        soql: "(not executed) empty SOQL after resolving additional_conditions — check map row and dependencies.",
        totalSize: 0,
        records: [],
        probeStatus: "skipped_empty",
      });
      continue;
    }
    if (!allReplaced) {
      warnings.push(
        `Skipped ${fromName}: additional_conditions still reference unresolved dependency fields — run order or data may be incomplete.`,
      );
      queries.push({
        object: fromName,
        soql: query,
        totalSize: 0,
        records: [],
        probeStatus: "skipped_unresolved_placeholders",
      });
      continue;
    }
    try {
      const res = await runSoql(query);
      queries.push({
        object: fromName,
        soql: query,
        totalSize: res.totalSize,
        records: sampleQueryRecords(res),
      });
      const rec = Array.isArray(res.records) && res.records[0] ? res.records[0] : null;
      if (!rec) {
        warnings.push(`${fromName}: SOQL returned no rows.`);
        continue;
      }
      successfulResults[fromName] = rec;
      successfulResults[fromName.toLowerCase()] = rec;
      successfulResults[objectName] = rec;
      successfulResults[objectName.toLowerCase()] = rec;
    } catch (e) {
      warnings.push(`${fromName}: ${String(e?.message || e)}`);
      queries.push({
        object: fromName,
        soql: query,
        totalSize: 0,
        records: [],
        probeStatus: "error",
        probeError: String(e?.message || e),
      });
    }
  }

  const fromSelect = fillAngleValuesFromEnhancedSelect(successfulResults, enhancedMapped);
  const fromRefs = fillAngleValuesFromRecords(refMap, successfulResults);
  const angleValues = { ...fromSelect, ...fromRefs };
  warnings.push(
    partial
      ? "SOQL used ESA `query_object_relationship_map` for a subset of objects (see skipped-object warnings); External Service Adapter would require rows for every queried object."
      : "SOQL used ESA `query_object_relationship_map` (same source as External Service Adapter Salesforce client).",
  );
  return { angleValues, queries, partial };
}

/**
 * Resolve <Object.Field> placeholders for HTTP probe using Salesforce SOQL.
 * Prefer ESA `query_object_relationship_map` (same as external-service-adapter); else legacy heuristics.
 */

export { collectAngleRefsFromBody } from "./esaAngleExtract.mjs";
import { collectAngleRefsFromBody } from "./esaAngleExtract.mjs";
import {
  buildSoqlWithValueReplacement,
  fetchQueryObjectMaps,
  runEsaAlignedProbe,
} from "./esaSalesforceProbeDb.mjs";
import {
  assertSafeSObjectName,
  getAccessTokenCached,
  readSalesforceConfig,
  SALESFORCE_ENV_HINT,
} from "./salesforceClient.mjs";

/** SOQL string literal: single quotes escaped by doubling (Salesforce). */
function soqlEscapeString(s) {
  return String(s ?? "").replace(/'/g, "''");
}

function soqlQuotedLiteral(s) {
  return `'${soqlEscapeString(s)}'`;
}

/** Dotted relationship paths from `query_object_relationship_map.query_relation` (e.g. `contact__r.Lead__c`). */
function isSafeQueryRelationPath(rel) {
  const s = String(rel ?? "").trim();
  if (!s) return false;
  return s.split(".").every((seg) => /^[A-Za-z][A-Za-z0-9_]*$/.test(seg.trim()));
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
 * @param {string} anchorId
 * @param {'Lead'|'Contact'|'auto'} anchorType
 */
function normalizeAnchor(anchorId, anchorType) {
  const id = String(anchorId ?? "").trim();
  if (!id) throw new Error("anchorId is required");
  if (!/^[a-zA-Z0-9]{15,18}$/.test(id)) {
    throw new Error("anchorId must be a 15–18 character Salesforce Id");
  }
  let t = anchorType === "auto" || !anchorType ? "auto" : anchorType;
  if (t === "auto") {
    if (id.startsWith("00Q")) t = "Lead";
    else if (id.startsWith("003")) t = "Contact";
    else t = "Lead";
  }
  if (t !== "Lead" && t !== "Contact") {
    throw new Error('anchorType must be "Lead", "Contact", or "auto"');
  }
  return { id, type: t };
}

function parseLeadContactLookupEnv() {
  const raw = String(process.env.SALESFORCE_PROBE_LEAD_CONTACT_LOOKUP ?? "").trim();
  if (!raw) return "";
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(raw)) return "";
  return raw;
}

/** @returns {Record<string, string>} */
function parseObjectLeadFieldMap() {
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

/** @returns {Record<string, string>} */
function parseObjectContactFieldMap() {
  const raw = String(process.env.SALESFORCE_PROBE_OBJECT_CONTACT_FIELD_JSON ?? "").trim();
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

async function executeSoql(accessToken, instanceUrl, apiVersion, soql) {
  const base = instanceUrl.replace(/\/$/, "");
  const url = `${base}/services/data/${apiVersion}/query?q=${encodeURIComponent(soql)}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const text = await r.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 200) || `HTTP ${r.status}`);
  }
  if (!r.ok) {
    const msg = Array.isArray(j) && j[0]?.message ? j[0].message : j.message || text.slice(0, 300);
    throw new Error(String(msg));
  }
  return j;
}

const MAX_PROBE_SF_RECORDS = 50;

function sampleQueryRecords(res) {
  const r = Array.isArray(res?.records) ? res.records : [];
  return r.slice(0, MAX_PROBE_SF_RECORDS);
}

function dedupeFields(fields) {
  const byLower = new Map();
  for (const f of fields) {
    const t = String(f).trim();
    if (!t) continue;
    const low = t.toLowerCase();
    if (!byLower.has(low)) byLower.set(low, t);
  }
  return [...byLower.values()];
}

/** Map common template spellings to Salesforce API names (legacy checks use `Lead` / `Contact`). */
function normalizeStandardObjectApiName(name) {
  const n = String(name || "").trim();
  const low = n.toLowerCase();
  if (low === "lead") return "Lead";
  if (low === "contact") return "Contact";
  return n;
}

/** @param {Map<string, { object: string; field: string }>} refMap */
function normalizeRefMapObjects(refMap) {
  /** @type {Map<string, { object: string; field: string }>} */
  const out = new Map();
  for (const [, v] of refMap) {
    const object = normalizeStandardObjectApiName(v.object);
    const field = v.field;
    const nk = `${object}.${field}`;
    if (!out.has(nk)) out.set(nk, { object, field });
  }
  return out;
}

/** @param {Map<string, { object: string; field: string }>} refMap */
function buildByObjectFromRefMap(refMap) {
  /** @type {Map<string, string[]>} */
  const byObject = new Map();
  for (const { object, field } of refMap.values()) {
    const list = byObject.get(object) ?? [];
    list.push(field);
    byObject.set(object, dedupeFields(list));
  }
  return byObject;
}

/**
 * Lead / Contact / child-object heuristics (env JSON maps, default `Lead__c` on `__c` objects).
 *
 * @param {{
 *   anchorId: string;
 *   anchorType: 'Lead'|'Contact';
 *   byObject: Map<string, string[]>;
 *   accessToken: string;
 *   instanceUrl: string;
 *   ver: string;
 *   warnings: string[];
 *   skipObjectsLower: Set<string>;
 *   poolForQor?: import('pg').Pool | null;
 * }} p
 */
async function runLegacyHeuristicProbe(p) {
  const {
    anchorId,
    anchorType,
    byObject,
    accessToken,
    instanceUrl,
    ver,
    warnings,
    skipObjectsLower,
    poolForQor,
  } = p;

  /** @type {Record<string, unknown>} */
  const angleValues = {};
  /** @type {{ object: string; soql: string; totalSize?: number; records?: unknown[] }[]} */
  const queries = [];

  const objectLeadField = parseObjectLeadFieldMap();
  const objectContactField = parseObjectContactFieldMap();
  const extraLeadLookup = parseLeadContactLookupEnv();

  let contactIdFromLead = "";
  /** Lead row from the probe SOQL (for Contact map `additional_conditions` that reference Lead). */
  let leadProbeRecord = null;
  /** Contact row when Contact SOQL ran (for child objects whose map rows reference Contact). */
  let contactProbeRecord = null;

  const needLeadRow =
    anchorType === "Lead" &&
    (byObject.has("Lead") ||
      byObject.has("Contact") ||
      [...byObject.keys()].some((o) => o !== "Lead" && o !== "Contact"));

  if (anchorType === "Lead" && needLeadRow && !skipObjectsLower.has("lead")) {
    const leadFields = byObject.get("Lead") ?? [];
    const leadSelect = dedupeFields([
      "Id",
      "ConvertedContactId",
      ...(extraLeadLookup ? [extraLeadLookup] : []),
      ...leadFields.filter((f) => !["Id", "ConvertedContactId"].includes(f)),
    ]);
    const soql = `SELECT ${leadSelect.join(", ")} FROM Lead WHERE Id = ${soqlQuotedLiteral(anchorId)}`;
    queries.push({ object: "Lead", soql });
    const res = await executeSoql(accessToken, instanceUrl, ver, soql);
    queries[queries.length - 1].totalSize = res.totalSize;
    queries[queries.length - 1].records = sampleQueryRecords(res);
    const rec = Array.isArray(res.records) && res.records[0] ? res.records[0] : null;
    if (!rec) {
      warnings.push("Lead query returned no rows for this anchor Id.");
    } else {
      leadProbeRecord = rec;
      const conv = objectKeyLookup(rec, "ConvertedContactId");
      const custom = extraLeadLookup ? objectKeyLookup(rec, extraLeadLookup) : "";
      contactIdFromLead = String(conv || custom || "").trim();
      for (const f of leadSelect) {
        const v = objectKeyLookup(rec, f);
        if (v !== undefined) angleValues[`Lead.${f}`] = v;
      }
    }
  }

  let contactQueryId = "";
  if (anchorType === "Contact") {
    contactQueryId = anchorId;
  } else if (contactIdFromLead) {
    contactQueryId = contactIdFromLead;
  }

  const contactFields = byObject.get("Contact");
  if (contactFields?.length && !skipObjectsLower.has("contact")) {
    let select = dedupeFields(["Id", ...contactFields]);
    /** @type {string | null} */
    let contactSoql = null;

    if (contactQueryId) {
      contactSoql = `SELECT ${select.join(", ")} FROM Contact WHERE Id = ${soqlQuotedLiteral(contactQueryId)}`;
    } else if (anchorType === "Lead" && poolForQor) {
      try {
        const qom = await fetchQueryObjectMaps(poolForQor, ["Contact"]);
        const qo = qom.get("contact");
        const rel = qo ? String(qo.query_relation ?? "").trim() : "";
        if (qo && isSafeQueryRelationPath(rel)) {
          let mergedFields = [...select];
          if (qo.additional_fields) {
            for (const raw of String(qo.additional_fields).split(",")) {
              const field = raw.trim();
              if (field && /^[A-Za-z][A-Za-z0-9_]*$/.test(field)) {
                mergedFields.push(field);
              }
            }
            mergedFields = dedupeFields(mergedFields);
          }
          select = mergedFields;
          const fromRaw = normalizeStandardObjectApiName(qo.query_object);
          let safeFrom = "Contact";
          try {
            safeFrom = assertSafeSObjectName(fromRaw);
          } catch {
            /* keep Contact */
          }
          /** @type {Record<string, unknown>} */
          const successfulResults = {};
          if (leadProbeRecord) {
            successfulResults.Lead = leadProbeRecord;
            successfulResults.lead = leadProbeRecord;
          }
          const { query, allReplaced } = buildSoqlWithValueReplacement(
            safeFrom,
            mergedFields,
            {
              query_object: qo.query_object,
              query_relation: rel,
              additional_fields: qo.additional_fields,
              additional_conditions: qo.additional_conditions,
            },
            anchorId,
            successfulResults,
          );
          if (query.trim() && allReplaced) {
            contactSoql = query.trim();
            if (!/\bLIMIT\s+\d+\s*$/i.test(contactSoql)) {
              contactSoql += " LIMIT 1";
            }
          } else if (query.trim() && !allReplaced) {
            warnings.push(
              "Contact: query_object_relationship_map additional_conditions still reference unresolved fields after the Lead probe — fill Lead-dependent placeholders or simplify conditions.",
            );
          }
        }
      } catch (e) {
        warnings.push(
          `Contact: could not use query_object_relationship_map for Lead-linked Contact SOQL (${String(e?.message || e)}).`,
        );
      }
    }

    if (!contactSoql) {
      if (!contactQueryId) {
        warnings.push(
          "Contact fields in template but no Contact Id (convert the Lead, set SALESFORCE_PROBE_LEAD_CONTACT_LOOKUP on Lead, or add a Contact row in query_object_relationship_map with query_relation to the Lead Id, e.g. Lead__c).",
        );
      }
    } else {
      queries.push({ object: "Contact", soql: contactSoql });
      try {
        const res = await executeSoql(accessToken, instanceUrl, ver, contactSoql);
        queries[queries.length - 1].totalSize = res.totalSize;
        queries[queries.length - 1].records = sampleQueryRecords(res);
        const rec = Array.isArray(res.records) && res.records[0] ? res.records[0] : null;
        if (!rec) warnings.push("Contact query returned no rows.");
        else {
          contactProbeRecord = rec;
          for (const f of select) {
            const v = objectKeyLookup(rec, f);
            if (v !== undefined) angleValues[`Contact.${f}`] = v;
          }
        }
      } catch (e) {
        warnings.push(`Contact query failed: ${String(e?.message || e)}`);
      }
    }
  }

  const leadIdForChildren = anchorType === "Lead" ? anchorId : "";
  const contactIdForChildren = anchorType === "Contact" ? anchorId : "";

  for (const [object, fields] of byObject.entries()) {
    if (object === "Lead" || object === "Contact") continue;
    let obj;
    try {
      obj = assertSafeSObjectName(object);
    } catch {
      continue;
    }
    if (skipObjectsLower.has(object.toLowerCase()) || skipObjectsLower.has(obj.toLowerCase())) {
      continue;
    }
    const select = dedupeFields(["Id", ...fields]);
    /** Fields to read from the query row (may include map `additional_fields` when SOQL came from QOR). */
    let fieldsRead = select;
    let soql = "";
    if (anchorType === "Lead" && leadIdForChildren && poolForQor) {
      try {
        const qom = await fetchQueryObjectMaps(poolForQor, [object, obj]);
        const qo = qom.get(String(object).toLowerCase()) ?? qom.get(String(obj).toLowerCase());
        const rel = qo ? String(qo.query_relation ?? "").trim() : "";
        if (qo && isSafeQueryRelationPath(rel)) {
          let mergedFields = [...select];
          if (qo.additional_fields) {
            for (const raw of String(qo.additional_fields).split(",")) {
              const field = raw.trim();
              if (field && /^[A-Za-z][A-Za-z0-9_]*$/.test(field)) {
                mergedFields.push(field);
              }
            }
            mergedFields = dedupeFields(mergedFields);
          }
          const fromRaw = String(qo.query_object ?? "").trim() || obj;
          let safeFrom = obj;
          try {
            safeFrom = assertSafeSObjectName(fromRaw);
          } catch {
            /* keep obj */
          }
          /** @type {Record<string, unknown>} */
          const successfulResults = {};
          if (leadProbeRecord) {
            successfulResults.Lead = leadProbeRecord;
            successfulResults.lead = leadProbeRecord;
          }
          if (contactProbeRecord) {
            successfulResults.Contact = contactProbeRecord;
            successfulResults.contact = contactProbeRecord;
          }
          const { query, allReplaced } = buildSoqlWithValueReplacement(
            safeFrom,
            mergedFields,
            {
              query_object: qo.query_object,
              query_relation: rel,
              additional_fields: qo.additional_fields,
              additional_conditions: qo.additional_conditions,
            },
            leadIdForChildren,
            successfulResults,
          );
          if (query.trim() && allReplaced) {
            soql = query.trim();
            fieldsRead = mergedFields;
            if (!/\bLIMIT\s+\d+\s*$/i.test(soql)) {
              soql += " LIMIT 1";
            }
          } else if (query.trim() && !allReplaced) {
            warnings.push(
              `${obj}: query_object_relationship_map additional_conditions still reference unresolved fields — ensure Lead/Contact probes ran first or simplify conditions.`,
            );
          }
        }
      } catch (e) {
        warnings.push(
          `${obj}: could not build SOQL from query_object_relationship_map (${String(e?.message || e)}); trying Lead__c heuristic.`,
        );
      }
    }
    if (anchorType === "Lead" && leadIdForChildren && !soql) {
      const leadLookup = objectLeadField[obj] || (obj.endsWith("__c") ? "Lead__c" : "");
      if (!leadLookup) {
        warnings.push(
          `Skipped ${obj}: add {"${obj}":"LeadLookupField__c"} to SALESFORCE_PROBE_OBJECT_LEAD_FIELD_JSON (or use a __c object with default Lead__c), or add a query_object_relationship_map row with query_relation.`,
        );
        continue;
      }
      soql = `SELECT ${select.join(", ")} FROM ${obj} WHERE ${leadLookup} = ${soqlQuotedLiteral(leadIdForChildren)} LIMIT 1`;
    } else if (anchorType === "Contact" && contactIdForChildren) {
      const cf = objectContactField[obj];
      if (!cf) {
        warnings.push(
          `Skipped ${obj} with Contact anchor: add {"${obj}":"Your_Contact_Lookup__c"} to SALESFORCE_PROBE_OBJECT_CONTACT_FIELD_JSON.`,
        );
        continue;
      }
      soql = `SELECT ${select.join(", ")} FROM ${obj} WHERE ${cf} = ${soqlQuotedLiteral(contactIdForChildren)} LIMIT 1`;
    } else {
      warnings.push(`Skipped ${obj}: use a Lead anchor Id (00Q…) for child objects keyed by Lead.`);
      continue;
    }

    queries.push({ object: obj, soql });
    try {
      const res = await executeSoql(accessToken, instanceUrl, ver, soql);
      queries[queries.length - 1].totalSize = res.totalSize;
      queries[queries.length - 1].records = sampleQueryRecords(res);
      const rec = Array.isArray(res.records) && res.records[0] ? res.records[0] : null;
      if (!rec) warnings.push(`${obj}: no matching row for the anchor.`);
      else {
        for (const f of fieldsRead) {
          const v = objectKeyLookup(rec, f);
          if (v !== undefined) angleValues[`${obj}.${f}`] = v;
        }
      }
    } catch (e) {
      warnings.push(`${obj} query failed: ${String(e?.message || e)}`);
    }
  }

  return { angleValues, queries };
}

/**
 * @param {unknown} requestBody
 * @param {{ anchorId: string; anchorType?: string }} opts
 * @param {{ poolEsa?: import('pg').Pool }} [deps]
 */
export async function resolveAngleBracketPlaceholders(requestBody, opts, deps = {}) {
  const cfg = readSalesforceConfig();
  if (!cfg.configured) {
    throw new Error(`Salesforce is not configured on the server. ${SALESFORCE_ENV_HINT}`);
  }

  const refIdRaw = String(opts.anchorId ?? "").trim();
  if (!/^[a-zA-Z0-9]{15,18}$/.test(refIdRaw)) {
    throw new Error("anchorId must be a 15–18 character Salesforce Id (ESA ref id / Lead or Contact id).");
  }

  const body =
    requestBody !== null && typeof requestBody === "object"
      ? requestBody
      : JSON.parse(String(requestBody));

  /** @type {string[]} */
  const warnings = [];

  const refMap = normalizeRefMapObjects(collectAngleRefsFromBody(body));
  const { id: anchorId, type: anchorType } = normalizeAnchor(
    opts.anchorId,
    /** @type {'Lead'|'Contact'|'auto'} */ (opts.anchorType || "auto"),
  );

  if (anchorType === "Contact") {
    for (const k of refMap.keys()) {
      if (k.startsWith("Lead.")) {
        warnings.push(
          "Template references Lead fields but the anchor Id is a Contact — Lead.* values will not be queried (legacy path).",
        );
        break;
      }
    }
  }
  const byObject = buildByObjectFromRefMap(refMap);

  const { accessToken, instanceUrl } = await getAccessTokenCached();
  const ver = cfg.apiVersion;

  /** @type {{ angleValues: Record<string, unknown>; queries: unknown[]; partial?: boolean } | null} */
  let esaOut = null;
  if (deps.poolEsa && byObject.size > 0) {
    try {
      esaOut = await runEsaAlignedProbe(deps.poolEsa, {
        refId: refIdRaw,
        byObject,
        refMap,
        warnings,
        runSoql: (soql) => executeSoql(accessToken, instanceUrl, ver, soql),
      });
    } catch (e) {
      warnings.push(`ESA mapping path failed (${String(e?.message || e)}); trying legacy probe rules.`);
      esaOut = null;
    }
  }

  // Always run legacy SOQL as well as ESA (when ESA ran) so the probe lists every query path
  // (Lead, Contact, child objects). ESA `angleValues` override legacy on the same key.
  const legacy = await runLegacyHeuristicProbe({
    anchorId,
    anchorType,
    byObject,
    accessToken,
    instanceUrl,
    ver,
    warnings,
    skipObjectsLower: new Set(),
    poolForQor: deps.poolEsa ?? null,
  });

  /** When the template references several objects but SOQL collapsed to a single Lead query, explain why. */
  function warnIfThinQueryPlan(queriesLen) {
    if (byObject.size < 2 || queriesLen !== 1) return;
    warnings.push(
      "Only one SOQL query ran while the body references multiple Salesforce objects. Common causes: (1) `query_object_relationship_map` has rows only for Lead—add rows for other objects on this DB for ESA-style queries; (2) Contact.* fields but no Contact Id (Lead not converted and SALESFORCE_PROBE_LEAD_CONTACT_LOOKUP unset); (3) custom objects skipped—set SALESFORCE_PROBE_OBJECT_LEAD_FIELD_JSON or use __c objects (default Lead__c). Expand warnings above for each skip.",
    );
  }

  if (esaOut) {
    const queriesLen = esaOut.queries.length + legacy.queries.length;
    warnIfThinQueryPlan(queriesLen);
    return {
      angleValues: { ...legacy.angleValues, ...esaOut.angleValues },
      queries: [...esaOut.queries, ...legacy.queries],
      warnings,
      anchorType,
      anchorId: refIdRaw,
      mappingSource: esaOut.partial
        ? "esa_partial_plus_legacy"
        : "esa_query_object_relationship_map_plus_legacy",
    };
  }

  warnIfThinQueryPlan(legacy.queries.length);
  return {
    angleValues: legacy.angleValues,
    queries: legacy.queries,
    warnings,
    anchorType,
    anchorId: refIdRaw,
    mappingSource: "legacy_heuristic",
  };
}

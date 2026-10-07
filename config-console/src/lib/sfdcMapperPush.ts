import { parseJsonObject } from "@/lib/json";
import type { ServiceSfdcFieldMapping } from "@/types/models";

/** Default Composite paths (Decision Manager / Salesforce REST). */
export const SFDC_DEFAULT_API_VERSION = "v64.0";
export const SFDC_DEFAULT_AUDIT_OBJECT = "Audit_Log__c";
export const SFDC_DEFAULT_ARRAY_TARGET_OBJECT = "A_Score__c";

/** @deprecated Use salesforceSobjectRestUrl + defaults */
export const SFDC_DEFAULT_AUDIT_LOG_URL = `/services/data/${SFDC_DEFAULT_API_VERSION}/sobjects/${SFDC_DEFAULT_AUDIT_OBJECT}`;
/** @deprecated Use salesforceSobjectRestUrl + defaults */
export const SFDC_DEFAULT_A_SCORE_URL = `/services/data/${SFDC_DEFAULT_API_VERSION}/sobjects/${SFDC_DEFAULT_ARRAY_TARGET_OBJECT}`;

/** REST path for a standard SObject POST: `/services/data/{version}/sobjects/{ObjectApiName}` */
export function salesforceSobjectRestUrl(
  apiVersion: string,
  objectApiName: string,
): string {
  const v = apiVersion.trim().replace(/^\/+|\/+$/g, "") || SFDC_DEFAULT_API_VERSION;
  const o = objectApiName.trim();
  if (!o) return "";
  return `/services/data/${v}/sobjects/${o}`;
}

/** Unique SObject API names found in mapping `request_body[].url`, sorted by frequency (desc). */
export function collectSobjectApiNamesFromMappings(
  mappings: ServiceSfdcFieldMapping[],
): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const m of mappings) {
    const rb = m.request_body;
    if (!Array.isArray(rb)) continue;
    for (const raw of rb) {
      if (raw === null || typeof raw !== "object") continue;
      const u = (raw as Record<string, unknown>).url;
      if (typeof u !== "string" || !u.trim()) continue;
      const match = u.match(/\/services\/data\/[^/]+\/sobjects\/([^/?#]+)/);
      if (!match) continue;
      const name = match[1].trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

/** Legacy single-block default (older mapper exports). */
export const SFDC_MAPPER_DEFAULT_COMPOSITE_URL =
  "/services/data/v64.0/sobjects/Generic__c";

/** Safe segment for referenceId (alphanumeric + underscore). */
export function sanitizeServiceRefIdSegment(serviceName: string): string {
  return (
    serviceName
      .trim()
      .replace(/[^A-Za-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "") || "Service"
  );
}

/**
 * Suggested `arrayPath` when stamping iterates an array under ESA `response.body.body`.
 * Used when the user clicks “Fill from service name”, or auto-filled on the SFDC mapper when applicable.
 * See configuration_guide.md §5 in Decision Manager.
 */
export function defaultArrayPathForService(serviceName: string): string {
  const s = serviceName.trim();
  if (!s) return "";
  return `${s}.response.body.body`;
}

/** First segment of `arrayPath` (e.g. `BureauBS_Ascore.response.body.body` → `BureauBS_Ascore`). */
export function serviceNameFromArrayPath(arrayPath: string): string {
  const t = arrayPath.trim();
  if (!t) return "";
  const i = t.indexOf(".");
  return i === -1 ? t : t.slice(0, i);
}

/** Matches `((ServiceName.response` / `((ServiceName.request` in stamping expressions. */
const STAMPING_SERVICE_FROM_EXPR_RE =
  /\(\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*(?:response|request)\b/;

/**
 * First ESA service name found in primary-row expressions (table order), e.g.
 * `((NTCModel.response.body.body[0].Data__c))` → `NTCModel`.
 * Used when Export “Service name” is blank so arrayPath auto-fill and audit templates can still resolve.
 */
export function inferServiceNameFromPrimaryExpressions(
  expressions: Record<string, string>,
  primaryRowKeysInOrder: string[],
): string {
  for (const key of primaryRowKeysInOrder) {
    const v = expressions[key]?.trim() ?? "";
    const m = v.match(STAMPING_SERVICE_FROM_EXPR_RE);
    if (m?.[1]) return m[1];
  }
  return "";
}

/** First `((identifier.` segment in a stamping expression (may be nested inside helpers). */
const FIRST_SERVICE_SEGMENT_RE = /\(\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\./;

/**
 * Forces the **first** service segment in an expression to match the user's API name from the mapper.
 * Corpus hints paste whatever was saved historically (`acticoData`, `NTCModel`, …); this rewrites that first `((Name.` to `((apiName.`.
 * Does not change `((current.` (Decision Manager array iteration).
 */
export function stampFirstServicePrefixInExpression(expr: string, apiName: string): string {
  const name = apiName.trim();
  if (!name) return expr;
  const m = expr.match(FIRST_SERVICE_SEGMENT_RE);
  if (!m || m[1] === "current") return expr;
  return expr.replace(FIRST_SERVICE_SEGMENT_RE, `(((${name}.`);
}

/** Stable referenceId for one Composite sub-request derived from service name (legacy). */
export function sfdcMapperReferenceId(serviceName: string): string {
  return `${sanitizeServiceRefIdSegment(serviceName)}_sfdc_mapper`;
}

export type ParsedMapperExport =
  | { ok: true; kind: "request_body"; request_body: unknown[] }
  | { ok: true; kind: "legacy"; body: Record<string, string>; arrayPath?: string }
  | { ok: false; error: string };

/** Longest common prefix ending at a segment boundary (… `.` or full string). Used to derive strip prefix for array rows. */
export function longestCommonPathPrefix(paths: string[]): string {
  if (paths.length === 0) return "";
  let s = paths[0].trim();
  for (let i = 1; i < paths.length; i++) {
    const p = paths[i].trim();
    let len = 0;
    while (len < s.length && len < p.length && s[len] === p[len]) len++;
    s = s.slice(0, len);
  }
  if (s.length > 0 && !s.endsWith(".")) {
    const lastDot = s.lastIndexOf(".");
    if (lastDot >= 0) s = s.slice(0, lastDot + 1);
  }
  return s;
}

/** Path relative to an array element after removing the shared prefix (e.g. `body.body[*].` → `Credit_bucket`). */
export function relativePathAfterPrefix(fullPath: string, prefix: string): string | null {
  const p = prefix.trim();
  const f = fullPath.trim();
  if (!p) return null;
  if (!f.startsWith(p)) return null;
  const rest = f.slice(p.length).replace(/^\./, "");
  return rest.length ? rest : null;
}

/** Decision Manager stamping for one element of an arrayPath (e.g. `((current.Credit_bucket))`). */
export function formatCurrentItemExpression(relativePath: string): string {
  const r = relativePath.trim();
  if (!r) return "";
  return `((current.${r}))`;
}

/**
 * Builds the standard two-block `request_body` used for services like BureauBS_Ascore:
 * 1) Audit_Log__c — service-level ((ServiceName.*)) templates
 * 2) Main SObject (e.g. A_Score__c, Multibureau_Data__c) — flat `body` or, when `arrayPath` is set,
 *    arrayPath + ((current.*)) per configuration_guide.md §5. Omit `arrayPath` for a single flat POST body.
 */
export function buildBureauStyleRequestBody(
  serviceName: string,
  aScoreBody: Record<string, string>,
  opts: {
    includeAuditLog: boolean;
    auditLogUrl: string;
    /** Used in referenceId segment (e.g. Audit_Log__c → …_Audit_Log__c_Post). */
    auditSObjectApiName: string;
    aScoreUrl: string;
    /** Used in referenceId segment for the array sub-request. */
    arraySObjectApiName: string;
    /** Full arrayPath, e.g. ServiceName.response.body.body */
    arrayPath: string;
    contactField: string;
  },
): unknown[] {
  const disp = serviceName.trim() || "YourService";
  const ref = sanitizeServiceRefIdSegment(disp);
  const auditSeg = sanitizeServiceRefIdSegment(
    opts.auditSObjectApiName.trim() || SFDC_DEFAULT_AUDIT_OBJECT,
  );
  const arraySeg = sanitizeServiceRefIdSegment(
    opts.arraySObjectApiName.trim() || SFDC_DEFAULT_ARRAY_TARGET_OBJECT,
  );
  const out: unknown[] = [];

  if (opts.includeAuditLog) {
    out.push({
      url: opts.auditLogUrl,
      body: {
        Type__c: `((${disp}.serviceName))`,
        EndTime__c: `((${disp}.endTime))`,
        Response__c: `{{serializeJson(((${disp}.response)))}}`,
        StartTime__c: `((${disp}.startTime))`,
        ContactName__c: opts.contactField,
      },
      merge: "false",
      method: "POST",
      referenceId: `${ref}_${auditSeg}_Post`,
    });
  }

  if (Object.keys(aScoreBody).length > 0) {
    const item: Record<string, unknown> = {
      url: opts.aScoreUrl,
      body: aScoreBody,
      merge: "false",
      method: "POST",
      referenceId: `${ref}_${arraySeg}_Post`,
    };
    const ap = opts.arrayPath.trim();
    if (ap) item.arrayPath = ap;
    out.push(item);
  }

  return out;
}

/** One Decision Manager / Composite POST block targeting a specific SObject body. */
export type BureauStampObjectBlock = {
  /** Stable id for unique Composite referenceId when multiple blocks share an API name. */
  blockId: string;
  arraySObjectApiName: string;
  aScoreUrl: string;
  body: Record<string, string>;
  arrayPath: string;
};

/**
 * Same as {@link buildBureauStyleRequestBody} but emits **one Composite sub-request per object block**
 * (multiple Salesforce POST bodies for one ESA service).
 */
export function buildBureauStyleRequestBodyMulti(
  serviceName: string,
  blocks: BureauStampObjectBlock[],
  opts: {
    includeAuditLog: boolean;
    auditLogUrl: string;
    auditSObjectApiName: string;
    contactField: string;
  },
): unknown[] {
  const disp = serviceName.trim() || "YourService";
  const ref = sanitizeServiceRefIdSegment(disp);
  const auditSeg = sanitizeServiceRefIdSegment(
    opts.auditSObjectApiName.trim() || SFDC_DEFAULT_AUDIT_OBJECT,
  );
  const out: unknown[] = [];

  if (opts.includeAuditLog) {
    out.push({
      url: opts.auditLogUrl,
      body: {
        Type__c: `((${disp}.serviceName))`,
        EndTime__c: `((${disp}.endTime))`,
        Response__c: `{{serializeJson(((${disp}.response)))}}`,
        StartTime__c: `((${disp}.startTime))`,
        ContactName__c: opts.contactField,
      },
      merge: "false",
      method: "POST",
      referenceId: `${ref}_${auditSeg}_Post`,
    });
  }

  let seq = 0;
  for (const b of blocks) {
    if (Object.keys(b.body).length === 0) continue;
    const arraySeg = sanitizeServiceRefIdSegment(
      b.arraySObjectApiName.trim() || SFDC_DEFAULT_ARRAY_TARGET_OBJECT,
    );
    const segBlock = sanitizeServiceRefIdSegment(b.blockId || `obj${seq}`);
    const item: Record<string, unknown> = {
      url: b.aScoreUrl,
      body: b.body,
      merge: "false",
      method: "POST",
      referenceId: `${ref}_${arraySeg}_${segBlock}_Post`,
    };
    const ap = b.arrayPath.trim();
    if (ap) item.arrayPath = ap;
    out.push(item);
    seq += 1;
  }

  return out;
}

/**
 * Parses export JSON: either a full `request_body` array, or legacy `{ "body": { … }, "arrayPath"?: … }`.
 */
export function parseSfdcMapperExport(exportJson: string): ParsedMapperExport {
  const t = exportJson.trim();
  if (!t) return { ok: false, error: "Export is empty." };
  const p = parseJsonObject(t);
  if (!p.ok) return { ok: false, error: p.error };
  const v = p.value;

  if (Array.isArray(v)) {
    if (v.length === 0) return { ok: false, error: "request_body array is empty." };
    return { ok: true, kind: "request_body", request_body: v };
  }

  if (v === null || typeof v !== "object") {
    return { ok: false, error: "Export root must be a JSON array or object." };
  }

  const body = (v as Record<string, unknown>).body;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: 'Legacy export must include an object "body" with Salesforce field keys.' };
  }
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(body as Record<string, unknown>)) {
    const key = k.trim();
    if (!key) continue;
    out[key] = typeof val === "string" ? val : String(val);
  }
  if (Object.keys(out).length === 0) {
    return { ok: false, error: "At least one SF field + expression pair is required (legacy mode)." };
  }
  const rawAp = (v as Record<string, unknown>).arrayPath;
  const arrayPath =
    typeof rawAp === "string" && rawAp.trim() ? rawAp.trim() : undefined;
  return { ok: true, kind: "legacy", body: out, ...(arrayPath ? { arrayPath } : {}) };
}

/** Builds a `service_sfdc_field_mapping` row from mapper export (full array or legacy single block). */
export function buildSfdcMappingRowFromMapperExport(
  base: ServiceSfdcFieldMapping,
  serviceName: string,
  parsed: ParsedMapperExport,
  legacyOpts: { compositeUrl: string; compositeMethod: string },
): ServiceSfdcFieldMapping | null {
  if (!parsed.ok || !serviceName.trim()) return null;

  if (parsed.kind === "request_body") {
    return {
      ...base,
      service_name: serviceName.trim(),
      request_body: parsed.request_body,
    };
  }

  const url = legacyOpts.compositeUrl.trim() || SFDC_MAPPER_DEFAULT_COMPOSITE_URL;
  const method = (legacyOpts.compositeMethod.trim() || "POST").toUpperCase();
  const ref = sfdcMapperReferenceId(serviceName);
  const item: Record<string, unknown> = {
    url,
    method,
    referenceId: ref,
    merge: "false",
    body: parsed.body,
  };
  if (parsed.arrayPath?.trim()) {
    item.arrayPath = parsed.arrayPath.trim();
  }
  return {
    ...base,
    service_name: serviceName.trim(),
    request_body: [item],
  };
}

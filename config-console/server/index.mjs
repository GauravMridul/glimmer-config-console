import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import pg from "pg";
import { validatePartnerSequence } from "./partnerSequenceValidation.mjs";
import {
  validatePartnerMapping,
  validateServiceConfiguration,
  validateSfdcMapping,
} from "./configValidation.mjs";
import {
  describeSObject,
  listSObjectsMetadata,
  readSalesforceConfig,
  salesforcePing,
} from "./salesforceClient.mjs";
import { resolveAngleBracketPlaceholders } from "./salesforceProbeResolve.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Parent .env first (Vite / shared), then server/.env last so DB secrets in server/.env are never overwritten.
dotenv.config({ path: path.join(__dirname, "../.env") });
dotenv.config({ path: path.join(__dirname, ".env"), override: true });

const { Pool } = pg;

/** Primary app / config-console Postgres (required for server start when no ESA_DATABASE_URL). */
const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
const esaUrl =
  String(process.env.ESA_DATABASE_URL ?? "").trim() || databaseUrl || undefined;
const dmUrl = String(process.env.DM_DATABASE_URL ?? "").trim() || databaseUrl;

/** DM password: plain DM_PASSWORD, or DM_PASSWORD_BASE64 (avoids .env parsing edge cases). */
function dmPasswordFromEnv() {
  const b64 = process.env.DM_PASSWORD_BASE64?.trim();
  if (b64) {
    try {
      return Buffer.from(b64, "base64").toString("utf8");
    } catch {
      return "";
    }
  }
  const p = process.env.DM_PASSWORD;
  if (p == null || p === "") return "";
  return String(p).replace(/\r\n/g, "\n").trimEnd();
}

/** Raw password + host (no URI encoding). Use when the password contains @, $, %, etc. */
const dmDiscrete =
  Boolean(process.env.DM_HOST) && dmPasswordFromEnv() !== "";

if (!esaUrl) {
  console.error("[config-console-server] Set DATABASE_URL (or ESA_DATABASE_URL).");
  process.exit(1);
}
if (!dmDiscrete && !dmUrl) {
  console.error(
    "[config-console-server] Set DM_DATABASE_URL, or DM_HOST + DM_PASSWORD (see .env.example).",
  );
  process.exit(1);
}

/** RDS / many cloud Postgres URLs use TLS; Node may lack the CA chain unless you pass ssl explicitly. */
function poolOptions(connectionString) {
  const relax =
    process.env.RDS_SSL_REJECT_UNAUTHORIZED === "false" ||
    process.env.RDS_SSL_REJECT_UNAUTHORIZED === "0";
  if (!relax) {
    return { connectionString };
  }
  try {
    const u = new URL(connectionString);
    u.searchParams.delete("sslmode");
    u.searchParams.delete("ssl");
    return {
      connectionString: u.toString(),
      ssl: { rejectUnauthorized: false },
    };
  } catch {
    return {
      connectionString: connectionString.replace(/\?.*$/, ""),
      ssl: { rejectUnauthorized: false },
    };
  }
}

function sslRejectUnauthorized() {
  return (
    process.env.RDS_SSL_REJECT_UNAUTHORIZED === "false" ||
    process.env.RDS_SSL_REJECT_UNAUTHORIZED === "0"
  );
}

function createDmPoolDiscrete() {
  return new Pool({
    user: process.env.DM_USER || "dmuser",
    password: dmPasswordFromEnv(),
    host: process.env.DM_HOST,
    port: Number(process.env.DM_PORT || 5432),
    database:
      process.env.DM_DB || process.env.DM_DATABASE || "decisionmanageruatdb",
    ssl: sslRejectUnauthorized() ? { rejectUnauthorized: false } : undefined,
  });
}

/** @type {pg.Pool} */
let poolEsa;
/** @type {pg.Pool} */
let poolDm;

const sharedUrlPools = !dmDiscrete && esaUrl === dmUrl;

if (sharedUrlPools) {
  poolEsa = poolDm = new Pool(poolOptions(esaUrl));
} else {
  poolEsa = new Pool(poolOptions(esaUrl));
  poolDm = dmDiscrete ? createDmPoolDiscrete() : new Pool(poolOptions(dmUrl));
}

/**
 * Postgres pool for `query_object_relationship_map` (probe SOQL + GET listing).
 * 1) QUERY_OBJECT_RELATIONSHIP_MAP_DATABASE_URL if set (else same as ESA / DM when equal).
 * 2) Else if ESA_DATABASE_URL is set and DATABASE_URL differs → use DATABASE_URL (map on config DB).
 * 3) Else reuse the ESA pool (single-database dev).
 */
const qorMapUrl = process.env.QUERY_OBJECT_RELATIONSHIP_MAP_DATABASE_URL?.trim();
/** @type {pg.Pool[]} */
const extraPgPools = [];
let poolQueryObjectRelationshipMap;
if (qorMapUrl) {
  if (qorMapUrl === esaUrl) {
    poolQueryObjectRelationshipMap = poolEsa;
  } else if (qorMapUrl === dmUrl) {
    poolQueryObjectRelationshipMap = poolDm;
  } else {
    const p = new Pool(poolOptions(qorMapUrl));
    extraPgPools.push(p);
    poolQueryObjectRelationshipMap = p;
  }
} else if (databaseUrl && databaseUrl !== esaUrl) {
  if (databaseUrl === dmUrl) {
    poolQueryObjectRelationshipMap = poolDm;
  } else {
    const p = new Pool(poolOptions(databaseUrl));
    extraPgPools.push(p);
    poolQueryObjectRelationshipMap = p;
  }
} else {
  poolQueryObjectRelationshipMap = poolEsa;
}


function ts(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** jsonb can be an object, array, or (with some drivers/settings) a JSON string. */
function coerceJsonValue(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === "object") return v;
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      if (p != null && typeof p === "object") return p;
    } catch {
      /* ignore */
    }
  }
  return fallback;
}

function mapServiceConfig(row) {
  return {
    id: Number(row.id),
    service_name: row.service_name,
    api_url: row.api_url,
    headers: coerceJsonValue(row.headers, {}),
    request_body: coerceJsonValue(row.request_body, {}),
    request_method: row.request_method,
    response_body: coerceJsonValue(row.response_body, {}),
    send_response: Boolean(row.send_response),
    timeout: Number(row.timeout ?? 0),
    additional_config: coerceJsonValue(row.additional_config, {}),
    created_date: ts(row.created_date),
    created_by: row.created_by,
    modified_date: ts(row.modified_date),
    modified_by: row.modified_by,
    is_deleted: Boolean(row.is_deleted),
  };
}

function mapPartner(row) {
  return {
    id: Number(row.id),
    name: row.name,
    partner_name: row.partner_name,
    program_type: row.program_type ?? "",
    business_type: row.business_type ?? "",
    sourcing_program: row.sourcing_program ?? "",
    loan_category: row.loan_category ?? "",
    customer_type: row.customer_type ?? "",
    product_line: row.product_line ?? "",
    stage: row.stage,
    service_sequence_string: row.service_sequence_string,
    created_date: ts(row.created_date),
    created_by: row.created_by,
    modified_date: ts(row.modified_date),
    modified_by: row.modified_by,
    is_deleted: Boolean(row.is_deleted),
  };
}

function mapSfdc(row) {
  let rb = row.request_body;
  if (typeof rb === "string") {
    try {
      rb = JSON.parse(rb);
    } catch {
      rb = [];
    }
  }
  if (rb == null || (typeof rb === "object" && !Array.isArray(rb) && Object.keys(rb).length === 0)) {
    rb = [];
  }
  if (!Array.isArray(rb)) rb = [];
  return {
    id: Number(row.id),
    service_name: row.service_name,
    request_body: rb,
    created_date: ts(row.created_date),
    created_by: row.created_by,
    modified_date: ts(row.modified_date),
    modified_by: row.modified_by,
    is_deleted: Boolean(row.is_deleted),
  };
}

async function loadEsaServiceConfigurations() {
  const result = await poolEsa.query(
    `SELECT id, service_name, api_url, headers, request_body, request_method, response_body, send_response, timeout, additional_config,
     created_date, created_by, modified_date, modified_by, is_deleted
     FROM service_configuration WHERE is_deleted = false ORDER BY id`,
  );
  return result.rows.map(mapServiceConfig);
}

function validationFailed(res, result) {
  return res.status(400).json({
    error: "Validation failed",
    details: result.errors,
  });
}

const HTTP_PROBE_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);
const HTTP_PROBE_MAX_RESPONSE_CHARS = 48_000;

/** Comma-separated hostnames; when set, only those hosts may be probed (case-insensitive). */
function httpProbeHostAllowSet() {
  const raw = process.env.HTTP_PROBE_HOST_ALLOWLIST?.trim();
  if (!raw) return null;
  const set = new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  return set.size === 0 ? null : set;
}

function httpProbeHostAllowed(hostname, allowSet) {
  if (!allowSet) return true;
  return allowSet.has(String(hostname).toLowerCase());
}

/** Consistent JSON for API failures; includes Postgres fields when present. */
function sendApiError(res, e, status = 500) {
  let msg = String(e?.message ?? e ?? "").trim();
  if (!msg) msg = "Unknown error";
  const body = { error: msg };
  if (e && typeof e === "object") {
    if (e.code) body.code = e.code;
    if (e.detail) body.detail = e.detail;
    if (e.hint) body.hint = e.hint;
  }
  if (
    e &&
    typeof e === "object" &&
    e.code === "42P01" &&
    /partner_service_mapping|service_sfdc_field_mapping/i.test(msg)
  ) {
    body.hint =
      body.hint ||
      "Decision Manager tables are missing on this database. Apply config-console/server/schema.sql, or set DM_DATABASE_URL (or DM_HOST) to a DB that has partner_service_mapping and service_sfdc_field_mapping.";
  }
  return res.status(status).json(body);
}

const app = express();
if (process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(express.json({ limit: "2mb" }));

/** URL prefix for the SPA (no trailing slash), e.g. `/decisioning-portal`. Must match Vite build `base`. */
function normalizePublicBasePath(raw) {
  const t = (raw ?? "").trim();
  if (!t || t === "/") return "";
  const x = t.startsWith("/") ? t : `/${t}`;
  return x.replace(/\/+$/, "");
}

const publicBasePath = normalizePublicBasePath(process.env.PUBLIC_BASE_PATH);

/** Allow health + API at both `/api/...` and `${PUBLIC_BASE_PATH}/api/...` (ingress / probes). */
if (publicBasePath) {
  app.use((req, res, next) => {
    const u = req.url;
    if (
      u === `${publicBasePath}/api` ||
      u.startsWith(`${publicBasePath}/api/`) ||
      u.startsWith(`${publicBasePath}/api?`)
    ) {
      req.url = u.slice(publicBasePath.length);
    }
    next();
  });
}

/** Avoid stale config after edits: intermediaries or browsers caching GET /api/config. */
app.use((req, res, next) => {
  const pathForApi = String(req.path ?? "");
  if (pathForApi.startsWith("/api")) {
    res.setHeader("Cache-Control", "private, no-store, no-cache, must-revalidate");
  }
  next();
});

const esaProcessSequenceUrl =
  process.env.ESA_PROCESS_SEQUENCE_URL?.trim() ||
  "https://staging.example.com/external-service-adapter/v1/process-sequence/v2";
const esaProcessSequenceApiKey = process.env.ESA_PROCESS_SEQUENCE_API_KEY?.trim() || "";

app.get("/api/health", async (_req, res) => {
  try {
    await poolEsa.query("SELECT 1");
    await poolDm.query("SELECT 1");
    res.json({ ok: true, database: "connected" });
  } catch (e) {
    res.status(503).json({ ok: false, error: String(e.message || e) });
  }
});

/** Salesforce: env present? live token + limits check? (secrets stay on server.) */
app.get("/api/salesforce/status", async (_req, res) => {
  const cfg = readSalesforceConfig();
  if (!cfg.configured) {
    return res.json({
      configured: false,
      connected: false,
      hint: "Set Salesforce vars in server/.env (see server/.env.example).",
    });
  }
  const ping = await salesforcePing();
  if (!ping.ok) {
    return res.json({
      configured: true,
      connected: false,
      error: ping.error,
    });
  }
  res.json({
    configured: true,
    connected: true,
    instanceUrl: ping.instanceUrl,
    apiVersion: ping.apiVersion,
    usernameMasked: ping.usernameMasked,
  });
});

/** Global org SObject list — Object API name autofill in SFDC mapper. */
app.get("/api/salesforce/sobjects", async (_req, res) => {
  try {
    const sobjects = await listSObjectsMetadata();
    res.json({ sobjects });
  } catch (e) {
    const msg = String(e?.message || e);
    const status = /not configured/i.test(msg) ? 503 : 502;
    res.status(status).json({ error: msg });
  }
});

/**
 * SObject describe (field API names for mapper datalist). Path segment must be a safe API name.
 * Example: GET /api/salesforce/describe/Account
 */
app.get("/api/salesforce/describe/:sobject", async (req, res) => {
  try {
    const raw = String(req.params.sobject ?? "").trim();
    const sobject = decodeURIComponent(raw);
    const fields = await describeSObject(sobject);
    res.json({
      sobject,
      fieldCount: fields.length,
      fields,
    });
  } catch (e) {
    const msg = String(e?.message || e);
    const status = /Invalid SObject|not configured/i.test(msg) ? 400 : 502;
    res.status(status).json({ error: msg });
  }
});

/**
 * Live `query_object_relationship_map` rows (same table as External Service Adapter). Used by the
 * portal so new objects added in Postgres are reflected without redeploy.
 */
app.get("/api/salesforce/query-object-relationship-map", async (_req, res) => {
  try {
    const r = await poolQueryObjectRelationshipMap.query(`
      SELECT query_object, query_relation, additional_fields, additional_conditions
      FROM query_object_relationship_map
      WHERE is_deleted = false
      ORDER BY LOWER(query_object)
    `);
    const rows = r.rows.map((row) => ({
      query_object: row.query_object != null ? String(row.query_object) : "",
      query_relation: row.query_relation != null ? String(row.query_relation) : null,
      additional_fields: row.additional_fields != null ? String(row.additional_fields) : null,
      additional_conditions:
        row.additional_conditions != null ? String(row.additional_conditions) : null,
    }));
    res.json({
      count: rows.length,
      usingDedicatedDb: poolQueryObjectRelationshipMap !== poolEsa,
      rows,
    });
  } catch (e) {
    const msg = String(e?.message || e);
    const code = e && typeof e === "object" && e.code === "42P01" ? 503 : 502;
    return res.status(code).json({
      error: msg,
      hint:
        code === 503
          ? "Table query_object_relationship_map is missing on this database. Use DATABASE_URL (or QUERY_OBJECT_RELATIONSHIP_MAP_DATABASE_URL) for the Postgres that holds this table; when ESA_DATABASE_URL points elsewhere, the map defaults to DATABASE_URL."
          : undefined,
    });
  }
});

/**
 * Resolve `<Object.field>` placeholders from live SOQL (HTTP probe helper).
 * GET: discovery (returns 400 JSON — use POST). Helps verify the route exists after deploy.
 * POST body: { anchorId, anchorType?: "auto"|"Lead"|"Contact", requestBody: object }
 */
app.get("/api/salesforce/resolve-probe-templates", (_req, res) => {
  res.status(400).json({
    error: "Use POST with JSON: { anchorId, anchorType?: \"auto\"|\"Lead\"|\"Contact\", requestBody: { … } }",
    hint: "If POST returns HTML “Cannot POST …”, the request is not reaching this config-console server (wrong VITE_API_URL or old image).",
  });
});

app.post("/api/salesforce/resolve-probe-templates", async (req, res) => {
  try {
    const b = req.body && typeof req.body === "object" ? req.body : {};
    const anchorId = String(b.anchorId ?? "").trim();
    const anchorType = String(b.anchorType ?? "auto").trim() || "auto";
    const requestBody = b.requestBody;
    if (requestBody == null || typeof requestBody !== "object" || Array.isArray(requestBody)) {
      return res.status(400).json({
        error: "requestBody must be a JSON object (same shape as the probe body).",
      });
    }
    const out = await resolveAngleBracketPlaceholders(
      requestBody,
      {
        anchorId,
        anchorType,
      },
      { poolEsa: poolQueryObjectRelationshipMap },
    );
    res.json(out);
  } catch (e) {
    const msg = String(e?.message || e);
    const client =
      /anchorId|required|must be|not configured|anchorType/i.test(msg) &&
      !/query failed|MALFORMED|INVALID_TYPE/i.test(msg);
    return sendApiError(res, e, client ? 400 : 502);
  }
});

/**
 * Server-side HTTP probe for External API rows (avoids browser CORS).
 * Body: { url, method, headers?, body?, timeoutMs? }
 * Optional env HTTP_PROBE_HOST_ALLOWLIST=comma-separated hostnames.
 */
app.post("/api/http-probe", async (req, res) => {
  const allowSet = httpProbeHostAllowSet();
  try {
    const b = req.body && typeof req.body === "object" ? req.body : {};
    const urlStr = String(b.url ?? "").trim();
    const method = String(b.method ?? "GET").trim().toUpperCase();
    if (!HTTP_PROBE_METHODS.has(method)) {
      return res.status(400).json({
        error: "Invalid method",
        details: [`Use one of: ${[...HTTP_PROBE_METHODS].join(", ")}`],
      });
    }
    let u;
    try {
      u = new URL(urlStr);
    } catch {
      return res.status(400).json({ error: "Invalid URL" });
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return res.status(400).json({
        error: "Invalid URL",
        details: ["Only http: and https: are allowed."],
      });
    }
    if (!httpProbeHostAllowed(u.hostname, allowSet)) {
      return res.status(403).json({
        error: "Host not allowed for HTTP probe",
        details: [
          `Hostname “${u.hostname}” is not in HTTP_PROBE_HOST_ALLOWLIST. Remove the env var to allow any host (dev only), or add this hostname.`,
        ],
      });
    }

    const headersIn =
      b.headers != null && typeof b.headers === "object" && !Array.isArray(b.headers)
        ? b.headers
        : {};
    const hdrs = new Headers();
    for (const [k0, v0] of Object.entries(headersIn)) {
      const k = String(k0).trim();
      if (!k) continue;
      const v =
        v0 == null ? "" : typeof v0 === "string" ? v0 : JSON.stringify(v0);
      hdrs.set(k, v);
    }

    let body;
    const noBody = method === "GET" || method === "HEAD";
    if (!noBody && b.body !== undefined && b.body !== null) {
      if (typeof b.body === "string") {
        body = b.body;
      } else {
        body = JSON.stringify(b.body);
      }
      if (!hdrs.has("content-type") && !hdrs.has("Content-Type")) {
        hdrs.set("Content-Type", "application/json");
      }
    }

    const timeoutMs = Math.min(
      Math.max(Number(b.timeoutMs) || 30_000, 1_000),
      120_000,
    );
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const started = Date.now();
    let upstream;
    try {
      upstream = await fetch(urlStr, {
        method,
        headers: hdrs,
        body,
        signal: ac.signal,
        redirect: "manual",
      });
    } catch (e) {
      clearTimeout(timer);
      const msg =
        e?.name === "AbortError"
          ? `Request timed out after ${timeoutMs}ms`
          : String(e?.message || e);
      return res.json({
        ok: false,
        error: msg,
        durationMs: Date.now() - started,
      });
    }
    clearTimeout(timer);

    const text = await upstream.text();
    const truncated = text.length > HTTP_PROBE_MAX_RESPONSE_CHARS;
    const snippet = truncated
      ? text.slice(0, HTTP_PROBE_MAX_RESPONSE_CHARS)
      : text;

    const responseHeaders = {};
    upstream.headers.forEach((val, key) => {
      responseHeaders[key] = val;
    });

    let bodyOut = snippet;
    const t = snippet.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        bodyOut = JSON.stringify(JSON.parse(snippet), null, 2);
      } catch {
        /* keep raw */
      }
    }

    return res.json({
      ok: true,
      status: upstream.status,
      statusText: upstream.statusText,
      durationMs: Date.now() - started,
      responseHeaders,
      body: bodyOut,
      bodyTruncated: truncated,
    });
  } catch (e) {
    console.error(e);
    sendApiError(res, e);
  }
});

/** GET probe: open in browser to confirm this server has the test route (avoids “Cannot POST” from wrong port/process). */
app.get("/api/test/process-sequence", (_req, res) => {
  res.json({
    ok: true,
    message:
      "This is the config-console API. Use POST with a JSON body from the Test sequence page. POST requires ESA_PROCESS_SEQUENCE_API_KEY in server/.env.",
  });
});

/**
 * Proxies to External Service Adapter `process-sequence/v2` so the browser does not need the API key or CORS.
 * Body: same JSON as upstream, plus optional `correlationId` (stripped before forward; also accepts X-Correlation-ID).
 */
app.post("/api/test/process-sequence", async (req, res) => {
  if (!esaProcessSequenceApiKey) {
    return res.status(503).json({
      error:
        "ESA_PROCESS_SEQUENCE_API_KEY is not set. Add it to server/.env (see server/.env.example).",
      hint: "The key is kept on the server only; it is never sent to the browser.",
    });
  }
  const raw = req.body && typeof req.body === "object" ? req.body : {};
  const correlationId =
    String(req.get("x-correlation-id") || "").trim() ||
    String(raw.correlationId ?? "").trim() ||
    randomUUID();
  const { correlationId: _drop, ...upstreamBody } = raw;
  try {
    const upstream = await fetch(esaProcessSequenceUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": esaProcessSequenceApiKey,
        "X-Correlation-ID": correlationId,
      },
      body: JSON.stringify(upstreamBody),
    });
    const text = await upstream.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    res.status(200).json({
      ok: upstream.ok,
      upstreamStatus: upstream.status,
      correlationId,
      data,
    });
  } catch (e) {
    console.error(e);
    sendApiError(res, e);
  }
});

app.get("/api/config", async (_req, res) => {
  try {
    const [esa, partner, sfdc] = await Promise.all([
      poolEsa.query(
        `SELECT id, service_name, api_url, headers, request_body, request_method, response_body, send_response, timeout, additional_config,
         created_date, created_by, modified_date, modified_by, is_deleted
         FROM service_configuration WHERE is_deleted = false ORDER BY id`,
      ),
      poolDm.query(
        `SELECT id, name, partner_name, program_type, business_type, sourcing_program, loan_category, customer_type, product_line, stage, service_sequence_string,
         created_date, created_by, modified_date, modified_by, is_deleted
         FROM partner_service_mapping WHERE is_deleted = false ORDER BY id`,
      ),
      poolDm.query(
        `SELECT id, service_name, request_body, created_date, created_by, modified_date, modified_by, is_deleted
         FROM service_sfdc_field_mapping WHERE is_deleted = false ORDER BY id`,
      ),
    ]);
    res.json({
      serviceConfigurations: esa.rows.map(mapServiceConfig),
      partnerMappings: partner.rows.map(mapPartner),
      sfdcMappings: sfdc.rows.map(mapSfdc),
    });
  } catch (e) {
    console.error(e);
    sendApiError(res, e);
  }
});

/** Validates `service_sequence_string` against live ESA `service_configuration` (same rules as the UI). */
app.post("/api/validate-partner-sequence", async (req, res) => {
  try {
    const s = req.body?.service_sequence_string ?? "";
    const result = await poolEsa.query(
      `SELECT id, service_name, api_url, headers, request_body, request_method, response_body, send_response, timeout, additional_config,
       created_date, created_by, modified_date, modified_by, is_deleted
       FROM service_configuration WHERE is_deleted = false ORDER BY id`,
    );
    const serviceConfigurations = result.rows.map(mapServiceConfig);
    const out = validatePartnerSequence(s, serviceConfigurations);
    res.json(out);
  } catch (e) {
    console.error(e);
    sendApiError(res, e);
  }
});

// --- service_configuration (ESA pool) ---
app.post("/api/service-configurations", async (req, res) => {
  const r = req.body;
  const vr = validateServiceConfiguration(r);
  if (!vr.ok) return validationFailed(res, vr);
  try {
    const result = await poolEsa.query(
      `INSERT INTO service_configuration (
        service_name, api_url, headers, request_body, request_method, response_body, send_response, timeout, additional_config,
        created_date, created_by, is_deleted
      ) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6::jsonb,$7,$8,$9::jsonb,$10,$11,false)
      RETURNING *`,
      [
        r.service_name,
        r.api_url,
        JSON.stringify(r.headers ?? {}),
        JSON.stringify(r.request_body ?? {}),
        r.request_method,
        JSON.stringify(r.response_body ?? {}),
        r.send_response ?? false,
        r.timeout ?? 0,
        JSON.stringify(r.additional_config ?? {}),
        r.created_date || new Date().toISOString(),
        r.created_by || "console",
      ],
    );
    res.status(201).json(mapServiceConfig(result.rows[0]));
  } catch (e) {
    console.error(e);
    sendApiError(res, e);
  }
});

app.put("/api/service-configurations/:id", async (req, res) => {
  const id = Number(req.params.id);
  const r = req.body;
  const vr = validateServiceConfiguration(r);
  if (!vr.ok) return validationFailed(res, vr);
  try {
    const result = await poolEsa.query(
      `UPDATE service_configuration SET
        service_name=$1, api_url=$2, headers=$3::jsonb, request_body=$4::jsonb, request_method=$5, response_body=$6::jsonb,
        send_response=$7, timeout=$8, additional_config=$9::jsonb,
        modified_date=NOW(), modified_by=$10
      WHERE id=$11 AND is_deleted = false
      RETURNING *`,
      [
        r.service_name,
        r.api_url,
        JSON.stringify(r.headers ?? {}),
        JSON.stringify(r.request_body ?? {}),
        r.request_method,
        JSON.stringify(r.response_body ?? {}),
        r.send_response ?? false,
        r.timeout ?? 0,
        JSON.stringify(r.additional_config ?? {}),
        r.modified_by || "console",
        id,
      ],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Not found" });
    }
    res.json(mapServiceConfig(result.rows[0]));
  } catch (e) {
    console.error(e);
    sendApiError(res, e);
  }
});

app.delete("/api/service-configurations/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    await poolEsa.query(
      `UPDATE service_configuration SET is_deleted=true, modified_date=NOW(), modified_by=$2 WHERE id=$1`,
      [id, "console"],
    );
    res.status(204).end();
  } catch (e) {
    console.error(e);
    sendApiError(res, e);
  }
});

// --- partner_service_mapping (DM pool) ---
app.post("/api/partner-mappings", async (req, res) => {
  const r = req.body;
  try {
    const esa = await loadEsaServiceConfigurations();
    const vr = validatePartnerMapping(r, esa);
    if (!vr.ok) return validationFailed(res, vr);
    const result = await poolDm.query(
      `INSERT INTO partner_service_mapping (
        name, partner_name, program_type, business_type, sourcing_program, loan_category, customer_type, product_line, stage, service_sequence_string,
        created_date, created_by, is_deleted
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false)
      RETURNING *`,
      [
        r.name,
        r.partner_name,
        r.program_type ?? "",
        r.business_type ?? "",
        r.sourcing_program ?? "",
        r.loan_category ?? "",
        r.customer_type ?? "",
        r.product_line ?? "",
        r.stage,
        r.service_sequence_string,
        r.created_date || new Date().toISOString(),
        r.created_by || "console",
      ],
    );
    res.status(201).json(mapPartner(result.rows[0]));
  } catch (e) {
    console.error(e);
    sendApiError(res, e);
  }
});

app.put("/api/partner-mappings/:id", async (req, res) => {
  const id = Number(req.params.id);
  const r = req.body;
  try {
    const esa = await loadEsaServiceConfigurations();
    const vr = validatePartnerMapping(r, esa);
    if (!vr.ok) return validationFailed(res, vr);
    const result = await poolDm.query(
      `UPDATE partner_service_mapping SET
        name=$1, partner_name=$2, program_type=$3, business_type=$4, sourcing_program=$5, loan_category=$6, customer_type=$7, product_line=$8, stage=$9, service_sequence_string=$10,
        modified_date=NOW(), modified_by=$11
      WHERE id=$12 AND is_deleted = false
      RETURNING *`,
      [
        r.name,
        r.partner_name,
        r.program_type ?? "",
        r.business_type ?? "",
        r.sourcing_program ?? "",
        r.loan_category ?? "",
        r.customer_type ?? "",
        r.product_line ?? "",
        r.stage,
        r.service_sequence_string,
        r.modified_by || "console",
        id,
      ],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });
    res.json(mapPartner(result.rows[0]));
  } catch (e) {
    console.error(e);
    sendApiError(res, e);
  }
});

app.delete("/api/partner-mappings/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    await poolDm.query(
      `UPDATE partner_service_mapping SET is_deleted=true, modified_date=NOW(), modified_by=$2 WHERE id=$1`,
      [id, "console"],
    );
    res.status(204).end();
  } catch (e) {
    console.error(e);
    sendApiError(res, e);
  }
});

// --- service_sfdc_field_mapping (DM pool) ---
app.post("/api/sfdc-mappings", async (req, res) => {
  const r = req.body;
  const vr = validateSfdcMapping(r);
  if (!vr.ok) return validationFailed(res, vr);
  try {
    const result = await poolDm.query(
      `INSERT INTO service_sfdc_field_mapping (service_name, request_body, created_date, created_by, is_deleted)
       VALUES ($1, $2::jsonb, $3, $4, false)
       RETURNING *`,
      [
        r.service_name,
        JSON.stringify(Array.isArray(r.request_body) ? r.request_body : []),
        r.created_date || new Date().toISOString(),
        r.created_by || "console",
      ],
    );
    res.status(201).json(mapSfdc(result.rows[0]));
  } catch (e) {
    console.error(e);
    sendApiError(res, e);
  }
});

app.put("/api/sfdc-mappings/:id", async (req, res) => {
  const id = Number(req.params.id);
  const r = req.body;
  const vr = validateSfdcMapping(r);
  if (!vr.ok) return validationFailed(res, vr);
  try {
    const result = await poolDm.query(
      `UPDATE service_sfdc_field_mapping SET
        service_name=$1, request_body=$2::jsonb, modified_date=NOW(), modified_by=$3
      WHERE id=$4 AND is_deleted = false
      RETURNING *`,
      [
        r.service_name,
        JSON.stringify(Array.isArray(r.request_body) ? r.request_body : []),
        r.modified_by || "console",
        id,
      ],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });
    res.json(mapSfdc(result.rows[0]));
  } catch (e) {
    console.error(e);
    sendApiError(res, e);
  }
});

app.delete("/api/sfdc-mappings/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    await poolDm.query(
      `UPDATE service_sfdc_field_mapping SET is_deleted=true, modified_date=NOW(), modified_by=$2 WHERE id=$1`,
      [id, "console"],
    );
    res.status(204).end();
  } catch (e) {
    console.error(e);
    sendApiError(res, e);
  }
});

/** When set (e.g. Docker: /app/dist), serve the Vite build and SPA fallback after /api routes. */
const staticDistDir = process.env.STATIC_DIST_DIR?.trim() || "";
if (staticDistDir && fs.existsSync(staticDistDir)) {
  console.log(`[config-console-server] Serving static UI from ${staticDistDir}`);
  if (publicBasePath) {
    console.log(`[config-console-server] UI public path: ${publicBasePath} (set PUBLIC_BASE_PATH to change)`);
    app.use(publicBasePath, express.static(staticDistDir, { index: "index.html" }));
    app.use((req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      const under =
        req.path === publicBasePath ||
        req.path === `${publicBasePath}/` ||
        req.path.startsWith(`${publicBasePath}/`);
      if (!under) return next();
      res.sendFile(path.join(staticDistDir, "index.html"), (err) => {
        if (err) next(err);
      });
    });
  } else {
    app.use(express.static(staticDistDir, { index: "index.html" }));
    app.use((req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      res.sendFile(path.join(staticDistDir, "index.html"), (err) => {
        if (err) next(err);
      });
    });
  }
}

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`[config-console-server] http://localhost:${port}`);
  console.log(`[config-console-server] ESA DB: ${maskUrl(esaUrl)}`);
  if (qorMapUrl && qorMapUrl !== esaUrl) {
    console.log(`[config-console-server] query_object_relationship_map DB: ${maskUrl(qorMapUrl)}`);
  } else {
    console.log(
      "[config-console-server] query_object_relationship_map: same connection as ESA DB (live SELECT each request).",
    );
  }
  if (dmDiscrete) {
    const db = process.env.DM_DB || process.env.DM_DATABASE || "decisionmanageruatdb";
    console.log(
      `[config-console-server] DM DB:  postgresql://${process.env.DM_USER || "dmuser"}:***@${process.env.DM_HOST}:${process.env.DM_PORT || 5432}/${db}`,
    );
  } else {
    console.log(`[config-console-server] DM DB:  ${maskUrl(dmUrl)}`);
  }
  console.log(
    `[config-console-server] ESA process-sequence test proxy: ${esaProcessSequenceApiKey ? "enabled" : "disabled (set ESA_PROCESS_SEQUENCE_API_KEY)"}`,
  );
  const sf = readSalesforceConfig();
  console.log(
    `[config-console-server] Salesforce API proxy: ${sf.configured ? "env present (GET /api/salesforce/status)" : "disabled (set SALESFORCE_* in server/.env)"}`,
  );
});

function maskUrl(u) {
  try {
    const x = new URL(u);
    if (x.password) x.password = "***";
    return x.toString();
  } catch {
    return "(invalid url)";
  }
}

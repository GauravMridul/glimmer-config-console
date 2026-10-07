import type { ConfigBundle } from "@/lib/storage";
import type { PartnerSequenceValidationResult } from "@/lib/partnerSequenceValidation";
import type {
  PartnerServiceMapping,
  ServiceConfiguration,
  ServiceSfdcFieldMapping,
} from "@/types/models";

/** When true, the UI loads/saves via the Node API + Postgres (see /server). */
export function shouldUseApi(): boolean {
  return (
    import.meta.env.VITE_USE_API === "true" ||
    import.meta.env.VITE_USE_API === "1"
  );
}

/** Origin of VITE_API_URL for runtime comparison (adds https:// if scheme omitted). */
function viteApiBaseOrigin(): string | null {
  const raw = (import.meta.env.VITE_API_URL ?? "").trim().replace(/\/$/, "");
  if (!raw) return null;
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(withScheme).origin;
  } catch {
    return null;
  }
}

function viteAppBasePrefix(): string {
  const b = (import.meta.env.BASE_URL ?? "/").replace(/\/+$/, "");
  return b === "/" ? "" : b;
}

function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const forceRelative =
    import.meta.env.VITE_API_RELATIVE === "true" ||
    import.meta.env.VITE_API_RELATIVE === "1";
  if (forceRelative) {
    const prefix = viteAppBasePrefix();
    return prefix ? `${prefix}${p}` : p;
  }
  const base = (import.meta.env.VITE_API_URL ?? "").trim().replace(/\/$/, "");
  if (!base) return p;

  // Misconfigured CI often bakes VITE_API_URL to another service (aa-calc-api, etc.). At runtime,
  // if that origin is not this tab’s origin, use relative `/api/...` so requests hit the same
  // host as the UI (typical single-container / ALB config-console deploy).
  if (typeof window !== "undefined" && window.location?.origin) {
    const baked = viteApiBaseOrigin();
    if (baked != null && baked !== window.location.origin) {
      return p;
    }
  }

  return `${base}${p}`;
}

function sameOriginApiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (typeof window === "undefined" || !window.location?.origin) return "";
  const prefix = viteAppBasePrefix();
  return `${window.location.origin}${prefix}${p}`;
}

function primaryIsAbsoluteCrossOrigin(primary: string): boolean {
  if (typeof window === "undefined" || !/^https?:\/\//i.test(primary)) {
    return false;
  }
  try {
    return new URL(primary).origin !== window.location.origin;
  } catch {
    return false;
  }
}

/**
 * When the first request hits a **different origin** that is not config-console (Express HTML
 * "Cannot GET/POST … /api/…"), retry once against **window.location.origin** (same tab).
 * Does not retry for relative `/api/…` URLs (same-origin 404 = deploy or route missing on that host).
 */
async function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  const primary = apiUrl(path);
  const method = (init?.method ?? "GET").toString().toUpperCase();
  let r = await fetch(primary, init);

  if (r.status !== 404 || typeof window === "undefined") {
    return r;
  }

  const fallback = sameOriginApiUrl(path);
  if (!fallback || fallback === primary || !primaryIsAbsoluteCrossOrigin(primary)) {
    return r;
  }

  const text = await r.text();
  const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expressNoRoute = new RegExp(
    `Cannot\\s+${method}\\s+${escapedPath}`,
    "i",
  ).test(text);

  if (!expressNoRoute) {
    return new Response(text, {
      status: r.status,
      statusText: r.statusText,
      headers: r.headers,
    });
  }

  return fetch(fallback, init);
}

async function parseError(res: Response): Promise<string> {
  const t = await res.text();
  const statusLine = `HTTP ${res.status}`;
  try {
    const j = JSON.parse(t) as {
      error?: string;
      details?: string[];
      code?: string;
      detail?: string;
      hint?: string;
    };
    if (j.details?.length) {
      return [
        statusLine,
        j.error ?? "Validation failed",
        ...j.details.map((d) => `• ${d}`),
      ].join("\n");
    }
    const parts: string[] = [];
    if (j.error) parts.push(j.error);
    if (j.code) parts.push(`(${j.code})`);
    if (j.detail) parts.push(j.detail);
    if (j.hint) parts.push(`Hint: ${j.hint}`);
    const core = parts.filter(Boolean).join("\n");
    if (core) return [statusLine, core].join("\n");
  } catch {
    const body = t.trim();
    if (body) {
      const snippet =
        body.length > 900 ? `${body.slice(0, 900)}…` : body;
      let hint = "";
      if (
        res.status === 404 &&
        /Cannot\s+POST\s+\/api\//i.test(body) &&
        (body.includes("<!DOCTYPE") || body.includes("<html"))
      ) {
        hint =
          "\n\n• **Cross-origin:** Rebuild so `VITE_API_URL` is empty or **`VITE_API_RELATIVE=true`**, or use an image where the UI **ignores** a baked API base whose origin differs from this page (relative `/api/…`).\n• **Same host:** This origin still has no `POST /api/salesforce/resolve-probe-templates` — redeploy **config-console** from this repo (must include `server/index.mjs` + `server/salesforceProbeResolve.mjs` + `server/esaSalesforceProbeDb.mjs`).";
      }
      return [statusLine, snippet, hint].filter(Boolean).join("\n");
    }
  }
  let msg = [statusLine, res.statusText || "Request failed"].join("\n");
  if (res.status >= 500) {
    msg +=
      "\n\nThe config-console API may be down or unreachable. From the config-console folder run: npm run server (default port 4000; Vite proxies /api to it). Then reload.";
  }
  return msg;
}

export async function fetchConfig(): Promise<ConfigBundle> {
  let r: Response;
  try {
    r = await fetchApi("/api/config");
  } catch (e) {
    const base = e instanceof Error ? e.message : String(e);
    throw new Error(
      `${base}\n\nCould not reach the API. Start it from the config-console folder: npm run server (port 4000 by default).`,
    );
  }
  if (!r.ok) throw new Error(await parseError(r));
  return r.json() as Promise<ConfigBundle>;
}

/** Server-side sequence validation using live Postgres `service_configuration` (authoritative when API mode is on). */
export async function validatePartnerSequenceRemote(
  serviceSequenceString: string,
): Promise<PartnerSequenceValidationResult> {
  const r = await fetchApi("/api/validate-partner-sequence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_sequence_string: serviceSequenceString,
    }),
  });
  if (!r.ok) throw new Error(await parseError(r));
  return r.json() as Promise<PartnerSequenceValidationResult>;
}

export async function upsertServiceConfiguration(
  row: ServiceConfiguration,
): Promise<void> {
  if (row.id === 0) {
    const r = await fetchApi("/api/service-configurations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    });
    if (!r.ok) throw new Error(await parseError(r));
    return;
  }
  const r = await fetchApi(`/api/service-configurations/${row.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(await parseError(r));
}

export async function deleteServiceConfiguration(id: number): Promise<void> {
  const r = await fetchApi(`/api/service-configurations/${id}`, {
    method: "DELETE",
  });
  if (!r.ok && r.status !== 204) throw new Error(await parseError(r));
}

export async function upsertPartnerMapping(
  row: PartnerServiceMapping,
): Promise<void> {
  await putOrCreatePartnerMapping(row);
}

/**
 * Writes one partner row to the API. PUT by id; on 404 (e.g. local id not on server), POST as new.
 * Returns the row as stored (including server id).
 */
export async function putOrCreatePartnerMapping(
  row: PartnerServiceMapping,
): Promise<PartnerServiceMapping> {
  if (row.id === 0) {
    const r = await fetchApi("/api/partner-mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    });
    if (!r.ok) throw new Error(await parseError(r));
    return r.json() as Promise<PartnerServiceMapping>;
  }
  let r = await fetchApi(`/api/partner-mappings/${row.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(row),
  });
  if (r.status === 404) {
    const ins = { ...row, id: 0 };
    r = await fetchApi("/api/partner-mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ins),
    });
  }
  if (!r.ok) throw new Error(await parseError(r));
  return r.json() as Promise<PartnerServiceMapping>;
}

export async function deletePartnerMapping(id: number): Promise<void> {
  const r = await fetchApi(`/api/partner-mappings/${id}`, {
    method: "DELETE",
  });
  if (!r.ok && r.status !== 204) throw new Error(await parseError(r));
}

export async function upsertSfdcMapping(
  row: ServiceSfdcFieldMapping,
): Promise<void> {
  if (row.id === 0) {
    const r = await fetchApi("/api/sfdc-mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    });
    if (!r.ok) throw new Error(await parseError(r));
    return;
  }
  const r = await fetchApi(`/api/sfdc-mappings/${row.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(await parseError(r));
}

export async function deleteSfdcMapping(id: number): Promise<void> {
  const r = await fetchApi(`/api/sfdc-mappings/${id}`, {
    method: "DELETE",
  });
  if (!r.ok && r.status !== 204) throw new Error(await parseError(r));
}

/** Payload for ESA `process-sequence/v2` (after proxy strips correlationId). */
export type ProcessSequenceTestPayload = {
  applicationId: string;
  oldRefId: string;
  customerId: string;
  partnerName: string;
  programType: string;
  sequenceId: string;
  sequenceString: string;
  stage: string;
  workflowId: string;
};

export type ProcessSequenceTestResult = {
  ok: boolean;
  upstreamStatus: number;
  correlationId: string;
  data: unknown;
};

/** Proxied via config-console server (`POST /api/test/process-sequence`). */
export async function postProcessSequenceTest(
  payload: ProcessSequenceTestPayload,
  correlationId?: string,
): Promise<ProcessSequenceTestResult> {
  const body: Record<string, unknown> = { ...payload };
  if (correlationId?.trim()) body.correlationId = correlationId.trim();
  let r: Response;
  try {
    r = await fetchApi("/api/test/process-sequence", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(correlationId?.trim()
          ? { "X-Correlation-ID": correlationId.trim() }
          : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const base = e instanceof Error ? e.message : String(e);
    throw new Error(
      `${base}\n\nCould not reach the API. From config-console run: npm run server (port 4000).`,
    );
  }
  const t = await r.text();
  let parsed: ProcessSequenceTestResult & { error?: string; hint?: string };
  try {
    parsed = JSON.parse(t) as ProcessSequenceTestResult & {
      error?: string;
      hint?: string;
    };
  } catch {
    throw new Error(t || `HTTP ${r.status}`);
  }
  if (!r.ok) {
    throw new Error(
      [parsed.error, parsed.hint].filter(Boolean).join("\n") || t,
    );
  }
  return parsed;
}

export type HttpProbeWireSuccess = {
  ok: true;
  status: number;
  statusText: string;
  durationMs: number;
  responseHeaders: Record<string, string>;
  body: string;
  bodyTruncated: boolean;
};

export type HttpProbeWireFailure = {
  ok: false;
  error: string;
  durationMs?: number;
};

export type HttpProbeWireResult = HttpProbeWireSuccess | HttpProbeWireFailure;

/** Uses `POST /api/http-probe` on the config-console server (CORS-safe probe). */
export type SalesforceStatusResponse =
  | {
      configured: false;
      connected: false;
      hint?: string;
    }
  | {
      configured: true;
      connected: false;
      error?: string;
    }
  | {
      configured: true;
      connected: true;
      instanceUrl: string;
      apiVersion: string;
      usernameMasked: string;
    };

export async function fetchSalesforceStatus(): Promise<SalesforceStatusResponse> {
  let r: Response;
  try {
    r = await fetchApi("/api/salesforce/status");
  } catch (e) {
    const base = e instanceof Error ? e.message : String(e);
    throw new Error(
      `${base}\n\nCould not reach the API. From config-console run: npm run server (port 4000).`,
    );
  }
  const t = await r.text();
  if (!r.ok) {
    throw new Error(
      await parseError(
        new Response(t, { status: r.status, statusText: r.statusText }),
      ),
    );
  }
  return JSON.parse(t) as SalesforceStatusResponse;
}

export type SalesforceDescribeField = {
  name: string;
  type: string;
  label: string;
  custom: boolean;
};

export type SalesforceDescribeResponse = {
  sobject: string;
  fieldCount: number;
  fields: SalesforceDescribeField[];
};

export type SalesforceProbeQueryRow = {
  object: string;
  soql: string;
  totalSize?: number;
  /** Sample rows from the REST query (capped server-side for payload size). */
  records?: unknown[];
  /** Present when SOQL was not run or failed (still listed for visibility). */
  probeStatus?:
    | "skipped_empty"
    | "skipped_unresolved_placeholders"
    | "error"
    | "prefetch_legacy_no_map_row"
    | "prefetch_error";
  probeError?: string;
};

export type SalesforceResolveProbeResponse = {
  angleValues: Record<string, unknown>;
  queries: SalesforceProbeQueryRow[];
  warnings: string[];
  anchorType: string;
  anchorId: string;
  /** `esa_query_object_relationship_map` when ESA DB rows were used; else `legacy_heuristic`. */
  mappingSource?: string;
};

export type QueryObjectRelationshipMapRow = {
  query_object: string;
  query_relation: string | null;
  additional_fields: string | null;
  additional_conditions: string | null;
};

export type QueryObjectRelationshipMapResponse = {
  count: number;
  /** True when the map uses a different Postgres pool than ESA (explicit QUERY_OBJECT… or default DATABASE_URL vs ESA_DATABASE_URL). */
  usingDedicatedDb: boolean;
  rows: QueryObjectRelationshipMapRow[];
};

/** Live rows from `query_object_relationship_map` (refreshed each call; no client-side cache). */
export async function fetchQueryObjectRelationshipMap(): Promise<QueryObjectRelationshipMapResponse> {
  let r: Response;
  try {
    r = await fetchApi("/api/salesforce/query-object-relationship-map");
  } catch (e) {
    const base = e instanceof Error ? e.message : String(e);
    throw new Error(
      `${base}\n\nCould not reach the API. From config-console run: npm run server (port 4000).`,
    );
  }
  const t = await r.text();
  if (!r.ok) {
    if (r.status === 404 && /Cannot GET .*query-object-relationship-map/i.test(t)) {
      throw new Error(
        "GET /api/salesforce/query-object-relationship-map returned 404. Restart the config-console API (`npm run server` from the repo root) or redeploy so this route is included. “Fill from Salesforce” can still work via POST /api/salesforce/resolve-probe-templates.",
      );
    }
    throw new Error(
      await parseError(
        new Response(t, { status: r.status, statusText: r.statusText }),
      ),
    );
  }
  return JSON.parse(t) as QueryObjectRelationshipMapResponse;
}

export async function postSalesforceResolveProbeTemplates(payload: {
  anchorId: string;
  anchorType?: string;
  requestBody: Record<string, unknown>;
}): Promise<SalesforceResolveProbeResponse> {
  let r: Response;
  try {
    r = await fetchApi("/api/salesforce/resolve-probe-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    const base = e instanceof Error ? e.message : String(e);
    throw new Error(
      `${base}\n\nCould not reach the API. From config-console run: npm run server (port 4000).`,
    );
  }
  const t = await r.text();
  if (!r.ok) {
    throw new Error(
      await parseError(
        new Response(t, { status: r.status, statusText: r.statusText }),
      ),
    );
  }
  return JSON.parse(t) as SalesforceResolveProbeResponse;
}

/** Rows from GET /services/data/vXX/sobjects/ (global describe). */
export type SalesforceGlobalSObjectRow = {
  name: string;
  label: string;
};

/** Org-wide SObject API names + labels — powers mapper Object API name datalist. */
export async function fetchSalesforceSObjectList(): Promise<SalesforceGlobalSObjectRow[]> {
  let r: Response;
  try {
    r = await fetchApi("/api/salesforce/sobjects");
  } catch (e) {
    const base = e instanceof Error ? e.message : String(e);
    throw new Error(
      `${base}\n\nCould not reach the API. From config-console run: npm run server (port 4000).`,
    );
  }
  const t = await r.text();
  if (!r.ok) {
    throw new Error(
      await parseError(
        new Response(t, { status: r.status, statusText: r.statusText }),
      ),
    );
  }
  const j = JSON.parse(t) as { sobjects?: SalesforceGlobalSObjectRow[] };
  return Array.isArray(j.sobjects) ? j.sobjects : [];
}

export async function fetchSalesforceDescribe(
  sobjectApiName: string,
): Promise<SalesforceDescribeResponse> {
  const name = encodeURIComponent(sobjectApiName.trim());
  let r: Response;
  try {
    r = await fetchApi(`/api/salesforce/describe/${name}`);
  } catch (e) {
    const base = e instanceof Error ? e.message : String(e);
    throw new Error(
      `${base}\n\nCould not reach the API. From config-console run: npm run server (port 4000).`,
    );
  }
  const t = await r.text();
  if (!r.ok) {
    throw new Error(
      await parseError(
        new Response(t, { status: r.status, statusText: r.statusText }),
      ),
    );
  }
  return JSON.parse(t) as SalesforceDescribeResponse;
}

export async function postHttpProbe(payload: {
  url: string;
  method: string;
  headers: Record<string, unknown>;
  body?: unknown;
  timeoutMs: number;
}): Promise<HttpProbeWireResult> {
  let r: Response;
  try {
    r = await fetchApi("/api/http-probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    const base = e instanceof Error ? e.message : String(e);
    throw new Error(
      `${base}\n\nCould not reach the API. From config-console run: npm run server (port 4000).`,
    );
  }
  const t = await r.text();
  if (!r.ok) {
    throw new Error(
      await parseError(
        new Response(t, { status: r.status, statusText: r.statusText }),
      ),
    );
  }
  return JSON.parse(t) as HttpProbeWireResult;
}

import type { ServiceConfiguration, ServiceSfdcFieldMapping } from "@/types/models";

/** Paste this shape (or equivalent aliases) from Postman, design docs, or a stub. */
export type SampleApiInput = {
  service_name: string;
  api_url: string;
  request_method: string;
  headers: Record<string, unknown>;
  request_body: Record<string, unknown>;
  /** Used to scaffold SFDC Composite `body` with ((ServiceName.path)) templates. */
  sample_response: unknown;
  timeout: number;
  salesforce_sobject: string;
  api_version: string;
};

const DEFAULT_EXAMPLE: SampleApiInput = {
  service_name: "RiskScore",
  api_url: "https://api.example.com/v1/risk/score",
  request_method: "POST",
  headers: { "Content-Type": "application/json" },
  request_body: {
    applicationId: "((applicationId))",
    customerId: "((customerId))",
  },
  sample_response: {
    score: 720,
    tier: "A",
    metadata: { source: "bureau" },
  },
  timeout: 30,
  salesforce_sobject: "Risk_Snapshot__c",
  api_version: "v64.0",
};

export function getDefaultSampleJson(): string {
  return JSON.stringify(DEFAULT_EXAMPLE, null, 2);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Accept common alternate keys from hand-written JSON. */
export function normalizeSampleInput(raw: unknown):
  | { ok: true; value: SampleApiInput }
  | { ok: false; error: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, error: "Root must be a JSON object." };
  }

  const service_name = String(
    raw.service_name ?? raw.serviceName ?? "",
  ).trim();
  const endpoint = isPlainObject(raw.endpoint) ? raw.endpoint : null;
  const api_url = String(
    raw.api_url ?? raw.apiUrl ?? endpoint?.url ?? raw.url ?? "",
  ).trim();

  if (!service_name) {
    return { ok: false, error: "Missing service_name (or serviceName)." };
  }
  if (!api_url) {
    return {
      ok: false,
      error: "Missing api_url (or apiUrl / endpoint.url / url).",
    };
  }

  const request_method = String(
    raw.request_method ?? raw.method ?? endpoint?.method ?? "POST",
  )
    .trim()
    .toUpperCase() || "POST";

  const headers = isPlainObject(raw.headers)
    ? (raw.headers as Record<string, unknown>)
    : endpoint && isPlainObject(endpoint.headers)
      ? (endpoint.headers as Record<string, unknown>)
      : {};

  let request_body: Record<string, unknown> = {};
  if (isPlainObject(raw.request_body)) {
    request_body = raw.request_body;
  } else if (isPlainObject(raw.requestBody)) {
    request_body = raw.requestBody;
  } else if (endpoint && isPlainObject(endpoint.body)) {
    request_body = endpoint.body as Record<string, unknown>;
  }

  const sample_response =
    raw.sample_response ?? raw.sampleResponse ?? raw.response ?? null;

  const timeout = Number(raw.timeout ?? 30) || 30;

  const salesforce_sobject = String(
    raw.salesforce_sobject ?? raw.salesforceSobject ?? "Audit_Log__c",
  ).trim();

  const api_version = String(raw.api_version ?? raw.apiVersion ?? "v64.0").trim();

  return {
    ok: true,
    value: {
      service_name,
      api_url,
      request_method,
      headers,
      request_body,
      sample_response,
      timeout,
      salesforce_sobject,
      api_version,
    },
  };
}

function safeSfFieldSuffix(key: string): string {
  const s = key.replace(/[^a-zA-Z0-9_]/g, "_");
  const base = s.length > 0 ? s : "Field";
  return base.length > 37 ? base.slice(0, 37) : base;
}

/**
 * Builds Composite `body` from sample_response: primitives use ((Name.key)),
 * nested values use serializeJson(((Name.key))).
 */
export function buildSfdcCompositeBody(
  serviceName: string,
  sampleResponse: unknown,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  if (sampleResponse === null || sampleResponse === undefined) {
    body.Payload__c = `{{serializeJson(((${serviceName})))}}`;
    return body;
  }

  if (typeof sampleResponse !== "object") {
    body.Value__c = `(( ${serviceName} ))`.replace(/\s/g, "");
    return body;
  }

  if (Array.isArray(sampleResponse)) {
    body.Items__c = `{{serializeJson(((${serviceName})))}}`;
    return body;
  }

  const o = sampleResponse as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length === 0) {
    body.Payload__c = `{{serializeJson(((${serviceName})))}}`;
    return body;
  }

  for (const k of keys) {
    const v = o[k];
    const field = `${safeSfFieldSuffix(k)}__c`;
    if (v !== null && typeof v === "object") {
      body[field] = `{{serializeJson(((${serviceName}.${k})))}}`;
    } else {
      body[field] = `(( ${serviceName}.${k} ))`.replace(/\s/g, "");
    }
  }

  return body;
}

export type GeneratedPair = {
  serviceConfiguration: Omit<ServiceConfiguration, "id"> & { id: number };
  sfdcMapping: Omit<ServiceSfdcFieldMapping, "id"> & { id: number };
};

export function generateFromSample(
  input: SampleApiInput,
  ids: { esaId: number; sfdcId: number },
  timestamps: { created_date: string; created_by: string },
): GeneratedPair {
  const { service_name } = input;
  const sc: ServiceConfiguration = {
    id: ids.esaId,
    service_name,
    api_url: input.api_url,
    headers: input.headers,
    request_body: input.request_body,
    request_method: input.request_method,
    response_body: {},
    send_response: false,
    timeout: input.timeout,
    additional_config: {},
    created_date: timestamps.created_date,
    created_by: timestamps.created_by,
    modified_date: null,
    modified_by: null,
    is_deleted: false,
  };

  const compositeUrl = `/services/data/${input.api_version}/sobjects/${input.salesforce_sobject}`;
  const refId = `${service_name}_${input.salesforce_sobject}_Post`.replace(
    /[^a-zA-Z0-9_]/g,
    "_",
  );

  const sfdc: ServiceSfdcFieldMapping = {
    id: ids.sfdcId,
    service_name,
    request_body: [
      {
        url: compositeUrl,
        method: "POST",
        referenceId: refId,
        merge: "false",
        body: buildSfdcCompositeBody(service_name, input.sample_response),
      },
    ],
    created_date: timestamps.created_date,
    created_by: timestamps.created_by,
    modified_date: null,
    modified_by: null,
    is_deleted: false,
  };

  return { serviceConfiguration: sc, sfdcMapping: sfdc };
}

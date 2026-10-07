/**
 * Server-only Salesforce REST auth (OAuth password flow) + cached access token.
 * Credentials come from env — never expose to the browser.
 */

/** @type {{ accessToken: string; instanceUrl: string; expiresAtMs: number } | null} */
let tokenCache = null;

function envTrim(k) {
  const v = process.env[k];
  if (v == null) return "";
  return String(v).trim();
}

/** Shown when OAuth env is incomplete (password flow). */
export const SALESFORCE_ENV_HINT =
  "Set SALESFORCE_CLIENT_ID, SALESFORCE_CLIENT_SECRET, SALESFORCE_USERNAME, SALESFORCE_PASSWORD, and SALESFORCE_TOKEN_URL (or SALESFORCE_BASE_URL) in server/.env, then restart the API — see server/.env.example.";

/**
 * Resolve token URL: SALESFORCE_TOKEN_URL, or SALESFORCE_LOGIN_URL + /services/oauth2/token,
 * or SALESFORCE_BASE_URL trimmed + /services/oauth2/token.
 */
export function resolveSalesforceTokenUrl() {
  const direct = envTrim("SALESFORCE_TOKEN_URL");
  if (direct) return direct;
  let base = envTrim("SALESFORCE_LOGIN_URL") || envTrim("SALESFORCE_BASE_URL");
  if (!base) return "";
  base = base.replace(/\/$/, "");
  if (base.endsWith("/services/oauth2/token")) return base;
  return `${base}/services/oauth2/token`;
}

export function readSalesforceConfig() {
  const clientId = envTrim("SALESFORCE_CLIENT_ID");
  const clientSecret = envTrim("SALESFORCE_CLIENT_SECRET");
  const username = envTrim("SALESFORCE_USERNAME");
  const password = envTrim("SALESFORCE_PASSWORD");
  const securityToken = envTrim("SALESFORCE_SECURITY_TOKEN");
  let apiVersion = envTrim("SALESFORCE_API_VERSION") || "v64.0";
  if (!/^v\d/i.test(apiVersion)) apiVersion = `v${apiVersion}`;
  const tokenUrl = resolveSalesforceTokenUrl();
  const configured = Boolean(
    clientId && clientSecret && username && password && tokenUrl,
  );
  return {
    configured,
    clientId,
    clientSecret,
    username,
    password,
    securityToken,
    apiVersion,
    tokenUrl,
  };
}

function maskUsername(u) {
  if (!u) return "";
  const at = u.indexOf("@");
  if (at <= 1) return "***";
  return `${u[0]}***${u.slice(at)}`;
}

/**
 * @returns {{ ok: true, instanceUrl: string, usernameMasked: string, apiVersion: string } | { ok: false, error: string }}
 */
export async function salesforcePing() {
  const cfg = readSalesforceConfig();
  if (!cfg.configured) {
    return {
      ok: false,
      error: `Salesforce env not set. ${SALESFORCE_ENV_HINT}`,
    };
  }
  try {
    const { accessToken, instanceUrl } = await getAccessTokenCached();
    const ver = cfg.apiVersion;
    const r = await fetch(
      `${instanceUrl.replace(/\/$/, "")}/services/data/${ver}/limits`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      },
    );
    if (!r.ok) {
      const t = await r.text();
      let msg = `HTTP ${r.status}`;
      try {
        const j = JSON.parse(t);
        if (Array.isArray(j) && j[0]?.message) msg = j[0].message;
        else if (j.message) msg = j.message;
      } catch {
        if (t) msg = t.slice(0, 200);
      }
      return { ok: false, error: msg };
    }
    return {
      ok: true,
      instanceUrl,
      usernameMasked: maskUsername(cfg.username),
      apiVersion: cfg.apiVersion,
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function getAccessTokenCached() {
  const now = Date.now();
  if (
    tokenCache &&
    tokenCache.accessToken &&
    tokenCache.instanceUrl &&
    now < tokenCache.expiresAtMs - 60_000
  ) {
    return {
      accessToken: tokenCache.accessToken,
      instanceUrl: tokenCache.instanceUrl,
    };
  }

  const cfg = readSalesforceConfig();
  if (!cfg.configured) {
    throw new Error(`Salesforce is not configured. ${SALESFORCE_ENV_HINT}`);
  }

  const form = new URLSearchParams();
  form.set("grant_type", "password");
  form.set("client_id", cfg.clientId);
  form.set("client_secret", cfg.clientSecret);
  form.set("username", cfg.username);
  form.set("password", cfg.password + (cfg.securityToken || ""));

  const resp = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      resp.ok ? "Invalid token response" : `Auth failed: ${text.slice(0, 200)}`,
    );
  }

  if (!resp.ok) {
    const msg =
      data.error_description ||
      data.message ||
      data.error ||
      `HTTP ${resp.status}`;
    throw new Error(String(msg));
  }

  const accessToken = data.access_token;
  const instanceUrl = String(data.instance_url || "").replace(/\/$/, "");
  const expiresIn = Number(data.expires_in) || 7200;

  if (!accessToken || !instanceUrl) {
    throw new Error("Token response missing access_token or instance_url");
  }

  tokenCache = {
    accessToken,
    instanceUrl,
    expiresAtMs: now + expiresIn * 1000,
  };

  return { accessToken, instanceUrl };
}

const SOBJECT_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;

export function assertSafeSObjectName(name) {
  const n = String(name || "").trim();
  if (!n || n.length > 120 || !SOBJECT_NAME_RE.test(n)) {
    throw new Error("Invalid SObject API name");
  }
  return n;
}

/**
 * @param {string} sobject
 * @returns {Promise<{ name: string; type: string; label: string; custom: boolean }[]>}
 */
export async function describeSObject(sobject) {
  const safe = assertSafeSObjectName(sobject);
  const cfg = readSalesforceConfig();
  if (!cfg.configured) {
    throw new Error(`Salesforce is not configured. ${SALESFORCE_ENV_HINT}`);
  }
  const { accessToken, instanceUrl } = await getAccessTokenCached();
  const ver = cfg.apiVersion;
  const url = `${instanceUrl}/services/data/${ver}/sobjects/${encodeURIComponent(safe)}/describe`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const text = await r.text();
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = JSON.parse(text);
      if (Array.isArray(j) && j[0]?.message) msg = j[0].message;
      else if (j.message) msg = j.message;
    } catch {
      if (text) msg = text.slice(0, 300);
    }
    throw new Error(msg);
  }
  const data = JSON.parse(text);
  const fields = Array.isArray(data.fields) ? data.fields : [];
  return fields.map((f) => ({
    name: String(f.name || ""),
    type: String(f.type || ""),
    label: String(f.label || ""),
    custom: Boolean(f.custom),
  }));
}

/**
 * Global SObject catalog (REST GET …/sobjects/) — API names + labels for mapper autofill.
 * @returns {Promise<{ name: string; label: string }[]>}
 */
export async function listSObjectsMetadata() {
  const cfg = readSalesforceConfig();
  if (!cfg.configured) {
    throw new Error(`Salesforce is not configured. ${SALESFORCE_ENV_HINT}`);
  }
  const { accessToken, instanceUrl } = await getAccessTokenCached();
  const ver = cfg.apiVersion;
  const base = instanceUrl.replace(/\/$/, "");
  const url = `${base}/services/data/${ver}/sobjects/`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const text = await r.text();
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = JSON.parse(text);
      if (Array.isArray(j) && j[0]?.message) msg = j[0].message;
      else if (j.message) msg = j.message;
    } catch {
      if (text) msg = text.slice(0, 300);
    }
    throw new Error(msg);
  }
  const data = JSON.parse(text);
  const raw = Array.isArray(data.sobjects) ? data.sobjects : [];
  const out = [];
  for (const s of raw) {
    const name = String(s.name || "");
    if (!name) continue;
    out.push({
      name,
      label: String(s.label || name),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

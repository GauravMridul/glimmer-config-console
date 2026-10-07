/**
 * Mirrors server/configValidation.mjs so local (browser) saves enforce the same ESA / Decision Manager rules.
 */
import type {
  PartnerServiceMapping,
  ServiceConfiguration,
  ServiceSfdcFieldMapping,
} from "@/types/models";
import { validatePartnerSequence } from "@/lib/partnerSequenceValidation";

const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

const SERVICE_NAME_RE = /^[\w\s.-]+$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

export function validateServiceConfiguration(
  r: ServiceConfiguration,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  const name = r.service_name.trim();
  if (!name) errors.push("service_name is required.");
  else if (name.length > 255)
    errors.push("service_name must be at most 255 characters (ESA schema).");
    else if (!SERVICE_NAME_RE.test(name))
      errors.push(
        "service_name must use letters, numbers, spaces, underscore, hyphen, or dot (ESA guide).",
      );

  const apiUrl = r.api_url.trim();
  if (!apiUrl) errors.push("api_url is required.");
  else if (apiUrl.length > 512)
    errors.push("api_url must be at most 512 characters (ESA schema).");

  const method = r.request_method.trim().toUpperCase();
  if (!r.request_method.trim()) errors.push("request_method is required.");
  else if (!HTTP_METHODS.has(method))
    errors.push(
      `request_method must be a standard HTTP verb (e.g. GET, POST, PUT, PATCH, DELETE); got "${r.request_method}".`,
    );

  const timeout = Number(r.timeout ?? 0);
  if (!Number.isFinite(timeout) || timeout < 0 || timeout > 3600) {
    errors.push("timeout must be a number from 0 to 3600 seconds (ESA guide; 0 = default).");
  }

  if (!isPlainObject(r.headers)) errors.push("headers must be a JSON object.");
  if (!isPlainObject(r.response_body)) errors.push("response_body must be a JSON object.");
  if (!isPlainObject(r.additional_config))
    errors.push("additional_config must be a JSON object.");
  const rb = r.request_body;
  if (rb != null && typeof rb !== "object") {
    errors.push("request_body must be JSON (object or array).");
  }

  return { ok: errors.length === 0, errors };
}

export function validateSfdcMapping(
  r: ServiceSfdcFieldMapping,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  const sn = r.service_name.trim();
  if (!sn) errors.push("service_name is required.");
  else if (sn.length > 255)
    errors.push("service_name must be at most 255 characters.");
  else if (!SERVICE_NAME_RE.test(sn))
    errors.push(
      "service_name must use letters, numbers, spaces, underscore, hyphen, or dot (matches ESA service_name).",
    );

  const body = r.request_body;
  if (!Array.isArray(body)) {
    errors.push(
      "request_body must be a JSON array of Composite sub-requests (Decision Manager guide).",
    );
    return { ok: false, errors };
  }

  body.forEach((raw, i) => {
    const p = `request_body[${i}]`;
    if (!isPlainObject(raw)) {
      errors.push(`${p} must be an object.`);
      return;
    }
    const item = raw as Record<string, unknown>;
    const url = item.url;
    const method = item.method;
    const ref = item.referenceId;
    if (typeof url !== "string" || !url.trim()) {
      errors.push(`${p}.url is required (string, Composite path).`);
    }
    if (typeof method !== "string" || !String(method).trim()) {
      errors.push(`${p}.method is required (e.g. POST, PATCH).`);
    }
    if (typeof ref !== "string" || !ref.trim()) {
      errors.push(`${p}.referenceId is required (unique within the Composite call).`);
    }
    if (item.body != null && !isPlainObject(item.body)) {
      errors.push(`${p}.body must be a JSON object when present.`);
    }
    if (item.merge != null) {
      const m = String(item.merge).toLowerCase();
      if (m !== "true" && m !== "false") {
        errors.push(`${p}.merge must be "true" or "false" (Decision Manager guide).`);
      }
    }
    if (item.arrayPath != null && typeof item.arrayPath !== "string") {
      errors.push(`${p}.arrayPath must be a string when present.`);
    }
  });

  return { ok: errors.length === 0, errors };
}

export function validatePartnerMapping(
  r: PartnerServiceMapping,
  serviceConfigurations: ServiceConfiguration[],
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!r.name.trim()) errors.push("name is required.");
  if (!r.partner_name.trim()) errors.push("partner_name is required.");
  if (!r.stage.trim()) errors.push("stage is required.");
  const seq = r.service_sequence_string.trim();
  if (!seq) errors.push("service_sequence_string is required.");

  if (errors.length) return { ok: false, errors };

  const v = validatePartnerSequence(seq, serviceConfigurations);
  if (v.hasErrors) {
    for (const issue of v.issues) {
      if (issue.severity === "error") errors.push(issue.message);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function formatValidationErrors(errors: string[]): string {
  return errors.length === 1
    ? errors[0]
    : `Validation failed:\n${errors.map((e) => `• ${e}`).join("\n")}`;
}

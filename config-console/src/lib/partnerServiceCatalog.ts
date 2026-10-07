import type { ServiceConfiguration } from "@/types/models";

/** Minimal ESA row for UI (dropdown labels) when only id + service_name are known. */
export function minimalServiceStub(
  id: number,
  service_name: string,
): ServiceConfiguration {
  return {
    id,
    service_name,
    api_url: "",
    headers: {},
    request_body: {},
    request_method: "POST",
    response_body: {},
    send_response: false,
    timeout: 0,
    additional_config: {},
    created_date: "",
    created_by: "",
    modified_date: null,
    modified_by: null,
    is_deleted: false,
  };
}

/**
 * Merges live `service_configuration` rows with a static id → service_name catalog (e.g. from
 * a DB export). Live rows win when the same id exists; catalog fills ids missing from the bundle.
 */
export function mergeServiceCatalogForPartnerUi(
  live: ServiceConfiguration[],
  catalog: ReadonlyArray<{ id: number; service_name: string }>,
): ServiceConfiguration[] {
  const byId = new Map<number, ServiceConfiguration>();
  for (const r of live) {
    if (!r.is_deleted) {
      byId.set(r.id, r);
    }
  }
  for (const c of catalog) {
    const id = Number(c.id);
    if (!Number.isFinite(id) || !c.service_name?.trim()) continue;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, minimalServiceStub(id, c.service_name.trim()));
    } else if (!existing.service_name?.trim()) {
      byId.set(id, { ...existing, service_name: c.service_name.trim() });
    }
  }
  return [...byId.values()];
}

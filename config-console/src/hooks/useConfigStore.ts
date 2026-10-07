import { useCallback, useEffect, useState } from "react";
import * as api from "@/api/backend";
import {
  loadBundle,
  nowIso,
  saveBundle,
  type ConfigBundle,
} from "@/lib/storage";
import {
  formatValidationErrors,
  validatePartnerMapping,
  validateServiceConfiguration,
  validateSfdcMapping,
} from "@/lib/configValidation";
import type {
  PartnerServiceMapping,
  ServiceConfiguration,
  ServiceSfdcFieldMapping,
} from "@/types/models";

function nextId<T extends { id: number }>(rows: T[]): number {
  if (rows.length === 0) return 1;
  return Math.max(...rows.map((r) => r.id)) + 1;
}

function emptyBundle(): ConfigBundle {
  return {
    serviceConfigurations: [],
    partnerMappings: [],
    sfdcMappings: [],
  };
}

export function useConfigStore() {
  const apiMode = api.shouldUseApi();
  const [bundle, setBundle] = useState<ConfigBundle>(() =>
    apiMode ? emptyBundle() : loadBundle(),
  );
  const [loading, setLoading] = useState(apiMode);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!api.shouldUseApi()) return;
    setLoading(true);
    setError(null);
    try {
      const b = await api.fetchConfig();
      setBundle(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!api.shouldUseApi()) return;
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (api.shouldUseApi()) return;
    saveBundle(bundle);
  }, [bundle]);

  const upsertServiceConfiguration = useCallback(
    async (row: ServiceConfiguration) => {
      if (api.shouldUseApi()) {
        try {
          setError(null);
          await api.upsertServiceConfiguration(row);
          await refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          throw e;
        }
        return;
      }
      setError(null);
      const vr = validateServiceConfiguration(row);
      if (!vr.ok) {
        const msg = formatValidationErrors(vr.errors);
        setError(msg);
        throw new Error(msg);
      }
      setBundle((b) => {
        const assignedId =
          row.id === 0 ? nextId(b.serviceConfigurations) : row.id;
        const next: ServiceConfiguration = {
          ...row,
          id: assignedId,
          modified_date: nowIso(),
          modified_by: "console",
        };
        const ix = b.serviceConfigurations.findIndex((x) => x.id === assignedId);
        const list = [...b.serviceConfigurations];
        if (ix >= 0) list[ix] = next;
        else list.push(next);
        return { ...b, serviceConfigurations: list };
      });
    },
    [refresh],
  );

  const removeServiceConfiguration = useCallback(
    async (id: number) => {
      if (api.shouldUseApi()) {
        try {
          setError(null);
          await api.deleteServiceConfiguration(id);
          await refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          throw e;
        }
        return;
      }
      setBundle((b) => ({
        ...b,
        serviceConfigurations: b.serviceConfigurations.map((x) =>
          x.id === id ? { ...x, is_deleted: true, modified_date: nowIso() } : x,
        ),
      }));
    },
    [refresh],
  );

  const upsertPartnerMapping = useCallback(
    async (row: PartnerServiceMapping) => {
      if (api.shouldUseApi()) {
        try {
          setError(null);
          await api.upsertPartnerMapping(row);
          await refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          throw e;
        }
        return;
      }
      setError(null);
      const vr = validatePartnerMapping(
        row,
        bundle.serviceConfigurations.filter((c) => !c.is_deleted),
      );
      if (!vr.ok) {
        const msg = formatValidationErrors(vr.errors);
        setError(msg);
        throw new Error(msg);
      }
      setBundle((b) => {
        const assignedId = row.id === 0 ? nextId(b.partnerMappings) : row.id;
        const next: PartnerServiceMapping = {
          ...row,
          id: assignedId,
          modified_date: nowIso(),
          modified_by: "console",
        };
        const ix = b.partnerMappings.findIndex((x) => x.id === assignedId);
        const list = [...b.partnerMappings];
        if (ix >= 0) list[ix] = next;
        else list.push(next);
        return { ...b, partnerMappings: list };
      });
    },
    [refresh, bundle.serviceConfigurations],
  );

  const removePartnerMapping = useCallback(
    async (id: number) => {
      if (api.shouldUseApi()) {
        try {
          setError(null);
          await api.deletePartnerMapping(id);
          await refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          throw e;
        }
        return;
      }
      setBundle((b) => ({
        ...b,
        partnerMappings: b.partnerMappings.map((x) =>
          x.id === id ? { ...x, is_deleted: true, modified_date: nowIso() } : x,
        ),
      }));
    },
    [refresh],
  );

  const upsertSfdcMapping = useCallback(
    async (row: ServiceSfdcFieldMapping) => {
      if (api.shouldUseApi()) {
        try {
          setError(null);
          await api.upsertSfdcMapping(row);
          await refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          throw e;
        }
        return;
      }
      setError(null);
      const vr = validateSfdcMapping(row);
      if (!vr.ok) {
        const msg = formatValidationErrors(vr.errors);
        setError(msg);
        throw new Error(msg);
      }
      setBundle((b) => {
        const assignedId = row.id === 0 ? nextId(b.sfdcMappings) : row.id;
        const next: ServiceSfdcFieldMapping = {
          ...row,
          id: assignedId,
          modified_date: nowIso(),
          modified_by: "console",
        };
        const ix = b.sfdcMappings.findIndex((x) => x.id === assignedId);
        const list = [...b.sfdcMappings];
        if (ix >= 0) list[ix] = next;
        else list.push(next);
        return { ...b, sfdcMappings: list };
      });
    },
    [refresh],
  );

  const removeSfdcMapping = useCallback(
    async (id: number) => {
      if (api.shouldUseApi()) {
        try {
          setError(null);
          await api.deleteSfdcMapping(id);
          await refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          throw e;
        }
        return;
      }
      setBundle((b) => ({
        ...b,
        sfdcMappings: b.sfdcMappings.map((x) =>
          x.id === id ? { ...x, is_deleted: true, modified_date: nowIso() } : x,
        ),
      }));
    },
    [refresh],
  );

  const createEmptyServiceConfiguration = useCallback((): ServiceConfiguration => {
    const t = nowIso();
    return {
      id: 0,
      service_name: "",
      api_url: "",
      headers: {},
      request_body: {},
      request_method: "POST",
      response_body: {},
      send_response: false,
      timeout: 30,
      additional_config: {},
      created_date: t,
      created_by: "console",
      modified_date: null,
      modified_by: null,
      is_deleted: false,
    };
  }, []);

  const createEmptyPartnerMapping = useCallback((): PartnerServiceMapping => {
    const t = nowIso();
    return {
      id: 0,
      name: "",
      partner_name: "",
      program_type: "",
      business_type: "",
      sourcing_program: "",
      loan_category: "",
      customer_type: "",
      product_line: "",
      stage: "",
      service_sequence_string: "",
      created_date: t,
      created_by: "console",
      modified_date: null,
      modified_by: null,
      is_deleted: false,
    };
  }, []);

  const createEmptySfdcMapping = useCallback((): ServiceSfdcFieldMapping => {
    const t = nowIso();
    return {
      id: 0,
      service_name: "",
      request_body: [],
      created_date: t,
      created_by: "console",
      modified_date: null,
      modified_by: null,
      is_deleted: false,
    };
  }, []);

  return {
    bundle,
    setBundle,
    apiMode,
    loading,
    error,
    clearError: () => setError(null),
    refresh,
    upsertServiceConfiguration,
    removeServiceConfiguration,
    upsertPartnerMapping,
    removePartnerMapping,
    upsertSfdcMapping,
    removeSfdcMapping,
    createEmptyServiceConfiguration,
    createEmptyPartnerMapping,
    createEmptySfdcMapping,
  };
}

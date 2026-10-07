import MiniSearch from "minisearch";
import type { ConfigBundle } from "@/lib/storage";
import { ESA_CUSTOM_FUNCTIONS } from "@/lib/esaCustomFunctionsReference";
import { ESA_TRANSFORM_OPERATIONS } from "@/lib/esaTransformReference";
import { ESA_ARRAY_OPERATIONS } from "@/lib/esaArrayReference";
import { DM_CUSTOM_FUNCTIONS } from "@/lib/dmCustomFunctionsReference";
import { camelToWords } from "@/lib/customFunctionSemanticSearch";

export type UniversalSearchHit = {
  id: string;
  category: string;
  title: string;
  subtitle?: string;
  path: string;
};

type SearchDoc = {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  blob: string;
};

function pageHit(
  id: string,
  category: string,
  title: string,
  subtitle: string,
  path: string,
  blob: string,
): { hit: UniversalSearchHit; doc: SearchDoc } {
  return {
    hit: { id, category, title, subtitle, path },
    doc: {
      id,
      title,
      subtitle,
      category,
      blob: `${blob} ${path} ${title} ${subtitle}`,
    },
  };
}

function buildStaticHits(): { hit: UniversalSearchHit; doc: SearchDoc }[] {
  return [
    pageHit(
      "nav-overview",
      "Page",
      "Overview",
      "API alignment & service names",
      "/",
      "dashboard home apis available partner sequences gaps alignment score",
    ),
    pageHit(
      "nav-smart",
      "Page",
      "Import",
      "Sample API → ESA + SFDC",
      "/smart",
      "import json sample load create rows",
    ),
    pageHit(
      "nav-esa-mapper",
      "Page",
      "ESA mapper",
      "JSON / curl → request_body",
      "/esa-auto-mapper",
      "map flatten paths request body template external api mapping",
    ),
    pageHit(
      "nav-sfdc-mapper",
      "Page",
      "SFDC mapper",
      "Response → Composite stamping",
      "/sfdc-auto-mapper",
      "salesforce composite field mapping arrayPath data stamping",
    ),
    pageHit(
      "nav-esa",
      "Page",
      "External APIs",
      "service_configuration",
      "/esa",
      "http url headers request_body timeout service_configuration esa",
    ),
    pageHit(
      "nav-expressions",
      "Page",
      "Custom Functions",
      "ESA CUSTOM, TRANSFORM, ARRAY, DM govaluate",
      "/expressions",
      "custom functions esa custom transform array transform-only merge map filter chunk replace_regex substring dm expression govaluate serializeJson formatDate template helpers external-service-adapter decision-manager",
    ),
    pageHit(
      "nav-partners",
      "Page",
      "Partners and Stages",
      "partner_service_mapping",
      "/partners",
      "sequence journey stage program workflow service ids",
    ),
    pageHit(
      "nav-sfdc",
      "Page",
      "Data Stamping",
      "service_sfdc_field_mapping",
      "/sfdc",
      "salesforce composite request_body stamping decision manager",
    ),
    pageHit(
      "nav-test",
      "Page",
      "Test sequence",
      "process-sequence/v2 proxy",
      "/test",
      "esa process sequence test curl correlation",
    ),
    pageHit(
      "nav-demo",
      "Page",
      "Demo",
      "Scenarios & guided tour",
      "/demo",
      "tutorial walkthrough sample data training sfdc mapper multi-object composite",
    ),
  ];
}

function buildDynamicHits(bundle: ConfigBundle): { hit: UniversalSearchHit; doc: SearchDoc }[] {
  const out: { hit: UniversalSearchHit; doc: SearchDoc }[] = [];

  for (const s of bundle.serviceConfigurations) {
    if (s.is_deleted) continue;
    const id = `esa-row-${s.id}`;
    const title = s.service_name.trim() || `ESA #${s.id}`;
    const subtitle = `id ${s.id} · ${s.request_method} · ${s.api_url.slice(0, 64)}${s.api_url.length > 64 ? "…" : ""}`;
    const blob = `${title} ${s.api_url} ${s.request_method} ${s.id} external api service_configuration http`;
    out.push({
      hit: {
        id,
        category: "External API",
        title,
        subtitle,
        path: `/esa?id=${s.id}`,
      },
      doc: { id, title, subtitle, category: "External API", blob },
    });
  }

  for (const m of bundle.sfdcMappings) {
    if (m.is_deleted) continue;
    const id = `sfdc-row-${m.id}`;
    const title = m.service_name.trim() || `SFDC #${m.id}`;
    const subtitle = `id ${m.id} · Composite templates`;
    const blob = `${title} ${m.id} data stamping salesforce composite service_sfdc_field_mapping`;
    out.push({
      hit: {
        id,
        category: "Data Stamping",
        title,
        subtitle,
        path: `/sfdc?id=${m.id}`,
      },
      doc: { id, title, subtitle, category: "Data Stamping", blob },
    });
  }

  for (const p of bundle.partnerMappings) {
    if (p.is_deleted) continue;
    const id = `partner-row-${p.id}`;
    const title = (p.name ?? "").trim() || `Partner mapping #${p.id}`;
    const subtitle = `${p.partner_name} · ${p.stage} · id ${p.id}`;
    const blob = [
      title,
      p.partner_name,
      p.stage,
      p.program_type,
      p.service_sequence_string,
      String(p.id),
      "partner journey sequence stages",
    ].join(" ");
    out.push({
      hit: {
        id,
        category: "Partner mapping",
        title,
        subtitle,
        path: `/partners?id=${p.id}`,
      },
      doc: { id, title, subtitle, category: "Partner mapping", blob },
    });
  }

  for (const f of ESA_CUSTOM_FUNCTIONS) {
    const id = `esa-fn-${f.name}`;
    const q = encodeURIComponent(f.name);
    out.push({
      hit: {
        id,
        category: "ESA CUSTOM",
        title: f.name,
        subtitle: f.summary.slice(0, 72) + (f.summary.length > 72 ? "…" : ""),
        path: `/expressions?esa=${q}#esa-custom`,
      },
      doc: {
        id,
        title: f.name,
        subtitle: f.summary,
        category: "ESA CUSTOM",
        blob: `${f.name} ${camelToWords(f.name)} ${f.summary} ${f.before} custom template`,
      },
    });
  }

  for (const t of ESA_TRANSFORM_OPERATIONS) {
    const id = `esa-transform-${t.name}`;
    const q = encodeURIComponent(t.name);
    out.push({
      hit: {
        id,
        category: "ESA TRANSFORM",
        title: t.name,
        subtitle: t.summary.slice(0, 72) + (t.summary.length > 72 ? "…" : ""),
        path: `/expressions?esaTransform=${q}#esa-transform`,
      },
      doc: {
        id,
        title: t.name,
        subtitle: t.summary,
        category: "ESA TRANSFORM",
        blob: `${t.name} ${camelToWords(t.name)} ${t.summary} ${t.before} transform template`,
      },
    });
  }

  for (const a of ESA_ARRAY_OPERATIONS) {
    const id = `esa-array-${a.name}`;
    const q = encodeURIComponent(a.name);
    out.push({
      hit: {
        id,
        category: "ESA ARRAY",
        title: a.name,
        subtitle: a.summary.slice(0, 72) + (a.summary.length > 72 ? "…" : ""),
        path: `/expressions?esaArray=${q}#esa-array`,
      },
      doc: {
        id,
        title: a.name,
        subtitle: a.summary,
        category: "ESA ARRAY",
        blob: `${a.name} ${camelToWords(a.name)} ${a.summary} ${a.before} array template transform-only`,
      },
    });
  }

  for (const f of DM_CUSTOM_FUNCTIONS) {
    const id = `dm-fn-${f.name}`;
    const q = encodeURIComponent(f.name);
    out.push({
      hit: {
        id,
        category: "DM expression",
        title: f.name,
        subtitle: f.summary.slice(0, 72) + (f.summary.length > 72 ? "…" : ""),
        path: `/expressions?dm=${q}#dm-expressions`,
      },
      doc: {
        id,
        title: f.name,
        subtitle: f.summary,
        category: "DM expression",
        blob: `${f.name} ${camelToWords(f.name)} ${f.summary} ${f.before} govaluate`,
      },
    });
  }

  return out;
}

export function createUniversalSearch(bundle: ConfigBundle): (query: string) => UniversalSearchHit[] {
  const staticHits = buildStaticHits().map((p) => p.hit);
  const pairs = [...buildStaticHits(), ...buildDynamicHits(bundle)];
  const byId = new Map<string, UniversalSearchHit>();
  const mini = new MiniSearch<SearchDoc>({
    fields: ["title", "subtitle", "category", "blob"],
    storeFields: ["id"],
    searchOptions: {
      boost: { title: 2.5, subtitle: 1.8, category: 0.6, blob: 1 },
      prefix: true,
      fuzzy: 0.1,
    },
  });
  for (const { hit, doc } of pairs) {
    byId.set(hit.id, hit);
    mini.add({
      id: doc.id,
      title: doc.title,
      subtitle: doc.subtitle,
      category: doc.category,
      blob: doc.blob,
    });
  }

  return (query: string) => {
    const q = query.trim();
    if (!q) {
      return staticHits;
    }
    const hits = mini.search(q);
    const out: UniversalSearchHit[] = [];
    const seen = new Set<string>();
    for (const h of hits) {
      const id = String(h.id);
      if (seen.has(id)) continue;
      seen.add(id);
      const hit = byId.get(id);
      if (hit) out.push(hit);
    }
    if (out.length > 0) return out;
    const low = q.toLowerCase();
    for (const { hit, doc } of pairs) {
      if (
        hit.title.toLowerCase().includes(low) ||
        (hit.subtitle?.toLowerCase().includes(low) ?? false) ||
        doc.blob.toLowerCase().includes(low)
      ) {
        out.push(hit);
      }
    }
    return out;
  };
}

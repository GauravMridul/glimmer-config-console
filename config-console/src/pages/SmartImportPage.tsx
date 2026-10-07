import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useConfig } from "@/context/ConfigContext";
import { TextArea } from "@/components/Field";
import { innerPanelClass, PageHero, PageStack, SemanticSearchField } from "@/components/PageChrome";
import {
  getDefaultSampleJson,
  normalizeSampleInput,
  generateFromSample,
} from "@/lib/sampleApiImport";
import { parseJsonObject, stringifyJson } from "@/lib/json";
import { nowIso } from "@/lib/storage";
import type { ServiceConfiguration, ServiceSfdcFieldMapping } from "@/types/models";
import { useSemanticRowFilter } from "@/lib/semanticTableSearch";
const PdfApiDocImportPanel = lazy(() =>
  import("@/components/PdfApiDocImportPanel").then((m) => ({ default: m.PdfApiDocImportPanel })),
);

type PreviewRow = { id: string; title: string; subtitle: string; json: string };

function findEsaByName(
  rows: ServiceConfiguration[],
  name: string,
): ServiceConfiguration | undefined {
  return rows.find((r) => !r.is_deleted && r.service_name === name);
}

function findSfdcByName(
  rows: ServiceSfdcFieldMapping[],
  name: string,
): ServiceSfdcFieldMapping | undefined {
  return rows.find((r) => !r.is_deleted && r.service_name === name);
}

export function SmartImportPage() {
  const { bundle, upsertServiceConfiguration, upsertSfdcMapping } = useConfig();

  const [rawJson, setRawJson] = useState(() => getDefaultSampleJson());

  const parsed = useMemo(() => {
    const j = parseJsonObject(rawJson);
    if (!j.ok) return { ok: false as const, error: j.error };
    const n = normalizeSampleInput(j.value);
    if (!n.ok) return { ok: false as const, error: n.error };
    return { ok: true as const, input: n.value };
  }, [rawJson]);

  const preview = useMemo(() => {
    if (!parsed.ok) return null;
    const name = parsed.input.service_name;
    const esaExisting = findEsaByName(bundle.serviceConfigurations, name);
    const sfdcExisting = findSfdcByName(bundle.sfdcMappings, name);
    const t = nowIso();
    const gen = generateFromSample(
      parsed.input,
      { esaId: esaExisting?.id ?? 0, sfdcId: sfdcExisting?.id ?? 0 },
      { created_date: t, created_by: "smart-import" },
    );
    if (esaExisting) {
      gen.serviceConfiguration.created_date = esaExisting.created_date;
      gen.serviceConfiguration.created_by = esaExisting.created_by;
    }
    if (sfdcExisting) {
      gen.sfdcMapping.created_date = sfdcExisting.created_date;
      gen.sfdcMapping.created_by = sfdcExisting.created_by;
    }
    return gen;
  }, [parsed, bundle.serviceConfigurations, bundle.sfdcMappings]);

  const previewRows = useMemo((): PreviewRow[] => {
    if (!preview) return [];
    return [
      {
        id: "esa",
        title: "service_configuration (ESA)",
        subtitle: "HTTP execution",
        json: stringifyJson(preview.serviceConfiguration),
      },
      {
        id: "sfdc",
        title: "service_sfdc_field_mapping (Decision Manager)",
        subtitle: "Composite templates",
        json: stringifyJson(preview.sfdcMapping),
      },
    ];
  }, [preview]);

  const getPreviewDoc = useCallback((r: PreviewRow) => {
    return { id: r.id, text: [r.title, r.subtitle, r.json].join(" ") };
  }, []);
  const [previewSearch, setPreviewSearch, previewFiltered] = useSemanticRowFilter(
    previewRows,
    getPreviewDoc,
  );

  const apply = async () => {
    if (!preview) return;
    try {
      await upsertServiceConfiguration(preview.serviceConfiguration);
      await upsertSfdcMapping(preview.sfdcMapping);
    } catch {
      /* Layout shows API error */
    }
  };

  return (
    <PageStack>
      <PageHero
        eyebrow="Import"
        title="Sample API → ESA + Salesforce rows"
        titleClassName="text-2xl font-semibold tracking-tight text-ink"
        description={
          <>
            Paste a structured example of the API call and reply, or upload a PDF and let us suggest
            blocks to use. This creates or updates both the external API row and the Salesforce mapping
            for the same <span className="font-medium text-ink">service name</span>.
          </>
        }
      />

      <Suspense
        fallback={
          <p
            className={`${innerPanelClass} text-sm text-ink-muted`}
          >
            Loading PDF import…
          </p>
        }
      >
        <PdfApiDocImportPanel onApplySampleJson={setRawJson} />
      </Suspense>

      <div className={innerPanelClass}>
        <TextArea
          label="Sample API (JSON)"
          hint="Supports service_name, api_url, request_method, headers, request_body, sample_response, salesforce_sobject, api_version — see default example."
          rows={22}
          value={rawJson}
          onChange={(e) => setRawJson(e.target.value)}
        />
        {!parsed.ok ? (
          <p className="mt-3 text-sm text-warn">
            {(parsed as { ok: false; error: string }).error}
          </p>
        ) : null}
      </div>

      {parsed.ok && preview ? (
        <>
          <SemanticSearchField
            id="smart-import-preview-search"
            label="Filter preview cards"
            value={previewSearch}
            onChange={(e) => setPreviewSearch(e.target.value)}
            placeholder="Filter cards by any text in the preview…"
            footer={
              <>
                Showing <span className="tabular-nums font-medium text-ink">{previewFiltered.length}</span>{" "}
                of <span className="tabular-nums font-medium text-ink">{previewRows.length}</span> preview
                card(s)
              </>
            }
          />
          <div className="grid gap-6 lg:grid-cols-2">
            {previewFiltered.map((r) => (
              <PreviewCard key={r.id} title={r.title} subtitle={r.subtitle} json={r.json} />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={apply}
              className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-accent-hover"
            >
              Apply both rows
            </button>
            <Link
              to="/"
              className="text-sm text-accent hover:underline"
            >
              Open Overview to verify alignment →
            </Link>
            <Link
              to="/esa"
              className="text-sm text-ink-muted hover:text-ink hover:underline"
            >
              Edit External APIs
            </Link>
            <Link
              to="/sfdc"
              className="text-sm text-ink-muted hover:text-ink hover:underline"
            >
              Edit Data Stamping
            </Link>
          </div>
        </>
      ) : null}

      <section className={`${innerPanelClass} text-xs text-ink-muted`}>
        <p>
          <span className="font-medium text-ink">Tip:</span>{" "}
          <code className="font-mono">sample_response</code> shapes the SFDC Composite template.
          Partner sequences are separate—add the new service id under Partners and Stages when you
          need it in a journey.
        </p>
      </section>
    </PageStack>
  );
}

function PreviewCard({
  title,
  subtitle,
  json,
}: {
  title: string;
  subtitle: string;
  json: string;
}) {
  return (
    <div className={`flex flex-col ${innerPanelClass}`}>
      <p className="text-xs font-medium text-ink-muted">{subtitle}</p>
      <h3 className="mt-0.5 font-semibold text-ink">{title}</h3>
      <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-ink">
        {json}
      </pre>
    </div>
  );
}

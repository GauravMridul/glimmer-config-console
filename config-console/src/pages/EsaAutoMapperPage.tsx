import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  EsaCustomFunctionsHelpModal,
  EsaCustomFunctionsReferenceTrigger,
} from "@/components/EsaCustomFunctionsHelpModal";
import { MappingAutocompleteInput } from "@/components/MappingAutocompleteInput";
import { Modal } from "@/components/Modal";
import {
  DataTableShell,
  PageHero,
  PageStack,
  tableListHeadRowClass,
} from "@/components/PageChrome";

const panelClass = "rounded-lg border border-ink/8 bg-white/90 p-4";
import { TextArea } from "@/components/Field";
import { useConfig } from "@/context/ConfigContext";
import { parseJsonObject, stringifyJson } from "@/lib/json";
import {
  collectKeys,
  unflattenMappings,
  type FlattenMode,
} from "@/lib/flattenRequestBody";
import {
  buildCorpusIndex,
  corpusIndexFromJSON,
  getAllCorpusExpressions,
  getSuggestionsForPath,
  mergeCorpusIndexes,
  type CorpusIndexJSON,
} from "@/lib/mappingSuggestions";
import mappingCorpusSeed from "@/data/mappingCorpusSeed.json";
import { ESA_AUTO_MAPPER_SAMPLE_CURL } from "@/data/esaAutoMapperSampleCurl";
import { ESA_AUTO_MAPPER_SAMPLE_REQUEST_BODY } from "@/data/esaAutoMapperSampleRequestBody";
import { parseCurl, type ParsedCurlOk } from "@/lib/parseCurl";
import { validateServiceConfiguration } from "@/lib/configValidation";
import { useSemanticRowFilter } from "@/lib/semanticTableSearch";
import type { ServiceConfiguration } from "@/types/models";

/** Placeholder URL for new rows from this screen when the source has no URL. */
const ESA_PUSH_PLACEHOLDER_API_URL = "https://placeholder.invalid/";

type InputMode = "json" | "curl";

/** Last successful curl parse while in cURL mode — kept after switching to JSON so Push still sends api_url / headers / method to the DB. */
type CurlDbFields = {
  api_url: string;
  request_method: string;
  headers: Record<string, string>;
};

function headersForServiceRow(h: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(h)) {
    const key = k.trim();
    if (!key) continue;
    out[key] = String(val);
  }
  return out;
}

export function EsaAutoMapperPage() {
  const {
    bundle,
    apiMode,
    createEmptyServiceConfiguration,
    upsertServiceConfiguration,
    clearError,
    error,
  } = useConfig();
  const [inputMode, setInputMode] = useState<InputMode>("json");
  const [jsonInput, setJsonInput] = useState("");
  const [curlInput, setCurlInput] = useState("");
  const [mode, setMode] = useState<FlattenMode>("array-wildcards");
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [pushStep, setPushStep] = useState<0 | 1 | 2>(0);
  const [newServiceName, setNewServiceName] = useState("");
  const [confirmServiceName, setConfirmServiceName] = useState("");
  const [pushing, setPushing] = useState(false);
  const [pushBanner, setPushBanner] = useState<string | null>(null);
  const [curlDbFields, setCurlDbFields] = useState<CurlDbFields | null>(null);
  const [esaCustomHelpOpen, setEsaCustomHelpOpen] = useState(false);

  /** Capture api_url, headers, and method whenever a cURL command parses successfully (cleared when curl input is empty). */
  useEffect(() => {
    if (inputMode !== "curl") return;
    const t = curlInput.trim();
    if (!t) {
      setCurlDbFields(null);
      return;
    }
    const p = parseCurl(t);
    if (!p.ok) return;
    setCurlDbFields({
      api_url: p.url.trim(),
      request_method: p.method,
      headers: { ...p.headers },
    });
  }, [inputMode, curlInput]);

  const corpus = useMemo(() => {
    const live = buildCorpusIndex(bundle.serviceConfigurations);
    if (live.meta.leafPaths >= 100) return live;
    return mergeCorpusIndexes(
      corpusIndexFromJSON(mappingCorpusSeed as CorpusIndexJSON),
      live,
    );
  }, [bundle.serviceConfigurations]);

  /** Distinct template strings from loaded ESA configs (API/DB or local) + seed, for &lt;datalist&gt; autocomplete. */
  const mappingAutocompleteOptions = useMemo(
    () => getAllCorpusExpressions(corpus, 500),
    [corpus],
  );

  /** Always parse when text exists so URL/headers stay visible after switching to JSON mode. */
  const curlParsed = useMemo(() => {
    if (!curlInput.trim()) return null;
    return parseCurl(curlInput);
  }, [curlInput]);

  /** What to show in “URL & headers extracted” — prefer live parse; else last successful DB snapshot. */
  const curlUiDisplay = useMemo(():
    | { kind: "live"; p: ParsedCurlOk }
    | {
        kind: "saved";
        method: string;
        url: string;
        headers: Record<string, string>;
        parseError?: string;
      }
    | null => {
    if (curlParsed?.ok) {
      return { kind: "live", p: curlParsed };
    }
    if (curlDbFields) {
      return {
        kind: "saved",
        method: curlDbFields.request_method,
        url: curlDbFields.api_url,
        headers: curlDbFields.headers,
        parseError:
          curlParsed && !curlParsed.ok ? curlParsed.error : undefined,
      };
    }
    return null;
  }, [curlParsed, curlDbFields]);

  const parsed = useMemo(() => {
    if (inputMode === "json") {
      if (!jsonInput.trim()) return { ok: false as const, error: "Paste JSON first." };
      const j = parseJsonObject(jsonInput);
      if (!j.ok) return { ok: false as const, error: j.error };
      if (j.value === null || typeof j.value !== "object") {
        return { ok: false as const, error: "Root must be a JSON object." };
      }
      if (Array.isArray(j.value)) {
        return { ok: false as const, error: "Root must be a JSON object (not an array)." };
      }
      return { ok: true as const, value: j.value as Record<string, unknown> };
    }
    if (!curlInput.trim()) {
      return { ok: false as const, error: "Paste a curl command first." };
    }
    if (!curlParsed) {
      return { ok: false as const, error: "Paste a curl command first." };
    }
    if (!curlParsed.ok) {
      return { ok: false as const, error: curlParsed.error };
    }
    if (curlParsed.bodyJson === null) {
      return {
        ok: false as const,
        error:
          "No JSON object in the curl body. Use -d '{…}' (or --data) with a JSON object body.",
      };
    }
    if (typeof curlParsed.bodyJson !== "object" || Array.isArray(curlParsed.bodyJson)) {
      return {
        ok: false as const,
        error: "Root must be a JSON object (curl -d body must be a JSON object, not an array).",
      };
    }
    return {
      ok: true as const,
      value: curlParsed.bodyJson as Record<string, unknown>,
    };
  }, [inputMode, jsonInput, curlInput, curlParsed]);

  const rows = useMemo(() => {
    if (!parsed.ok) return [];
    return collectKeys(parsed.value, mode);
  }, [parsed, mode]);

  useEffect(() => {
    if (!parsed.ok) return;
    const paths = collectKeys(parsed.value, mode).map((r) => r.path);
    const pathSet = new Set(paths);
    setMappings((prev) => {
      const next = { ...prev };
      for (const p of paths) {
        if (next[p] === undefined) next[p] = "";
      }
      for (const k of Object.keys(next)) {
        if (!pathSet.has(k)) delete next[k];
      }
      return next;
    });
  }, [parsed, mode]);

  const getEsaMapperPathDoc = useCallback(
    (r: { path: string; sample: unknown; kind: string }) => {
      let sampleText = "";
      try {
        sampleText =
          typeof r.sample === "object" && r.sample !== null
            ? JSON.stringify(r.sample).slice(0, 3500)
            : String(r.sample ?? "");
      } catch {
        sampleText = "";
      }
      return {
        id: r.path,
        text: [r.path, r.kind, sampleText].join(" "),
      };
    },
    [],
  );
  const [pathFilter, setPathFilter, filteredRows] = useSemanticRowFilter(rows, getEsaMapperPathDoc);

  const exportJson = useMemo(() => {
    if (!parsed.ok) return "";
    const flat: Record<string, string> = {};
    for (const r of rows) {
      const v = mappings[r.path]?.trim() ?? "";
      if (v) flat[r.path] = v;
    }
    try {
      if (mode === "top-level") {
        return stringifyJson(flat);
      }
      const nested = unflattenMappings(flat);
      return stringifyJson(nested);
    } catch (e) {
      return `// Error building nested JSON: ${e instanceof Error ? e.message : String(e)}`;
    }
  }, [parsed, rows, mappings, mode]);

  const copyExport = useCallback(async () => {
    if (!exportJson || exportJson.startsWith("//")) return;
    await navigator.clipboard.writeText(exportJson);
  }, [exportJson]);

  const copyParsedHeaders = useCallback(async () => {
    const h =
      curlUiDisplay?.kind === "live"
        ? curlUiDisplay.p.headers
        : curlUiDisplay?.kind === "saved"
          ? curlUiDisplay.headers
          : null;
    if (!h || Object.keys(h).length === 0) return;
    await navigator.clipboard.writeText(stringifyJson(h));
  }, [curlUiDisplay]);

  const closePushModal = useCallback(() => {
    setPushStep(0);
    setConfirmServiceName("");
  }, []);

  const exportBodyParsed = useMemo(() => {
    if (!exportJson || exportJson.startsWith("//")) {
      return { ok: false as const, error: "" };
    }
    return parseJsonObject(exportJson);
  }, [exportJson]);

  const exportIsObjectBody = useMemo(() => {
    if (!exportBodyParsed.ok) return false;
    const v = exportBodyParsed.value;
    return (
      v !== null && typeof v === "object" && !Array.isArray(v)
    );
  }, [exportBodyParsed]);

  const pushRowDraft = useMemo((): ServiceConfiguration | null => {
    if (!exportBodyParsed.ok || !exportIsObjectBody) return null;
    const v = exportBodyParsed.value;
    if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
    const base = createEmptyServiceConfiguration();
    const curl = curlDbFields;
    const resolvedUrl =
      curl?.api_url && curl.api_url.length > 0 ? curl.api_url : ESA_PUSH_PLACEHOLDER_API_URL;
    return {
      ...base,
      service_name: newServiceName.trim(),
      request_body: v as Record<string, unknown>,
      api_url: resolvedUrl,
      request_method: curl?.request_method ?? base.request_method,
      headers: curl ? headersForServiceRow(curl.headers) : { ...base.headers },
    };
  }, [
    exportBodyParsed,
    exportIsObjectBody,
    newServiceName,
    createEmptyServiceConfiguration,
    curlDbFields,
  ]);

  const pushValidation = useMemo(() => {
    if (!pushRowDraft) return { ok: false as const, errors: [] as string[] };
    return validateServiceConfiguration(pushRowDraft);
  }, [pushRowDraft]);

  const canPushToDb =
    mode === "array-wildcards" &&
    apiMode &&
    !!exportJson &&
    !exportJson.startsWith("//") &&
    exportIsObjectBody &&
    pushValidation.ok;

  const runPushToDb = useCallback(async () => {
    if (!pushRowDraft || !pushValidation.ok) return;
    setPushing(true);
    clearError();
    setPushBanner(null);
    try {
      await upsertServiceConfiguration(pushRowDraft);
      closePushModal();
      const name = pushRowDraft.service_name;
      setNewServiceName("");
      const hadCurl = !!curlDbFields;
      setPushBanner(
        hadCurl
          ? `New service “${name}” saved with request_body, api_url, request_method, and headers from your curl (review under External APIs).`
          : `New service “${name}” saved with this request_body. Set API URL and other fields under External APIs if needed.`,
      );
      window.setTimeout(() => setPushBanner(null), 8000);
    } catch {
      /* store surfaces error */
    } finally {
      setPushing(false);
    }
  }, [
    pushRowDraft,
    pushValidation.ok,
    curlDbFields,
    upsertServiceConfiguration,
    clearError,
    closePushModal,
  ]);

  const applyTopSuggestions = useCallback(() => {
    setMappings((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if ((next[r.path] ?? "").trim()) continue;
        const sug = getSuggestionsForPath(r.path, corpus, 1)[0];
        if (sug) next[r.path] = sug.expression;
      }
      return next;
    });
  }, [rows, corpus]);

  return (
    <PageStack className="space-y-5">
      <PageHero
        eyebrow="Mapper"
        eyebrowClassName="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-muted"
        title="Sample JSON → request_body"
        titleClassName="text-xl font-semibold tracking-tight text-ink"
        description={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>JSON or cURL; map paths, copy export.</span>
            <EsaCustomFunctionsReferenceTrigger
              onClick={() => setEsaCustomHelpOpen(true)}
              className="!rounded border border-ink/12 !bg-white !from-transparent !to-transparent px-2 py-0.5 text-[11px] font-normal normal-case !text-accent !shadow-none hover:!border-ink/20 hover:!shadow-none"
            >
              Helpers
            </EsaCustomFunctionsReferenceTrigger>
            <Link to="/expressions#esa-custom" className="text-[11px] text-accent hover:underline">
              Full reference
            </Link>
          </div>
        }
      />

      <div className={panelClass}>
        <fieldset>
          <legend className="sr-only">Input source</legend>
          <div className="flex flex-wrap gap-4 text-[13px]">
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="esa-input-mode"
                checked={inputMode === "json"}
                onChange={() => setInputMode("json")}
                className="border-ink/25 text-accent"
              />
              JSON
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="esa-input-mode"
                checked={inputMode === "curl"}
                onChange={() => setInputMode("curl")}
                className="border-ink/25 text-accent"
              />
              cURL
            </label>
          </div>
        </fieldset>
        {inputMode === "json" ? (
          <TextArea
            className="mt-3"
            label="Sample JSON"
            hint="Root object."
            rows={10}
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
          />
        ) : (
          <TextArea
            className="mt-3"
            label="cURL"
            hint="-H and -d with JSON object (no @file)."
            rows={10}
            value={curlInput}
            onChange={(e) => setCurlInput(e.target.value)}
          />
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {inputMode === "json" ? (
            <button
              type="button"
              onClick={() => {
                setJsonInput(ESA_AUTO_MAPPER_SAMPLE_REQUEST_BODY);
                setCurlDbFields(null);
              }}
              className="rounded border border-ink/12 px-2 py-1 text-[11px] text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              Sample
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setCurlInput(ESA_AUTO_MAPPER_SAMPLE_CURL)}
              className="rounded border border-ink/12 px-2 py-1 text-[11px] text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              Sample
            </button>
          )}
          <button
            type="button"
            onClick={() => (inputMode === "json" ? setJsonInput("") : setCurlInput(""))}
            className="rounded border border-ink/12 px-2 py-1 text-[11px] text-ink-muted hover:bg-surface-2 hover:text-ink"
          >
            Clear
          </button>
        </div>
        {curlUiDisplay ? (
          <div
            className="mt-3 space-y-2 rounded-lg border border-ink/8 bg-white/80 p-3 text-[12px]"
            role="region"
            aria-label="Extracted URL and headers from cURL"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-ink-muted">
                {curlUiDisplay.kind === "live"
                  ? "Parsed from cURL"
                  : "Last successful parse (switch to cURL to edit)"}
              </p>
              {(() => {
                const hdrs =
                  curlUiDisplay.kind === "live"
                    ? curlUiDisplay.p.headers
                    : curlUiDisplay.headers;
                return Object.keys(hdrs).length > 0 ? (
                  <button
                    type="button"
                    onClick={() => void copyParsedHeaders()}
                    className="rounded border border-ink/12 px-2 py-0.5 text-[11px] hover:bg-surface-2"
                  >
                    Copy headers
                  </button>
                ) : null;
              })()}
            </div>
            {curlUiDisplay.kind === "saved" && curlUiDisplay.parseError ? (
              <p className="text-[11px] text-warn">{curlUiDisplay.parseError} — showing last OK parse.</p>
            ) : null}
            <dl className="grid gap-1 text-[11px] sm:grid-cols-[4rem_1fr] sm:gap-x-2">
              <dt className="text-ink-muted">Method</dt>
              <dd className="font-mono text-ink">
                {curlUiDisplay.kind === "live" ? curlUiDisplay.p.method : curlUiDisplay.method}
              </dd>
              <dt className="text-ink-muted">URL</dt>
              <dd className="break-all font-mono text-ink">
                {(() => {
                  const u =
                    curlUiDisplay.kind === "live"
                      ? curlUiDisplay.p.url.trim()
                      : curlUiDisplay.url.trim();
                  return u.length > 0 ? u : "—";
                })()}
              </dd>
            </dl>
            {(() => {
              const hdrs =
                curlUiDisplay.kind === "live"
                  ? curlUiDisplay.p.headers
                  : curlUiDisplay.headers;
              return Object.keys(hdrs).length > 0 ? (
                <div>
                  <pre className="max-h-36 overflow-auto rounded border border-ink/8 bg-surface-2/40 p-2 font-mono text-[10px] text-ink">
                    {stringifyJson(hdrs)}
                  </pre>
                </div>
              ) : (
                <p className="text-[11px] text-ink-muted">No headers parsed.</p>
              );
            })()}
            <div>
              <p className="mb-1 text-[11px] text-ink-muted">Body used for mapping</p>
              {curlUiDisplay.kind === "live" ? (
                <pre className="max-h-36 overflow-auto rounded border border-ink/8 bg-surface-2/40 p-2 font-mono text-[10px] text-ink">
                  {curlUiDisplay.p.bodyJson !== null
                    ? stringifyJson(curlUiDisplay.p.bodyJson)
                    : "// No JSON body"}
                </pre>
              ) : (
                <p className="text-[11px] text-ink-muted">
                  Open cURL mode to preview <code className="font-mono text-[10px]">-d</code> body.
                </p>
              )}
            </div>
          </div>
        ) : null}
        {!parsed.ok && (inputMode === "json" ? jsonInput.trim() : curlInput.trim()) ? (
          <p className="mt-2 text-sm text-warn">
            {(parsed as { ok: false; error: string }).error}
          </p>
        ) : null}
      </div>

      {parsed.ok ? (
        <>
          <div className={panelClass}>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-0.5 text-[11px] text-ink-muted">
                <span>Listing</span>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as FlattenMode)}
                  className="rounded border border-ink/12 bg-white px-2 py-1 text-[13px]"
                  aria-describedby="mode-hint"
                >
                  <option value="array-wildcards">Lists as [*] (recommended)</option>
                  <option value="all-leaves">Every index [0],[1]…</option>
                  <option value="top-level">Top-level keys only</option>
                </select>
              </label>
              <p id="mode-hint" className="max-w-md text-[11px] text-ink-muted">
                {mode === "array-wildcards"
                  ? "One row per field inside arrays."
                  : mode === "all-leaves"
                    ? "Per-index rows when mappings differ by position."
                    : "Single line per top-level key."}
              </p>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink/8 pt-3">
              <input
                type="search"
                placeholder="Filter paths…"
                value={pathFilter}
                onChange={(e) => setPathFilter(e.target.value)}
                className="min-w-[10rem] flex-1 rounded border border-ink/12 bg-white px-2 py-1 text-[13px] outline-none focus:border-ink/25"
              />
              <span className="text-[11px] text-ink-muted tabular-nums">
                {filteredRows.length}/{rows.length}
              </span>
              <button
                type="button"
                onClick={applyTopSuggestions}
                className="rounded border border-ink/12 px-2 py-1 text-[11px] hover:bg-surface-2"
              >
                Autofill empty
              </button>
              <EsaCustomFunctionsReferenceTrigger
                onClick={() => setEsaCustomHelpOpen(true)}
                className="!rounded border border-ink/12 !bg-white !from-transparent !to-transparent px-2 py-0.5 text-[11px] font-normal normal-case !text-accent !shadow-none hover:!border-ink/20 hover:!shadow-none"
              >
                Helpers
              </EsaCustomFunctionsReferenceTrigger>
            </div>
          </div>

          <p className="text-[10px] text-ink-muted/80">
            Suggestion corpus · {corpus.meta.leafPaths} patterns · autocomplete while typing
          </p>

          <DataTableShell>
            <table className="w-full min-w-[56rem] text-left text-[13px]">
              <thead>
                <tr className={tableListHeadRowClass}>
                  <th className="px-2 py-2 pr-1 normal-case tracking-normal">Path</th>
                  <th className="px-2 py-2 pr-1 normal-case tracking-normal">Sample</th>
                  <th className="min-w-[12rem] px-2 py-2 pr-1 normal-case tracking-normal">Ideas</th>
                  <th className="min-w-[16rem] px-2 py-2 pr-1 normal-case tracking-normal">Mapping</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/[0.05]">
                {filteredRows.map((r) => {
                  const sug = getSuggestionsForPath(r.path, corpus, 4);
                  return (
                    <tr key={r.path} className="align-top hover:bg-surface-2/40">
                      <td className="px-2 py-1.5 font-mono text-[11px] text-ink">{r.path}</td>
                      <td className="max-w-[10rem] truncate px-2 py-1.5 font-mono text-[11px] text-ink-muted" title={String(r.sample)}>
                        {previewSample(r.sample)}
                      </td>
                      <td className="max-w-[20rem] px-2 py-1.5">
                        {sug.length === 0 ? (
                          <span className="text-[11px] text-ink-muted">—</span>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            {sug.map((s, i) => (
                              <button
                                key={i}
                                type="button"
                                title={`${s.expression}\n\nServices: ${s.services.join(", ")}`}
                                onClick={() =>
                                  setMappings((m) => ({ ...m, [r.path]: s.expression }))
                                }
                                className="rounded border border-ink/8 bg-transparent px-1.5 py-0.5 text-left font-mono text-[10px] text-ink hover:bg-surface-2"
                              >
                                <span className="text-ink-muted">×{s.count}</span>{" "}
                                {truncateExpr(s.expression, 56)}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <MappingAutocompleteInput
                          value={mappings[r.path] ?? ""}
                          onChange={(v) =>
                            setMappings((m) => ({ ...m, [r.path]: v }))
                          }
                          corpusExpressions={mappingAutocompleteOptions}
                          aria-label={`Mapping for ${r.path}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DataTableShell>

          <div className={panelClass}>
            <div className="flex flex-wrap items-end gap-3">
              <h3 className="w-full text-sm font-medium text-ink">
                {mode === "top-level"
                  ? "Export (top-level)"
                  : mode === "array-wildcards"
                    ? "Export"
                    : "Export (full paths)"}
              </h3>
              <button
                type="button"
                onClick={() => void copyExport()}
                disabled={!exportJson || exportJson.startsWith("//")}
                className="rounded border border-ink/12 bg-accent px-3 py-1.5 text-[13px] text-white hover:bg-accent-hover disabled:opacity-40"
              >
                Copy
              </button>
              {mode === "array-wildcards" ? (
                <>
                  <label className="flex min-w-[10rem] flex-1 flex-col gap-0.5 text-[11px] text-ink-muted">
                    Service name
                    <input
                      type="text"
                      value={newServiceName}
                      onChange={(e) => setNewServiceName(e.target.value)}
                      placeholder="MyNewMappingService"
                      autoComplete="off"
                      className="rounded border border-ink/12 bg-white px-2 py-1 font-mono text-[13px]"
                      aria-label="New ESA service name for this push"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!canPushToDb}
                    title={
                      !apiMode
                        ? "Enable API mode (VITE_USE_API) to write to the database."
                        : !exportIsObjectBody
                          ? "Export must be a JSON object."
                          : !pushValidation.ok
                            ? pushValidation.errors[0]
                            : undefined
                    }
                    onClick={() => {
                      clearError();
                      setConfirmServiceName("");
                      setPushStep(1);
                    }}
                    className="rounded border border-ink/12 px-3 py-1.5 text-[13px] hover:bg-surface-2 disabled:opacity-40"
                  >
                    Push
                  </button>
                </>
              ) : null}
              <Link
                to="/esa"
                className="rounded border border-ink/12 px-3 py-1.5 text-[13px] text-ink-muted hover:bg-surface-2"
              >
                External APIs
              </Link>
            </div>
            {mode === "array-wildcards" && pushBanner ? (
              <p className="mt-2 text-[13px] text-emerald-800" role="status">
                {pushBanner}
              </p>
            ) : null}
            {mode === "array-wildcards" && error ? (
              <p className="mt-2 whitespace-pre-wrap text-[13px] text-warn">{error}</p>
            ) : null}
            <pre className="mt-3 max-h-[22rem] overflow-auto rounded border border-ink/8 bg-white/80 p-3 font-mono text-[10px] leading-relaxed">
              {exportJson || "{}"}
            </pre>
          </div>

          <Modal
            title={pushStep === 1 ? "Push to database?" : "Confirm"}
            open={pushStep === 1 || pushStep === 2}
            onClose={closePushModal}
            footer={
              pushStep === 1 ? (
                <>
                  <button
                    type="button"
                    onClick={closePushModal}
                    className="rounded-lg border border-ink/15 px-4 py-2 text-sm hover:bg-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!canPushToDb}
                    onClick={() => setPushStep(2)}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                  >
                    Continue
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={closePushModal}
                    className="rounded-lg border border-ink/15 px-4 py-2 text-sm hover:bg-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={
                      pushing ||
                      confirmServiceName.trim() !== newServiceName.trim()
                    }
                    onClick={() => void runPushToDb()}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                  >
                    {pushing ? "Saving…" : "Push to database"}
                  </button>
                </>
              )
            }
          >
            {pushStep === 1 && newServiceName.trim() ? (
              <div className="space-y-2 text-sm text-ink">
                <p>
                  New service <strong className="font-mono">{newServiceName.trim()}</strong>
                  {" · "}
                  request_body from export.
                </p>
                <p className="text-xs text-ink-muted">
                  {curlDbFields
                    ? "Method, URL, headers from cURL saved with row."
                    : `api_url defaults to ${ESA_PUSH_PLACEHOLDER_API_URL} until edited.`}
                </p>
              </div>
            ) : null}
            {pushStep === 2 && newServiceName.trim() ? (
              <div className="space-y-2 text-sm text-ink">
                <p className="text-xs text-ink-muted">
                  Confirm: type <strong className="font-mono text-ink">{newServiceName.trim()}</strong>
                </p>
                <label className="block">
                  <input
                    type="text"
                    value={confirmServiceName}
                    onChange={(e) => setConfirmServiceName(e.target.value)}
                    autoComplete="off"
                    className="w-full rounded border border-ink/12 bg-white px-2 py-1.5 font-mono text-sm"
                    placeholder={newServiceName.trim()}
                  />
                </label>
              </div>
            ) : null}
          </Modal>
        </>
      ) : null}

      <details className={`${panelClass} text-[11px] text-ink-muted`}>
        <summary className="cursor-pointer list-none font-medium text-ink [&::-webkit-details-marker]:hidden">
          Reference
        </summary>
        <ul className="mt-2 space-y-1.5 border-t border-ink/8 pt-2">
          <li>
            cURL: <code className="font-mono text-[10px]">-H</code> + <code className="font-mono text-[10px]">-d</code>{" "}
            JSON object; Push saves URL/method/headers when API mode is on.
          </li>
          <li>
            Mappings are strings (templates, <code className="font-mono text-[10px]">{"{{…}}"}</code>,{" "}
            <code className="font-mono text-[10px]">((…))</code>).
          </li>
          <li>
            Use [*] listing for variable-length lists; top-level mode for whole nested blobs (e.g. bureau trees).
          </li>
          <li>Blank rows omit from export.</li>
        </ul>
      </details>

      <EsaCustomFunctionsHelpModal open={esaCustomHelpOpen} onClose={() => setEsaCustomHelpOpen(false)} />
    </PageStack>
  );
}

function truncateExpr(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function previewSample(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "object") {
    const s = stringifyJson(v, false);
    return s.length > 80 ? `${s.slice(0, 80)}…` : s;
  }
  return String(v);
}

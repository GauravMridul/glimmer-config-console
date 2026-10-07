import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { TextArea, TextInput } from "@/components/Field";
import {
  fetchQueryObjectRelationshipMap,
  postHttpProbe,
  postSalesforceResolveProbeTemplates,
  type HttpProbeWireResult,
  type SalesforceProbeQueryRow,
} from "@/api/backend";
import {
  applyLiteralAtJsonPath,
  collectBodyTemplateSuggestions,
} from "@/lib/httpProbeBodySuggestions";
import { valueFromAngleValuesAny } from "@/lib/sfdcProbeResolveFill";
import { recordEsaProbeHttpResult } from "@/lib/esaProbeLocalResults";
import { parseJsonObject, stringifyJson } from "@/lib/json";
import type { ServiceConfiguration } from "@/types/models";

type Props = {
  open: boolean;
  onClose: () => void;
  row: ServiceConfiguration;
};

function draftsFromRow(r: ServiceConfiguration) {
  return {
    urlDraft: r.api_url.trim(),
    headersText: stringifyJson(r.headers ?? {}),
    bodyText: stringifyJson(r.request_body ?? {}),
  };
}

/** Subset of resolve `angleValues` whose keys are `Object.field` for this API name (case-insensitive object). */
function angleValuesForSObject(
  objectApiName: string,
  angleValues: Record<string, unknown>,
): Record<string, unknown> {
  const low = objectApiName.toLowerCase();
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(angleValues)) {
    const i = k.indexOf(".");
    if (i < 1) continue;
    if (k.slice(0, i).toLowerCase() === low) out[k] = v;
  }
  return out;
}

export function ServiceConfigHttpProbeModal({ open, onClose, row }: Props) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<HttpProbeWireResult | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState("");
  const [headersText, setHeadersText] = useState("{}");
  const [bodyText, setBodyText] = useState("{}");

  const method = (row.request_method.trim().toUpperCase() || "GET") as string;
  const noBody = method === "GET" || method === "HEAD";

  const resetForOpen = useCallback(() => {
    setResult(null);
    setClientError(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    resetForOpen();
    const d = draftsFromRow(row);
    setUrlDraft(d.urlDraft);
    setHeadersText(d.headersText);
    setBodyText(d.bodyText);
    setSfBackedSuggestionPaths({});
    setSuggestionsSfOnly(false);
    // Intentionally only open + id: re-seed when the dialog opens or user tests another service;
    // omit `row` so bundle refreshes don’t wipe in-progress edits (use “Reset from saved” for fresh DB).
  }, [open, row.id, resetForOpen]);

  const handleClose = useCallback(() => {
    resetForOpen();
    setRunning(false);
    onClose();
  }, [onClose, resetForOpen]);

  const run = useCallback(async () => {
    setRunning(true);
    setClientError(null);
    setResult(null);
    const timeoutSec = Number(row.timeout) || 0;
    const timeoutMs =
      timeoutSec > 0 ? Math.min(timeoutSec * 1000, 120_000) : 30_000;

    const url = urlDraft.trim();
    if (!url) {
      setClientError("Request URL is empty.");
      setRunning(false);
      return;
    }

    const hp = parseJsonObject(headersText);
    if (!hp.ok) {
      setClientError(`Headers JSON: ${hp.error}`);
      setRunning(false);
      return;
    }
    if (
      hp.value === null ||
      typeof hp.value !== "object" ||
      Array.isArray(hp.value)
    ) {
      setClientError("Headers must be a JSON object (e.g. {\"Authorization\": \"Bearer …\"}).");
      setRunning(false);
      return;
    }
    const headersObj = hp.value as Record<string, unknown>;

    let bodyPayload: unknown | undefined;
    if (!noBody) {
      const raw = bodyText.trim();
      if (raw === "") {
        bodyPayload = undefined;
      } else {
        const bp = parseJsonObject(bodyText);
        if (!bp.ok) {
          setClientError(`Request body JSON: ${bp.error}`);
          setRunning(false);
          return;
        }
        bodyPayload = bp.value;
      }
    }

    try {
      const out = await postHttpProbe({
        url,
        method,
        headers: headersObj,
        timeoutMs,
        ...(!noBody && bodyPayload !== undefined ? { body: bodyPayload } : {}),
      });
      setResult(out);
      if (out.ok) {
        recordEsaProbeHttpResult(row.id, out.status);
      }
    } catch (e) {
      setClientError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [bodyText, headersText, method, noBody, row.id, row.timeout, urlDraft]);

  const label =
    row.service_name.trim() || `id ${row.id}` || "External API";

  const bodyParse = useMemo(() => parseJsonObject(bodyText), [bodyText]);
  const suggestionRows = useMemo(() => {
    if (!bodyParse.ok) return [];
    return collectBodyTemplateSuggestions(bodyParse.value);
  }, [bodyParse]);

  const [suggestionDrafts, setSuggestionDrafts] = useState<Record<string, string>>(
    {},
  );

  const [anchorId, setAnchorId] = useState("");
  const [anchorType, setAnchorType] = useState<"auto" | "Lead" | "Contact">("auto");
  const [sfBusy, setSfBusy] = useState(false);
  const [sfError, setSfError] = useState<string | null>(null);
  const [sfWarnings, setSfWarnings] = useState<string[]>([]);
  const [sfQueries, setSfQueries] = useState<SalesforceProbeQueryRow[]>([]);
  const [sfAngleValues, setSfAngleValues] = useState<Record<string, unknown>>({});
  /** JSON paths whose suggestion draft came from the last Salesforce resolve (live SOQL). */
  const [sfBackedSuggestionPaths, setSfBackedSuggestionPaths] = useState<Record<string, true>>(
    {},
  );
  const [sfMappingSource, setSfMappingSource] = useState<string | null>(null);
  /** When true, the suggestions list shows only rows last filled from Salesforce (SF badge). */
  const [suggestionsSfOnly, setSuggestionsSfOnly] = useState(false);
  /** Live row count from `query_object_relationship_map` (GET each time the modal opens). */
  const [qorMapSummary, setQorMapSummary] = useState<{
    count: number;
    usingDedicatedDb: boolean;
  } | null>(null);
  const [qorMapError, setQorMapError] = useState<string | null>(null);

  const sfBackedSuggestionCount = useMemo(
    () => Object.keys(sfBackedSuggestionPaths).length,
    [sfBackedSuggestionPaths],
  );

  const filteredSuggestionRows = useMemo(() => {
    if (!suggestionsSfOnly) return suggestionRows;
    return suggestionRows.filter((r) => Boolean(sfBackedSuggestionPaths[r.path]));
  }, [suggestionRows, suggestionsSfOnly, sfBackedSuggestionPaths]);

  useEffect(() => {
    setSuggestionDrafts((prev) => {
      const next: Record<string, string> = {};
      for (const r of suggestionRows) {
        next[r.path] = prev[r.path] ?? r.suggestedInput;
      }
      return next;
    });
  }, [suggestionRows]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setQorMapSummary(null);
    setQorMapError(null);
    void (async () => {
      try {
        const d = await fetchQueryObjectRelationshipMap();
        if (cancelled) return;
        setQorMapSummary({
          count: d.count,
          usingDedicatedDb: d.usingDedicatedDb,
        });
      } catch (e) {
        if (cancelled) return;
        setQorMapError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const applyOneSuggestion = useCallback(
    (path: string) => {
      if (!bodyParse.ok) return;
      const raw = suggestionDrafts[path];
      if (raw === undefined) return;
      const next = applyLiteralAtJsonPath(bodyParse.value, path, raw);
      setBodyText(stringifyJson(next));
    },
    [bodyParse, suggestionDrafts],
  );

  const applyAllSuggestions = useCallback(() => {
    if (!bodyParse.ok) return;
    const rows = suggestionsSfOnly
      ? suggestionRows.filter((r) => Boolean(sfBackedSuggestionPaths[r.path]))
      : suggestionRows;
    if (rows.length === 0) return;
    let cur: unknown = bodyParse.value;
    for (const r of rows) {
      cur = applyLiteralAtJsonPath(
        cur,
        r.path,
        suggestionDrafts[r.path] ?? r.suggestedInput,
      );
    }
    setBodyText(stringifyJson(cur));
  }, [bodyParse, suggestionRows, suggestionDrafts, suggestionsSfOnly, sfBackedSuggestionPaths]);

  const fillFromSalesforce = useCallback(async () => {
    setSfError(null);
    setSfWarnings([]);
    setSfQueries([]);
    setSfAngleValues({});
    setSfBackedSuggestionPaths({});
    setSfMappingSource(null);
    if (!bodyParse.ok) {
      setSfError("Fix request body JSON first.");
      return;
    }
    const id = anchorId.trim();
    if (!id) {
      setSfError("Enter a Lead or Contact Id (anchor for SOQL).");
      return;
    }
    setSfBusy(true);
    try {
      const out = await postSalesforceResolveProbeTemplates({
        anchorId: id,
        anchorType,
        requestBody: bodyParse.value as Record<string, unknown>,
      });
      setSfWarnings(out.warnings ?? []);
      setSfQueries(out.queries ?? []);
      const av = (out.angleValues ?? {}) as Record<string, unknown>;
      setSfAngleValues(av);
      setSfMappingSource(out.mappingSource ?? null);
      let filled = 0;
      const nextDrafts: Record<string, string> = { ...suggestionDrafts };
      const nextSfBacked: Record<string, true> = {};
      for (const r of suggestionRows) {
        const v = valueFromAngleValuesAny(r.templateFull, av, r.angleRefKeys);
        if (v != null) {
          nextDrafts[r.path] = v;
          nextSfBacked[r.path] = true;
          filled += 1;
        }
      }
      setSuggestionDrafts(nextDrafts);
      setSfBackedSuggestionPaths(nextSfBacked);
      if (filled === 0 && (out.warnings?.length ?? 0) === 0) {
        setSfError(
          "No suggestion rows matched returned Salesforce fields. Ensure templates include <Object.field> names that appear in the resolve response (check SOQL / angle keys below).",
        );
      }
    } catch (e) {
      setSfError(e instanceof Error ? e.message : String(e));
    } finally {
      setSfBusy(false);
    }
  }, [anchorId, anchorType, bodyParse, suggestionRows, suggestionDrafts]);

  return (
    <Modal
      title="Test request"
      open={open}
      onClose={handleClose}
      zClassName="z-[60]"
      panelClassName="max-w-6xl"
      footer={
        <>
          <button
            type="button"
            onClick={() => {
              const d = draftsFromRow(row);
              setUrlDraft(d.urlDraft);
              setHeadersText(d.headersText);
              setBodyText(d.bodyText);
              setResult(null);
              setClientError(null);
              setSfError(null);
              setSfWarnings([]);
              setSfQueries([]);
              setSfAngleValues({});
              setSfBackedSuggestionPaths({});
              setSuggestionsSfOnly(false);
              setSfMappingSource(null);
            }}
            className="rounded-lg border border-ink/15 px-4 py-2 text-sm"
          >
            Reset from saved
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg border border-ink/15 px-4 py-2 text-sm"
          >
            Close
          </button>
          <button
            type="button"
            disabled={running}
            onClick={() => void run()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {running ? "Sending…" : "Send request"}
          </button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-xs text-ink-muted">
          Test-only—nothing saved to the database.{" "}
          <span className="font-mono text-ink">{method}</span>
          <span className="text-ink-muted"> · </span>
          <span className="font-mono text-ink">{label}</span>
        </p>

        {!noBody ? (
          <div className="rounded-lg border border-dm/25 bg-dm/[0.06] px-3 py-2.5 text-xs">
            <p className="font-medium text-ink">Fill{" "}
              <code className="rounded bg-white/80 px-1 font-mono text-[10px]">&lt;Object.field&gt;</code>{" "}
              from Salesforce
            </p>
            <p className="mt-1 text-ink-muted">
              Enter a Salesforce <strong className="font-medium text-ink">ref id</strong> (same as ESA —
              usually Lead <code className="font-mono text-[10px]">00Q…</code> or Contact{" "}
              <code className="font-mono text-[10px]">003…</code>). When the ESA database has{" "}
              <code className="font-mono text-[10px]">query_object_relationship_map</code> rows for the
              objects in your template, SOQL is built like{" "}
              <code className="font-mono text-[10px]">external-service-adapter</code> (
              <code className="font-mono text-[10px]">query_relation</code>,{" "}
              <code className="font-mono text-[10px]">additional_conditions</code>, dependency order).
              Otherwise the server uses legacy heuristics (
              <code className="font-mono text-[10px]">Lead__c</code> / env JSON). Rows with{" "}
              <code className="font-mono text-[10px]">((Service…))</code> are not changed here.
            </p>
            {qorMapSummary ? (
              <p className="mt-1.5 text-[11px] text-dm/90">
                <span className="text-ink-muted">Live mapping table:</span>{" "}
                <strong className="font-medium text-ink">{qorMapSummary.count}</strong>{" "}
                object{qorMapSummary.count === 1 ? "" : "s"}
                {qorMapSummary.usingDedicatedDb ? (
                  <span className="text-ink-muted">
                    {" "}
                    · not ESA pool (DATABASE_URL default or QUERY_OBJECT_RELATIONSHIP_MAP_DATABASE_URL)
                  </span>
                ) : null}
                . New Postgres rows appear the next time you open this dialog or run Fill.
              </p>
            ) : null}
            {qorMapError ? (
              <p
                className={`mt-1 whitespace-pre-wrap text-[11px] ${
                  /Restart the config-console API|returned 404/i.test(qorMapError)
                    ? "text-ink-muted"
                    : "text-warn/90"
                }`}
              >
                {qorMapError}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="flex min-w-[12rem] flex-1 flex-col gap-0.5">
                <span className="text-ink-muted">Anchor record Id</span>
                <input
                  type="text"
                  value={anchorId}
                  onChange={(e) => setAnchorId(e.target.value)}
                  placeholder="00Q… or 003…"
                  spellCheck={false}
                  className="rounded border border-ink/15 bg-white px-2 py-1.5 font-mono text-[11px] text-ink"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-ink-muted">Type</span>
                <select
                  value={anchorType}
                  onChange={(e) =>
                    setAnchorType(e.target.value as "auto" | "Lead" | "Contact")
                  }
                  className="rounded border border-ink/15 bg-white px-2 py-1.5 text-[11px] text-ink"
                >
                  <option value="auto">Auto (from Id prefix)</option>
                  <option value="Lead">Lead</option>
                  <option value="Contact">Contact</option>
                </select>
              </label>
              <button
                type="button"
                disabled={sfBusy}
                onClick={() => void fillFromSalesforce()}
                className="rounded-lg bg-dm px-3 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {sfBusy ? "Querying…" : "Fill <…> from Salesforce"}
              </button>
            </div>
            {sfError ? (
              <p className="mt-2 whitespace-pre-wrap text-warn">{sfError}</p>
            ) : null}
            {sfWarnings.length > 0 ? (
              <ul className="mt-2 list-inside list-disc space-y-0.5 text-[11px] text-ink-muted">
                {sfWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
            {sfMappingSource ? (
              <p className="mt-2 text-[11px] text-ink-muted">
                Mapping source:{" "}
                <code className="rounded bg-white/90 px-1 font-mono text-[10px] text-ink">
                  {sfMappingSource}
                </code>
              </p>
            ) : null}
            {sfQueries.length > 0 ? (
              <div className="mt-3 space-y-2 border-t border-dm/20 pt-3">
                <p className="text-[11px] font-semibold text-ink">
                  SOQL executed ({sfQueries.length}{" "}
                  {sfQueries.length === 1 ? "query" : "queries"})
                </p>
                <ol className="list-decimal space-y-2 pl-4 text-[11px] text-ink-muted">
                  {sfQueries.map((q, i) => (
                    <li key={`${q.object}-${i}`} className="marker:font-medium marker:text-ink">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="font-medium text-ink">{q.object}</span>
                        {q.probeStatus ? (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[9px] text-amber-950">
                            {q.probeStatus}
                          </span>
                        ) : null}
                        {q.totalSize !== undefined ? (
                          <span className="font-mono text-[10px] text-ink-muted">
                            totalSize={q.totalSize}
                          </span>
                        ) : null}
                      </div>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded border border-ink/10 bg-white/90 p-2 font-mono text-[10px] leading-snug text-ink">
                        {q.soql}
                      </pre>
                      {q.probeError ? (
                        <p className="mt-1 text-[10px] text-warn">{q.probeError}</p>
                      ) : null}
                      {(() => {
                        const subset = angleValuesForSObject(q.object, sfAngleValues);
                        const hasSubset = Object.keys(subset).length > 0;
                        const rec = q.records;
                        const hasRows = Array.isArray(rec) && rec.length > 0;
                        const noRows = Array.isArray(rec) && rec.length === 0;
                        return (
                          <div className="mt-2 space-y-1">
                            {typeof q.totalSize === "number" &&
                            rec !== undefined &&
                            q.totalSize > rec.length ? (
                              <p className="text-[10px] text-ink-muted">
                                Showing {rec.length} of {q.totalSize} row(s) in the API response.
                              </p>
                            ) : null}
                            {hasRows ? (
                              <>
                                <p className="text-[10px] font-medium text-ink">
                                  Row data (Salesforce REST)
                                </p>
                                <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded border border-ink/10 bg-white/95 p-2 font-mono text-[10px] leading-snug text-ink">
                                  {JSON.stringify(rec, null, 2)}
                                </pre>
                              </>
                            ) : null}
                            {noRows ? (
                              <p className="text-[10px] text-ink-muted">
                                No rows returned for this query.
                              </p>
                            ) : null}
                            {!hasRows && hasSubset ? (
                              <>
                                <p className="text-[10px] font-medium text-ink">
                                  Values merged into templates (this object)
                                </p>
                                <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded border border-ink/10 bg-white/95 p-2 font-mono text-[10px] leading-snug text-ink">
                                  {JSON.stringify(subset, null, 2)}
                                </pre>
                                {rec === undefined ? (
                                  <p className="text-[10px] text-amber-900/90">
                                    Row JSON was not returned for this query (older API). Restart{" "}
                                    <code className="rounded bg-white/80 px-0.5 font-mono text-[9px]">
                                      npm run server
                                    </code>{" "}
                                    from this repo, or redeploy the image so each query includes{" "}
                                    <code className="rounded bg-white/80 px-0.5 font-mono text-[9px]">
                                      records
                                    </code>
                                    .
                                  </p>
                                ) : null}
                              </>
                            ) : null}
                            {!hasRows && !hasSubset && rec === undefined ? (
                              <p className="text-[10px] text-ink-muted">
                                No row payload and no merged fields for this object in the resolve
                                response.
                              </p>
                            ) : null}
                          </div>
                        );
                      })()}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>
        ) : null}

        <TextInput
          label="Request URL"
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          className="font-mono text-xs"
          spellCheck={false}
        />

        <TextArea
          label="Headers (JSON object)"
          rows={4}
          value={headersText}
          onChange={(e) => setHeadersText(e.target.value)}
          className="font-mono text-xs"
        />

        {noBody ? (
          <p className="text-xs text-ink-muted">
            <span className="font-medium text-ink">{method}</span> does not send a request body. If the
            saved row has a template body, it is ignored for this probe.
          </p>
        ) : (
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-ink">Request body (JSON)</span>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_17.5rem] lg:items-stretch">
              <textarea
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                spellCheck={false}
                rows={14}
                className="min-h-[16rem] w-full resize-y rounded-lg border border-ink/15 bg-white px-3 py-2 font-mono text-xs text-ink outline-none ring-accent/0 transition focus:border-accent/40 focus:ring-2 focus:ring-accent/20"
                aria-label="Request body JSON"
              />
              <aside
                className={`flex min-h-[12rem] flex-col rounded-lg border border-ink/10 bg-surface-2/50 lg:min-h-0 lg:max-h-[min(26rem,50vh)] ${
                  suggestionRows.length > 0 ? "border-accent/20 bg-accent/[0.04]" : ""
                }`}
              >
                {bodyParse.ok && suggestionRows.length > 0 ? (
                  <>
                    <div className="flex shrink-0 flex-col gap-1 border-b border-ink/10 px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-ink">
                          {suggestionsSfOnly
                            ? `Suggestions · SF only (${filteredSuggestionRows.length} of ${suggestionRows.length})`
                            : `Suggestions (${suggestionRows.length})`}
                        </span>
                        <button
                          type="button"
                          onClick={applyAllSuggestions}
                          disabled={filteredSuggestionRows.length === 0}
                          title={
                            suggestionsSfOnly
                              ? "Apply all visible (Salesforce-backed) fields to the JSON body"
                              : "Apply every suggestion to the JSON body"
                          }
                          className="rounded-md bg-accent px-2 py-1 text-[11px] font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Apply all
                        </button>
                      </div>
                      <label className="flex cursor-pointer items-center gap-2 text-[11px] text-ink">
                        <input
                          type="checkbox"
                          checked={suggestionsSfOnly}
                          onChange={(e) => setSuggestionsSfOnly(e.target.checked)}
                          className="size-3.5 shrink-0 rounded border-ink/30 text-accent focus:ring-accent/30"
                        />
                        <span>
                          Show only Salesforce-backed
                          {sfBackedSuggestionCount > 0 ? (
                            <span className="text-ink-muted"> ({sfBackedSuggestionCount})</span>
                          ) : null}
                        </span>
                      </label>
                      <p className="text-[10px] leading-snug text-ink-muted">
                        <span className="font-mono font-semibold text-emerald-900/90">SF</span> beside a
                        field = value from the last{" "}
                        <span className="font-medium text-ink">Fill &lt;…&gt; from Salesforce</span>{" "}
                        (SOQL / <code className="font-mono text-[9px]">angleValues</code>).
                      </p>
                    </div>
                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
                      {filteredSuggestionRows.length === 0 ? (
                        <p className="rounded-md border border-dashed border-ink/15 bg-white/60 px-2 py-3 text-center text-[11px] leading-snug text-ink-muted">
                          {suggestionsSfOnly
                            ? "No Salesforce-backed suggestions yet. Run Fill <…> from Salesforce, or turn the filter off."
                            : null}
                        </p>
                      ) : null}
                      {filteredSuggestionRows.map((r) => (
                        <div
                          key={r.path || "__root__"}
                          className="rounded-md border border-ink/8 bg-white/90 px-2 py-1.5 shadow-sm"
                        >
                          <div
                            className="truncate font-mono text-[10px] font-medium text-ink"
                            title={`${r.path}\n\n${r.templateFull}`}
                          >
                            {r.path || "(root)"}
                          </div>
                          <div className="mt-1 flex items-center gap-1.5">
                            <input
                              type="text"
                              value={suggestionDrafts[r.path] ?? r.suggestedInput}
                              onChange={(e) => {
                                const next = e.target.value;
                                setSuggestionDrafts((prev) => ({
                                  ...prev,
                                  [r.path]: next,
                                }));
                                setSfBackedSuggestionPaths((prev) => {
                                  if (!prev[r.path]) return prev;
                                  const { [r.path]: _, ...rest } = prev;
                                  return rest;
                                });
                              }}
                              spellCheck={false}
                              title={`${r.hint}\n\nSaved template:\n${r.templateFull}`}
                              className="min-w-0 flex-1 rounded border border-ink/15 bg-white px-2 py-1 font-mono text-[11px] text-ink outline-none focus:border-accent/40"
                            />
                            {sfBackedSuggestionPaths[r.path] ? (
                              <span
                                className="shrink-0 select-none rounded border border-emerald-600/35 bg-emerald-600/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-emerald-900"
                                title="Value from live Salesforce (last Fill &lt;…&gt; from Salesforce)"
                              >
                                SF
                              </span>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => applyOneSuggestion(r.path)}
                              className="shrink-0 rounded border border-ink/15 bg-surface-2 px-2 py-1 text-[11px] font-medium text-ink hover:bg-surface-2/80"
                            >
                              Apply
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="flex flex-1 items-center justify-center p-3 text-center">
                    <p className="text-[11px] leading-snug text-ink-muted">
                      {bodyText.trim() && !bodyParse.ok
                        ? "Fix JSON syntax to list template fields here."
                        : bodyParse.ok && bodyText.trim() !== ""
                          ? "No templated fields in this body."
                          : "Suggestions appear for <Field>, ((path)), {{…}} templates."}
                    </p>
                  </div>
                )}
              </aside>
            </div>
          </div>
        )}

        {clientError ? (
          <div className="rounded-lg border border-warn/40 bg-warn/15 px-3 py-2 text-ink whitespace-pre-wrap">
            {clientError}
          </div>
        ) : null}
        {result ? (
          result.ok ? (
            <div className="space-y-2">
              <div
                className={`rounded-lg border px-3 py-2 font-medium ${
                  result.status >= 200 && result.status < 300
                    ? "border-emerald-500/30 bg-emerald-500/10"
                    : result.status >= 400
                      ? "border-warn/40 bg-warn/15"
                      : "border-ink/15 bg-surface-2/60"
                }`}
              >
                HTTP {result.status} {result.statusText}
                <span className="ml-2 font-normal text-ink-muted">
                  · {result.durationMs} ms
                </span>
                {result.bodyTruncated ? (
                  <span className="ml-2 text-xs font-normal text-ink-muted">
                    (body truncated)
                  </span>
                ) : null}
              </div>
              <details className="rounded-lg border border-ink/10 bg-white/60 px-3 py-2">
                <summary className="cursor-pointer text-xs font-medium text-ink-muted">
                  Response headers
                </summary>
                <pre className="mt-2 max-h-40 overflow-auto text-[11px] text-ink">
                  {JSON.stringify(result.responseHeaders, null, 2)}
                </pre>
              </details>
              <div>
                <div className="text-xs font-medium text-ink-muted">Body</div>
                <pre className="mt-1 max-h-[min(24rem,50vh)] overflow-auto rounded-lg border border-ink/10 bg-ink/[0.03] p-3 font-mono text-[11px] text-ink whitespace-pre-wrap">
                  {result.body || "(empty)"}
                </pre>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-warn/40 bg-warn/15 px-3 py-2 text-ink">
              <div className="font-medium">Request did not complete</div>
              <p className="mt-1 text-xs whitespace-pre-wrap">{result.error}</p>
              {result.durationMs != null ? (
                <p className="mt-1 text-xs text-ink-muted">
                  After {result.durationMs} ms
                </p>
              ) : null}
            </div>
          )
        ) : null}
      </div>
    </Modal>
  );
}

import { useCallback, useMemo, useState, type FormEvent } from "react";
import {
  postProcessSequenceTest,
  type ProcessSequenceTestResult,
} from "@/api/backend";
import { Field, TextArea, TextInput } from "@/components/Field";
import { innerPanelClass, PageHero, PageSection, PageStack } from "@/components/PageChrome";
import { stringifyJson } from "@/lib/json";
import { useConfig } from "@/context/ConfigContext";
import { useSemanticRowFilter } from "@/lib/semanticTableSearch";
import type { ServiceConfiguration } from "@/types/models";

const defaultForm = {
  applicationId: "APP123456",
  oldRefId: "00Q9H00000FTmBuUAL",
  customerId: "00Q9H00000FTmBuUAL",
  partnerName: "Finnable",
  programType: "Personal Loan",
  sequenceId: "NEW42343423442e1234231",
  stage: "loan-decision",
  workflowId: "ye5675636464564557fs35354gd456453455wye",
  serviceId: "178",
  sequenceStringOverride: "",
  correlationId: "",
};

export function TestSequencePage() {
  const { bundle } = useConfig();
  const [form, setForm] = useState(defaultForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProcessSequenceTestResult | null>(null);

  const esaRows = useMemo(
    () =>
      [...bundle.serviceConfigurations]
        .filter((r) => !r.is_deleted)
        .sort((a, b) => a.id - b.id),
    [bundle.serviceConfigurations],
  );

  const getEsaPickDoc = useCallback((r: ServiceConfiguration) => {
    return {
      id: String(r.id),
      text: [String(r.id), r.service_name, r.api_url, r.request_method].join(" "),
    };
  }, []);
  const [esaPickSearch, setEsaPickSearch, esaPickRows] = useSemanticRowFilter(
    esaRows,
    getEsaPickDoc,
  );

  const sequenceString = useMemo(() => {
    const o = form.sequenceStringOverride.trim();
    if (o) return o;
    const id = Number(form.serviceId);
    if (!Number.isFinite(id) || id <= 0) return "";
    return `{${id}}`;
  }, [form.serviceId, form.sequenceStringOverride]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!sequenceString) {
      setError("Enter a numeric service id or a custom sequenceString.");
      return;
    }
    setLoading(true);
    try {
      const out = await postProcessSequenceTest(
        {
          applicationId: form.applicationId.trim(),
          oldRefId: form.oldRefId.trim(),
          customerId: form.customerId.trim(),
          partnerName: form.partnerName.trim(),
          programType: form.programType.trim(),
          sequenceId: form.sequenceId.trim(),
          sequenceString,
          stage: form.stage.trim(),
          workflowId: form.workflowId.trim(),
        },
        form.correlationId.trim() || undefined,
      );
      setResult(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const searchInputClass =
    "w-full rounded-xl border border-ink/12 bg-white/90 py-2.5 px-3 text-xs text-ink shadow-inner outline-none ring-accent/0 transition placeholder:text-ink-muted/70 hover:border-ink/18 hover:bg-white focus:border-accent/40 focus:bg-white focus:ring-2 focus:ring-accent/18";

  return (
    <PageStack>
      <PageSection>
        <PageHero
          eyebrow="Test"
          title="Process sequence"
          description={
            <>
              Calls External Service Adapter{" "}
              <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px]">
                /v1/process-sequence/v2
              </code>{" "}
              through the config-console API (key stays on the server). Set{" "}
              <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px]">
                ESA_PROCESS_SEQUENCE_API_KEY
              </code>{" "}
              in <code className="font-mono text-[11px]">server/.env</code>. Requires{" "}
              <code className="font-mono text-[11px]">npm run server</code>. If{" "}
              <code className="font-mono text-[11px]">PORT</code> in{" "}
              <code className="font-mono text-[11px]">server/.env</code> is not{" "}
              <code className="font-mono text-[11px]">4000</code>, set{" "}
              <code className="font-mono text-[11px]">VITE_DEV_API_PROXY_TARGET</code> in{" "}
              <code className="font-mono text-[11px]">.env</code> to that URL and restart{" "}
              <code className="font-mono text-[11px]">npm run dev</code>.
            </>
          }
        />

        <form onSubmit={onSubmit} className="mt-6 space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            label="applicationId"
            value={form.applicationId}
            onChange={(e) => setForm((f) => ({ ...f, applicationId: e.target.value }))}
            autoComplete="off"
          />
          <TextInput
            label="oldRefId"
            value={form.oldRefId}
            onChange={(e) => setForm((f) => ({ ...f, oldRefId: e.target.value }))}
            autoComplete="off"
          />
          <TextInput
            label="customerId"
            value={form.customerId}
            onChange={(e) => setForm((f) => ({ ...f, customerId: e.target.value }))}
            autoComplete="off"
          />
          <TextInput
            label="partnerName"
            value={form.partnerName}
            onChange={(e) => setForm((f) => ({ ...f, partnerName: e.target.value }))}
            autoComplete="off"
          />
          <TextInput
            label="programType"
            value={form.programType}
            onChange={(e) => setForm((f) => ({ ...f, programType: e.target.value }))}
            autoComplete="off"
          />
          <TextInput
            label="sequenceId"
            value={form.sequenceId}
            onChange={(e) => setForm((f) => ({ ...f, sequenceId: e.target.value }))}
            autoComplete="off"
          />
          <TextInput
            label="stage"
            value={form.stage}
            onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value }))}
            autoComplete="off"
          />
          <TextInput
            label="workflowId"
            value={form.workflowId}
            onChange={(e) => setForm((f) => ({ ...f, workflowId: e.target.value }))}
            autoComplete="off"
          />
        </div>

        <div className={innerPanelClass}>
          <h3 className="mb-3 text-sm font-semibold text-esa">sequenceString</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Service id (ESA)"
              type="number"
              min={1}
              step={1}
              value={form.serviceId}
              onChange={(e) => setForm((f) => ({ ...f, serviceId: e.target.value }))}
              hint={`Sent as sequenceString ${sequenceString ? `"${sequenceString}"` : "(invalid id)"}`}
            />
            {esaRows.length > 0 ? (
              <Field label="Pick from loaded services">
                <input
                  type="search"
                  value={esaPickSearch}
                  onChange={(e) => setEsaPickSearch(e.target.value)}
                  placeholder="Filter by id, name, URL…"
                  className={`mb-2 ${searchInputClass}`}
                  autoComplete="off"
                />
                <select
                  className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/20"
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) setForm((f) => ({ ...f, serviceId: v }));
                  }}
                >
                  <option value="">Choose…</option>
                  {esaPickRows.map((r) => (
                    <option key={r.id} value={String(r.id)}>
                      {r.id} — {r.service_name || "(unnamed)"}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-ink-muted">
                  {esaPickRows.length} of {esaRows.length} services
                </p>
              </Field>
            ) : null}
          </div>
          <div className="mt-4">
            <TextArea
              label="Override sequenceString (optional)"
              rows={2}
              value={form.sequenceStringOverride}
              onChange={(e) =>
                setForm((f) => ({ ...f, sequenceStringOverride: e.target.value }))
              }
              hint='Leave empty to use {serviceId}. Example for multiple ids: {178,179} or "{178}" style per your API contract.'
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            label="X-Correlation-ID (optional)"
            value={form.correlationId}
            onChange={(e) => setForm((f) => ({ ...f, correlationId: e.target.value }))}
            placeholder="Leave empty to let the server generate one"
            autoComplete="off"
          />
        </div>

        {error ? (
          <div
            className="rounded-lg border border-warn/50 bg-warn/15 px-4 py-3 text-sm text-ink whitespace-pre-wrap"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg border border-accent/30 bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-accent/90 disabled:opacity-60"
          >
            {loading ? "Sending…" : "Send test request"}
          </button>
          <span className="text-xs text-ink-muted">
            sequenceString preview:{" "}
            <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px]">
              {sequenceString || "—"}
            </code>
          </span>
        </div>
        </form>

        {result ? (
        <div className="mt-8 space-y-2 border-t border-ink/8 pt-6">
          <h3 className="text-sm font-semibold text-ink">Response</h3>
          <p className="text-xs text-ink-muted">
            Upstream HTTP {result.upstreamStatus} · correlationId{" "}
            <code className="font-mono text-[11px]">{result.correlationId}</code> ·{" "}
            {result.ok ? (
              <span className="text-emerald-700">ok</span>
            ) : (
              <span className="text-amber-800">upstream reported failure</span>
            )}
          </p>
          <TextArea
            label="Body (JSON)"
            readOnly
            rows={16}
            value={stringifyJson(result.data)}
            className="text-xs"
          />
        </div>
        ) : null}
      </PageSection>
    </PageStack>
  );
}

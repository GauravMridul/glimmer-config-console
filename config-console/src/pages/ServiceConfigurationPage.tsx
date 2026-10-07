import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { shouldUseApi } from "@/api/backend";
import { useConfig } from "@/context/ConfigContext";
import { Modal } from "@/components/Modal";
import { ServiceConfigHttpProbeModal } from "@/components/ServiceConfigHttpProbeModal";
import {
  EsaCustomFunctionsHelpModal,
  EsaCustomFunctionsReferenceTrigger,
} from "@/components/EsaCustomFunctionsHelpModal";
import {
  DataTableShell,
  PageHero,
  PageSection,
  PageStack,
  SemanticSearchField,
  tableListHeadRowClass,
} from "@/components/PageChrome";
import { TextInput, TextArea } from "@/components/Field";
import { parseJsonObject, stringifyJson } from "@/lib/json";
import type { ServiceConfiguration } from "@/types/models";
import { useSemanticRowFilter } from "@/lib/semanticTableSearch";

function rowToForm(r: ServiceConfiguration) {
  return {
    ...r,
    headers: stringifyJson(r.headers),
    request_body: stringifyJson(r.request_body),
    response_body: stringifyJson(r.response_body),
    additional_config: stringifyJson(r.additional_config),
  };
}

type FormState = ReturnType<typeof rowToForm>;

function parseForm(f: FormState): { ok: true; row: ServiceConfiguration } | { ok: false; error: string } {
  const h = parseJsonObject(f.headers);
  const rb = parseJsonObject(f.request_body);
  const resb = parseJsonObject(f.response_body);
  const ac = parseJsonObject(f.additional_config);
  if (!h.ok) return { ok: false, error: `headers: ${h.error}` };
  if (!rb.ok) return { ok: false, error: `request_body: ${rb.error}` };
  if (!resb.ok) return { ok: false, error: `response_body: ${resb.error}` };
  if (!ac.ok) return { ok: false, error: `additional_config: ${ac.error}` };
  return {
    ok: true,
    row: {
      id: f.id,
      service_name: f.service_name.trim(),
      api_url: f.api_url.trim(),
      headers: h.value as Record<string, unknown>,
      request_body: rb.value as Record<string, unknown>,
      request_method: f.request_method.trim(),
      response_body: resb.value as Record<string, unknown>,
      send_response: f.send_response,
      timeout: Number(f.timeout) || 0,
      additional_config: ac.value as Record<string, unknown>,
      created_date: f.created_date,
      created_by: f.created_by,
      modified_date: f.modified_date,
      modified_by: f.modified_by,
      is_deleted: f.is_deleted,
    },
  };
}

export function ServiceConfigurationPage() {
  const {
    bundle,
    upsertServiceConfiguration,
    removeServiceConfiguration,
    createEmptyServiceConfiguration,
    loading,
  } = useConfig();

  const [searchParams, setSearchParams] = useSearchParams();
  const [editor, setEditor] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [esaCustomHelpOpen, setEsaCustomHelpOpen] = useState(false);
  const [probeOpen, setProbeOpen] = useState(false);
  const [probeRow, setProbeRow] = useState<ServiceConfiguration | null>(null);
  const apiMode = shouldUseApi();
  const openedIdFromQuery = useRef<number | null>(null);

  const rows = bundle.serviceConfigurations.filter((r) => !r.is_deleted);

  const getEsaTableDoc = useCallback((r: ServiceConfiguration) => {
    return {
      id: String(r.id),
      text: [String(r.id), r.service_name, r.api_url, r.request_method, String(r.timeout)].join(" "),
    };
  }, []);
  const [tableSearch, setTableSearch, tableRows] = useSemanticRowFilter(rows, getEsaTableDoc);

  /** Open editor when navigating from partner mapping (or shared links): `/esa?id=123` */
  useEffect(() => {
    const raw = searchParams.get("id");
    if (raw == null) {
      openedIdFromQuery.current = null;
      return;
    }
    const id = Number(raw);
    if (!Number.isFinite(id)) {
      setSearchParams(
        (p) => {
          const n = new URLSearchParams(p);
          n.delete("id");
          return n;
        },
        { replace: true },
      );
      return;
    }
    if (loading) return;

    const row = bundle.serviceConfigurations.find((r) => !r.is_deleted && r.id === id);
    if (row) {
      if (openedIdFromQuery.current !== id) {
        openedIdFromQuery.current = id;
        setError(null);
        setEditor(rowToForm(row));
      }
    } else {
      setError(
        `Service id ${id} is not in the loaded ESA config. Use “Reload from database” if you use API mode, or check the id.`,
      );
      openedIdFromQuery.current = null;
    }

    setSearchParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.delete("id");
        return n;
      },
      { replace: true },
    );
  }, [
    searchParams,
    bundle.serviceConfigurations,
    loading,
    setSearchParams,
  ]);

  const openNew = () => {
    setError(null);
    setEditor(rowToForm(createEmptyServiceConfiguration()));
  };

  const openEdit = (r: ServiceConfiguration) => {
    setError(null);
    setEditor(rowToForm(r));
  };

  const openTestRequest = () => {
    if (!editor) return;
    const parsed = parseForm(editor);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setProbeRow(parsed.row);
    setProbeOpen(true);
  };

  const save = async () => {
    if (!editor) return;
    if (!editor.service_name.trim() || !editor.api_url.trim()) {
      setError("service_name and api_url are required.");
      return;
    }
    const parsed = parseForm(editor);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    try {
      await upsertServiceConfiguration(parsed.row);
      setEditor(null);
      setError(null);
    } catch {
      /* global error banner in Layout */
    }
  };

  return (
    <PageStack>
      <PageSection>
        <PageHero
          eyebrow="External APIs"
          title="External APIs"
          description={
            <>
              HTTP calls the Decision Manager runs: URL, method, JSON request/response templates, and
              timeouts. Table: <code className="font-mono text-xs">service_configuration</code>.
            </>
          }
          afterDescription={
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              <EsaCustomFunctionsReferenceTrigger onClick={() => setEsaCustomHelpOpen(true)} />
              <Link
                to="/expressions#esa-custom"
                className="font-medium text-accent hover:underline"
              >
                Full-page reference
              </Link>
              <span className="text-ink-muted">
                <code className="font-mono text-[11px]">{"{{CUSTOM:…}}"}</code> in external-service-adapter
              </span>
            </div>
          }
          action={
            <button
              type="button"
              onClick={openNew}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-hover"
            >
              Add service
            </button>
          }
        />

        <div className="mt-5">
          <SemanticSearchField
            id="esa-table-search"
            label="Filter table"
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
            placeholder="service name, id, URL, method…"
            footer={
              <>
                Showing <span className="tabular-nums font-medium text-ink">{tableRows.length}</span> of{" "}
                <span className="tabular-nums font-medium text-ink">{rows.length}</span> rows
              </>
            }
          />
        </div>

        <DataTableShell className="mt-5">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead>
              <tr className={tableListHeadRowClass}>
                <th className="px-4 py-3.5 pr-3">id</th>
                <th className="px-4 py-3.5 pr-3">service_name</th>
                <th className="px-4 py-3.5 pr-3">method</th>
                <th className="px-4 py-3.5 pr-3">api_url</th>
                <th className="px-4 py-3.5 pr-3">timeout</th>
                <th className="px-4 py-3.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/[0.06]">
            {tableRows.map((r) => (
              <tr key={r.id} className="transition-colors hover:bg-ink/[0.025]">
                <td className="px-4 py-2.5 font-mono text-xs">{r.id}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{r.service_name}</td>
                <td className="px-4 py-2.5">{r.request_method}</td>
                <td className="max-w-xs truncate px-4 py-2.5 text-ink-muted">{r.api_url}</td>
                <td className="px-4 py-2.5">{r.timeout}s</td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => openEdit(r)}
                    className="mr-2 text-accent hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeServiceConfiguration(r.id)}
                    className="text-ink-muted hover:text-ink"
                  >
                    Soft delete
                  </button>
                </td>
              </tr>
            ))}
            </tbody>
          </table>
        </DataTableShell>
      </PageSection>

      <Modal
        title={
          editor && editor.id === 0
            ? "New External API service"
            : "Edit External API service"
        }
        open={!!editor}
        onClose={() => setEditor(null)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setEditor(null)}
              className="rounded-lg border border-ink/15 px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={openTestRequest}
              disabled={!apiMode}
              title={
                apiMode
                  ? "Send the current form values through the config-console server (see modal for caveats)."
                  : "Turn on API mode (VITE_USE_API) and run npm run server so test requests can be proxied without CORS issues."
              }
              className="rounded-lg border border-ink/15 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-45"
            >
              Test request
            </button>
            <button
              type="button"
              onClick={save}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
            >
              Save
            </button>
          </>
        }
      >
        {editor ? (
          <div className="space-y-4">
            {error ? (
              <div className="rounded-lg border border-warn/40 bg-warn/15 px-3 py-2 text-sm text-ink">
                {error}
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput
                label="service_name"
                value={editor.service_name}
                onChange={(e) => setEditor({ ...editor, service_name: e.target.value })}
              />
              <TextInput
                label="request_method"
                value={editor.request_method}
                onChange={(e) => setEditor({ ...editor, request_method: e.target.value })}
              />
              <TextInput
                label="timeout (seconds)"
                type="number"
                value={editor.timeout}
                onChange={(e) =>
                  setEditor({ ...editor, timeout: Number(e.target.value) })
                }
              />
              <label className="flex items-start gap-2 pt-6">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={editor.send_response}
                  onChange={(e) =>
                    setEditor({ ...editor, send_response: e.target.checked })
                  }
                />
                <span>
                  <span className="block text-sm font-medium text-ink">
                    Return response to caller
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    When off, downstream steps may not see this service’s body.
                  </span>
                </span>
              </label>
            </div>
            <TextInput
              label="api_url"
              value={editor.api_url}
              onChange={(e) => setEditor({ ...editor, api_url: e.target.value })}
            />
            <TextArea
              label="headers (JSON)"
              rows={4}
              value={editor.headers}
              onChange={(e) => setEditor({ ...editor, headers: e.target.value })}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-esa/25 bg-esa/[0.07] px-3 py-2.5">
              <p className="text-xs leading-relaxed text-ink">
                Headers, <span className="font-medium">request_body</span>, and{" "}
                <span className="font-medium">additional_config</span> can use{" "}
                <code className="rounded bg-white/80 px-1 font-mono text-[10px] text-ink">
                  {"{{CUSTOM:…}}"}
                </code>
                ,{" "}
                <code className="rounded bg-white/80 px-1 font-mono text-[10px] text-ink">
                  {"{{TRANSFORM:…}}"}
                </code>
                , and{" "}
                <code className="rounded bg-white/80 px-1 font-mono text-[10px] text-ink">
                  {"{{ARRAY:…}}"}
                </code>
                .
              </p>
              <EsaCustomFunctionsReferenceTrigger onClick={() => setEsaCustomHelpOpen(true)} />
            </div>
            <TextArea
              label="request_body (JSON)"
              rows={5}
              value={editor.request_body}
              onChange={(e) => setEditor({ ...editor, request_body: e.target.value })}
            />
            <TextArea
              label="response_body (JSON)"
              rows={4}
              value={editor.response_body}
              onChange={(e) => setEditor({ ...editor, response_body: e.target.value })}
            />
            <TextArea
              label="additional_config (JSON)"
              hint="Auth tokens, mTLS, storage paths—see your ESA deployment guide."
              rows={5}
              value={editor.additional_config}
              onChange={(e) =>
                setEditor({ ...editor, additional_config: e.target.value })
              }
            />
          </div>
        ) : null}
      </Modal>

      <EsaCustomFunctionsHelpModal open={esaCustomHelpOpen} onClose={() => setEsaCustomHelpOpen(false)} />

      {probeRow ? (
        <ServiceConfigHttpProbeModal
          open={probeOpen}
          onClose={() => {
            setProbeOpen(false);
            setProbeRow(null);
          }}
          row={probeRow}
        />
      ) : null}
    </PageStack>
  );
}

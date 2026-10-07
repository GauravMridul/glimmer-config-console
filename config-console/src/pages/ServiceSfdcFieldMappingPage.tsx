import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useConfig } from "@/context/ConfigContext";
import { Modal } from "@/components/Modal";
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
import { useSemanticRowFilter } from "@/lib/semanticTableSearch";
import type { ServiceSfdcFieldMapping } from "@/types/models";

type FormState = Omit<ServiceSfdcFieldMapping, "request_body"> & {
  request_body: string;
};

function rowToForm(r: ServiceSfdcFieldMapping): FormState {
  return {
    ...r,
    request_body: stringifyJson(r.request_body),
  };
}

export function ServiceSfdcFieldMappingPage() {
  const {
    bundle,
    upsertSfdcMapping,
    removeSfdcMapping,
    createEmptySfdcMapping,
    loading,
  } = useConfig();

  const [searchParams, setSearchParams] = useSearchParams();
  const [editor, setEditor] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openedIdFromQuery = useRef<number | null>(null);

  const rows = bundle.sfdcMappings.filter((r) => !r.is_deleted);

  const getSfdcTableDoc = useCallback((r: ServiceSfdcFieldMapping) => {
    const bodySnippet = stringifyJson(r.request_body, false).slice(0, 1200);
    return {
      id: String(r.id),
      text: [String(r.id), r.service_name, bodySnippet, "composite salesforce stamping"].join(" "),
    };
  }, []);
  const [tableSearch, setTableSearch, tableRows] = useSemanticRowFilter(rows, getSfdcTableDoc);

  /** Open editor from universal search: `/sfdc?id=123` */
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

    const row = bundle.sfdcMappings.find((r) => !r.is_deleted && r.id === id);
    if (row) {
      if (openedIdFromQuery.current !== id) {
        openedIdFromQuery.current = id;
        setError(null);
        setEditor(rowToForm(row));
      }
    } else {
      setError(
        `Data Stamping id ${id} is not in the loaded config. Use “Reload from database” in API mode, or check the id.`,
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
  }, [searchParams, bundle.sfdcMappings, loading, setSearchParams]);

  const save = async () => {
    if (!editor) return;
    if (!editor.service_name.trim()) {
      setError("service_name is required.");
      return;
    }
    const parsed = parseJsonObject(editor.request_body);
    if (!parsed.ok) {
      setError(`request_body: ${parsed.error}`);
      return;
    }
    if (!Array.isArray(parsed.value)) {
      setError("request_body must be a JSON array (Composite sub-requests).");
      return;
    }
    setError(null);
    try {
      await upsertSfdcMapping({
        id: editor.id,
        service_name: editor.service_name.trim(),
        request_body: parsed.value,
        created_date: editor.created_date,
        created_by: editor.created_by,
        modified_date: editor.modified_date,
        modified_by: editor.modified_by,
        is_deleted: editor.is_deleted,
      });
      setEditor(null);
    } catch {
      /* Layout shows API error */
    }
  };

  return (
    <PageStack>
      <PageSection>
        <PageHero
          eyebrow="Data Stamping"
          eyebrowClassName="text-[11px] font-semibold uppercase tracking-[0.12em] text-dm"
          title="Data Stamping"
          description={
            <>
              Maps ESA output into Salesforce Composite sub-requests. Linked to External APIs only by{" "}
              <code className="font-mono text-xs">service_name</code>. Table:{" "}
              <code className="font-mono text-xs">service_sfdc_field_mapping</code>.{" "}
              <Link
                to="/expressions#dm-expressions"
                className="font-medium text-dm hover:underline"
              >
                DM expression functions
              </Link>{" "}
              (<code className="font-mono text-xs">{"{{ … }}"}</code>) are evaluated by decision-manager.
            </>
          }
          action={
            <button
              type="button"
              onClick={() => {
                setError(null);
                setEditor(rowToForm(createEmptySfdcMapping()));
              }}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-hover"
            >
              Add mapping
            </button>
          }
        />

        {error && !editor ? (
          <div
            className="mt-4 rounded-lg border border-warn/40 bg-warn/15 px-3 py-2 text-sm text-ink"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        <div className="mt-5">
          <SemanticSearchField
            id="sfdc-table-search"
            label="Filter table"
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
            placeholder="service_name, id, composite field names…"
            footer={
              <>
                Showing <span className="tabular-nums font-medium text-ink">{tableRows.length}</span> of{" "}
                <span className="tabular-nums font-medium text-ink">{rows.length}</span> rows
              </>
            }
          />
        </div>

        <DataTableShell className="mt-5">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead>
              <tr className={tableListHeadRowClass}>
                <th className="px-4 py-3.5 pr-3">id</th>
                <th className="px-4 py-3.5 pr-3">service_name</th>
                <th className="px-4 py-3.5 pr-3">request_body</th>
                <th className="px-4 py-3.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/[0.06]">
            {tableRows.map((r) => (
              <tr key={r.id} className="transition-colors hover:bg-ink/[0.025]">
                <td className="px-4 py-2.5 font-mono text-xs">{r.id}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{r.service_name}</td>
                <td className="max-w-md truncate px-4 py-2.5 font-mono text-xs text-ink-muted">
                  {stringifyJson(r.request_body, false)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setEditor(rowToForm(r));
                    }}
                    className="mr-2 text-accent hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeSfdcMapping(r.id)}
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
            ? "New Data Stamping mapping"
            : "Edit Data Stamping mapping"
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
              <div className="rounded-lg border border-warn/40 bg-warn/15 px-3 py-2 text-sm">
                {error}
              </div>
            ) : null}
            <TextInput
              label="service_name"
              hint="Must match the ESA service_name this stamping belongs to."
              value={editor.service_name}
              onChange={(e) =>
                setEditor({ ...editor, service_name: e.target.value })
              }
            />
            <TextArea
              label="request_body (JSON array)"
              hint="Composite sub-requests: url, method, referenceId, body, merge, arrayPath…"
              rows={18}
              value={editor.request_body}
              onChange={(e) =>
                setEditor({ ...editor, request_body: e.target.value })
              }
            />
          </div>
        ) : null}
      </Modal>
    </PageStack>
  );
}

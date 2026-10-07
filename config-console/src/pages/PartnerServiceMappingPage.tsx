import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useConfig } from "@/context/ConfigContext";
import { Modal } from "@/components/Modal";
import {
  DataTableShell,
  PageHero,
  PageSection,
  PageStack,
  SemanticSearchField,
  tableListHeadRowClassPlain,
} from "@/components/PageChrome";
import { PartnerSequenceBuilder } from "@/components/PartnerSequenceBuilder";
import { PartnerSequenceListCell } from "@/components/PartnerSequenceListCell";
import { TextInput } from "@/components/Field";
import {
  fetchConfig,
  putOrCreatePartnerMapping,
  shouldUseApi,
  validatePartnerSequenceRemote,
} from "@/api/backend";
import {
  computeRecommendedSequence,
  formatRecommendedSequenceString,
  validatePartnerSequence,
  type PartnerSequenceValidationResult,
} from "@/lib/partnerSequenceValidation";
import { mergeServiceCatalogForPartnerUi } from "@/lib/partnerServiceCatalog";
import { parseSequenceGroups } from "@/lib/sequence";
import serviceIdNameSeed from "@/data/serviceConfigurationIdNames.seed.json";
import type { PartnerServiceMapping, ServiceConfiguration } from "@/types/models";
import { useSemanticRowFilter } from "@/lib/semanticTableSearch";

const SERVICE_ID_NAME_SEED = serviceIdNameSeed as {
  services: ReadonlyArray<{ id: number; service_name: string }>;
};

function toggleSetMember(prev: ReadonlySet<string>, value: string): Set<string> {
  const next = new Set(prev);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** Button opens a portaled panel (avoids table overflow clip). Empty selection = show all. */
function ColumnMultiCheckboxFilter({
  options,
  selected,
  onChange,
  ariaLabel,
}: {
  options: string[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [entered, setEntered] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, width: 220 });

  const updatePosition = useCallback(() => {
    const el = buttonRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, 216);
    let left = r.left;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8);
    }
    setPanelPos({ top: r.bottom + 6, left, width });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const onWin = () => updatePosition();
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, true);
    return () => {
      window.removeEventListener("resize", onWin);
      window.removeEventListener("scroll", onWin, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => setEntered(true)),
    );
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const summary =
    selected.size === 0
      ? "Filter…"
      : selected.size === 1
        ? [...selected][0].length > 18
          ? `${[...selected][0].slice(0, 16)}…`
          : [...selected][0]
        : `${selected.size} selected`;

  const panel = open
    ? createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label={ariaLabel}
          className={[
            "fixed z-[200] overflow-hidden rounded-xl border border-ink/12",
            "bg-gradient-to-b from-white via-white to-slate-50/95",
            "shadow-[0_1px_0_rgba(255,255,255,0.85)_inset,0_2px_6px_rgba(15,23,42,0.06),0_12px_28px_rgba(15,23,42,0.12),0_24px_48px_rgba(15,23,42,0.08)]",
            "ring-1 ring-black/[0.04]",
            "origin-top transition-[opacity,transform,filter] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
            entered
              ? "translate-y-0 scale-100 opacity-100"
              : "-translate-y-1 scale-[0.98] opacity-0",
          ].join(" ")}
          style={{
            top: panelPos.top,
            left: panelPos.left,
            width: panelPos.width,
          }}
        >
          <div className="border-b border-ink/8 bg-gradient-to-b from-slate-50/80 to-transparent px-3 py-2">
            <p className="text-[10px] font-medium tracking-wide text-ink-muted uppercase">
              {ariaLabel}
            </p>
            <p className="mt-0.5 text-[10px] text-ink-muted">None checked = show all rows</p>
          </div>
          <div className="max-h-52 overflow-y-auto px-2 py-2">
            {options.length === 0 ? (
              <span className="block px-2 py-2 text-[11px] text-ink-muted">—</span>
            ) : (
              options.map((opt) => (
                <label
                  key={opt}
                  className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-100/90"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 shrink-0 rounded border-ink/25"
                    checked={selected.has(opt)}
                    onChange={() => onChange(toggleSetMember(selected, opt))}
                  />
                  <span className="min-w-0 break-words text-xs leading-snug text-ink">{opt}</span>
                </label>
              ))
            )}
          </div>
          {selected.size > 0 ? (
            <div className="border-t border-ink/8 bg-slate-50/50 px-2 py-2">
              <button
                type="button"
                className="w-full rounded-lg border border-ink/10 bg-white px-2 py-1.5 text-left text-[11px] font-medium text-accent shadow-[0_1px_0_rgba(255,255,255,0.9)_inset,0_1px_2px_rgba(15,23,42,0.06)] transition hover:border-accent/25 hover:shadow-md active:translate-y-px"
                onClick={() => onChange(new Set())}
              >
                Clear filter
              </button>
            </div>
          ) : null}
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="relative inline-block w-full min-w-0">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${ariaLabel}: ${summary}`}
        onClick={() => setOpen((o) => !o)}
        className={[
          "flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-ink/14",
          "bg-gradient-to-b from-white to-slate-100/90 px-2.5 py-2 text-left text-xs font-medium text-ink",
          "shadow-[0_1px_0_rgba(255,255,255,0.95)_inset,0_2px_4px_rgba(15,23,42,0.07),0_6px_16px_rgba(15,23,42,0.06)]",
          "ring-1 ring-black/[0.03] transition-all duration-150 ease-out",
          "hover:to-slate-50 hover:shadow-[0_1px_0_rgba(255,255,255,0.95)_inset,0_4px_10px_rgba(15,23,42,0.1),0_12px_28px_rgba(15,23,42,0.08)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35",
          open ? "border-accent/30 ring-accent/20" : "",
          "active:translate-y-px active:shadow-[0_1px_0_rgba(255,255,255,0.9)_inset,0_1px_3px_rgba(15,23,42,0.08)]",
        ].join(" ")}
      >
        <span className="min-w-0 truncate">{summary}</span>
        <span
          className={`shrink-0 text-ink-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          ▾
        </span>
      </button>
      {panel}
    </div>
  );
}

/** One line per parallel stage (semicolon group); narrow column with wrap. */
function SequenceStagesTableCell({
  raw,
  tone = "muted",
}: {
  raw: string;
  tone?: "muted" | "ink";
}) {
  const trimmed = raw?.trim() ?? "";
  const textCls = tone === "ink" ? "text-ink" : "text-ink-muted";
  if (!trimmed) {
    return <span className={textCls}>—</span>;
  }
  const groups = parseSequenceGroups(trimmed);
  if (groups.length === 0) {
    return (
      <span className={`break-all font-mono text-xs ${textCls}`} title={trimmed}>
        {trimmed}
      </span>
    );
  }
  return (
    <div className={`space-y-1 font-mono text-[11px] leading-snug ${textCls}`}>
      {groups.map((g, i) => (
        <div
          key={i}
          className="break-all border-l-2 border-dm/25 pl-2"
          title={`Stage ${i + 1} — parallel ids (comma-separated)`}
        >
          {g.join(",")}
        </div>
      ))}
    </div>
  );
}

function RecommendedSequenceTableCell({
  rec,
}: {
  rec:
    | {
        text: string;
        empty: boolean;
        cycle: boolean;
      }
    | undefined;
}) {
  if (!rec || rec.empty) {
    return (
      <span className="text-ink-muted" title="No sequence">
        —
      </span>
    );
  }
  if (rec.cycle) {
    return (
      <span
        className="text-warn"
        title="Dependencies form a cycle among these ids — no valid order."
      >
        (cycle)
      </span>
    );
  }
  return <SequenceStagesTableCell raw={rec.text} tone="ink" />;
}

export function PartnerServiceMappingPage() {
  const {
    bundle,
    setBundle,
    upsertPartnerMapping,
    removePartnerMapping,
    createEmptyPartnerMapping,
    loading,
  } = useConfig();

  const [searchParams, setSearchParams] = useSearchParams();
  const openedPartnerIdFromQuery = useRef<number | null>(null);
  const [editor, setEditor] = useState<PartnerServiceMapping | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  /** Fresh ESA rows from GET /api/config — required so validation sees real request_body for ids 40, 178, … */
  const [esaSnapshot, setEsaSnapshot] = useState<ServiceConfiguration[] | null>(null);
  const [esaLoading, setEsaLoading] = useState(false);
  const [esaLoadError, setEsaLoadError] = useState<string | null>(null);
  const [partnerFilterSelected, setPartnerFilterSelected] = useState<Set<string>>(
    () => new Set(),
  );
  const [stageFilterSelected, setStageFilterSelected] = useState<Set<string>>(() => new Set());

  const rows = bundle.partnerMappings.filter((r) => !r.is_deleted);

  const partnerFilterOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      const v = (r.partner_name ?? "").trim();
      if (v) s.add(v);
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const stageFilterOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      const v = (r.stage ?? "").trim();
      if (v) s.add(v);
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      const p = (r.partner_name ?? "").trim();
      const st = (r.stage ?? "").trim();
      if (partnerFilterSelected.size > 0 && !partnerFilterSelected.has(p)) return false;
      if (stageFilterSelected.size > 0 && !stageFilterSelected.has(st)) return false;
      return true;
    });
  }, [rows, partnerFilterSelected, stageFilterSelected]);

  const getPartnerTableDoc = useCallback((r: PartnerServiceMapping) => {
    return {
      id: String(r.id),
      text: [
        String(r.id),
        r.name,
        r.partner_name,
        r.stage,
        r.program_type,
        r.business_type,
        r.sourcing_program,
        r.loan_category,
        r.customer_type,
        r.product_line,
        r.service_sequence_string,
      ]
        .filter(Boolean)
        .join(" "),
    };
  }, []);
  const [tableSearch, setTableSearch, listRows] = useSemanticRowFilter(
    filteredRows,
    getPartnerTableDoc,
  );

  /** Open editor from universal search: `/partners?id=123` */
  useEffect(() => {
    const raw = searchParams.get("id");
    if (raw == null) {
      openedPartnerIdFromQuery.current = null;
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

    const row = bundle.partnerMappings.find((r) => !r.is_deleted && r.id === id);
    if (row) {
      if (openedPartnerIdFromQuery.current !== id) {
        openedPartnerIdFromQuery.current = id;
        setError(null);
        setEditor({ ...row });
      }
    } else {
      setError(
        `Partner mapping id ${id} is not in the loaded config. Use “Reload from database” in API mode, or check the id.`,
      );
      openedPartnerIdFromQuery.current = null;
    }

    setSearchParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.delete("id");
        return n;
      },
      { replace: true },
    );
  }, [searchParams, bundle.partnerMappings, loading, setSearchParams]);

  useEffect(() => {
    if (!editor) {
      setEsaSnapshot(null);
      setEsaLoadError(null);
      setEsaLoading(false);
      return;
    }
    if (!shouldUseApi()) {
      setEsaSnapshot(null);
      setEsaLoadError(null);
      return;
    }
    let cancelled = false;
    setEsaLoading(true);
    setEsaLoadError(null);
    void fetchConfig()
      .then((b) => {
        if (!cancelled) {
          setEsaSnapshot(b.serviceConfigurations);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setEsaSnapshot(null);
          setEsaLoadError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setEsaLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editor]);

  const esaRowsForValidation = useMemo((): ServiceConfiguration[] => {
    if (!shouldUseApi()) return bundle.serviceConfigurations;
    return esaSnapshot ?? bundle.serviceConfigurations;
  }, [esaSnapshot, bundle.serviceConfigurations]);

  /** Live ESA rows + bundled id→service_name (from export) so dropdowns show names for all known ids. */
  const partnerSequenceServices = useMemo(
    () =>
      mergeServiceCatalogForPartnerUi(esaRowsForValidation, SERVICE_ID_NAME_SEED.services),
    [esaRowsForValidation],
  );

  const sequenceValidation = useMemo(() => {
    if (!editor?.service_sequence_string?.trim()) return null;
    if (shouldUseApi() && esaLoading) return null;
    return validatePartnerSequence(editor.service_sequence_string, esaRowsForValidation);
  }, [editor?.service_sequence_string, esaRowsForValidation, esaLoading]);

  /** Per-row sequence checks for the table (uses loaded ESA bundle; refresh after API sync). */
  const listRowSequenceValidation = useMemo(() => {
    const m = new Map<number, PartnerSequenceValidationResult | null>();
    const svcs = bundle.serviceConfigurations;
    for (const r of rows) {
      const raw = r.service_sequence_string?.trim() ?? "";
      if (!raw) {
        m.set(r.id, null);
        continue;
      }
      m.set(r.id, validatePartnerSequence(raw, svcs));
    }
    return m;
  }, [rows, bundle.serviceConfigurations]);

  /** Dependency-aware suggested ordering (same ids; stages maximize parallelism). */
  const listRowRecommendedSequence = useMemo(() => {
    const m = new Map<
      number,
      { text: string; empty: boolean; cycle: boolean }
    >();
    const svcs = bundle.serviceConfigurations;
    for (const r of rows) {
      const raw = r.service_sequence_string?.trim() ?? "";
      if (!raw) {
        m.set(r.id, { text: "", empty: true, cycle: false });
        continue;
      }
      const rec = computeRecommendedSequence(raw, svcs);
      if (!rec.ok) {
        m.set(r.id, { text: "", empty: false, cycle: true });
        continue;
      }
      m.set(r.id, {
        text: formatRecommendedSequenceString(rec),
        empty: false,
        cycle: false,
      });
    }
    return m;
  }, [rows, bundle.serviceConfigurations]);

  const validateEditorForDatabase = async (): Promise<string | null> => {
    if (!editor) return "Nothing to save.";
    if (
      !editor.name.trim() ||
      !editor.partner_name.trim() ||
      !editor.stage.trim() ||
      !editor.service_sequence_string.trim()
    ) {
      return "name, partner_name, stage, and service_sequence_string are required.";
    }
    let v;
    if (shouldUseApi()) {
      try {
        v = await validatePartnerSequenceRemote(editor.service_sequence_string);
      } catch (e: unknown) {
        return `Could not validate the sequence against the server (ESA DB): ${e instanceof Error ? e.message : String(e)}`;
      }
    } else {
      v = validatePartnerSequence(
        editor.service_sequence_string,
        bundle.serviceConfigurations,
      );
    }
    if (v.hasErrors) {
      return "Fix sequence dependency errors below before pushing (or clear the sequence to skip validation).";
    }
    return null;
  };

  const saveLocally = async () => {
    const msg = await validateEditorForDatabase();
    if (msg) {
      setError(msg);
      return;
    }
    setError(null);
    try {
      await upsertPartnerMapping(editor!);
      setEditor(null);
    } catch {
      /* Layout shows API error */
    }
  };

  const pushToDatabase = async () => {
    if (!editor) return;
    const msg = await validateEditorForDatabase();
    if (msg) {
      setError(msg);
      return;
    }
    setError(null);
    setPushing(true);
    try {
      if (shouldUseApi()) {
        await upsertPartnerMapping(editor);
        setEditor(null);
      } else {
        const draft = editor;
        const serverRow = await putOrCreatePartnerMapping(draft);
        setBundle((b) => {
          const rest = b.partnerMappings.filter((x) => x.id !== draft.id);
          const ix = rest.findIndex((x) => x.id === serverRow.id);
          if (ix >= 0) {
            const list = [...rest];
            list[ix] = serverRow;
            return { ...b, partnerMappings: list };
          }
          return { ...b, partnerMappings: [...rest, serverRow] };
        });
        setEditor(null);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPushing(false);
    }
  };

  return (
    <PageStack>
      <PageSection>
        <PageHero
          eyebrow="Partners"
          title="Partners and Stages"
          description={
            <>
              Which ESA service sequence runs for each partner and journey.{" "}
              <strong className="font-medium text-ink">Recommended</strong> is a dependency-correct
              ordering (same ids, stages merged for parallelism).{" "}
              <strong className="font-medium text-ink">Check</strong> flags ordering
              issues—reload from the header after DB changes. Downstream services that use{" "}
              <code className="font-mono text-[11px]">((acticoData.body…))</code> depend on the{" "}
              <code className="font-mono text-[11px]">acticoData</code> API. For the{" "}
              <code className="font-mono text-[11px]">acticoData</code> row only, prerequisites are limited to{" "}
              <code className="font-mono text-[11px]">CIBIL</code> and{" "}
              <code className="font-mono text-[11px]">CRIF</code> (payload{" "}
              <code className="font-mono text-[11px]">Cibil_Data</code> /{" "}
              <code className="font-mono text-[11px]">Crif_Data</code>). Use{" "}
              <strong className="font-medium text-ink">Push to database</strong> in the editor to write this
              row to <code className="font-mono text-[11px]">partner_service_mapping</code>.
            </>
          }
          action={
            <button
              type="button"
              onClick={() => {
                setError(null);
                setEditor(createEmptyPartnerMapping());
              }}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-hover"
            >
              Add mapping
            </button>
          }
        />

        <div className="mt-5">
          <SemanticSearchField
            id="partner-table-search"
            label="Filter rows (after column filters)"
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
            placeholder="name, partner, stage, sequence ids…"
            footer={
              <>
                Showing <span className="tabular-nums font-medium text-ink">{listRows.length}</span> of{" "}
                <span className="tabular-nums font-medium text-ink">{filteredRows.length}</span> visible rows
              </>
            }
          />
        </div>

        {error && !editor ? (
          <div
            className="mt-4 rounded-lg border border-warn/40 bg-warn/15 px-3 py-2 text-sm text-ink"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        <DataTableShell className="mt-5">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead>
              <tr className={tableListHeadRowClassPlain}>
                <th className="px-4 py-3.5 pr-3 font-medium">id</th>
                <th className="px-4 py-3.5 pr-3 font-medium">name</th>
                <th className="min-w-[11rem] max-w-[14rem] px-4 py-3.5 pr-3 font-medium align-top">
                <div className="flex flex-col gap-1.5">
                  <span>partner</span>
                  <ColumnMultiCheckboxFilter
                    options={partnerFilterOptions}
                    selected={partnerFilterSelected}
                    onChange={setPartnerFilterSelected}
                    ariaLabel="Filter by partner"
                  />
                </div>
              </th>
              <th className="min-w-[11rem] max-w-[14rem] px-4 py-3.5 pr-3 font-medium align-top">
                <div className="flex flex-col gap-1.5">
                  <span>stage</span>
                  <ColumnMultiCheckboxFilter
                    options={stageFilterOptions}
                    selected={stageFilterSelected}
                    onChange={setStageFilterSelected}
                    ariaLabel="Filter by stage"
                  />
                </div>
              </th>
              <th
                className="max-w-[14rem] px-4 py-3.5 pr-3 font-medium"
                title="Each line is one stage; commas = parallel within that stage"
              >
                sequence
              </th>
              <th
                className="max-w-[14rem] px-4 py-3.5 pr-3 font-medium"
                title="Dependency-aware order; acticoData service only requires CIBIL+CRIF before it; others referencing acticoData depend on acticoData."
              >
                Recommended
              </th>
              <th
                className="min-w-[12rem] max-w-xs px-4 py-3.5 pr-3 font-medium"
                title="Same rules as Recommended."
              >
                Check
              </th>
              <th className="px-4 py-3.5 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/[0.06]">
            {filteredRows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-10 text-center text-sm text-ink-muted"
                >
                  No mappings match the selected filters.
                </td>
              </tr>
            ) : listRows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-10 text-center text-sm text-ink-muted"
                >
                  No mappings match the semantic search.
                </td>
              </tr>
            ) : null}
            {listRows.map((r) => (
              <tr key={r.id} className="transition-colors hover:bg-ink/[0.025]">
                <td className="px-4 py-2.5 font-mono text-xs">{r.id}</td>
                <td className="px-4 py-2.5">{r.name}</td>
                <td className="px-4 py-2.5">{r.partner_name}</td>
                <td className="px-4 py-2.5">{r.stage}</td>
                <td className="max-w-[14rem] align-top px-4 py-2.5">
                  <SequenceStagesTableCell raw={r.service_sequence_string} />
                </td>
                <td className="max-w-[14rem] px-4 py-2.5 align-top font-mono text-xs text-ink">
                  <RecommendedSequenceTableCell
                    rec={listRowRecommendedSequence.get(r.id)}
                  />
                </td>
                <td className="max-w-xs align-top px-4 py-2.5">
                  <PartnerSequenceListCell
                    empty={!r.service_sequence_string?.trim()}
                    result={listRowSequenceValidation.get(r.id) ?? null}
                  />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setEditor({ ...r });
                    }}
                    className="mr-2 text-accent hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void removePartnerMapping(r.id)}
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
            ? "New Partners and Stages mapping"
            : "Edit Partners and Stages mapping"
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
            {shouldUseApi() ? null : (
              <button
                type="button"
                onClick={() => void saveLocally()}
                disabled={pushing}
                className="rounded-lg border border-ink/15 px-4 py-2 text-sm font-medium text-ink hover:border-accent/25 disabled:opacity-50"
              >
                Save locally
              </button>
            )}
            <button
              type="button"
              onClick={() => void pushToDatabase()}
              disabled={pushing}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {pushing ? "Pushing…" : "Push to database"}
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
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput
                label="name"
                value={editor.name}
                onChange={(e) => setEditor({ ...editor, name: e.target.value })}
              />
              <TextInput
                label="partner_name"
                value={editor.partner_name}
                onChange={(e) =>
                  setEditor({ ...editor, partner_name: e.target.value })
                }
              />
              <TextInput
                label="program_type"
                value={editor.program_type}
                onChange={(e) =>
                  setEditor({ ...editor, program_type: e.target.value })
                }
              />
              <TextInput
                label="business_type"
                value={editor.business_type}
                onChange={(e) =>
                  setEditor({ ...editor, business_type: e.target.value })
                }
              />
              <TextInput
                label="sourcing_program"
                value={editor.sourcing_program}
                onChange={(e) =>
                  setEditor({ ...editor, sourcing_program: e.target.value })
                }
              />
              <TextInput
                label="loan_category"
                value={editor.loan_category}
                onChange={(e) =>
                  setEditor({ ...editor, loan_category: e.target.value })
                }
              />
              <TextInput
                label="customer_type"
                value={editor.customer_type}
                onChange={(e) =>
                  setEditor({ ...editor, customer_type: e.target.value })
                }
              />
              <TextInput
                label="product_line"
                value={editor.product_line}
                onChange={(e) =>
                  setEditor({ ...editor, product_line: e.target.value })
                }
              />
              <TextInput
                label="stage"
                value={editor.stage}
                onChange={(e) => setEditor({ ...editor, stage: e.target.value })}
              />
              <div className="sm:col-span-2">
                <p className="mb-2 text-xs font-medium text-ink">Service sequence</p>
                <p className="mb-3 text-xs text-ink-muted">
                  <strong className="font-medium text-ink-muted">Syntax:</strong> comma = run in
                  parallel in one stage; semicolon = next stage. Example{" "}
                  <code className="font-mono text-[11px]">40,101,88;3;5</code>. Labels come from ESA
                  plus any bundled id→name catalog.
                </p>
                <PartnerSequenceBuilder
                  value={editor.service_sequence_string}
                  onChange={(next) =>
                    setEditor({ ...editor, service_sequence_string: next })
                  }
                  services={partnerSequenceServices}
                />
                {!shouldUseApi() ? (
                  <p className="mt-2 text-xs text-warn">
                    Validation uses local data only. Enable the API to check dependencies against live
                    ESA request bodies.
                  </p>
                ) : null}
                {shouldUseApi() && esaLoading ? (
                  <p className="mt-2 text-xs text-ink-muted">Loading ESA services for validation…</p>
                ) : null}
                {shouldUseApi() && esaLoadError ? (
                  <p className="mt-2 text-xs text-warn" role="alert">
                    Could not refresh ESA from API: {esaLoadError}. Save still validates on the server.
                  </p>
                ) : null}
                {sequenceValidation && editor.service_sequence_string.trim() ? (
                  <div className="mt-3 space-y-2 rounded-lg border border-ink/10 bg-surface-2/50 px-3 py-2 text-xs">
                    <p className="font-medium text-ink">
                      Dependency check
                      {shouldUseApi() ? (
                        <span className="ml-2 font-normal text-ink-muted">
                          · {esaRowsForValidation.length} ESA rows
                        </span>
                      ) : null}
                      {sequenceValidation.hasErrors ? (
                        <span className="ml-2 text-warn">— fix to save</span>
                      ) : sequenceValidation.hasWarnings ? (
                        <span className="ml-2 text-ink-muted">— warnings only</span>
                      ) : (
                        <span className="ml-2 text-dm">— OK</span>
                      )}
                    </p>
                    <p className="text-ink-muted">
                      Parsed:{" "}
                      <code className="font-mono text-[11px]">
                        {sequenceValidation.groups.length
                          ? sequenceValidation.groups
                              .map((g, i) => `G${i + 1}[${g.join(",")}]`)
                              .join(" → ")
                          : "(empty)"}
                      </code>
                    </p>
                    {sequenceValidation.issues.length === 0 ? (
                      <p className="text-dm">
                        No dependency conflicts for <code className="font-mono">((ServiceName…))</code>{" "}
                        placeholders vs ESA <code className="font-mono">service_name</code> values.
                      </p>
                    ) : (
                      <ul className="max-h-48 list-outside list-disc space-y-1.5 overflow-y-auto py-0.5 pl-4 text-ink marker:text-ink-muted/80">
                        {sequenceValidation.issues.map((iss, idx) => (
                          <li
                            key={`${iss.code}-${idx}-${iss.message.slice(0, 40)}`}
                            className={
                              iss.severity === "error"
                                ? "text-warn marker:text-warn/70"
                                : "text-ink-muted marker:text-ink-muted"
                            }
                          >
                            <span className="sr-only">{iss.severity}: </span>
                            {iss.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </PageStack>
  );
}

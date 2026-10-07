import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { shouldUseApi } from "@/api/backend";
import { Modal } from "@/components/Modal";
import { ServiceConfigHttpProbeModal } from "@/components/ServiceConfigHttpProbeModal";
import { useConfig } from "@/context/ConfigContext";
import { stringifyJson } from "@/lib/json";
import { parseSequenceGroups } from "@/lib/sequence";
import {
  ESA_PROBE_UPDATED_EVENT,
  hasRecentSuccessfulEsaProbe,
} from "@/lib/esaProbeLocalResults";
import {
  getEsaViewHighlights,
  getSfdcViewHighlights,
  scoreEsaAlignment,
  scoreSfdcAlignment,
  scoreTier,
  type AlignmentScoreResult,
} from "@/lib/overviewAlignmentScores";
import type {
  PartnerServiceMapping,
  ServiceConfiguration,
  ServiceSfdcFieldMapping,
} from "@/types/models";
import { useSemanticRowFilter } from "@/lib/semanticTableSearch";

type OverviewTab = "alignment" | "partners";

type AlignSearchRow = { serviceName: string; blob: string };

type ConfigPopup =
  | null
  | { kind: "esa"; id: number; viewHighlights?: string[] }
  | { kind: "sfdc"; serviceName: string; viewHighlights?: string[] };

/** Label for partner dropdown; disambiguate when the same stage has duplicate partner_name. */
function partnerDropdownLabel(
  p: PartnerServiceMapping,
  siblings: PartnerServiceMapping[],
): string {
  const dup =
    siblings.filter((x) => x.partner_name === p.partner_name).length > 1;
  const base = (p.partner_name ?? "").trim() || p.name || `Mapping ${p.id}`;
  if (dup) {
    return `${base} (${p.name})`;
  }
  return base;
}

const ALIGN_SCORE_TIP_MAX_H = 240;

function IconEye({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconSendProbe({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

function AlignmentScorePill({
  present,
  kind,
  result,
}: {
  present: boolean;
  kind: "esa" | "sfdc";
  result: AlignmentScoreResult;
}) {
  const side = kind === "esa" ? "ESA" : "SFDC";
  const tipId = useId();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [tipPos, setTipPos] = useState<{
    top: number;
    left: number;
    placement: "below" | "above";
  }>({ top: 0, left: 0, placement: "below" });

  const syncTipPosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const gap = 8;
    const roomBelow = window.innerHeight - r.bottom - gap;
    const preferBelow = roomBelow >= Math.min(ALIGN_SCORE_TIP_MAX_H, 160);
    if (preferBelow) {
      setTipPos({ top: r.bottom + gap, left: cx, placement: "below" });
    } else {
      setTipPos({ top: r.top - gap, left: cx, placement: "above" });
    }
  }, []);

  const showTip = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    syncTipPosition();
    setOpen(true);
  }, [syncTipPosition]);

  const scheduleHide = useCallback(() => {
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }, []);

  const cancelHide = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    syncTipPosition();
    const onScrollOrResize = () => syncTipPosition();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, syncTipPosition]);

  if (!present) {
    return (
      <span
        className="text-ink-muted"
        title={
          side === "ESA"
            ? "No External APIs row for this name"
            : "No Data Stamping row for this name"
        }
      >
        —
      </span>
    );
  }

  const tier = scoreTier(result.score);
  const cls =
    tier === "high"
      ? "bg-emerald-500/15 text-emerald-900 ring-emerald-500/25"
      : tier === "mid"
        ? "bg-amber-500/15 text-amber-950 ring-amber-500/25"
        : tier === "low"
          ? "bg-red-500/12 text-red-950 ring-red-500/20"
          : "bg-ink/5 text-ink-muted ring-ink/10";

  const transform =
    tipPos.placement === "below"
      ? "translate(-50%, 0)"
      : "translate(-50%, -100%)";

  const tooltip = open
    ? createPortal(
        <div
          id={tipId}
          role="tooltip"
          style={{
            position: "fixed",
            top: tipPos.top,
            left: tipPos.left,
            transform,
            zIndex: 9999,
            maxWidth: "min(22rem, calc(100vw - 1.5rem))",
          }}
          className="max-h-[min(22rem,80vh)] overflow-y-auto rounded-lg border border-ink/15 bg-white p-3 text-left text-xs leading-snug text-ink shadow-lg ring-1 ring-black/5"
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          <p className="font-semibold text-ink">
            Why {result.score}/100 ({side})
          </p>
          <p className="mt-1 text-[11px] text-ink-muted">
            {side === "ESA" ? (
              <>
                Mostly from saved config; a line about HTTP 2xx means you ran Test successfully in this
                browser recently.{" "}
              </>
            ) : (
              <>This is a quick read of your saved config—it doesn’t run DM flows. </>
            )}
            <span className="font-medium text-ink">What helped</span> lists pluses;{" "}
            <span className="font-medium text-ink">What held it back</span> lists gaps, missed bonuses, or
            score caps.
          </p>
          {result.credits.length > 0 ? (
            <div className="mt-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                What helped
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px]">
                {result.credits.map((line, i) => (
                  <li key={`c-${i}`}>
                    <span>{line.label}</span>
                    <span className="ml-1 tabular-nums font-medium text-emerald-800">+{line.points}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {result.deductions.length > 0 ? (
            <div className="mt-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                What held it back
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px]">
                {result.deductions.map((line, i) => (
                  <li key={`d-${i}`}>
                    <span>{line.label}</span>
                    {line.points > 0 ? (
                      <span className="ml-1 tabular-nums font-medium text-red-800/90">
                        −{line.points}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`inline-flex cursor-help items-baseline gap-1 rounded-full px-2.5 py-0.5 text-left text-xs font-semibold tabular-nums ring-1 ring-inset transition hover:brightness-[0.97] ${cls}`}
        aria-describedby={open ? tipId : undefined}
        onMouseEnter={showTip}
        onMouseLeave={scheduleHide}
        onFocus={showTip}
        onBlur={scheduleHide}
      >
        {result.score}
        <span className="font-normal opacity-80">/100</span>
      </button>
      {tooltip}
    </>
  );
}

export function OverviewPage() {
  const { bundle } = useConfig();
  const [tab, setTab] = useState<OverviewTab>("alignment");
  const [configPopup, setConfigPopup] = useState<ConfigPopup>(null);
  const [probeOpen, setProbeOpen] = useState(false);
  const [probeRow, setProbeRow] = useState<ServiceConfiguration | null>(null);
  const [, bumpProbeScores] = useReducer((n: number) => n + 1, 0);
  const apiMode = shouldUseApi();

  useEffect(() => {
    const bump = () => bumpProbeScores();
    window.addEventListener(ESA_PROBE_UPDATED_EVENT, bump);
    return () => window.removeEventListener(ESA_PROBE_UPDATED_EVENT, bump);
  }, []);
  const [selectedStage, setSelectedStage] = useState<string>("");
  const [selectedPartnerId, setSelectedPartnerId] = useState<number | null>(null);

  const esaConfigById = useMemo(() => {
    const m = new Map<number, ServiceConfiguration>();
    for (const r of bundle.serviceConfigurations) {
      if (!r.is_deleted) m.set(r.id, r);
    }
    return m;
  }, [bundle.serviceConfigurations]);

  const esaNames = useMemo(() => {
    const s = new Set<string>();
    for (const r of bundle.serviceConfigurations) {
      if (!r.is_deleted && r.service_name) s.add(r.service_name);
    }
    return s;
  }, [bundle.serviceConfigurations]);

  const sfdcNames = useMemo(() => {
    const s = new Set<string>();
    for (const r of bundle.sfdcMappings) {
      if (!r.is_deleted && r.service_name) s.add(r.service_name);
    }
    return s;
  }, [bundle.sfdcMappings]);

  const union = useMemo(() => {
    return [...new Set([...esaNames, ...sfdcNames])].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }),
    );
  }, [esaNames, sfdcNames]);

  const partnerRows = useMemo(() => {
    return bundle.partnerMappings
      .filter((p) => !p.is_deleted)
      .map((p) => {
        const groups = parseSequenceGroups(p.service_sequence_string ?? "");
        return { p, groups };
      });
  }, [bundle.partnerMappings]);

  /** All ESA ids referenced in any partner sequence (any stage). */
  const esaIdsUsedInPartners = useMemo(() => {
    const s = new Set<number>();
    for (const { groups } of partnerRows) {
      for (const g of groups) {
        for (const id of g) {
          if (Number.isFinite(id)) s.add(id);
        }
      }
    }
    return s;
  }, [partnerRows]);

  const esaRowByName = useMemo(() => {
    const m = new Map<string, ServiceConfiguration>();
    for (const r of bundle.serviceConfigurations) {
      if (!r.is_deleted && r.service_name) m.set(r.service_name, r);
    }
    return m;
  }, [bundle.serviceConfigurations]);

  const alignSearchRows = useMemo((): AlignSearchRow[] => {
    return union.map((name) => {
      const esaRow = esaRowByName.get(name);
      const esaUsed =
        esaRow !== undefined && esaIdsUsedInPartners.has(esaRow.id);
      return {
        serviceName: name,
        blob: [
          name,
          esaNames.has(name) ? "esa external api http service_configuration" : "",
          sfdcNames.has(name) ? "sfdc data stamping composite salesforce" : "",
          esaUsed ? "partner sequence journey workflow ids" : "",
        ].join(" "),
      };
    });
  }, [union, esaNames, sfdcNames, esaIdsUsedInPartners, esaRowByName]);

  const getAlignDoc = useCallback(
    (r: AlignSearchRow) => ({ id: r.serviceName, text: r.blob }),
    [],
  );
  const [alignSearchQuery, setAlignSearchQuery, alignFiltered] = useSemanticRowFilter(
    alignSearchRows,
    getAlignDoc,
  );

  /** Distinct `stage` values (journey / decision type), sorted for the first dropdown. */
  const stageOptions = useMemo(() => {
    const s = new Set<string>();
    for (const { p } of partnerRows) {
      s.add((p.stage ?? "").trim());
    }
    return [...s].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [partnerRows]);

  /** Mappings for the currently selected stage (second dropdown). */
  const partnersForSelectedStage = useMemo(() => {
    return partnerRows.filter(
      ({ p }) => (p.stage ?? "").trim() === selectedStage,
    );
  }, [partnerRows, selectedStage]);

  const sfdcByServiceName = useMemo(() => {
    const m = new Map<string, ServiceSfdcFieldMapping>();
    for (const r of bundle.sfdcMappings) {
      if (!r.is_deleted && r.service_name) m.set(r.service_name, r);
    }
    return m;
  }, [bundle.sfdcMappings]);

  useEffect(() => {
    if (partnerRows.length === 0 || stageOptions.length === 0) {
      setSelectedStage("");
      setSelectedPartnerId(null);
      return;
    }
    setSelectedStage((prev) => {
      if (stageOptions.includes(prev)) return prev;
      return stageOptions[0] ?? "";
    });
  }, [partnerRows, stageOptions]);

  useEffect(() => {
    if (partnersForSelectedStage.length === 0) {
      setSelectedPartnerId(null);
      return;
    }
    setSelectedPartnerId((prev) => {
      if (prev != null && partnersForSelectedStage.some((row) => row.p.id === prev)) {
        return prev;
      }
      return partnersForSelectedStage[0].p.id;
    });
  }, [partnersForSelectedStage]);

  const selectedPartnerRow = useMemo(() => {
    if (selectedPartnerId == null) return null;
    return partnerRows.find((r) => r.p.id === selectedPartnerId) ?? null;
  }, [partnerRows, selectedPartnerId]);

  /** Row counts for the alignment table (full union, not search-filtered). */
  const alignmentSummary = useMemo(() => {
    let bothSides = 0;
    let esaOnly = 0;
    let sfdcOnly = 0;
    for (const name of union) {
      const e = esaNames.has(name);
      const s = sfdcNames.has(name);
      if (e && s) bothSides += 1;
      else if (e) esaOnly += 1;
      else if (s) sfdcOnly += 1;
    }
    return {
      total: union.length,
      bothSides,
      esaOnly,
      sfdcOnly,
      gaps: esaOnly + sfdcOnly,
    };
  }, [union, esaNames, sfdcNames]);

  const tabClass = (id: OverviewTab) =>
    `rounded-lg px-4 py-2.5 text-sm font-medium transition ${
      tab === id
        ? "bg-white text-ink shadow-sm shadow-ink/5"
        : "text-ink-muted hover:bg-white/70 hover:text-ink"
    }`;

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Overview sections"
        className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl border border-ink/10 bg-white/50 p-1.5 shadow-sm"
      >
        <button
          type="button"
          role="tab"
          id="overview-tab-alignment"
          aria-selected={tab === "alignment"}
          aria-controls="overview-panel-alignment"
          onClick={() => setTab("alignment")}
          className={tabClass("alignment")}
        >
          APIs
        </button>
        <button
          type="button"
          role="tab"
          id="overview-tab-partners"
          aria-selected={tab === "partners"}
          aria-controls="overview-panel-partners"
          onClick={() => setTab("partners")}
          className={tabClass("partners")}
        >
          Partner sequences
          {partnerRows.length > 0 ? (
            <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-normal text-ink-muted">
              {partnerRows.length}
            </span>
          ) : null}
        </button>
      </div>

      {tab === "alignment" ? (
      <section
        id="overview-panel-alignment"
        role="tabpanel"
        aria-labelledby="overview-tab-alignment"
        className="rounded-[var(--radius-card)] border border-ink/10 bg-gradient-to-b from-white via-white to-surface-2/35 p-6 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.06),0_12px_40px_-12px_rgba(0,0,0,0.07)] ring-1 ring-white/70 backdrop-blur-sm sm:p-7"
      >
        <div className="border-b border-ink/8 pb-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">
                Alignment
              </p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-ink">APIs Available</h2>
              <p className="mt-2 text-xs text-ink-muted">
                Rows join <code className="rounded bg-ink/[0.06] px-1 py-0.5 font-mono text-[11px]">service_name</code>{" "}
                across External APIs and Data Stamping. Amber rows are one-sided.
              </p>
              {alignmentSummary.total > 0 ? (
                <ul
                  className="mt-4 flex flex-wrap gap-2"
                  aria-label="Alignment summary"
                >
                  <li className="flex items-center gap-2 rounded-xl border border-ink/10 bg-white/80 px-3 py-2 shadow-sm ring-1 ring-ink/[0.03]">
                    <span className="text-[11px] font-medium text-ink-muted">Total names</span>
                    <span className="tabular-nums text-sm font-semibold text-ink">
                      {alignmentSummary.total}
                    </span>
                  </li>
                  <li className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] px-3 py-2 shadow-sm">
                    <span className="text-[11px] font-medium text-emerald-900/80">Both sides</span>
                    <span className="tabular-nums text-sm font-semibold text-emerald-950">
                      {alignmentSummary.bothSides}
                    </span>
                  </li>
                  <li className="flex items-center gap-2 rounded-xl border border-esa/25 bg-esa/8 px-3 py-2 shadow-sm">
                    <span className="text-[11px] font-medium text-esa">ESA only</span>
                    <span className="tabular-nums text-sm font-semibold text-ink">
                      {alignmentSummary.esaOnly}
                    </span>
                  </li>
                  <li className="flex items-center gap-2 rounded-xl border border-dm/25 bg-dm/8 px-3 py-2 shadow-sm">
                    <span className="text-[11px] font-medium text-dm">SFDC only</span>
                    <span className="tabular-nums text-sm font-semibold text-ink">
                      {alignmentSummary.sfdcOnly}
                    </span>
                  </li>
                  {alignmentSummary.gaps > 0 ? (
                    <li className="flex items-center gap-2 rounded-xl border border-warn/35 bg-warn/10 px-3 py-2 shadow-sm">
                      <span className="text-[11px] font-medium text-amber-950/90">Gaps</span>
                      <span className="tabular-nums text-sm font-semibold text-amber-950">
                        {alignmentSummary.gaps}
                      </span>
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </div>
            <div className="w-full min-w-0 flex-1 lg:max-w-2xl">
              <label
                className="flex flex-col gap-2 text-xs font-medium text-ink"
                htmlFor="overview-align-search"
              >
                <span>Filter by name</span>
                <div className="relative w-full">
                  <span
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
                    aria-hidden
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="11" cy="11" r="8" />
                      <path d="m21 21-4.3-4.3" />
                    </svg>
                  </span>
                  <input
                    id="overview-align-search"
                    type="search"
                    value={alignSearchQuery}
                    onChange={(e) => setAlignSearchQuery(e.target.value)}
                    placeholder="service_name, esa, sfdc, partner…"
                    className="w-full rounded-xl border border-ink/12 bg-white/90 py-2.5 pl-10 pr-3 text-sm text-ink shadow-inner outline-none ring-accent/0 transition placeholder:text-ink-muted/70 hover:border-ink/18 hover:bg-white focus:border-accent/40 focus:bg-white focus:ring-2 focus:ring-accent/18"
                    autoComplete="off"
                  />
                </div>
                <span className="text-[11px] font-normal text-ink-muted">
                  Showing <span className="tabular-nums font-medium text-ink">{alignFiltered.length}</span> of{" "}
                  <span className="tabular-nums font-medium text-ink">{union.length}</span> service names
                </span>
              </label>
            </div>
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-xl border border-ink/10 bg-white/60 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.85)] ring-1 ring-ink/[0.04]">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-left text-sm">
            <thead>
              <tr className="sticky top-0 z-[1] border-b border-ink/10 bg-surface-2/90 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted backdrop-blur-md">
                <th className="px-4 py-3.5 pr-3">service_name</th>
                <th className="px-2 py-3.5 pr-3" title="Heuristic ESA completeness + partner wiring">
                  <span className="text-esa">ESA</span> score
                </th>
                <th className="px-2 py-3.5 pr-3" title="Heuristic Composite stamping + ESA name match">
                  <span className="text-dm">SFDC</span> score
                </th>
                <th
                  className="w-14 px-3 py-3.5 text-center normal-case tracking-normal"
                  title="HTTP test using the saved External APIs row (POST /api/http-probe)"
                >
                  Test
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/[0.06]">
              {union.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-ink-muted">
                    Nothing to show yet—add services from the other screens or load sample data.
                  </td>
                </tr>
              ) : alignFiltered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-ink-muted">
                    No service names match the filter.
                  </td>
                </tr>
              ) : (
                alignFiltered.map(({ serviceName: name }) => {
                  const hasEsa = esaNames.has(name);
                  const hasSfdc = sfdcNames.has(name);
                  const warn = hasEsa !== hasSfdc;
                  const esaRow = esaRowByName.get(name);
                  const sfdcRow = sfdcByServiceName.get(name);
                  const esaUsed =
                    esaRow !== undefined && esaIdsUsedInPartners.has(esaRow.id);
                  const esaScore = scoreEsaAlignment(esaRow, {
                    serviceIdUsedInPartnerSequences: esaUsed,
                    recentProbeHttp2xx:
                      esaRow !== undefined && hasRecentSuccessfulEsaProbe(esaRow.id),
                  });
                  const sfdcScore = scoreSfdcAlignment(sfdcRow, {
                    hasMatchingEsaRow: hasEsa,
                  });
                  return (
                    <tr
                      key={name}
                      className={`transition-colors ${warn ? "border-l-2 border-l-warn/80 bg-warn/[0.08]" : "border-l-2 border-l-transparent"} hover:bg-ink/[0.025]`}
                    >
                      <td className="max-w-[min(28rem,40vw)] px-4 py-2.5 pr-3 font-mono text-[13px] leading-snug text-ink">
                        <span className="block truncate" title={name}>
                          {name}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 pr-3 align-middle">
                        <div className="flex flex-nowrap items-center gap-1.5">
                          <div className="flex min-w-[5.5rem] shrink-0 items-center justify-start">
                            <AlignmentScorePill
                              present={hasEsa}
                              kind="esa"
                              result={esaScore}
                            />
                          </div>
                          <button
                            type="button"
                            disabled={!hasEsa || esaRow === undefined}
                            aria-label={
                              hasEsa && esaRow
                                ? "Preview External APIs row"
                                : "No External APIs row for this name"
                            }
                            title={
                              hasEsa && esaRow
                                ? "Open a read-only preview of this External APIs row"
                                : "There’s no External APIs row for this name yet"
                            }
                            onClick={() =>
                              esaRow &&
                              setConfigPopup({
                                kind: "esa",
                                id: esaRow.id,
                                viewHighlights: getEsaViewHighlights(esaRow, {
                                  serviceIdUsedInPartnerSequences: esaUsed,
                                  recentProbeHttp2xx: hasRecentSuccessfulEsaProbe(esaRow.id),
                                }),
                              })
                            }
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-ink/0 bg-ink/[0.03] text-esa transition hover:border-esa/25 hover:bg-esa/10 hover:text-esa active:translate-y-px disabled:cursor-not-allowed disabled:border-transparent disabled:bg-transparent disabled:text-ink-muted/50"
                          >
                            <IconEye />
                          </button>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 pr-3 align-middle">
                        <div className="flex flex-nowrap items-center gap-1.5">
                          <div className="flex min-w-[5.5rem] shrink-0 items-center justify-start">
                            <AlignmentScorePill
                              present={hasSfdc}
                              kind="sfdc"
                              result={sfdcScore}
                            />
                          </div>
                          <button
                            type="button"
                            disabled={!hasSfdc}
                            aria-label={
                              hasSfdc
                                ? "Preview Data Stamping row"
                                : "No Data Stamping row for this name"
                            }
                            title={
                              hasSfdc
                                ? "Open a read-only preview of this Data Stamping row"
                                : "There’s no Data Stamping row for this name yet"
                            }
                            onClick={() =>
                              hasSfdc &&
                              sfdcRow &&
                              setConfigPopup({
                                kind: "sfdc",
                                serviceName: name,
                                viewHighlights: getSfdcViewHighlights(sfdcRow, {
                                  hasMatchingEsaRow: hasEsa,
                                }),
                              })
                            }
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-ink/0 bg-ink/[0.03] text-dm transition hover:border-dm/25 hover:bg-dm/10 hover:text-dm active:translate-y-px disabled:cursor-not-allowed disabled:border-transparent disabled:bg-transparent disabled:text-ink-muted/50"
                          >
                            <IconEye />
                          </button>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-center align-middle">
                        <button
                          type="button"
                          disabled={!esaRow || !apiMode}
                          aria-label={
                            !apiMode
                              ? "HTTP test unavailable (enable API mode)"
                              : !esaRow
                                ? "No External APIs row to test"
                                : "Send HTTP test for this External APIs row"
                          }
                          title={
                            !apiMode
                              ? "Turn on API mode (VITE_USE_API) and run npm run server so test requests can be proxied."
                              : !esaRow
                                ? "There’s no External APIs row for this name yet"
                                : "Send an HTTP request using this External APIs row (sandbox credentials recommended)"
                          }
                          onClick={() => {
                            if (!esaRow) return;
                            setProbeRow(esaRow);
                            setProbeOpen(true);
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-ink/0 bg-ink/[0.03] text-accent transition hover:border-accent/30 hover:bg-accent/10 active:translate-y-px disabled:cursor-not-allowed disabled:border-transparent disabled:bg-transparent disabled:text-ink-muted/50"
                        >
                          <IconSendProbe />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          </div>
        </div>
        {union.some((n) => esaNames.has(n) !== sfdcNames.has(n)) ? (
          <ul className="mt-3 list-inside list-disc space-y-0.5 text-xs leading-snug text-warn marker:text-warn/80">
            <li>Amber row: name on ESA or on Data Stamping, not both.</li>
            <li>Add the missing row. The absent side has no score.</li>
          </ul>
        ) : null}
      </section>
      ) : null}

      {tab === "partners" ? (
      <section
        id="overview-panel-partners"
        role="tabpanel"
        aria-labelledby="overview-tab-partners"
        className="rounded-[var(--radius-card)] border border-ink/10 bg-gradient-to-b from-white via-white to-surface-2/40 p-4 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.06),0_12px_40px_-12px_rgba(0,0,0,0.08)] ring-1 ring-white/80 backdrop-blur-sm sm:p-5"
      >
        <div className="border-b border-ink/10 pb-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">
            Overview
          </p>
          <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-ink">Partner sequences</h2>
          <p className="mt-1.5 text-xs leading-snug text-ink-muted">
            Stages run in order; services in one group run in parallel.{" "}
            <span className="font-medium text-esa">APIs</span> /{" "}
            <span className="font-medium text-dm">Stamping</span> open previews.
          </p>
        </div>

        {partnerRows.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">No partner mappings.</p>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-ink/10 bg-white/95 p-3 shadow-sm ring-1 ring-ink/5">
              <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-ink">Stage</span>
                <select
                  value={selectedStage}
                  onChange={(e) => setSelectedStage(e.target.value)}
                  className="w-full rounded-lg border border-ink/12 bg-surface-2/30 px-2.5 py-2 text-sm text-ink shadow-inner outline-none ring-accent/0 transition hover:bg-white focus:border-accent/45 focus:bg-white focus:ring-2 focus:ring-accent/20"
                >
                  {stageOptions.map((stage) => (
                    <option key={stage || "__empty__"} value={stage}>
                      {stage || "(no stage)"}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-ink-muted">
                  <code className="font-mono text-[10px]">stage</code> · e.g. loan-decision, kyc-decision
                </span>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-ink">Partner</span>
                <select
                  value={selectedPartnerId ?? ""}
                  onChange={(e) => setSelectedPartnerId(Number(e.target.value))}
                  disabled={partnersForSelectedStage.length === 0}
                  className="w-full rounded-lg border border-ink/12 bg-surface-2/30 px-2.5 py-2 text-sm text-ink shadow-inner outline-none ring-accent/0 transition hover:bg-white focus:border-accent/45 focus:bg-white focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {partnersForSelectedStage.map(({ p }) => (
                    <option key={p.id} value={p.id}>
                      {partnerDropdownLabel(p, partnersForSelectedStage.map((r) => r.p))}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-ink-muted">
                  <code className="font-mono text-[10px]">partner_name</code> for this stage
                </span>
              </label>
              </div>
            </div>

            {selectedPartnerRow ? (
              <PartnerSequenceDetail
                p={selectedPartnerRow.p}
                groups={selectedPartnerRow.groups}
                esaConfigById={esaConfigById}
                esaNames={esaNames}
                sfdcNames={sfdcNames}
                apiMode={apiMode}
                onPreviewEsa={(id) => setConfigPopup({ kind: "esa", id })}
                onPreviewSfdc={(serviceName) =>
                  setConfigPopup({ kind: "sfdc", serviceName })
                }
                onTestEsa={(id) => {
                  const row = esaConfigById.get(id);
                  if (!row) return;
                  setProbeRow(row);
                  setProbeOpen(true);
                }}
              />
            ) : null}
          </div>
        )}
      </section>
      ) : null}

      <Modal
        title={
          configPopup?.kind === "esa"
            ? `External APIs · service_configuration (id ${configPopup.id})`
            : configPopup?.kind === "sfdc"
              ? `Data Stamping · ${configPopup.serviceName}`
              : ""
        }
        open={configPopup !== null}
        onClose={() => setConfigPopup(null)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfigPopup(null)}
              className="rounded-lg border border-ink/15 px-4 py-2 text-sm"
            >
              Close
            </button>
            {configPopup?.kind === "esa" ? (
              <Link
                to={`/esa?id=${configPopup.id}`}
                onClick={() => setConfigPopup(null)}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
              >
                Open full editor
              </Link>
            ) : null}
            {configPopup?.kind === "sfdc" ? (
              <Link
                to="/sfdc"
                onClick={() => setConfigPopup(null)}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
              >
                Open full editor
              </Link>
            ) : null}
          </>
        }
      >
        {configPopup?.kind === "esa" ? (
          <EsaPopupBody
            row={esaConfigById.get(configPopup.id)}
            id={configPopup.id}
            highlightKeys={configPopup.viewHighlights}
          />
        ) : null}
        {configPopup?.kind === "sfdc" ? (
          <SfdcPopupBody
            row={sfdcByServiceName.get(configPopup.serviceName)}
            serviceName={configPopup.serviceName}
            highlightKeys={configPopup.viewHighlights}
          />
        ) : null}
      </Modal>

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
    </div>
  );
}

/** Per-group contour so Group 1 / 2 / 3 scan quickly (cycles if there are many groups). */
const PARTNER_GROUP_CONTOUR_STYLES = [
  {
    shell: "border-l-sky-500 from-sky-50/55 to-white/95 ring-sky-500/12",
    header:
      "border-b border-sky-200/70 from-sky-600/[0.09] via-sky-500/[0.04] to-transparent",
    badge: "bg-sky-500/20 text-sky-950 ring-sky-400/25",
    count: "border-sky-200/60 bg-sky-100/85 text-sky-900",
  },
  {
    shell: "border-l-violet-500 from-violet-50/55 to-white/95 ring-violet-500/12",
    header:
      "border-b border-violet-200/70 from-violet-600/[0.09] via-violet-500/[0.04] to-transparent",
    badge: "bg-violet-500/20 text-violet-950 ring-violet-400/25",
    count: "border-violet-200/60 bg-violet-100/85 text-violet-900",
  },
  {
    shell: "border-l-teal-500 from-teal-50/55 to-white/95 ring-teal-500/12",
    header:
      "border-b border-teal-200/70 from-teal-600/[0.09] via-teal-500/[0.04] to-transparent",
    badge: "bg-teal-500/20 text-teal-950 ring-teal-400/25",
    count: "border-teal-200/60 bg-teal-100/85 text-teal-900",
  },
  {
    shell: "border-l-rose-500 from-rose-50/55 to-white/95 ring-rose-500/12",
    header:
      "border-b border-rose-200/70 from-rose-600/[0.09] via-rose-500/[0.04] to-transparent",
    badge: "bg-rose-500/20 text-rose-950 ring-rose-400/25",
    count: "border-rose-200/60 bg-rose-100/85 text-rose-900",
  },
  {
    shell: "border-l-cyan-600 from-cyan-50/55 to-white/95 ring-cyan-500/12",
    header:
      "border-b border-cyan-200/70 from-cyan-600/[0.09] via-cyan-500/[0.04] to-transparent",
    badge: "bg-cyan-600/20 text-cyan-950 ring-cyan-500/25",
    count: "border-cyan-200/60 bg-cyan-100/85 text-cyan-900",
  },
] as const;

function PartnerSequenceDetail({
  p,
  groups,
  esaConfigById,
  esaNames,
  sfdcNames,
  apiMode,
  onPreviewEsa,
  onPreviewSfdc,
  onTestEsa,
}: {
  p: PartnerServiceMapping;
  groups: number[][];
  esaConfigById: Map<number, ServiceConfiguration>;
  esaNames: Set<string>;
  sfdcNames: Set<string>;
  apiMode: boolean;
  onPreviewEsa: (id: number) => void;
  onPreviewSfdc: (serviceName: string) => void;
  onTestEsa: (id: number) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-ink/10 bg-white shadow-sm ring-1 ring-ink/[0.05]">
      <div className="relative border-b border-ink/10 bg-gradient-to-br from-accent/[0.06] via-surface-2/50 to-white px-3 py-2.5 sm:px-4 sm:py-3">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/25 to-transparent"
          aria-hidden
        />
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">Mapping</p>
            <h3 className="mt-0.5 text-base font-semibold leading-snug tracking-tight text-ink">
              {p.name}
            </h3>
            <p className="mt-0.5 text-xs text-ink-muted">
              <span className="font-medium text-ink/90">{p.partner_name}</span>
              <span className="text-ink-muted/60"> · </span>
              {p.stage}
            </p>
          </div>
        </div>
        <details className="mt-2 rounded-md border border-ink/8 bg-ink/[0.02] px-2 py-1.5">
          <summary className="cursor-pointer select-none text-[11px] font-medium text-accent hover:underline">
            Raw <code className="font-mono text-[10px] text-ink">service_sequence_string</code>
          </summary>
          <div className="mt-2 overflow-x-auto border-t border-ink/8 pt-2">
            <code className="block max-w-full whitespace-pre-wrap break-all font-mono text-[11px] leading-snug text-ink">
              {p.service_sequence_string || "—"}
            </code>
          </div>
        </details>
      </div>

      <div className="bg-gradient-to-b from-surface-2/20 to-white px-2.5 py-3 sm:px-3 sm:py-3.5">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
          Groups run in order · services in a group run in parallel
        </p>
        {groups.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No stages parsed — sequence is empty or invalid.
          </p>
        ) : (
          <div className="space-y-3">
            {groups.map((stageIds, si) => {
              const contour =
                PARTNER_GROUP_CONTOUR_STYLES[si % PARTNER_GROUP_CONTOUR_STYLES.length];
              return (
              <section
                key={si}
                className={`rounded-lg border border-ink/10 border-l-4 bg-gradient-to-r shadow-sm ring-1 ${contour.shell}`}
                aria-labelledby={`partner-stage-${p.id}-${si}-title`}
              >
                <div
                  className={`flex flex-wrap items-center justify-between gap-1.5 bg-gradient-to-r px-2 py-1.5 sm:px-2.5 ${contour.header}`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ring-1 ${contour.badge}`}
                      aria-hidden
                    >
                      {si + 1}
                    </span>
                    <div className="min-w-0">
                      <h4
                        id={`partner-stage-${p.id}-${si}-title`}
                        className="text-xs font-semibold tracking-tight text-ink"
                      >
                        Group {si + 1}{" "}
                        <span className="font-normal text-ink-muted">· parallel</span>
                      </h4>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium tabular-nums ${contour.count}`}
                  >
                    {stageIds.length}
                  </span>
                </div>

                <div
                  className="p-2 sm:p-2"
                  role="group"
                  aria-label={`Group ${si + 1}, parallel services`}
                >
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                    {stageIds.map((id) => {
                      const esaRow = esaConfigById.get(id);
                      const name = esaRow?.service_name?.trim() || null;
                      const mismatch = Boolean(
                        name && esaNames.has(name) !== sfdcNames.has(name),
                      );
                      return (
                        <div
                          key={`${p.id}-${si}-${id}`}
                          className={`flex min-w-0 flex-col gap-1.5 rounded-lg border p-2 ${
                            mismatch
                              ? "border-warn/40 bg-warn/[0.06] ring-1 ring-warn/12"
                              : "border-ink/10 bg-surface-2/25 ring-1 ring-ink/[0.03] hover:bg-white"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-1">
                            <span className="font-mono text-[11px] font-bold tabular-nums text-ink">
                              {id}
                            </span>
                            {mismatch ? (
                              <span className="rounded bg-warn/25 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-950">
                                Gap
                              </span>
                            ) : null}
                          </div>
                          <p
                            className="w-full min-w-0 text-xs font-medium leading-snug text-ink [overflow-wrap:anywhere]"
                            title={name ?? undefined}
                          >
                            {name ?? (
                              <span className="font-normal text-warn">
                                Unknown id — not in External APIs.
                              </span>
                            )}
                          </p>

                          {mismatch ? (
                            <ul className="list-inside list-disc text-[10px] leading-tight text-warn marker:text-warn/70">
                              <li>
                                <code className="font-mono">service_name</code>: ESA or SFDC only.
                              </li>
                              <li>Add the other row.</li>
                            </ul>
                          ) : null}

                          <div className="mt-auto flex flex-wrap gap-1 border-t border-ink/8 pt-1.5">
                            <button
                              type="button"
                              onClick={() => onPreviewEsa(id)}
                              title="Open a read-only preview of this External APIs row"
                              className="rounded-md border border-esa/40 bg-esa/10 px-2 py-1 text-[11px] font-semibold text-esa transition hover:bg-esa/15 active:translate-y-px"
                            >
                              APIs
                            </button>
                            <button
                              type="button"
                              disabled={!name}
                              title={
                                name
                                  ? "Open a read-only preview of this Data Stamping row"
                                  : "Fix the id in External APIs first so we know the service name"
                              }
                              onClick={() => name && onPreviewSfdc(name)}
                              className="rounded-md border border-dm/40 bg-dm/10 px-2 py-1 text-[11px] font-semibold text-dm transition hover:bg-dm/15 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Stamping
                            </button>
                            <button
                              type="button"
                              disabled={!apiMode || !esaRow}
                              title={
                                !apiMode
                                  ? "Turn on API mode (VITE_USE_API) and run npm run server so test requests can be proxied."
                                  : !esaRow
                                    ? "No External APIs row for this id"
                                    : "Send an HTTP request using this External APIs row (sandbox credentials recommended)"
                              }
                              onClick={() => onTestEsa(id)}
                              className="rounded-md border border-accent/35 bg-accent/10 px-2 py-1 text-[11px] font-semibold text-accent transition hover:bg-accent/15 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Test
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {si < groups.length - 1 ? (
                  <div
                    className="flex items-center gap-2 px-2 pb-1.5 text-ink-muted sm:px-2.5"
                    aria-hidden
                  >
                    <div className="h-px flex-1 bg-gradient-to-r from-transparent via-ink/15 to-ink/30" />
                    <span className="shrink-0 rounded-full border border-ink/10 bg-surface-2 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-muted">
                      Then
                    </span>
                    <div className="h-px flex-1 bg-gradient-to-l from-transparent via-ink/15 to-ink/30" />
                  </div>
                ) : null}
              </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function lowScorePopupSection(active: boolean): string {
  return active
    ? "rounded-lg border border-red-500/45 bg-red-500/[0.08] p-2.5 shadow-[inset_0_0_0_1px_rgba(239,68,68,0.2)]"
    : "";
}

function EsaPopupBody({
  row,
  id,
  highlightKeys,
}: {
  row: ServiceConfiguration | undefined;
  id: number;
  highlightKeys?: string[];
}) {
  const keys = highlightKeys ?? [];
  const hl = (k: string) => keys.includes(k);
  const anyHl = keys.length > 0;

  if (!row) {
    return (
      <p className="text-sm text-ink-muted">
        We couldn’t find a <code className="font-mono text-xs">service_configuration</code> row for id{" "}
        <span className="font-mono font-semibold">{id}</span> in what’s loaded right now. If you’re using
        API mode, try reloading from the header.
      </p>
    );
  }
  return (
    <div className="space-y-4 text-sm">
      {anyHl ? (
        <p className="rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs leading-snug text-red-950">
          <strong className="font-semibold">Heads up</strong> — red boxes call out things that pulled your
          confidence below 80 (based on the same checks as the score).
        </p>
      ) : null}
      {hl("partner_wiring") ? (
        <p className="rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs leading-snug text-red-950">
          This service id doesn’t appear in any <strong className="font-semibold">partner sequence</strong>{" "}
          yet. Add it under Partner mappings when it should run as part of a journey.
        </p>
      ) : null}
      <p className="text-ink-muted">
        Read-only snapshot from the config loaded in this browser session.
      </p>
      <dl className="space-y-2 text-xs sm:text-sm">
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-ink-muted">service_name</dt>
          <dd className="font-mono text-ink">{row.service_name}</dd>
        </div>
        <div className={lowScorePopupSection(hl("request_method"))}>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-ink-muted">request_method</dt>
            <dd className="font-mono">{row.request_method}</dd>
          </div>
        </div>
        <div className={lowScorePopupSection(hl("api_url"))}>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-ink-muted">api_url</dt>
            <dd className="break-all font-mono text-xs">{row.api_url}</dd>
          </div>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-ink-muted">timeout</dt>
          <dd>{row.timeout}s</dd>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-ink-muted">send_response</dt>
          <dd>{row.send_response ? "true" : "false"}</dd>
        </div>
      </dl>
      {(
        [
          ["headers", row.headers],
          ["request_body", row.request_body],
          ["response_body", row.response_body],
          ["additional_config", row.additional_config],
        ] as const
      ).map(([label, value]) => (
        <div
          key={label}
          className={
            label === "request_body" && hl("request_body")
              ? lowScorePopupSection(true)
              : undefined
          }
        >
          <p className="mb-1 text-xs font-medium text-ink-muted">{label}</p>
          <pre className="max-h-48 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-ink sm:text-xs">
            {stringifyJson(value)}
          </pre>
        </div>
      ))}
    </div>
  );
}

function SfdcPopupBody({
  row,
  serviceName,
  highlightKeys,
}: {
  row: ServiceSfdcFieldMapping | undefined;
  serviceName: string;
  highlightKeys?: string[];
}) {
  const keys = highlightKeys ?? [];
  const hl = (k: string) => keys.includes(k);
  const anyHl = keys.length > 0;
  const hlCompositeBlock = keys.some((k) =>
    ["request_body", "composite_urls", "composite_sobjects", "field_mappings"].includes(k),
  );

  if (!row) {
    return (
      <p className="text-sm text-ink-muted">
        We couldn’t find a <code className="font-mono text-xs">service_sfdc_field_mapping</code> row for{" "}
        <span className="font-mono font-semibold">{serviceName}</span> in what’s loaded right now.
      </p>
    );
  }
  return (
    <div className="space-y-4 text-sm">
      {anyHl ? (
        <p className="rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs leading-snug text-red-950">
          <strong className="font-semibold">Heads up</strong> — red boxes call out things that pulled your
          confidence below 80 (based on the same checks as the score).
        </p>
      ) : null}
      {hl("esa_row") ? (
        <p className="rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs leading-snug text-red-950">
          Nothing in <strong className="font-semibold">External APIs</strong> uses this{" "}
          <code className="font-mono text-[11px]">service_name</code> yet. Create or rename the HTTP row so
          it matches—stamping and APIs should share the same name.
        </p>
      ) : null}
      {hlCompositeBlock ? (
        <ul className="list-inside list-disc space-y-0.5 rounded-lg border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-[11px] leading-relaxed text-red-950">
          {hl("request_body") ? (
            <li>
              Use a non-empty JSON array of Composite blocks for{" "}
              <code className="font-mono">request_body</code>.
            </li>
          ) : null}
          {hl("composite_urls") ? (
            <li>
              Give each Salesforce call a <code className="font-mono">url</code> in its Composite block.
            </li>
          ) : null}
          {hl("composite_sobjects") ? (
            <li>
              Point urls at Salesforce’s <code className="font-mono">/sobjects/</code> REST paths when you’re
              writing objects.
            </li>
          ) : null}
          {hl("field_mappings") ? (
            <li>
              Put field names and values inside each block’s <code className="font-mono">body</code> object.
            </li>
          ) : null}
        </ul>
      ) : null}
      <p className="text-ink-muted">
        Read-only snapshot — Composite <code className="font-mono text-xs">request_body</code> array.
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs sm:text-sm">
        <dt className="text-ink-muted">id</dt>
        <dd className="font-mono">{row.id}</dd>
        <dt className="text-ink-muted">service_name</dt>
        <dd className="font-mono text-ink">{row.service_name}</dd>
      </dl>
      <div className={lowScorePopupSection(hlCompositeBlock)}>
        <p className="mb-1 text-xs font-medium text-ink-muted">request_body</p>
        <pre className="max-h-[min(50vh,24rem)] overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-ink sm:text-xs">
          {stringifyJson(row.request_body)}
        </pre>
      </div>
    </div>
  );
}

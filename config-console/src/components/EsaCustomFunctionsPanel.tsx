import { useEffect, useMemo, useState } from "react";
import {
  ESA_CUSTOM_FUNCTIONS,
  ESA_CUSTOM_FUNCTIONS_SOURCE,
} from "@/lib/esaCustomFunctionsReference";
import { searchEsaCustomFunctions } from "@/lib/customFunctionSemanticSearch";

export type EsaCustomFunctionsPanelProps = {
  /** When set, the table scrolls inside this max height (e.g. in a modal). */
  tableMaxHeight?: string;
  /** Pin header while scrolling the table body. */
  stickyTableHeader?: boolean;
  /** Show the monospace source line under the syntax box. */
  showSourceLine?: boolean;
  /** From URL `?q=` (universal search) or parent. */
  initialQuery?: string;
};

export function EsaCustomFunctionsPanel({
  tableMaxHeight,
  stickyTableHeader = false,
  showSourceLine = true,
  initialQuery = "",
}: EsaCustomFunctionsPanelProps) {
  const [filter, setFilter] = useState(initialQuery);

  useEffect(() => {
    setFilter(initialQuery);
  }, [initialQuery]);

  const filtered = useMemo(
    () => searchEsaCustomFunctions(filter),
    [filter],
  );

  const tableWrapStyle = tableMaxHeight
    ? { maxHeight: tableMaxHeight }
    : undefined;

  return (
    <div className="space-y-4">
      <div className="rounded-[var(--radius-card)] border border-ink/10 bg-surface-2/40 px-4 py-3 text-sm text-ink">
        <p className="font-medium text-ink">Syntax</p>
        <code className="mt-1 block break-all font-mono text-[13px] leading-relaxed text-ink">
          {"{{CUSTOM:<functionName>:<arg1>:<arg2>:…}}"}
        </code>
        <p className="mt-2 text-xs leading-relaxed text-ink-muted">
          Arguments are separated by colons; nested{" "}
          <code className="font-mono text-[11px]">{"{{…}}"}</code> expressions are allowed inside
          arguments. Each row shows a minimal <strong className="font-medium text-ink">before</strong>{" "}
          (template) and <strong className="font-medium text-ink">after</strong> (example). Full guide:{" "}
          <code className="font-mono text-[11px]">external-service-adapter/docs/ESA_Guide.md</code> §10.
        </p>
        {showSourceLine ? (
          <p className="mt-2 font-mono text-[11px] leading-relaxed text-ink-muted">
            {ESA_CUSTOM_FUNCTIONS_SOURCE}
          </p>
        ) : null}
      </div>

      <div>
        <label className="block text-xs font-medium text-ink-muted" htmlFor="esa-custom-fn-filter">
          Semantic search
        </label>
        <input
          id="esa-custom-fn-filter"
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Describe what you need — e.g. hash payload, Indian phone, extract JSON field, age from DOB…"
          className="mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3 py-2.5 text-sm text-ink shadow-sm placeholder:text-ink-muted/70"
          autoComplete="off"
        />
        <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
          Full-text rank + synonyms + fuzzy prefix match; falls back to substring if nothing scores.{" "}
          Showing <span className="font-medium text-ink">{filtered.length}</span> of{" "}
          {ESA_CUSTOM_FUNCTIONS.length} functions
        </p>
      </div>

      <div
        className={`rounded-[var(--radius-card)] border border-ink/10 bg-white/90 shadow-sm ${
          tableMaxHeight ? "overflow-x-auto overflow-y-auto" : "overflow-x-auto"
        }`}
        style={tableWrapStyle}
      >
        {filtered.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-muted">No functions match that search.</p>
        ) : (
          <table className="w-full min-w-[52rem] table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[11rem]" />
            <col />
            <col className="w-[min(28%,22rem)]" />
            <col className="w-[min(28%,22rem)]" />
          </colgroup>
          <thead
            className={
              stickyTableHeader
                ? "sticky top-0 z-[1] border-b border-ink/10 bg-white shadow-[0_1px_0_0_rgb(0_0_0/0.06)]"
                : ""
            }
          >
            <tr className="text-xs font-medium text-ink-muted">
              <th className="whitespace-nowrap px-3 py-2.5 font-medium sm:px-4 sm:py-3">Function</th>
              <th className="px-3 py-2.5 font-medium sm:px-4 sm:py-3">What it does</th>
              <th className="px-3 py-2.5 font-medium sm:px-4 sm:py-3">Before (template)</th>
              <th className="px-3 py-2.5 font-medium sm:px-4 sm:py-3">After (example)</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((fn) => (
              <tr
                key={fn.name}
                className="border-b border-ink/10 align-top odd:bg-surface-2/40 hover:bg-esa/[0.08]"
              >
                <td className="whitespace-nowrap px-3 py-3 font-mono text-[12px] font-semibold text-esa sm:px-4">
                  {fn.name}
                </td>
                <td className="px-3 py-3 text-[13px] leading-relaxed text-ink sm:px-4">{fn.summary}</td>
                <td className="px-3 py-3 sm:px-4">
                  <code className="block whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-ink">
                    {fn.before}
                  </code>
                </td>
                <td className="px-3 py-3 sm:px-4">
                  <code className="block whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-ink-muted">
                    {fn.after}
                  </code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </div>
    </div>
  );
}

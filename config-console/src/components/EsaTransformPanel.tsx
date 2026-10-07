import { useCallback } from "react";
import {
  ESA_TRANSFORM_OPERATIONS,
  ESA_TRANSFORM_SOURCE,
  type EsaTransformOperation,
} from "@/lib/esaTransformReference";
import { useSemanticRowFilter } from "@/lib/semanticTableSearch";

const getTransformDoc = (r: EsaTransformOperation) => ({
  id: r.name,
  text: [r.name, r.summary, r.before, r.after].join(" "),
});

export type EsaTransformPanelProps = {
  /** From URL `?esaTransform=` (universal search) or parent. */
  initialQuery?: string;
  /** When set, the table scrolls inside this max height (e.g. in a modal). */
  tableMaxHeight?: string;
  /** Pin header while scrolling the table body. */
  stickyTableHeader?: boolean;
  /** Show monospace implementation path under the syntax box. */
  showSourceLine?: boolean;
};

export function EsaTransformPanel({
  initialQuery = "",
  tableMaxHeight,
  stickyTableHeader = false,
  showSourceLine = true,
}: EsaTransformPanelProps) {
  const toDoc = useCallback((r: EsaTransformOperation) => getTransformDoc(r), []);
  const [query, setQuery, filtered] = useSemanticRowFilter(ESA_TRANSFORM_OPERATIONS, toDoc, initialQuery);

  const tableWrapStyle = tableMaxHeight ? { maxHeight: tableMaxHeight } : undefined;

  return (
    <div className="space-y-4">
      <div className="rounded-[var(--radius-card)] border border-ink/10 bg-surface-2/40 px-4 py-3 text-sm text-ink">
        <p className="font-medium text-ink">Syntax</p>
        <code className="mt-1 block break-all font-mono text-[13px] leading-relaxed text-ink">
          {"{{TRANSFORM:<value>:<operation>}}"}
        </code>
        <p className="mt-2 text-xs leading-relaxed text-ink-muted">
          <code className="font-mono text-[11px]">value</code> can use{" "}
          <code className="font-mono text-[11px]">&lt;Object.field&gt;</code>,{" "}
          <code className="font-mono text-[11px]">((Service.path))</code>, literals, nested{" "}
          <code className="font-mono text-[11px]">{"{{…}}"}</code>, and{" "}
          <code className="font-mono text-[11px]">||</code> fallbacks. Operations with extra args use
          additional colons (e.g. <code className="font-mono text-[11px]">chunk:40:0</code>). See{" "}
          <code className="font-mono text-[11px]">external-service-adapter/docs/ESA_Guide.md</code> §7.
        </p>
        {showSourceLine ? (
          <p className="mt-2 font-mono text-[11px] leading-relaxed text-ink-muted">{ESA_TRANSFORM_SOURCE}</p>
        ) : null}
      </div>

      <div>
        <label className="block text-xs font-medium text-ink-muted" htmlFor="esa-transform-search">
          Semantic search
        </label>
        <input
          id="esa-transform-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. chunk address, replace_regex, substring, phone digits…"
          className="mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3 py-2.5 text-sm text-ink shadow-sm placeholder:text-ink-muted/70"
          autoComplete="off"
        />
        <p className="mt-1.5 text-xs text-ink-muted">
          <span className="font-medium text-ink">{filtered.length}</span> of {ESA_TRANSFORM_OPERATIONS.length}{" "}
          rows
        </p>
      </div>

      <div
        className={`rounded-[var(--radius-card)] border border-ink/10 bg-white/90 shadow-sm ${
          tableMaxHeight ? "overflow-x-auto overflow-y-auto" : "overflow-x-auto"
        }`}
        style={tableWrapStyle}
      >
        {filtered.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-muted">No rows match that search.</p>
        ) : (
          <table className="w-full min-w-[52rem] table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[11rem]" />
              <col />
              <col className="w-[min(30%,24rem)]" />
              <col className="w-[min(30%,24rem)]" />
            </colgroup>
            <thead
              className={
                stickyTableHeader
                  ? "sticky top-0 z-[1] border-b border-ink/10 bg-white text-xs font-medium text-ink-muted shadow-[0_1px_0_0_rgb(0_0_0/0.06)]"
                  : "border-b border-ink/10 text-xs font-medium text-ink-muted"
              }
            >
              <tr>
                <th className="px-3 py-2.5 font-medium sm:px-4 sm:py-3">Operation / topic</th>
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
                  <td className="px-3 py-3 font-mono text-[12px] font-semibold text-esa sm:px-4">
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

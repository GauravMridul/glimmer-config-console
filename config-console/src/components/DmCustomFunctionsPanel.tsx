import { useEffect, useMemo, useState } from "react";
import {
  DM_CUSTOM_FUNCTIONS,
  DM_CUSTOM_FUNCTIONS_SOURCE,
} from "@/lib/dmCustomFunctionsReference";
import { searchDmCustomFunctions } from "@/lib/customFunctionSemanticSearch";

export type DmCustomFunctionsPanelProps = {
  initialQuery?: string;
  /** Prefix for input `id` when multiple panels exist on one page. */
  htmlIdPrefix?: string;
};

export function DmCustomFunctionsPanel({
  initialQuery = "",
  htmlIdPrefix = "dm-expr",
}: DmCustomFunctionsPanelProps) {
  const [query, setQuery] = useState(initialQuery);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  const filtered = useMemo(() => searchDmCustomFunctions(query), [query]);
  const searchId = `${htmlIdPrefix}-custom-fn-search`;

  return (
    <div className="space-y-4">
      <div className="rounded-[var(--radius-card)] border border-ink/10 bg-surface-2/40 px-4 py-3 text-sm text-ink">
        <p className="font-medium text-ink">Syntax reminders</p>
        <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-ink-muted">
          <li>
            <strong className="font-medium text-ink">Paths</strong> from ESA output use double parens:{" "}
            <code className="font-mono text-[11px]">((Service.field))</code> — not inside every function;
            see Data Stamping docs.
          </li>
          <li>
            <strong className="font-medium text-ink">String building</strong>: use{" "}
            <code className="font-mono text-[11px]">concat(a, b, …)</code>. There is no{" "}
            <code className="font-mono text-[11px]">String.concat</code> API in this engine.
          </li>
          <li>
            <strong className="font-medium text-ink">Dates</strong>:{" "}
            <code className="font-mono text-[11px]">now()</code> then{" "}
            <code className="font-mono text-[11px]">formatDate(value, '…')</code> with your format tokens.
          </li>
        </ul>
        <p className="mt-2 text-xs text-ink-muted">
          Deeper behavior:{" "}
          <code className="font-mono text-[11px]">decision-manager/docs/configuration_guide.md</code> and{" "}
          <code className="font-mono text-[11px]">DECISION_MANAGER_DB_CONFIGURATION_GUIDE.md</code>.
        </p>
        <p className="mt-2 font-mono text-[11px] leading-relaxed text-ink-muted">{DM_CUSTOM_FUNCTIONS_SOURCE}</p>
      </div>

      <div>
        <label className="block text-xs font-medium text-ink-muted" htmlFor={searchId}>
          Semantic search
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. join strings, format ISO date, json to string, whitelist values…"
          className="mt-1.5 w-full max-w-2xl rounded-lg border border-ink/15 bg-white px-3 py-2.5 text-sm text-ink shadow-sm placeholder:text-ink-muted/70"
          autoComplete="off"
        />
        <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
          Ranked search with synonyms and fuzzy prefix match.{" "}
          <span className="font-medium text-ink">{filtered.length}</span> of {DM_CUSTOM_FUNCTIONS.length}{" "}
          functions
        </p>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-ink/10 bg-white/80 shadow-sm">
        {filtered.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-muted">No functions match that search.</p>
        ) : (
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-xs font-medium text-ink-muted">
                <th className="whitespace-nowrap px-4 py-3 font-medium">Function</th>
                <th className="min-w-[12rem] px-4 py-3 font-medium">What it does</th>
                <th className="min-w-[14rem] px-4 py-3 font-medium">Before (template)</th>
                <th className="min-w-[14rem] px-4 py-3 font-medium">After (example)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((fn) => (
                <tr key={fn.name} className="border-b border-ink/5 align-top hover:bg-surface-2/50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-medium text-dm">
                    {fn.name}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-muted">{fn.summary}</td>
                  <td className="px-4 py-3">
                    <code className="break-all font-mono text-[11px] text-ink">{fn.before}</code>
                  </td>
                  <td className="px-4 py-3">
                    <code className="break-all font-mono text-[11px] text-ink">{fn.after}</code>
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

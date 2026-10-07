import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useConfig } from "@/context/ConfigContext";
import { createUniversalSearch, type UniversalSearchHit } from "@/lib/universalSearch";

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2.5 text-sm text-ink shadow-sm placeholder:text-ink-muted/70 focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/20";

export function UniversalSearch() {
  const navigate = useNavigate();
  const { bundle } = useConfig();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useMemo(() => createUniversalSearch(bundle), [bundle]);
  const results = useMemo(() => search(query), [search, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const t = window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => window.clearTimeout(t);
  }, [open]);

  const go = useCallback(
    (hit: UniversalSearchHit) => {
      navigate(hit.path);
      setOpen(false);
      setQuery("");
    },
    [navigate],
  );

  const grouped = useMemo(() => {
    const m = new Map<string, UniversalSearchHit[]>();
    for (const h of results) {
      const list = m.get(h.category) ?? [];
      list.push(h);
      m.set(h.category, list);
    }
    return [...m.entries()];
  }, [results]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-ink/15 bg-white/90 px-3 py-2 text-sm text-ink-muted shadow-sm transition hover:border-accent/25 hover:text-ink"
        title="Search everywhere (⌘K / Ctrl+K)"
      >
        <span aria-hidden className="text-ink-muted">
          ⌘K
        </span>
        <span className="hidden sm:inline">Search</span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-ink/45 p-4 pt-[min(12vh,8rem)] backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Universal search"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close search"
            onClick={() => setOpen(false)}
          />
          <div className="relative z-10 flex w-full max-w-2xl flex-col rounded-[var(--radius-card)] border border-ink/10 bg-surface shadow-2xl">
            <div className="border-b border-ink/10 px-4 py-3">
              <label htmlFor="universal-search-input" className="sr-only">
                Search pages, rows, and functions
              </label>
              <input
                ref={inputRef}
                id="universal-search-input"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                }}
                placeholder="Pages, services, partners, stamping rows, CUSTOM / DM functions…"
                className={inputClass}
                autoComplete="off"
              />
              <p className="mt-2 text-xs text-ink-muted">
                Semantic-style full-text (MiniSearch). Arrow keys: use results with mouse or tap.{" "}
                <kbd className="rounded border border-ink/15 bg-surface-2 px-1 font-mono text-[10px]">
                  Esc
                </kbd>{" "}
                to close.
              </p>
            </div>
            <div className="max-h-[min(60vh,28rem)] overflow-y-auto px-2 py-2">
              {grouped.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-ink-muted">No matches.</p>
              ) : (
                grouped.map(([category, hits]) => (
                  <div key={category} className="mb-3">
                    <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                      {category}
                    </p>
                    <ul className="space-y-0.5">
                      {hits.map((h) => (
                        <li key={h.id}>
                          <button
                            type="button"
                            onClick={() => go(h)}
                            className="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left text-sm transition hover:bg-surface-2"
                          >
                            <span className="font-medium text-ink">{h.title}</span>
                            {h.subtitle ? (
                              <span className="mt-0.5 line-clamp-2 text-xs text-ink-muted">
                                {h.subtitle}
                              </span>
                            ) : null}
                            <span className="mt-1 font-mono text-[10px] text-ink-muted/80">
                              {h.path}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

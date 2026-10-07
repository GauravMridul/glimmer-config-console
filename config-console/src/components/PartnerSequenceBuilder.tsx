import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { Link } from "react-router-dom";
import {
  parseSequenceGroups,
  serializeSequenceGroups,
} from "@/lib/sequence";
import {
  computePartnerBacklogTooltipPlain,
  insertServiceAtRecommendedStage,
} from "@/lib/partnerSequenceValidation";
import type { ServiceConfiguration } from "@/types/models";

const MIME = "application/x-config-console-partner-seq";

type DragPayload =
  | { kind: "add"; id: number }
  | { kind: "move"; fromStage: number; fromIndex: number; id: number };

function readPayload(e: DragEvent): DragPayload | null {
  try {
    const t = e.dataTransfer.getData(MIME);
    if (!t) return null;
    return JSON.parse(t) as DragPayload;
  } catch {
    return null;
  }
}

function cloneGroups(groups: number[][]): number[][] {
  return groups.map((g) => [...g]);
}

function idUsedInSequence(groups: number[][], id: number): boolean {
  return groups.some((g) => g.includes(id));
}

type Props = {
  value: string;
  onChange: (next: string) => void;
  services: ServiceConfiguration[];
};

export function PartnerSequenceBuilder({ value, onChange, services }: Props) {
  const groups = useMemo(() => parseSequenceGroups(value), [value]);

  const sorted = useMemo(() => {
    return [...services]
      .filter((s) => !s.is_deleted && s.service_name)
      .sort((a, b) =>
        a.service_name.localeCompare(b.service_name, undefined, {
          sensitivity: "base",
        }),
      );
  }, [services]);

  const nameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of sorted) {
      m.set(s.id, s.service_name);
    }
    return m;
  }, [sorted]);

  const [selectedId, setSelectedId] = useState<string>("");
  const [targetStage, setTargetStage] = useState<string>("new");
  const [backlogClickHint, setBacklogClickHint] = useState<string | null>(null);
  /**
   * After a drag ends, the same chip may receive a spurious `click`. Ignore only if it fires soon
   * after `dragend` on that chip (so a deliberate click a moment later still works).
   */
  const backlogDragEndGuardRef = useRef<{ id: number; at: number } | null>(null);

  useEffect(() => {
    if (!backlogClickHint) return;
    const t = window.setTimeout(() => setBacklogClickHint(null), 4500);
    return () => window.clearTimeout(t);
  }, [backlogClickHint]);

  useEffect(() => {
    if (groups.length === 0) {
      setTargetStage("new");
      return;
    }
    if (targetStage !== "new") {
      const i = Number(targetStage);
      if (Number.isNaN(i) || i < 0 || i >= groups.length) {
        setTargetStage(String(Math.max(0, groups.length - 1)));
      }
    }
  }, [groups, targetStage]);

  const applyGroups = (next: number[][]) => {
    onChange(serializeSequenceGroups(next));
  };

  const addService = (id: number, stageSpec: "new" | number) => {
    if (!Number.isFinite(id)) return;
    if (idUsedInSequence(groups, id)) return;
    const g = cloneGroups(groups);
    if (stageSpec === "new") {
      g.push([id]);
    } else {
      if (stageSpec < 0 || stageSpec >= g.length) return;
      g[stageSpec].push(id);
    }
    applyGroups(g);
  };

  const removeAt = (stageIdx: number, index: number) => {
    const g = cloneGroups(groups);
    if (!g[stageIdx]) return;
    g[stageIdx].splice(index, 1);
    applyGroups(g.filter((s) => s.length > 0));
  };

  const moveWithinStage = (
    stageIdx: number,
    fromIndex: number,
    delta: -1 | 1,
  ) => {
    const g = cloneGroups(groups);
    const row = g[stageIdx];
    if (!row) return;
    const to = fromIndex + delta;
    if (to < 0 || to >= row.length) return;
    const [x] = row.splice(fromIndex, 1);
    row.splice(to, 0, x);
    applyGroups(g);
  };

  const handleDropOnStage = (e: DragEvent, targetStage: number) => {
    e.preventDefault();
    e.stopPropagation();
    const p = readPayload(e);
    if (!p) return;

    if (p.kind === "add") {
      if (idUsedInSequence(groups, p.id)) return;
      const g = cloneGroups(groups);
      while (g.length <= targetStage) g.push([]);
      g[targetStage].push(p.id);
      applyGroups(g);
      return;
    }

    if (p.kind === "move") {
      if (p.fromStage === targetStage) {
        const g = cloneGroups(groups);
        const row = g[targetStage];
        if (!row) return;
        const [x] = row.splice(p.fromIndex, 1);
        row.push(x);
        applyGroups(g);
        return;
      }
      const g = cloneGroups(groups);
      const from = g[p.fromStage];
      if (!from) return;
      const [x] = from.splice(p.fromIndex, 1);
      while (g.length <= targetStage) g.push([]);
      g[targetStage].push(x);
      applyGroups(g.filter((s) => s.length > 0));
    }
  };

  const handleAddClick = () => {
    const id = Number(selectedId);
    if (!selectedId || !Number.isFinite(id)) return;
    if (targetStage === "new") addService(id, "new");
    else addService(id, Number(targetStage));
  };

  const unusedIds = useMemo(
    () => sorted.map((s) => s.id).filter((id) => !idUsedInSequence(groups, id)),
    [sorted, groups],
  );

  const backlogHoverById = useMemo(() => {
    const m = new Map<number, string>();
    for (const id of unusedIds) {
      m.set(id, computePartnerBacklogTooltipPlain(groups, id, services));
    }
    return m;
  }, [unusedIds, groups, services]);

  const onBacklogChipClick = useCallback(
    (id: number) => {
      if (idUsedInSequence(groups, id)) return;
      const next = insertServiceAtRecommendedStage(groups, id, services);
      if (!next) {
        setBacklogClickHint(
          "Couldn’t place automatically—dependencies may be unclear or circular. Drag the chip to a step instead.",
        );
        return;
      }
      onChange(serializeSequenceGroups(next));
      const step = next.findIndex((stage) => stage.includes(id)) + 1;
      setBacklogClickHint(`Added to step ${step} (matches the Tip).`);
    },
    [groups, onChange, services],
  );

  const paletteAside = (
    <aside className="order-1 w-full shrink-0 space-y-3 lg:order-2 lg:sticky lg:top-2 lg:w-[min(22rem,100%)] lg:self-start">
      <div className="rounded-lg border border-ink/10 bg-surface-2/40 p-3">
        <p className="mb-2 text-xs font-medium text-ink">Add to sequence</p>
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-ink-muted">Service</span>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full rounded-lg border border-ink/15 bg-white px-2 py-2 text-sm"
            >
              <option value="">Select…</option>
              {sorted.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.id} — {s.service_name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-ink-muted">Place in</span>
            <select
              value={targetStage}
              onChange={(e) => setTargetStage(e.target.value)}
              className="w-full rounded-lg border border-ink/15 bg-white px-2 py-2 text-sm"
            >
              {groups.length === 0 ? (
                <option value="new">Stage 1 (new)</option>
              ) : (
                <>
                  {groups.map((_, i) => (
                    <option key={i} value={String(i)}>
                      Stage {i + 1} (parallel with others in stage)
                    </option>
                  ))}
                  <option value="new">New stage after last</option>
                </>
              )}
            </select>
          </label>
          <button
            type="button"
            onClick={handleAddClick}
            disabled={!selectedId}
            className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            Add
          </button>
          {selectedId ? (
            <Link
              to={`/esa?id=${encodeURIComponent(selectedId)}`}
              className="block text-center text-xs text-accent hover:underline"
              title="External APIs — request & response for this service id"
            >
              Open External APIs (request & response) →
            </Link>
          ) : null}
        </div>
      </div>

      {unusedIds.length > 0 ? (
        <div className="rounded-lg border border-ink/10 bg-white/90 p-2">
          <p className="mb-2 px-1 text-xs text-ink-muted">
            Not in the journey yet — <span className="font-medium text-ink">click</span> a chip to add
            it at the suggested step (same as the Tip), or{" "}
            <span className="font-medium text-ink">drag</span> to place it yourself. Hover for a{" "}
            <span className="font-medium text-ink">Tip</span> (why that step).
          </p>
          {backlogClickHint ? (
            <p className="mb-2 rounded-md border border-accent/25 bg-accent/10 px-2 py-1.5 text-left text-[11px] leading-snug text-ink">
              {backlogClickHint}
            </p>
          ) : null}
          <div className="max-h-[min(50vh,22rem)] overflow-y-auto pr-0.5">
            <div className="flex flex-col gap-1.5">
              {unusedIds.map((id) => (
                <div
                  key={id}
                  className="flex min-w-0 items-stretch gap-1"
                >
                  <button
                    type="button"
                    draggable
                    title={backlogHoverById.get(id)}
                    onClick={() => {
                      const g = backlogDragEndGuardRef.current;
                      if (
                        g &&
                        g.id === id &&
                        Date.now() - g.at < 350
                      ) {
                        backlogDragEndGuardRef.current = null;
                        return;
                      }
                      backlogDragEndGuardRef.current = null;
                      onBacklogChipClick(id);
                    }}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        MIME,
                        JSON.stringify({ kind: "add", id } satisfies DragPayload),
                      );
                      e.dataTransfer.effectAllowed = "copyMove";
                    }}
                    onDragEnd={() => {
                      backlogDragEndGuardRef.current = { id, at: Date.now() };
                    }}
                    className="min-w-0 flex-1 cursor-grab rounded-md border border-dashed border-ink/20 bg-surface-2/80 px-2 py-1.5 text-left font-mono text-xs text-ink shadow-sm hover:bg-surface-2 active:cursor-grabbing"
                  >
                    <span className="text-ink-muted">{id}</span> {nameById.get(id) ?? "?"}
                  </button>
                  <Link
                    to={`/esa?id=${id}`}
                    title="External APIs — request & response"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="shrink-0 self-center rounded border border-accent/30 px-1.5 py-1 text-[10px] font-medium text-accent hover:bg-accent/10"
                  >
                    APIs
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-ink/10 bg-white/60 px-3 py-2 text-xs text-ink-muted">
          Every known service appears in the sequence below.
        </p>
      )}
    </aside>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
        <div className="order-2 min-w-0 flex-1 space-y-3 lg:order-1">
          <p className="text-xs text-ink-muted">
            <span className="lg:hidden">Stages (click or drag from above).</span>
            <span className="hidden lg:inline">
              Stages — click a backlog chip to auto-place (Tip), or drag from the palette.
            </span>
          </p>
          <div className="space-y-3">
            {groups.length === 0 ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const p = readPayload(e);
                  if (p?.kind === "add" && !idUsedInSequence(groups, p.id)) {
                    applyGroups([[p.id]]);
                  }
                }}
                className="rounded-lg border-2 border-dashed border-ink/15 bg-white/50 px-4 py-8 text-center text-sm text-ink-muted"
              >
                Drop a service here or use <strong className="text-ink">Add</strong> in the palette.
              </div>
            ) : (
              groups.map((stage, si) => (
                <div key={si} className="space-y-1">
                  <p className="text-xs font-medium text-ink-muted">
                    Stage {si + 1}
                    <span className="ml-1.5 font-normal text-ink-muted/90">
                      · services in one stage run in parallel
                    </span>
                  </p>
                  <div
                    role="list"
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => handleDropOnStage(e, si)}
                    className="flex min-h-[3rem] flex-wrap gap-2 rounded-lg border border-ink/15 bg-white/90 p-2"
                  >
                    {stage.map((id, idx) => (
                      <span
                        key={`${si}-${id}-${idx}`}
                        role="listitem"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(
                            MIME,
                            JSON.stringify({
                              kind: "move",
                              fromStage: si,
                              fromIndex: idx,
                              id,
                            } satisfies DragPayload),
                          );
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-ink/10 bg-surface-2 px-2 py-1 font-mono text-xs text-ink shadow-sm"
                      >
                        <span
                          className="cursor-grab select-none"
                          title="Drag to another stage"
                        >
                          {id} {nameById.get(id) ?? "?"}
                        </span>
                        <Link
                          to={`/esa?id=${id}`}
                          title="External APIs — request & response"
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="shrink-0 rounded border border-accent/30 px-1 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/10"
                        >
                          APIs
                        </Link>
                        <span className="flex gap-0.5 border-l border-ink/10 pl-1">
                          <button
                            type="button"
                            title="Earlier in stage (parallel order)"
                            onClick={() => moveWithinStage(si, idx, -1)}
                            disabled={idx === 0}
                            className="px-0.5 leading-none text-ink-muted hover:text-ink disabled:opacity-30"
                          >
                            ←
                          </button>
                          <button
                            type="button"
                            title="Later in stage (parallel order)"
                            onClick={() => moveWithinStage(si, idx, 1)}
                            disabled={idx === stage.length - 1}
                            className="px-0.5 leading-none text-ink-muted hover:text-ink disabled:opacity-30"
                          >
                            →
                          </button>
                        </span>
                        <button
                          type="button"
                          title="Remove"
                          onClick={() => removeAt(si, idx)}
                          className="ml-0.5 text-ink-muted hover:text-warn"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-ink">
              Sequence string
              <span className="ml-1.5 font-normal text-ink-muted">
                (kept in sync with the builder; edit for bulk paste)
              </span>
            </label>
            <textarea
              value={value}
              onChange={(e) => onChange(e.target.value)}
              rows={2}
              spellCheck={false}
              className="mt-1 w-full rounded-lg border border-ink/15 bg-white px-3 py-2 font-mono text-xs text-ink"
              aria-label="service_sequence_string"
            />
          </div>
        </div>

        {paletteAside}
      </div>
    </div>
  );
}

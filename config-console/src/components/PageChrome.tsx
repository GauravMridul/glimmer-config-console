import type { ChangeEvent, ComponentPropsWithoutRef, ReactNode } from "react";

const searchMagnifier = (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

/** Vertical rhythm between major page blocks (override with e.g. `className="space-y-10"`). */
export function PageStack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className === undefined ? "space-y-6" : className}>{children}</div>;
}

/** Primary page card (matches Overview alignment / partner panels) */
export function PageSection({
  children,
  className = "",
  ...rest
}: { children: ReactNode; className?: string } & ComponentPropsWithoutRef<"section">) {
  return (
    <section
      className={`rounded-[var(--radius-card)] border border-ink/10 bg-gradient-to-b from-white via-white to-surface-2/35 p-6 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.06),0_12px_40px_-12px_rgba(0,0,0,0.07)] ring-1 ring-white/70 backdrop-blur-sm sm:p-7 ${className}`.trim()}
      {...rest}
    >
      {children}
    </section>
  );
}

/** Nested panels (forms, mapper inputs, toolbars) */
export const innerPanelClass =
  "rounded-xl border border-ink/10 bg-white/75 p-5 shadow-sm ring-1 ring-ink/[0.04] sm:p-6";

export function PageHero({
  eyebrow,
  eyebrowClassName,
  title,
  titleClassName = "text-xl font-semibold tracking-tight text-ink",
  description,
  afterDescription,
  action,
}: {
  eyebrow?: string;
  eyebrowClassName?: string;
  title: string;
  titleClassName?: string;
  description?: ReactNode;
  afterDescription?: ReactNode;
  action?: ReactNode;
}) {
  const eyebrowCls =
    eyebrowClassName ?? "text-[11px] font-semibold uppercase tracking-[0.12em] text-accent";
  return (
    <div className="border-b border-ink/8 pb-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          {eyebrow ? <p className={eyebrowCls}>{eyebrow}</p> : null}
          <h2 className={`mt-1 ${titleClassName}`}>{title}</h2>
          {description ? (
            <div className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">{description}</div>
          ) : null}
          {afterDescription ? <div className="mt-2">{afterDescription}</div> : null}
        </div>
        {action ? (
          <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">{action}</div>
        ) : null}
      </div>
    </div>
  );
}

export function SemanticSearchField({
  id,
  label,
  value,
  onChange,
  placeholder,
  footer,
  className = "",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  footer: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={`flex max-w-xl flex-col gap-2 text-xs font-medium text-ink ${className}`.trim()}
      htmlFor={id}
    >
      <span>{label}</span>
      <div className="relative w-full">
        <span
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
          aria-hidden
        >
          {searchMagnifier}
        </span>
        <input
          id={id}
          type="search"
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="w-full rounded-xl border border-ink/12 bg-white/90 py-2.5 pl-10 pr-3 text-sm text-ink shadow-inner outline-none ring-accent/0 transition placeholder:text-ink-muted/70 hover:border-ink/18 hover:bg-white focus:border-accent/40 focus:bg-white focus:ring-2 focus:ring-accent/18"
          autoComplete="off"
        />
      </div>
      <span className="text-[11px] font-normal text-ink-muted">{footer}</span>
    </label>
  );
}

export function DataTableShell({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-ink/10 bg-white/60 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.85)] ring-1 ring-ink/[0.04] ${className}`.trim()}
    >
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

/** Apply to `<thead><tr …>` on list screens (ESA / SFDC tables). */
export const tableListHeadRowClass =
  "sticky top-0 z-[1] border-b border-ink/10 bg-surface-2/90 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted backdrop-blur-md";

/** Partners table: filters in header — keep normal case. */
export const tableListHeadRowClassPlain =
  "sticky top-0 z-[1] border-b border-ink/10 bg-surface-2/90 text-xs font-semibold text-ink-muted backdrop-blur-md";

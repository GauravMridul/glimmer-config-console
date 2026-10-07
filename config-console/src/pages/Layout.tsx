import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { Modal } from "@/components/Modal";
import { UniversalSearch } from "@/components/UniversalSearch";
import { resetToSeed } from "@/lib/storage";
import { useConfig } from "@/context/ConfigContext";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `inline-flex items-baseline gap-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive
      ? "bg-white text-ink shadow-sm shadow-ink/5"
      : "text-ink-muted hover:bg-white/60 hover:text-ink"
  }`;

function AboutModal({
  open,
  onClose,
  apiMode,
}: {
  open: boolean;
  onClose: () => void;
  apiMode: boolean;
}) {
  return (
    <Modal title="About this console" open={open} onClose={onClose} panelClassName="max-w-lg">
      <div className="space-y-5 text-sm leading-relaxed text-ink-muted">
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Connection</h3>
          <p className="mt-2">
            {apiMode ? (
              <>
                <strong className="font-medium text-ink">API mode:</strong> reads and writes
                configuration through the console API to your database. Use{" "}
                <strong className="font-medium text-ink">Reload from database</strong> after changes
                elsewhere.
              </>
            ) : (
              <>
                <strong className="font-medium text-ink">Local mode:</strong> edits stay in this
                browser until you enable the API. Use <strong className="font-medium text-ink">Overview</strong>{" "}
                to spot gaps across External APIs, partners, and Salesforce.
              </>
            )}
          </p>
        </section>
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Alignment</h3>
          <p className="mt-2">
            External API configs and Data Stamping templates align on{" "}
            <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px] text-ink">
              service_name
            </code>
            . <strong className="font-medium text-ink">Overview</strong> shows where names diverge.
          </p>
        </section>
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Getting started</h3>
          <p className="mt-2">
            In local mode, sample bundles use the same editors as production. Open the demo walkthrough
            to load scenarios and explore.
          </p>
          <Link
            to="/demo"
            onClick={onClose}
            className="mt-3 inline-flex rounded-lg border border-accent/30 bg-white px-3 py-2 text-sm font-medium text-accent shadow-sm hover:bg-accent/5"
          >
            Demo &amp; orientation →
          </Link>
        </section>
        <p className="border-t border-ink/10 pt-4 text-xs text-ink-muted">
          <span className="font-medium text-ink">Glimmer Technologies</span> — integration settings
          for decision flows (ESA, partner routing, Salesforce stamping).
        </p>
      </div>
    </Modal>
  );
}

export function Layout() {
  const { setBundle, apiMode, refresh, loading, error, clearError } = useConfig();
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <div className="mx-auto flex min-h-screen max-w-[90rem] flex-col px-4 pb-10 pt-3 sm:px-6 sm:pt-4">
      {error ? (
        <div
          className="mb-4 rounded-lg border border-warn/50 bg-warn/15 px-4 py-3 text-sm text-ink"
          role="alert"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <span>{error}</span>
            <button
              type="button"
              onClick={clearError}
              className="shrink-0 text-xs font-medium text-ink-muted hover:text-ink"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
      {apiMode && loading ? (
        <p className="mb-3 text-sm text-ink-muted">Loading configuration…</p>
      ) : null}

      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <img
            src="/glimmer-logo.png"
            alt="Glimmer Technologies"
            className="h-8 w-auto max-w-[200px] shrink-0 object-contain object-left sm:h-9 sm:max-w-[220px]"
          />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight text-ink sm:text-xl">
              Config console
            </h1>
            <p
              className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent"
              title={apiMode ? "Connected to API — changes persist to your database" : "Browser storage only"}
            >
              {apiMode ? "Connected to API" : "Browser storage"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAboutOpen(true)}
            className="rounded-lg border border-ink/12 bg-white px-3 py-2 text-sm font-medium text-ink shadow-sm transition hover:border-accent/35 hover:text-ink"
          >
            About
          </button>
          <UniversalSearch />
          <button
            type="button"
            onClick={() => (apiMode ? void refresh() : setBundle(resetToSeed()))}
            className="rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink shadow-sm transition hover:border-accent/30 hover:text-ink"
          >
            {apiMode ? "Reload from database" : "Reset sample data"}
          </button>
        </div>
      </header>

      <nav
        className="mb-4 flex w-fit max-w-full flex-wrap gap-1 rounded-xl border border-ink/10 bg-white/50 p-1.5 shadow-sm backdrop-blur"
        aria-label="Main"
      >
        <NavLink to="/" end className={linkClass}>
          Overview
        </NavLink>
        <NavLink to="/smart" className={linkClass}>
          Import
        </NavLink>
        <NavLink to="/esa-auto-mapper" className={linkClass} title="Map sample JSON to ESA request_body">
          ESA mapper
        </NavLink>
        <NavLink to="/sfdc-auto-mapper" className={linkClass} title="Map fields for Salesforce Composite">
          SFDC mapper
        </NavLink>
        <span
          className="mx-1 hidden h-6 w-px self-center bg-ink/10 sm:block"
          aria-hidden
        />
        <NavLink
          to="/esa"
          className={linkClass}
          title="service_configuration — HTTP / external API services"
        >
          <span className="text-esa">External APIs</span>
        </NavLink>
        <NavLink
          to="/expressions"
          className={linkClass}
          title="ESA {{CUSTOM:…}}, {{TRANSFORM:…}}, {{ARRAY:…}} (external-service-adapter) and DM {{ }} govaluate (decision-manager)"
        >
          <span className="text-ink">Custom Functions</span>
        </NavLink>
        <NavLink
          to="/partners"
          className={linkClass}
          title="partner_service_mapping"
        >
          Partners and Stages
        </NavLink>
        <NavLink
          to="/sfdc"
          className={linkClass}
          title="service_sfdc_field_mapping — Salesforce stamping"
        >
          <span className="text-dm">Data Stamping</span>
        </NavLink>
        <NavLink to="/test" className={linkClass} title="Call process-sequence/v2 via server proxy">
          Test sequence
        </NavLink>
      </nav>

      <main className="min-w-0 min-h-0 flex-1">
        <Outlet />
      </main>

      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} apiMode={apiMode} />
    </div>
  );
}

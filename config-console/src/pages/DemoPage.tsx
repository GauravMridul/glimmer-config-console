import { useCallback } from "react";
import { Link } from "react-router-dom";
import { useConfig } from "@/context/ConfigContext";
import { innerPanelClass, PageSection, PageStack, SemanticSearchField } from "@/components/PageChrome";
import { useSemanticRowFilter } from "@/lib/semanticTableSearch";
import {
  getDemoScenario,
  type DemoScenarioId,
} from "@/lib/demoScenarios";

const DEMO_GUIDE_STEPS: {
  title: string;
  detail: string;
  links?: { label: string; to: string }[];
}[] = [
  {
    title: "Stay in local (browser) mode",
    detail:
      "Canned scenarios load into localStorage only when the console is not connected to the API. If VITE_USE_API is on, use the real DB instead—the Load buttons stay disabled.",
  },
  {
    title: "Pick a scenario and load it",
    detail:
      "Scroll to “Load a scenario”, choose a card (e.g. Full journey), then click Load. This replaces the in-browser dataset immediately.",
  },
  {
    title: "Start on Overview",
    detail:
      "Check the alignment table: green means ESA, partner, and SFDC names line up; yellow rows flag gaps.",
    links: [{ label: "Open Overview", to: "/" }],
  },
  {
    title: "Walk the three config areas",
    detail:
      "External APIs = HTTP services. Partners & stages = sequences of service ids. Data stamping = Salesforce Composite templates (one service_name can include several SObject POSTs in the same array). Same service_name ties them together.",
    links: [
      { label: "External APIs", to: "/esa" },
      { label: "Partners and Stages", to: "/partners" },
      { label: "Data Stamping", to: "/sfdc" },
    ],
  },
  {
    title: "Optional: mapper tools from JSON samples",
    detail:
      "ESA mapper drafts External API request_body from pasted responses. SFDC mapper flattens API JSON, assigns paths to one or more Row SObjects (O1, O2, …), and leaves extras under ∅ so they stay out of export — matching how Composite arrays stamp multiple objects per service.",
    links: [
      { label: "ESA mapper", to: "/esa-auto-mapper" },
      { label: "SFDC mapper", to: "/sfdc-auto-mapper" },
    ],
  },
  {
    title: "Optional: troubleshoot with gap scenarios",
    detail:
      "Load “Gap: no SFDC…” or “Gap: orphan SFDC…” to see how Overview highlights missing links—useful for training and incident review.",
  },
  {
    title: "Reset sample data when needed",
    detail:
      "Use Reset sample data in the header to return to the original small seed in local mode.",
  },
];

const scenarios: {
  id: DemoScenarioId;
  title: string;
  badge: string;
  description: string;
  whatToSee: string;
}[] = [
  {
    id: "full",
    title: "Full journey",
    badge: "Recommended",
    description:
      "Two partner mappings, three ESA services, two SFDC stamping configs. NTCModel’s Composite template includes two Salesforce object POSTs (audit + summary) in one array — same pattern the SFDC mapper uses for multi-object exports.",
    whatToSee:
      "Open Overview: alignment table should have no yellow rows. On Data Stamping, open NTCModel and confirm request_body has two Composite blocks.",
  },
  {
    id: "minimal",
    title: "Minimal one-hop",
    badge: "Quick pitch",
    description:
      "Single service id, one partner row, one SFDC template — fastest story for “how the three tables connect.”",
    whatToSee:
      "Use this before a live audience when you have under two minutes.",
  },
  {
    id: "missing-sfdc",
    title: "Gap: no SFDC for CreditCheck",
    badge: "Troubleshooting",
    description:
      "Same as full demo but the CreditCheck SFDC mapping row is removed. ESA still runs the HTTP call; stamping to Salesforce is missing for that service name.",
    whatToSee:
      "Overview highlights CreditCheck: ESA yes, SFDC no. Discuss operational risk vs. intentional.",
  },
  {
    id: "orphan-sfdc",
    title: "Gap: orphan SFDC row",
    badge: "Troubleshooting",
    description:
      "Adds a SFDC template for LegacyOnlyService with no matching ESA service_configuration.",
    whatToSee:
      "Overview highlights LegacyOnlyService: SFDC yes, ESA no — stale config or rename drift.",
  },
];

function PortalOverview() {
  return (
    <PageSection aria-labelledby="portal-overview-heading">
      <h2
        id="portal-overview-heading"
        className="text-xl font-semibold tracking-tight text-ink sm:text-2xl"
      >
        What is this portal?
      </h2>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-muted">
        This <strong className="font-medium text-ink">config console</strong> is where you review and
        edit integration settings used in decision flows:{" "}
        <strong className="font-medium text-ink">HTTP calls to external systems</strong> (External
        Service Adapter), <strong className="font-medium text-ink">which services run for each partner
        and stage</strong> (Decision Manager routing), and{" "}
        <strong className="font-medium text-ink">how results are written back to Salesforce</strong>{" "}
        (data stamping). Everything is visible in one UI so you can spot misalignment before it hits
        production.
      </p>

      <h3 className="mt-8 text-sm font-semibold uppercase tracking-wide text-ink-muted">
        Main screens (use the top nav)
      </h3>
      <ul className="mt-4 grid list-none gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <li className="guide-step flex flex-col rounded-xl border border-ink/10 bg-surface/80 p-4 shadow-sm"
          style={{ animationDelay: "0.05s" }}>
          <span className="text-xs font-medium text-ink-muted">Start here</span>
          <span className="mt-1 font-semibold text-ink">Overview</span>
          <p className="mt-2 flex-1 text-xs leading-relaxed text-ink-muted">
            One table that checks whether each service name lines up across External APIs, partner
            sequences, and Data Stamping—yellow means a gap to fix.
          </p>
          <Link
            to="/"
            className="mt-3 text-xs font-medium text-accent hover:underline"
          >
            Open Overview →
          </Link>
        </li>
        <li
          className="guide-step flex flex-col rounded-xl border border-esa/25 bg-white p-4 shadow-sm ring-1 ring-esa/15"
          style={{ animationDelay: "0.12s" }}
        >
          <span className="text-xs font-semibold text-esa">External APIs</span>
          <span className="mt-1 font-semibold text-ink">ESA services</span>
          <p className="mt-2 flex-1 text-xs leading-relaxed text-ink-muted">
            Define each HTTP integration: URL, method, headers, and{" "}
            <code className="font-mono text-[10px]">request_body</code> templates (
            <code className="font-mono text-[10px]">service_configuration</code>).
          </p>
          <Link to="/esa" className="mt-3 text-xs font-medium text-esa hover:underline">
            External APIs →
          </Link>
        </li>
        <li
          className="guide-step flex flex-col rounded-xl border border-dm/25 bg-white p-4 shadow-sm ring-1 ring-dm/15"
          style={{ animationDelay: "0.19s" }}
        >
          <span className="text-xs font-semibold text-dm">Partners &amp; stages</span>
          <span className="mt-1 font-semibold text-ink">Decision Manager</span>
          <p className="mt-2 flex-1 text-xs leading-relaxed text-ink-muted">
            Map partner context to ordered lists of service <strong className="text-ink">ids</strong> (
            <code className="font-mono text-[10px]">partner_service_mapping</code>).
          </p>
          <Link to="/partners" className="mt-3 text-xs font-medium text-dm hover:underline">
            Partners and Stages →
          </Link>
        </li>
        <li
          className="guide-step flex flex-col rounded-xl border border-dm/25 bg-white p-4 shadow-sm ring-1 ring-dm/15"
          style={{ animationDelay: "0.26s" }}
        >
          <span className="text-xs font-semibold text-dm">Data stamping</span>
          <span className="mt-1 font-semibold text-ink">Salesforce</span>
          <p className="mt-2 flex-1 text-xs leading-relaxed text-ink-muted">
            Composite-style templates that stamp values into one or more Salesforce objects per service (
            <code className="font-mono text-[10px]">service_sfdc_field_mapping</code> —{" "}
            <code className="font-mono text-[10px]">request_body</code> is an array of sub-requests).
          </p>
          <Link to="/sfdc" className="mt-3 text-xs font-medium text-dm hover:underline">
            Data Stamping →
          </Link>
        </li>
      </ul>

      <div className="mt-6 rounded-lg border border-ink/8 bg-surface-2/50 px-4 py-3 text-xs leading-relaxed text-ink-muted">
        <strong className="font-medium text-ink">Helpers:</strong>{" "}
        <Link to="/smart" className="font-medium text-ink underline-offset-2 hover:underline">
          Import
        </Link>
        {" · "}
        <Link to="/esa-auto-mapper" className="font-medium text-ink underline-offset-2 hover:underline">
          ESA mapper
        </Link>
        {" · "}
        <Link to="/sfdc-auto-mapper" className="font-medium text-ink underline-offset-2 hover:underline">
          SFDC mapper
        </Link>
        {" "}
        — optional tools to build JSON from samples (SFDC mapper supports multiple Row SObjects per API, ∅ for paths you skip). Use the header{" "}
        <strong className="text-ink">About</strong> button anytime for how the console connects and
        aligns config.
      </div>

      <p className="mt-4 max-w-3xl text-xs leading-relaxed text-ink-muted">
        <strong className="text-ink">How it fits together:</strong> there is no database foreign key
        between these editors in the UI—operations teams rely on consistent{" "}
        <code className="rounded bg-surface-2 px-1 font-mono text-[11px]">service_name</code> strings
        and correct numeric <code className="rounded bg-surface-2 px-1 font-mono text-[11px]">id</code>{" "}
        references in partner sequences. Overview makes breaks in that discipline obvious.
      </p>
    </PageSection>
  );
}

function StepByStepGuide() {
  const getGuideDoc = useCallback(
    (s: (typeof DEMO_GUIDE_STEPS)[number]) => ({
      id: s.title,
      text: [
        s.title,
        s.detail,
        ...(s.links?.map((l) => `${l.label} ${l.to}`) ?? []),
      ].join(" "),
    }),
    [],
  );
  const [guideSearch, setGuideSearch, guideSteps] = useSemanticRowFilter(
    DEMO_GUIDE_STEPS,
    getGuideDoc,
  );

  return (
    <PageSection
      className="border-accent/25 bg-gradient-to-br from-white via-white to-accent/5"
      aria-labelledby="demo-guide-heading"
    >
      <h3 id="demo-guide-heading" className="text-lg font-semibold tracking-tight text-ink">
        Step-by-step: run the demo once
      </h3>
      <p className="mt-1 max-w-2xl text-sm text-ink-muted">
        After reading the portal overview above, walk through these once on your machine. Then you can
        jump to any screen from the nav.
      </p>
      <div className="mt-4">
        <SemanticSearchField
          id="demo-guide-search"
          label="Filter steps"
          value={guideSearch}
          onChange={(e) => setGuideSearch(e.target.value)}
          placeholder="e.g. Overview, scenario, Import…"
          footer={
            <>
              Showing <span className="tabular-nums font-medium text-ink">{guideSteps.length}</span> of{" "}
              <span className="tabular-nums font-medium text-ink">{DEMO_GUIDE_STEPS.length}</span> steps
            </>
          }
        />
      </div>
      <ol className="relative mt-8 space-y-0">
        <span
          className="absolute start-[0.7rem] top-3 bottom-3 w-px bg-gradient-to-b from-accent/50 via-accent/25 to-transparent sm:start-[0.85rem]"
          aria-hidden
        />
        {guideSteps.map((step, index) => (
          <li
            key={step.title}
            className="guide-step relative flex gap-4 pb-10 last:pb-0"
            style={{ animationDelay: `${0.06 + index * 0.09}s` }}
          >
            <span
              className="relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-accent/40 bg-white text-xs font-bold text-accent shadow-sm sm:h-8 sm:w-8 sm:text-sm"
              aria-hidden
            >
              {index + 1}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="font-semibold text-ink">{step.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-muted">{step.detail}</p>
              {step.links && step.links.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {step.links.map((l) => (
                    <Link
                      key={l.to}
                      to={l.to}
                      className="rounded-lg border border-ink/12 bg-white px-3 py-1.5 text-xs font-medium text-ink shadow-sm transition hover:border-accent/35 hover:bg-surface-2"
                    >
                      {l.label} →
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </PageSection>
  );
}

function FlowDiagram() {
  return (
    <div className={innerPanelClass}>
      <h3 className="text-sm font-semibold text-ink-muted">End-to-end (conceptual)</h3>
      <div className="mx-auto mt-6 flex max-w-lg flex-col gap-2 text-sm">
        <FlowDiagramStep
          title="1. Partner context"
          subtitle="Decision Manager"
          body="partner_service_mapping picks a service_sequence_string from partner + stage + dimensions."
          tone="dm"
        />
        <ArrowDown />
        <FlowDiagramStep
          title="2. ESA execution"
          subtitle="External Service Adapter"
          body="service_configuration rows define HTTP calls for each numeric id in the sequence (comma = parallel group, semicolon = next group)."
          tone="esa"
        />
        <ArrowDown />
        <FlowDiagramStep
          title="3. Normalized output"
          subtitle="valueJson"
          body="Responses are keyed by service name (e.g. NTCModel.*). No foreign key to the next step — only naming discipline."
          tone="neutral"
        />
        <ArrowDown />
        <FlowDiagramStep
          title="4. Salesforce stamping"
          subtitle="Decision Manager"
          body="service_sfdc_field_mapping.request_body is a Composite array: each entry POSTs to an sobjects URL; one service can stamp several objects in one template."
          tone="dm"
        />
      </div>
    </div>
  );
}

function FlowDiagramStep({
  title,
  subtitle,
  body,
  tone,
}: {
  title: string;
  subtitle: string;
  body: string;
  tone: "esa" | "dm" | "neutral";
}) {
  const ring =
    tone === "esa"
      ? "ring-esa/30"
      : tone === "dm"
        ? "ring-dm/30"
        : "ring-ink/10";
  return (
    <div
      className={`flex max-w-sm flex-1 flex-col rounded-xl border border-ink/10 bg-surface p-4 ring-2 ${ring}`}
    >
      <p className="text-xs font-medium text-ink-muted">{subtitle}</p>
      <p className="mt-1 font-semibold text-ink">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">{body}</p>
    </div>
  );
}

function ArrowDown() {
  return (
    <div className="flex justify-center py-0.5">
      <span className="text-ink-muted" aria-hidden>
        ↓
      </span>
    </div>
  );
}

export function DemoPage() {
  const { setBundle, apiMode } = useConfig();

  const getScenarioDoc = useCallback((s: (typeof scenarios)[number]) => {
    return {
      id: s.id,
      text: [s.id, s.title, s.badge, s.description, s.whatToSee].join(" "),
    };
  }, []);
  const [scenarioSearch, setScenarioSearch, scenariosFiltered] = useSemanticRowFilter(
    scenarios,
    getScenarioDoc,
  );

  const loadScenario = (id: DemoScenarioId) => {
    if (apiMode) return;
    setBundle(getDemoScenario(id));
  };

  return (
    <PageStack className="space-y-10">
      <PageSection className="border-accent/20 bg-gradient-to-br from-white via-white to-surface-2/40">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">
          Demo · read this page first
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
          Get oriented before you edit anything
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted">
          Use this page to understand <strong className="font-medium text-ink">what each part of the
          portal does</strong>, then load a sample dataset and click through the same screens you
          would use in production. In <strong className="font-medium text-ink">local mode</strong>, data
          lives in this browser (
          <code className="rounded bg-surface-2 px-1 font-mono text-xs">localStorage</code>
          ). When the console is <strong className="font-medium text-ink">connected to the API</strong> (
          <code className="font-mono text-xs">VITE_USE_API</code>), scenario buttons are disabled—you
          work against the real database instead.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to="/smart"
            className="rounded-lg border border-accent/30 bg-white px-4 py-2.5 text-sm font-medium text-accent hover:bg-surface-2"
          >
            Import sample → ESA + SFDC
          </Link>
          <Link
            to="/"
            className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-accent-hover"
          >
            Open Overview after loading a scenario
          </Link>
          <Link
            to="/esa"
            className="rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-sm font-medium text-ink hover:bg-surface-2"
          >
            External APIs
          </Link>
          <Link
            to="/partners"
            className="rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-sm font-medium text-ink hover:bg-surface-2"
          >
            Partners and Stages
          </Link>
          <Link
            to="/sfdc"
            className="rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-sm font-medium text-ink hover:bg-surface-2"
          >
            Data Stamping
          </Link>
        </div>
      </PageSection>

      <PortalOverview />

      <StepByStepGuide />

      <section>
        <h3 className="text-lg font-semibold">Load sample data</h3>
        <p className="mt-1 text-sm text-ink-muted">
          When you are ready to explore with real-looking rows, pick a bundle below. It{" "}
          <strong className="font-medium text-ink">replaces</strong> the in-browser dataset immediately
          (local mode only). Use <strong className="font-medium text-ink">Reset sample data</strong> in
          the header to go back to the original small seed.
        </p>
        <div className="mt-4">
          <SemanticSearchField
            id="demo-scenario-search"
            label="Filter scenarios"
            value={scenarioSearch}
            onChange={(e) => setScenarioSearch(e.target.value)}
            placeholder="e.g. gap, minimal, CreditCheck…"
            footer={
              <>
                Showing{" "}
                <span className="tabular-nums font-medium text-ink">{scenariosFiltered.length}</span> of{" "}
                <span className="tabular-nums font-medium text-ink">{scenarios.length}</span> scenarios
              </>
            }
          />
        </div>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {scenariosFiltered.map((s) => (
            <li key={s.id} className={`flex flex-col ${innerPanelClass}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink">{s.title}</span>
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-muted">
                  {s.badge}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                {s.description}
              </p>
              <p className="mt-3 border-l-2 border-accent/40 pl-3 text-xs text-ink-muted">
                <span className="font-medium text-ink">Try:</span> {s.whatToSee}
              </p>
              <button
                type="button"
                disabled={apiMode}
                title={
                  apiMode
                    ? "Disabled while VITE_USE_API is on — scenarios only seed localStorage."
                    : undefined
                }
                onClick={() => loadScenario(s.id)}
                className="mt-4 self-start rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Load “{s.title}”
              </button>
            </li>
          ))}
        </ul>
      </section>

      <FlowDiagram />

      <PageSection className="text-sm text-ink-muted">
        <h3 className="font-semibold text-ink">Implementation notes</h3>
        <ul className="mt-3 list-inside list-disc space-y-2">
          <li>
            <strong className="text-ink">Loose coupling:</strong> ESA and SFDC configuration are
            edited on separate screens; only{" "}
            <code className="font-mono text-xs">service_name</code> aligns them in Overview.
          </li>
          <li>
            <strong className="text-ink">Multi-object stamping:</strong> the SFDC auto-mapper exports one Composite sub-request per Row SObject block; paths are assigned per row (O1, O2, …). Unmatched paths stay under ∅ and are omitted from the generated JSON.
          </li>
          <li>
            Partner sequences use <strong className="text-ink">numeric ids</strong> that reference{" "}
            <code className="font-mono text-xs">service_configuration.id</code>, not the display name.
            Overview resolves ids to names for review.
          </li>
          <li>
            <strong className="text-ink">Deployment:</strong> this console can persist to a
            database via the API (<code className="font-mono text-xs">VITE_USE_API</code>) or use
            browser storage; the data models in{" "}
            <code className="font-mono text-xs">src/types/models.ts</code> stay the same.
          </li>
        </ul>
      </PageSection>
    </PageStack>
  );
}

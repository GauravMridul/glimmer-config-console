import { useLayoutEffect } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { EsaCustomFunctionsPanel } from "@/components/EsaCustomFunctionsPanel";
import { EsaTransformPanel } from "@/components/EsaTransformPanel";
import { EsaArrayPanel } from "@/components/EsaArrayPanel";
import { DmCustomFunctionsPanel } from "@/components/DmCustomFunctionsPanel";
import { ESA_CUSTOM_FUNCTIONS_SOURCE } from "@/lib/esaCustomFunctionsReference";
import { PageHero, PageStack } from "@/components/PageChrome";

function scrollToHash(hash: string) {
  const id = hash.replace(/^#/, "");
  if (!id) return;
  requestAnimationFrame(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

export function ExpressionReferencePage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const esaQ = params.get("esa") ?? "";
  const esaTransformQ = params.get("esaTransform") ?? "";
  const esaArrayQ = params.get("esaArray") ?? "";
  const dmQ = params.get("dm") ?? "";

  useLayoutEffect(() => {
    scrollToHash(location.hash);
  }, [location.hash, location.pathname]);

  return (
    <PageStack>
      <div>
        <PageHero
          eyebrow="Reference"
          title="Custom Functions"
          description={
            <>
              External APIs use <strong className="font-medium text-esa">ESA</strong>{" "}
              <code className="font-mono text-[11px]">{"{{CUSTOM:…}}"}</code> helpers and{" "}
              <code className="font-mono text-[11px]">{"{{TRANSFORM:…}}"}</code> string ops, and{" "}
              <code className="font-mono text-[11px]">{"{{ARRAY:…}}"}</code> (e.g.{" "}
              <code className="font-mono text-[11px]">transform-only</code>) in external-service-adapter.
              Data Stamping uses <strong className="font-medium text-dm">DM</strong>{" "}
              <code className="font-mono text-[11px]">{"{{ … }}"}</code> in decision-manager. Jump between
              sections anytime.
            </>
          }
        />
        <nav
          className="mt-4 flex w-fit max-w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-ink/10 bg-white/80 px-4 py-3 text-sm shadow-sm ring-1 ring-ink/[0.04]"
          aria-label="On this page"
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Jump to</span>
          <a href="#esa-custom" className="font-semibold text-esa hover:underline">
            ESA CUSTOM
          </a>
          <span className="text-ink-muted" aria-hidden>
            ·
          </span>
          <a href="#esa-transform" className="font-semibold text-esa hover:underline">
            ESA TRANSFORM
          </a>
          <span className="text-ink-muted" aria-hidden>
            ·
          </span>
          <a href="#esa-array" className="font-semibold text-esa hover:underline">
            ESA ARRAY
          </a>
          <span className="text-ink-muted" aria-hidden>
            ·
          </span>
          <a href="#dm-expressions" className="font-semibold text-dm hover:underline">
            DM expressions
          </a>
        </nav>
      </div>

      <section
        id="esa-custom"
        className="scroll-mt-28 space-y-4 rounded-[var(--radius-card)] border border-esa/20 bg-gradient-to-b from-esa/[0.06] to-white/90 p-5 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] ring-1 ring-esa/10 sm:p-6"
        aria-labelledby="esa-custom-heading"
      >
        <div>
          <h3 id="esa-custom-heading" className="text-lg font-semibold text-esa">
            ESA CUSTOM functions
          </h3>
          <p className="mt-2 max-w-3xl text-sm text-ink-muted">
            Helpers for External API templates (<code className="font-mono text-[11px]">request_body</code>
            , headers, <code className="font-mono text-[11px]">additional_config</code>). Implemented in
            the <span className="font-medium text-ink">external-service-adapter</span> — keep this list in
            sync with the Go code when functions change.
          </p>
          <p className="mt-2 font-mono text-[11px] text-ink-muted">{ESA_CUSTOM_FUNCTIONS_SOURCE}</p>
        </div>
        <EsaCustomFunctionsPanel showSourceLine stickyTableHeader={false} initialQuery={esaQ} />
      </section>

      <section
        id="esa-transform"
        className="scroll-mt-28 space-y-4 rounded-[var(--radius-card)] border border-esa/20 bg-gradient-to-b from-esa/[0.06] to-white/90 p-5 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] ring-1 ring-esa/10 sm:p-6"
        aria-labelledby="esa-transform-heading"
      >
        <div>
          <h3 id="esa-transform-heading" className="text-lg font-semibold text-esa">
            ESA TRANSFORM expressions
          </h3>
          <p className="mt-2 max-w-3xl text-sm text-ink-muted">
            String transforms in the same templates as CUSTOM — use{" "}
            <code className="font-mono text-[11px]">{"{{TRANSFORM:<value>:<operation>[:args…]}}"}</code>.
            Common patterns: <code className="font-mono text-[11px]">chunk</code> for multi-line
            addresses, <code className="font-mono text-[11px]">replace_regex</code> to strip non-digits
            before <code className="font-mono text-[11px]">substring:-10</code> for mobile numbers.
          </p>
        </div>
        <EsaTransformPanel initialQuery={esaTransformQ} />
      </section>

      <section
        id="esa-array"
        className="scroll-mt-28 space-y-4 rounded-[var(--radius-card)] border border-esa/20 bg-gradient-to-b from-esa/[0.06] to-white/90 p-5 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] ring-1 ring-esa/10 sm:p-6"
        aria-labelledby="esa-array-heading"
      >
        <div>
          <h3 id="esa-array-heading" className="text-lg font-semibold text-esa">
            ESA ARRAY expressions
          </h3>
          <p className="mt-2 max-w-3xl text-sm text-ink-muted">
            Array shaping for External API templates — especially{" "}
            <code className="font-mono text-[11px]">transform-only</code> to map API field names to
            Salesforce-style keys and optional <code className="font-mono text-[11px]">@NUMERIC</code> /{" "}
            <code className="font-mono text-[11px]">@BOOLEAN</code> /{" "}
            <code className="font-mono text-[11px]">@STRING</code> coercion. Not the same prefix as{" "}
            <code className="font-mono text-[11px]">{"{{TRANSFORM:…}}"}</code>.
          </p>
        </div>
        <EsaArrayPanel initialQuery={esaArrayQ} />
      </section>

      <section
        id="dm-expressions"
        className="scroll-mt-28 space-y-4 rounded-[var(--radius-card)] border border-dm/20 bg-gradient-to-b from-dm/[0.06] to-white/90 p-5 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] ring-1 ring-dm/10 sm:p-6"
        aria-labelledby="dm-expressions-heading"
      >
        <div>
          <h3 id="dm-expressions-heading" className="text-lg font-semibold text-dm">
            Decision Manager expression functions
          </h3>
          <p className="mt-2 max-w-3xl text-sm text-ink-muted">
            Used inside <code className="font-mono text-[11px]">{"{{ double braces }}"}</code> when
            templating Salesforce Composite{" "}
            <code className="font-mono text-[11px]">request_body</code> (Data Stamping). Evaluated by{" "}
            <span className="font-medium text-ink">decision-manager</span> against the normalized ESA
            response map — not the same as ESA’s{" "}
            <code className="font-mono text-[11px]">{"{{CUSTOM:…}}"}</code> helpers.
          </p>
        </div>
        <DmCustomFunctionsPanel initialQuery={dmQ} htmlIdPrefix="dm-ref" />
      </section>

      <p className="text-sm text-ink-muted">
        <Link to="/esa" className="font-medium text-accent hover:underline">
          ← External APIs
        </Link>
        {" · "}
        <Link to="/sfdc" className="font-medium text-dm hover:underline">
          Data Stamping
        </Link>
      </p>
    </PageStack>
  );
}

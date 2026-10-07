import { type ButtonHTMLAttributes, type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { Modal } from "@/components/Modal";
import { EsaCustomFunctionsPanel } from "@/components/EsaCustomFunctionsPanel";
import { EsaTransformPanel } from "@/components/EsaTransformPanel";
import { EsaArrayPanel } from "@/components/EsaArrayPanel";

const triggerBase =
  "inline-flex items-center gap-1.5 rounded-lg border border-esa/40 bg-gradient-to-b from-esa/14 to-esa/5 px-3 py-1.5 text-xs font-semibold text-esa shadow-sm transition hover:border-esa/60 hover:shadow-md active:translate-y-px";

export function EsaCustomFunctionsReferenceTrigger({
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode }) {
  return (
    <button type="button" className={`${triggerBase} ${className}`.trim()} {...rest}>
      {children ?? (
        <>
          ESA templates
          <span className="font-normal opacity-85" aria-hidden>
            {"{{CUSTOM}} · {{TRANSFORM}} · {{ARRAY}}"}
          </span>
        </>
      )}
    </button>
  );
}

type EsaHelpSection = "custom" | "transform" | "array";

const FULL_PAGE_HASH: Record<EsaHelpSection, string> = {
  custom: "#esa-custom",
  transform: "#esa-transform",
  array: "#esa-array",
};

const TABLE_SCROLL = "min(58vh,520px)";

type EsaCustomFunctionsHelpModalProps = {
  open: boolean;
  onClose: () => void;
};

export function EsaCustomFunctionsHelpModal({ open, onClose }: EsaCustomFunctionsHelpModalProps) {
  const [section, setSection] = useState<EsaHelpSection>("custom");

  const tabClass = (id: EsaHelpSection) =>
    `rounded-lg px-3 py-2 text-sm font-medium transition ${
      section === id
        ? "bg-white text-ink shadow-sm shadow-ink/5"
        : "text-ink-muted hover:bg-white/70 hover:text-ink"
    }`;

  return (
    <Modal
      title="ESA template reference"
      open={open}
      onClose={onClose}
      zClassName="z-[60]"
      panelClassName="max-w-[min(92rem,calc(100vw-1.25rem))]"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <Link
            to={`/expressions${FULL_PAGE_HASH[section]}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-accent hover:underline"
          >
            Open on Custom Functions page (new tab)
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-hover"
          >
            Done
          </button>
        </div>
      }
    >
      <p className="mb-3 text-sm leading-relaxed text-ink-muted">
        For <strong className="font-medium text-ink">External API</strong> rows: use in{" "}
        <code className="font-mono text-[11px] text-ink">request_body</code>,{" "}
        <code className="font-mono text-[11px] text-ink">headers</code>, and{" "}
        <code className="font-mono text-[11px] text-ink">additional_config</code>. Evaluated in{" "}
        <span className="font-medium text-ink">external-service-adapter</span>. Pick a tab for{" "}
        <code className="font-mono text-[11px]">{"{{CUSTOM:…}}"}</code>,{" "}
        <code className="font-mono text-[11px]">{"{{TRANSFORM:…}}"}</code>, or{" "}
        <code className="font-mono text-[11px]">{"{{ARRAY:…}}"}</code>.
      </p>

      <div
        role="tablist"
        aria-label="ESA expression kinds"
        className="mb-4 flex flex-wrap gap-1 rounded-xl border border-ink/10 bg-white/50 p-1.5 shadow-sm"
      >
        <button
          type="button"
          role="tab"
          id="esa-help-tab-custom"
          aria-selected={section === "custom"}
          aria-controls="esa-help-panel-custom"
          onClick={() => setSection("custom")}
          className={tabClass("custom")}
        >
          <span className="text-esa">CUSTOM</span>
        </button>
        <button
          type="button"
          role="tab"
          id="esa-help-tab-transform"
          aria-selected={section === "transform"}
          aria-controls="esa-help-panel-transform"
          onClick={() => setSection("transform")}
          className={tabClass("transform")}
        >
          <span className="text-esa">TRANSFORM</span>
        </button>
        <button
          type="button"
          role="tab"
          id="esa-help-tab-array"
          aria-selected={section === "array"}
          aria-controls="esa-help-panel-array"
          onClick={() => setSection("array")}
          className={tabClass("array")}
        >
          <span className="text-esa">ARRAY</span>
        </button>
      </div>

      {section === "custom" ? (
        <section id="esa-help-panel-custom" role="tabpanel" aria-labelledby="esa-help-tab-custom">
          <EsaCustomFunctionsPanel
            showSourceLine={false}
            stickyTableHeader
            tableMaxHeight={TABLE_SCROLL}
          />
        </section>
      ) : null}

      {section === "transform" ? (
        <section id="esa-help-panel-transform" role="tabpanel" aria-labelledby="esa-help-tab-transform">
          <EsaTransformPanel
            showSourceLine={false}
            stickyTableHeader
            tableMaxHeight={TABLE_SCROLL}
          />
        </section>
      ) : null}

      {section === "array" ? (
        <section id="esa-help-panel-array" role="tabpanel" aria-labelledby="esa-help-tab-array">
          <EsaArrayPanel showSourceLine={false} stickyTableHeader tableMaxHeight={TABLE_SCROLL} />
        </section>
      ) : null}
    </Modal>
  );
}

import type { PartnerSequenceValidationResult } from "@/lib/partnerSequenceValidation";

type Props = {
  result: PartnerSequenceValidationResult | null;
  /** True when service_sequence_string is empty */
  empty: boolean;
};

/** Bulleted list of issues (scrollable) for table readability — no “(+N more)” truncation. */
export function PartnerSequenceListCell({ result, empty }: Props) {
  if (empty) {
    return (
      <span className="text-xs text-ink-muted" title="No sequence configured">
        —
      </span>
    );
  }
  if (!result) return null;

  if (result.issues.length === 0) {
    return (
      <span
        className="text-xs font-medium text-dm"
        title="No dependency or ordering issues detected for this sequence."
      >
        OK
      </span>
    );
  }

  return (
    <ul
      className="max-h-[min(11rem,36vh)] list-outside list-disc space-y-1.5 overflow-y-auto py-0.5 pl-4 text-left text-xs leading-snug marker:text-ink-muted/80"
      title={result.issues.map((i) => i.message).join("\n")}
    >
      {result.issues.map((iss, idx) => (
        <li
          key={`${iss.code}-${idx}-${iss.message.slice(0, 32)}`}
          className={
            iss.severity === "error"
              ? "text-warn marker:text-warn/70"
              : "text-ink-muted marker:text-ink-muted"
          }
        >
          <span className="sr-only">{iss.severity}: </span>
          {iss.message}
        </li>
      ))}
    </ul>
  );
}

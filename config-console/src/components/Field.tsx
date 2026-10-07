import { type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

type LabelProps = { label: string; hint?: string; children: ReactNode };

export function Field({ label, hint, children }: LabelProps) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-ink">{label}</span>
      {children}
      {hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
    </label>
  );
}

export function TextInput(
  props: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string },
) {
  const { label, hint, className = "", ...rest } = props;
  return (
    <Field label={label} hint={hint}>
      <input
        className={`w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm outline-none ring-accent/0 transition focus:border-accent/40 focus:ring-2 focus:ring-accent/20 ${className}`}
        {...rest}
      />
    </Field>
  );
}

export function TextArea(
  props: TextareaHTMLAttributes<HTMLTextAreaElement> & {
    label: string;
    hint?: string;
  },
) {
  const { label, hint, className = "", rows = 4, ...rest } = props;
  return (
    <Field label={label} hint={hint}>
      <textarea
        rows={rows}
        spellCheck={false}
        className={`font-mono w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-xs leading-relaxed outline-none ring-accent/0 transition focus:border-accent/40 focus:ring-2 focus:ring-accent/20 ${className}`}
        {...rest}
      />
    </Field>
  );
}

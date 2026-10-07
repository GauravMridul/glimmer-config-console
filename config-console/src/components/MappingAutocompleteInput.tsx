import { useId, useMemo } from "react";
import { filterAutocompleteExpressions } from "@/lib/mappingSuggestions";

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Frequency-sorted expressions from the corpus (see getAllCorpusExpressions). */
  corpusExpressions: string[];
  "aria-label": string;
  placeholder?: string;
  className?: string;
};

/** Native text input with &lt;datalist&gt; capped to 10 filtered options for readability. */
export function MappingAutocompleteInput({
  value,
  onChange,
  corpusExpressions,
  "aria-label": ariaLabel,
  placeholder = "Type a template, or pick an idea ←",
  className = "w-full rounded border border-ink/15 bg-white px-2 py-1.5 font-mono text-xs",
}: Props) {
  const listId = useId();
  const options = useMemo(
    () => filterAutocompleteExpressions(value, corpusExpressions, 10),
    [value, corpusExpressions],
  );

  return (
    <>
      <datalist id={listId}>
        {options.map((expr) => (
          <option key={expr} value={expr} />
        ))}
      </datalist>
      <input
        type="text"
        className={className}
        placeholder={placeholder}
        value={value}
        list={listId}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
      />
    </>
  );
}

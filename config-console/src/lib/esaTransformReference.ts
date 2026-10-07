/**
 * ESA `{{TRANSFORM:…}}` string operations (external-service-adapter
 * `expression_processor.go` → `evaluateTransformationExpression`).
 * Not the same as `{{CUSTOM:…}}` — different prefix and grammar.
 * Full spec: external-service-adapter/docs/ESA_Guide.md §7.
 */
export type EsaTransformOperation = {
  name: string;
  summary: string;
  before: string;
  after: string;
};

export const ESA_TRANSFORM_SOURCE =
  "external-service-adapter — expression_processor.go (evaluateTransformationExpression)";

/** Curated operations / patterns editors search for; not an exhaustive enum. */
export const ESA_TRANSFORM_OPERATIONS: EsaTransformOperation[] = [
  {
    name: "TRANSFORM (syntax)",
    summary:
      "First segment is the value (angle paths, ((Service.field)), literals, nested {{…}}, optional || fallbacks). After the first top-level colon: operation and parameters. Colon-safe rules apply for nested expressions inside the value.",
    before: "{{TRANSFORM:<Contact.Email>:lowercase}}",
    after: "user@example.com (after resolving <Contact.Email>)",
  },
  {
    name: "chunk",
    summary:
      "Pack text into lines up to maxLength characters (word/comma boundaries). Without index: returns a JSON array of lines. With index: returns that line only (0-based); empty if out of range.",
    before: "{{TRANSFORM:<Contact.OtherStreet>||<Contact.MailingStreet>:chunk:40:0}}",
    after: "First ≤40-char line (example; depends on field values)",
  },
  {
    name: "chunk (lines 1–5)",
    summary:
      "Typical Salesforce multi-line address mapping: same source, chunk:40 and indices 0…4.",
    before:
      '"line1": "{{TRANSFORM:<Contact.OtherStreet>||<Contact.MailingStreet>:chunk:40:0}}",\n' +
      '"line2": "{{TRANSFORM:<Contact.OtherStreet>||<Contact.MailingStreet>:chunk:40:1}}"',
    after: "line1 / line2 strings (empty string if no such chunk)",
  },
  {
    name: "replace_regex",
    summary:
      "Regex replace (RE2 syntax). Pattern is the first segment after replace_regex:, replacement is the rest (may be empty to strip non-digits, etc.). Nested TRANSFORM is allowed in the value.",
    before:
      "{{TRANSFORM:{{TRANSFORM:<Contact.Phone>||<Contact.MobilePhone>:replace_regex:[^0-9]:}}:substring:-10}}",
    after: "Last 10 digits only (example)",
  },
  {
    name: "substring",
    summary:
      "substring:start takes from start to end of string. substring:start:length takes a slice. Non-negative start is a byte/char index; negative start counts from the end (e.g. -10 = last 10 characters when no length).",
    before: "{{TRANSFORM:9876543210:substring:-10}}",
    after: "9876543210",
  },
  {
    name: "replace (literal)",
    summary:
      "Literal string replace (not regex): replace:search:replacement. Search and replacement can use placeholders/expressions.",
    before: "{{TRANSFORM:<Contact.Name>:replace:' ':'%20'}}",
    after: "John%20Doe (example)",
  },
  {
    name: "split",
    summary:
      "split:delimiter or split:delimiter:index — delimiter can be a literal or /regex/. Returns array or one element by index.",
    before: "{{TRANSFORM:<Contact.FullName>:split: :0}}",
    after: "First name token (example)",
  },
  {
    name: "uppercase / lowercase / trim",
    summary: "Case and whitespace: uppercase, lowercase, trim, remove_spaces, normalize_spaces.",
    before: "{{TRANSFORM:<Contact.LastName>:uppercase}}",
    after: "SINGH (example)",
  },
  {
    name: "truncate / pad",
    summary: "truncate:length; pad_left:totalLen:char; pad_right:totalLen:char.",
    before: "{{TRANSFORM:<Contact.Description>:truncate:100}}",
    after: "First 97 chars + … (when longer than 100)",
  },
  {
    name: "format_time / parse_time",
    summary:
      "Date/time layout tokens per ESA standardized names (see ESA_Guide §7 and §10). Colon-safe parsing for patterns containing :.",
    before: "{{TRANSFORM:<Contact.Birthdate>:format_time:YYYY-MM-DD}}",
    after: "2020-06-01 (example)",
  },
];

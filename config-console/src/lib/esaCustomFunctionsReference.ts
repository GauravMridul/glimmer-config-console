/**
 * ESA `{{CUSTOM:…}}` helpers implemented in external-service-adapter
 * (`internal/app/service/sequence_service/expression_processor.go` → `evaluateCustomExpression`).
 * Keep aligned when functions change upstream.
 */
export type EsaCustomFunction = {
  name: string;
  summary: string;
  /** Template fragment (what you configure). */
  before: string;
  /** Typical resolved value (placeholders replaced; time/random values are examples). */
  after: string;
};

export const ESA_CUSTOM_FUNCTIONS_SOURCE =
  "external-service-adapter — expression_processor.go (evaluateCustomExpression)";

export const ESA_CUSTOM_FUNCTIONS: EsaCustomFunction[] = [
  {
    name: "base64Encode",
    summary: "Encodes text as Base64 (e.g. for binary-safe payloads).",
    before: "{{CUSTOM:base64Encode:hello}}",
    after: "aGVsbG8=",
  },
  {
    name: "calculateAge",
    summary:
      "Full years from a date of birth (ISO / common datetime strings). Returns 0 if missing or invalid.",
    before: "{{CUSTOM:calculateAge:1990-01-15}}",
    after: "36 (example as of 2026; depends on run date)",
  },
  {
    name: "calculateFOIR",
    summary:
      "Fixed Obligation to Income Ratio — ten colon-separated parameters in a fixed order. Returns -1 if fewer than ten args.",
    before:
      "{{CUSTOM:calculateFOIR:500000:12:36:75000:12000:Web:false:0:[]:0}}",
    after: "38.42 (illustrative; actual value follows Apex-equivalent logic)",
  },
  {
    name: "cleanSpecialChars",
    summary: "Keeps only letters, digits, and spaces (strip punctuation and symbols).",
    before: "{{CUSTOM:cleanSpecialChars:+91-98765-43210!}}",
    after: "919876543210",
  },
  {
    name: "dateWithinDays",
    summary:
      "Whether a date is within a day window from today (two-arg: max days; three-arg: min and max). Returns true/false.",
    before: "{{CUSTOM:dateWithinDays:2020-06-01:30}}",
    after: "false (example; depends on today’s date)",
  },
  {
    name: "daysSince",
    summary: "Whole days from the given date to now (format auto-detected when possible).",
    before: "{{CUSTOM:daysSince:2025-01-01}}",
    after: "461 (example; depends on run date)",
  },
  {
    name: "formatPhone",
    summary:
      "Normalizes digits; formats 10-digit Indian mobiles (and 12-digit 91 prefix) as +91-xxxxx-xxxxx.",
    before: "{{CUSTOM:formatPhone:9876543210}}",
    after: "+91-98765-43210",
  },
  {
    name: "generateId",
    summary:
      "Identifier prefix_SixDigits (default prefix id). Optional first argument sets the prefix; suffix is random.",
    before: "{{CUSTOM:generateId:req}}",
    after: "req_482917 (example; digits change each call)",
  },
  {
    name: "getCurrentTimestamp",
    summary:
      "Current UTC time. Optional format token (YYYYMMDD, DD/MM/YYYY, ISO8601, etc.) via ESA date vocabulary.",
    before: "{{CUSTOM:getCurrentTimestamp:YYYYMMDD}}",
    after: "20260406 (example; matches clock when evaluated)",
  },
  {
    name: "getJsonPath",
    summary:
      "Parses a string that contains JSON and reads a value by dot path. Empty if JSON or path is invalid.",
    before: "{{CUSTOM:getJsonPath:'{\"score\":99,\"ok\":true}':score}}",
    after: "99",
  },
  {
    name: "getNumericValue",
    summary: "Extracts the first numeric value from mixed text (currency, labels, etc.).",
    before: "{{CUSTOM:getNumericValue:EMI: ₹12,500/month}}",
    after: "12500",
  },
  {
    name: "mapDocumentType",
    summary:
      "First non-empty argument, trimmed length: 10 → 01, 12 → 06, 16 → 04. Otherwise empty.",
    before: "{{CUSTOM:mapDocumentType:ABCDE1234F}}",
    after: "01",
  },
  {
    name: "mapGender",
    summary: "m/male → 2, f/female → 1; otherwise empty string.",
    before: "{{CUSTOM:mapGender:Male}}",
    after: "2",
  },
  {
    name: "monthsSince",
    summary: "Whole months from a calendar date to today; pass date and format when ambiguous.",
    before: "{{CUSTOM:monthsSince:16/05/2011:DD/MM/YYYY}}",
    after: "179 (example; depends on run date)",
  },
  {
    name: "normalizeJsonNan",
    summary:
      "Replaces invalid JSON token NaN with 0 so getJsonPath can parse (e.g. analytics responses).",
    before: "{{CUSTOM:normalizeJsonNan:'{\"x\":NaN}'}}",
    after: "{\"x\":0}",
  },
  {
    name: "resolveBureauStateCode",
    summary:
      "State name to bureau code; last argument is CIBIL or CRIF; earlier args are state strings with fallback.",
    before: "{{CUSTOM:resolveBureauStateCode:Maharashtra:CIBIL}}",
    after: "27",
  },
  {
    name: "sha256Hash",
    summary: "Hex-encoded SHA-256 of the resolved input string.",
    before: "{{CUSTOM:sha256Hash:hello}}",
    after: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  },
  {
    name: "splitName",
    summary: "Splits a full name on spaces into first or last.",
    before: "{{CUSTOM:splitName:John Kumar Singh:first}}",
    after: "John",
  },
  {
    name: "stringifyJSON",
    summary:
      "Serializes a service response object/array into a JSON string for fields that must hold JSON as text.",
    before: "{{CUSTOM:stringifyJSON:((SomeService.data))}}",
    after: "{\"a\":1,\"b\":\"x\"} (shape matches that service’s data object)",
  },
  {
    name: "takeLast",
    summary: "Last N characters; second argument is the count.",
    before: "{{CUSTOM:takeLast:ABCD1234EFGH:4}}",
    after: "EFGH",
  },
  {
    name: "validatePAN",
    summary: "Indian PAN format (5 letters + 4 digits + 1 letter). Returns true or false.",
    before: "{{CUSTOM:validatePAN:ABCDE1234F}}",
    after: "true",
  },
];

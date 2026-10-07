/**
 * Decision Manager `{{ … }}` expression helpers (govaluate) used when building Salesforce
 * Composite bodies from `service_sfdc_field_mapping.request_body`.
 *
 * Source: decision-manager `internal/app/utility/dynamic_json_updater.go` → `customFunctions`.
 * Not the same as ESA `{{CUSTOM:…}}` — those run in external-service-adapter.
 */
export type DmCustomFunction = {
  name: string;
  summary: string;
  before: string;
  after: string;
};

export const DM_CUSTOM_FUNCTIONS_SOURCE =
  "decision-manager — dynamic_json_updater.go (customFunctions map)";

/** Alphabetical by name */
export const DM_CUSTOM_FUNCTIONS: DmCustomFunction[] = [
  {
    name: "abs",
    summary: "Absolute value of a number (float).",
    before: "{{abs(-12.5)}}",
    after: "12.5",
  },
  {
    name: "arrayToString",
    summary:
      "Joins arrays or expanded args into a comma-separated string. Optional second arg: field name when the first arg is an array of objects (extract that field per element). Empty array → empty string.",
    before: "{{arrayToString(((Svc.tags)))}}",
    after: "a,b,c (example; from array values)",
  },
  {
    name: "ceil",
    summary: "Smallest integer ≥ the argument.",
    before: "{{ceil(4.2)}}",
    after: "5",
  },
  {
    name: "concat",
    summary:
      "Concatenates all arguments using fmt %v (no separator). This is the DM equivalent of string join — there is no `String.concat` symbol; use `concat(...)`.",
    before: "{{concat('Lead-', ((Some.externalId)))}}",
    after: "Lead-EXT-991 (example)",
  },
  {
    name: "floor",
    summary: "Largest integer ≤ the argument.",
    before: "{{floor(4.9)}}",
    after: "4",
  },
  {
    name: "formatDate",
    summary:
      "Parses a date string (many input formats) and formats it using tokens YYYY, MM, DD, HH, mm, ss, SSS, Z, etc. (mapped to Go layouts). Second arg optional; default output DD/MM/YYYY. Pair with now() for “current time” formatting.",
    before: "{{formatDate(now(), 'YYYY-MM-DDTHH:mm:ss.SSSZ')}}",
    after: "2026-04-06T12:00:00.000Z (example; depends on clock & format)",
  },
  {
    name: "inList",
    summary:
      "First arg: value or array of values to test. Remaining args: allowed values (string compared via %v). Returns true if any element of an array matches any candidate, or if a scalar matches.",
    before: "{{inList(((Risk.bucket)), 'A', 'B', 'VIP')}}",
    after: "true or false",
  },
  {
    name: "inListField",
    summary:
      "On an array of objects: true if any object’s field (arg 2) equals one of the following args. Supports govaluate-expanded array args. At least three arguments after the array path.",
    before: "{{inListField(((accounts)), 'accountType', '40', '52')}}",
    after: "true when any row has accountType 40 or 52",
  },
  {
    name: "max",
    summary: "Maximum of two or more numbers (float64).",
    before: "{{max(3.0, 7.0, 5.0)}}",
    after: "7",
  },
  {
    name: "min",
    summary: "Minimum of two or more numbers (float64).",
    before: "{{min(3.0, 7.0, 5.0)}}",
    after: "3",
  },
  {
    name: "now",
    summary:
      "Current UTC time as RFC3339Nano string (no arguments). Pass into formatDate() for formatted stamps.",
    before: "{{now()}}",
    after: "2026-04-06T15:04:05.123456789Z (example; changes every call)",
  },
  {
    name: "pow",
    summary: "Base to the power of exponent (float64).",
    before: "{{pow(10.0, 2.0)}}",
    after: "100",
  },
  {
    name: "round",
    summary: "Rounds to nearest integer (half away from zero).",
    before: "{{round(4.5)}}",
    after: "5",
  },
  {
    name: "serializeJson",
    summary:
      "Marshals a map/slice/value to a compact JSON string for storing in a text field (e.g. long text area).",
    before: "{{serializeJson(((NTCModel.response)))}}",
    after: "{\"status\":\"OK\",...} (one-line JSON string)",
  },
  {
    name: "serializeJsonPretty",
    summary: "Same as serializeJson but indented (two spaces) for human-readable logs.",
    before: "{{serializeJsonPretty(((NTCModel.response)))}}",
    after: "{\n  \"status\": \"OK\",\n  ...\n}",
  },
  {
    name: "sqrt",
    summary: "Square root (float64).",
    before: "{{sqrt(16.0)}}",
    after: "4",
  },
  {
    name: "toLower",
    summary: "Lowercases a string; empty or nil → empty string.",
    before: "{{toLower(((Some.code)))}}",
    after: "approved (example)",
  },
  {
    name: "toUpper",
    summary: "Uppercases a string; empty or nil → empty string.",
    before: "{{toUpper('yes')}}",
    after: "YES",
  },
];

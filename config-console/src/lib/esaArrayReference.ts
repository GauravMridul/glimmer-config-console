/**
 * ESA `{{ARRAY:…}}` array operations (external-service-adapter
 * `expression_processor.go` → array evaluation / `applyArrayOperation`).
 * `transform-only` renames and optionally coerces fields per element; it is not
 * `{{TRANSFORM:…}}` (string ops). Full spec: ESA_Guide.md §12.
 */
export type EsaArrayTopic = {
  name: string;
  summary: string;
  before: string;
  after: string;
};

export const ESA_ARRAY_SOURCE =
  "external-service-adapter — expression_processor.go (ARRAY / applyArrayOperation)";

/** Curated patterns; not an exhaustive list of every ARRAY edge case. */
export const ESA_ARRAY_OPERATIONS: EsaArrayTopic[] = [
  {
    name: "ARRAY (syntax)",
    summary:
      "Source is usually a JSON array ((Service.path)), Salesforce child relationship (<ChildRel__r>), or another expression that resolves to an array. After the source segment: an operation (transform-only, transform, map, filter, merge, …) and its parameters.",
    before: "{{ARRAY:((SomeService.body.items)):transform-only:id->external_id,name->full_name}}",
    after: '[{"external_id":"1","full_name":"A"}, …] (shape depends on mapping)',
  },
  {
    name: "transform-only",
    summary:
      "For each array element, output only the listed keys. Map source field → target name with `->`. Separate mappings with commas. Optional type suffix `@NUMERIC`, `@BOOLEAN`, `@STRING` on the target side coerces values.",
    before:
      '"GST_Details": "{{ARRAY:((KarzaPanGstCallout.body.result)):transform-only:gstinId->gst_number__c,authStatus->GSTIN_Status__c}}"',
    after: "Array of objects with gst_number__c and GSTIN_Status__c only (per element)",
  },
  {
    name: "transform-only (nested paths)",
    summary:
      "Source keys can use dot paths (nested JSON). Each left-hand path is read from the element object.",
    before:
      "{{ARRAY:((KarzaGSTNonOTP.results)):transform-only:result.ctb->td_constitution,result.sts->td_gstin_status}}",
    after: "Flatten/rename nested API fields into Salesforce-oriented keys",
  },
  {
    name: "transform vs transform-only",
    summary:
      "`transform` copies unmapped top-level keys through and applies renames. `transform-only` drops any field not listed — best for minimal API payloads.",
    before: "{{ARRAY:<Scores__c>:transform-only:Type__c->type,Value__c->score@NUMERIC}}",
    after: "Only `type` and numeric `score` on each row",
  },
  {
    name: "merge + transform-only",
    summary:
      "Multiple array sources: `((A)),((B)):merge` concatenates, then chain `transform-only:…` to align field names across sources.",
    before:
      "{{ARRAY:((Svc.SANCTIONS)),((Svc.BLACKLIST)):merge:transform-only:MATCHED_SOURCE->key,MATCHED_RULENAME->value}}",
    after: "Single merged array with unified key names",
  },
  {
    name: "map",
    summary:
      "Apply an expression per element (see ESA_Guide §12). Use when you need more than field rename/coerce.",
    before: "{{ARRAY:((Svc.rows)):map:…}}",
    after: "(per guide — expression in map slot)",
  },
  {
    name: "filter",
    summary: "Keep elements matching a condition (see ESA_Guide §12).",
    before: "{{ARRAY:((Svc.rows)):filter:…}}",
    after: "(subset of rows)",
  },
];

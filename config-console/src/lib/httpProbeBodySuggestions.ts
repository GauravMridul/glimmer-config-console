/**
 * Heuristic “smart fill” for External API test probes: maps templated JSON string leaves
 * (<Field>, ((service.path)), {{NUMERIC:…}}, CONDITION, etc.) to editable sample literals.
 *
 * Shared bureau request shape: many services use a common envelope (`partner`, `Cibil_Data`, …).
 * Only `Cibil_Data` is stable by key — the nested pull JSON varies by consumer; we suggest by
 * common inner field names (addresses, scores, enquiries, …), not a full frozen snapshot.
 */

export type BodyTemplateSuggestion = {
  path: string;
  /** Short preview of the saved template */
  templatePreview: string;
  /** Full template string (tooltip) */
  templateFull: string;
  /** Initial value for the input (user-editable before Apply) */
  suggestedInput: string;
  hint: string;
  /**
   * `Object.field` keys from `<Object.field>` and `sbx-ref:Object.field` in this leaf — kept so
   * “Fill from Salesforce” still works after heuristic placeholders replaced angle brackets.
   */
  angleRefKeys: string[];
};

type PathSegment = string | number;

const SFDC_LEAD_ID = "00Q000000000000AAA";
const SFDC_CONTACT_ID = "003000000000000AAA";
const SAMPLE_UUID = "550e8400-e29b-41d4-a716-446655440000";

/** Same object.field rules as `server/esaAngleExtract.mjs` (ESA `utility.go` parity). */
const ANGLE_REF_KEY_RE = /<([A-Za-z][A-Za-z0-9_]*)\.([^<>]+)>/g;

/** `Obj[cond].Field` inside angle or `sbx-ref:` (must match server `conditionalPlaceholderRe`). */
const CONDITIONAL_PLACEHOLDER_INNER_RE =
  /^([A-Za-z0-9_]+)\[([^\]]+)\]\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)$/;

/**
 * Collect `Object.field` keys from angle brackets and reversible `sbx-ref:Object.field` tokens.
 * Exported for the probe modal when pairing suggestions with Salesforce `angleValues`.
 */
export function extractAngleRefKeysFromTemplate(s: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  ANGLE_REF_KEY_RE.lastIndex = 0;
  let m;
  while ((m = ANGLE_REF_KEY_RE.exec(s)) !== null) {
    const object = m[1];
    const field = m[2].trim();
    if (!field || field.includes("<") || field.includes(">") || field.includes(".")) continue;
    const key = `${object}.${field}`;
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  const sb = /^sbx-ref:(.+)$/i.exec(s.trim());
  if (sb) {
    const inner = sb[1].trim();
    if (inner && !inner.includes("<") && !inner.includes(">")) {
      const cm = CONDITIONAL_PLACEHOLDER_INNER_RE.exec(inner);
      const lookupKey = cm ? `${cm[1]}.${cm[3]}` : inner;
      if (lookupKey && !seen.has(lookupKey)) {
        seen.add(lookupKey);
        keys.push(lookupKey);
      }
    }
  }
  return keys;
}

/**
 * Distinct placeholder strings so downstream unmarshalling errors identify the field.
 * Angle refs use reversible `sbx-ref:Object.Field` so Fill-from-SF can map after Apply.
 */
function sandboxPlaceHolder(
  kind: "angle" | "service" | "transform" | "leaf",
  detail: string,
): string {
  const d = detail.trim();
  if (kind === "angle" && d && !d.includes("<") && !d.includes(">") && !d.includes(":")) {
    return `sbx-ref:${d}`;
  }
  const slug = d
    .slice(0, 120)
    .replace(/[[\]]/g, "_")
    .replace(/[^a-zA-Z0-9_.|@-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return `sbx-${kind}-${slug || "unknown"}`;
}

const RE_PATH_UNDER_CIBIL_DATA = /(^|\.)Cibil_Data(\.|$|\[)/i;

function pathUnderCibilData(jsonPath: string): boolean {
  return RE_PATH_UNDER_CIBIL_DATA.test(jsonPath);
}

/**
 * Nested fields under `Cibil_Data` — structure differs by bureau response; match typical TU/CIBIL-style names.
 */
function suggestUnderCibilData(jsonPath: string, key: string): unknown | undefined {
  if (!pathUnderCibilData(jsonPath)) return undefined;
  const p = jsonPath;

  if (key === "success" && /\.controlData\.success$/i.test(p)) return true;

  if (key === "pincode") return "761126";
  if (key === "statecode") return "21";
  if (key === "addresscategory" || key === "residencecode") return "01";
  if (key === "line1") return "SAMPLE ADDRESS LINE 1";
  if (key === "line2") return "SAMPLE ADDRESS LINE 2";
  if (key === "line3") return "SAMPLE CITY STATE";

  if (key === "emailid") return "SANDBOX@EXAMPLE.COM";

  if (
    key === "datereported" ||
    key === "enquirydate" ||
    key === "dateopened" ||
    key === "lastpaymentdate" ||
    key === "paymentstartdate" ||
    key === "paymentenddate" ||
    key === "dateclosed" ||
    key === "scoredate" ||
    key === "dateprocessed" ||
    key === "birthdate" ||
    key === "recentdateopened" ||
    key === "oldestdateopened" ||
    key === "recentinquirydate"
  ) {
    return "01012026";
  }

  if (key === "membershortname") return "NOT DISCLOSED";
  if (key === "enquirypurpose") return "10";
  if (key === "accounttype") return "06";
  if (key === "paymentfrequency") return "03";
  if (key === "telephonetype" || key === "idtype") return "01";
  if (key === "collateraltype") return "00";

  if (key === "currentbalance" && /accountsummary/i.test(p)) return 406_502;
  if (key === "highcreditamount" && /accountsummary/i.test(p)) return 1_674_358;

  if (key === "enquiryamount") return 10_000;
  if (
    key === "highcreditamount" ||
    key === "currentbalance" ||
    key === "creditlimit" ||
    key === "cashlimit" ||
    key === "emiamount" ||
    key === "actualpaymentamount"
  ) {
    return 0;
  }
  if (key === "ownershipindicator") return 1;
  if (key === "paymenttenure") return 12;
  if (key === "interestrate") return 12.5;

  if (key === "paymenthistory") return "000000000000000000000000";

  if (key === "score" && /scores\[\d+\]\.score$/i.test(p)) return "00779";
  if (key === "scorecardname") return "08";
  if (key === "scorecardversion") return "10";
  if (key === "scorename") return "CIBILTUSC3";

  if (key === "reasoncodevalue") return "39";
  if (key === "reasoncodename") return "reasonCode1";

  if (key === "name" && /\.names\[/i.test(p)) return "SANDBOX CONSUMER NAME";
  if (key === "gender" && /\.names\[/i.test(p)) return "2";

  if (key === "telephonenumber") return "9000000006";
  if (key === "idnumber") return "ABCDE1234N";

  if (key === "subjectreturncode") return 1;
  if (key === "timeprocessed") return "114949";
  if (key === "version" && /\.tuefHeader\./i.test(p)) return "12";
  if (key === "enquirycontrolnumber") return "123456789012";
  if (key === "headertype") return "TUEF";

  if (key === "overdueaccounts" || key === "overduebalance" || key === "zerobalanceaccounts") {
    return 0;
  }
  if (key === "inquirypast30days") return 0;
  if (key === "totalaccounts") return 19;
  if (key === "inquirypast12months") return 13;
  if (key === "inquirypast24months") return 25;
  if (key === "totalinquiry") return 61;

  if (key === "index") {
    if (/\.addresses\[/i.test(p)) return "A01";
    if (/\.enquiries\[/i.test(p)) return "I001";
    if (/consumerCreditData\[\d+\]\.accounts\[/i.test(p)) return "T001";
    if (/\.employment\[/i.test(p)) return "E01";
    if (/\.telephones\[/i.test(p)) return "T01";
    if (/\.names\[/i.test(p)) return "N01";
    if (/consumerCreditData\[\d+\]\.ids\[/i.test(p)) return "I01";
    if (/\.emails\[/i.test(p)) return "C01";
    if (/reasoncodes\[/i.test(p)) return "reasonCode1";
    return "A01";
  }

  return undefined;
}

/** Envelope keys shared across services (outside `Cibil_Data`). */
function suggestSharedBureauEnvelope(jsonPath: string, key: string): unknown | undefined {
  if (pathUnderCibilData(jsonPath)) return undefined;

  if (key === "partner") return "Personal Loan";
  if (key === "net_monthly_income") return 23058;
  if (key === "sector_f__c" || key === "sector__c") return "Salaried";
  if (
    key === "payu_a_score__c" ||
    key === "m2_score__c" ||
    key === "pan_mobile__c" ||
    key === "monnai_json" ||
    key === "bank_statement" ||
    key === "opportunity_id" ||
    key === "standard_employment_type__c" ||
    key === "educationlevel__c" ||
    key === "vendor_type"
  ) {
    return "";
  }
  if (key.includes("distance_between_dealer")) return "";

  if (key === "phone" && !/cibil_data/i.test(jsonPath)) return "9000000006";
  if (key === "address") return "Sample address line 1, Line 2, City, District, State";
  if (key === "programtype") return "Prime";
  if (key === "uan__c") return "0";
  if (key === "emailid") return "sandbox.user@example.com";
  if (key === "gender__c") return "Male";
  if ((key === "age" || leafMatchesAgeField(jsonPath)) && !/cibil_data/i.test(jsonPath)) {
    return 25;
  }
  if (key === "pincode" && (jsonPath === "pincode" || /\.pincode$/i.test(jsonPath))) return "400017";
  if (key === "ntc_index") return 0;
  if (key === "createddate") return "2026-02-05T10:52:25Z";

  if (/Pan_ITR/i.test(jsonPath)) {
    if (key === "message") {
      return "Please register this PAN or try with some other PAN";
    }
    if (key === "karzastatuscode") return "";
  }

  return undefined;
}

function leafMatchesAgeField(jsonPath: string): boolean {
  return /\.Age$/i.test(jsonPath) || /^Age$/i.test(jsonPath.trim());
}

/** Last segment of <Object.field> — avoid matching "id" inside "validity", "grid", etc. */
function angleRefLastSegment(ref: string): string {
  return (ref.trim().split(".").pop() ?? ref.trim()).toLowerCase().replace(/\s/g, "");
}

/** True when the angle-bracket path ends like a Salesforce Id field (not *validity_date*, etc.). */
function angleRefLastSegmentLooksLikeSfIdField(ref: string): boolean {
  const last = angleRefLastSegment(ref);
  if (!last) return false;
  if (/(^|_)date(__c)?$/i.test(last)) return false;

  if (last === "id") return true;
  if (/(^|_)id(__c)?$/.test(last)) return true;
  if (/id__c$/i.test(last)) return true;
  return false;
}

/** True if the string likely needs substitution before a partner will accept it. */
export function stringLooksTemplated(s: string): boolean {
  if (!s || typeof s !== "string") return false;
  return (
    /<[^>\s][^>]*>/.test(s) ||
    /\(\([^)]+\)\)/.test(s) ||
    /\{\s*\{/.test(s) ||
    /\{\{/.test(s) ||
    /\b(CUSTOM|TRANSFORM|ARRAY|NUMERIC|CONDITION)\s*:/i.test(s) ||
    (/\|\|/.test(s) && /<[^>]+>/.test(s)) ||
    /^sbx-ref:/i.test(s.trim()) ||
    /^sbx-(angle|service|transform|leaf)-/i.test(s.trim())
  );
}

function suggestFromLeafKey(jsonPath: string): unknown {
  const leaf = jsonPath.split(".").pop() ?? jsonPath;
  const key = leaf.replace(/\[\d+\]/g, "").toLowerCase();

  const cibil = suggestUnderCibilData(jsonPath, key);
  if (cibil !== undefined) return cibil;

  const envelope = suggestSharedBureauEnvelope(jsonPath, key);
  if (envelope !== undefined) return envelope;

  if (
    key.includes("validity_date") ||
    key.includes("credit_limit_validity") ||
    (key.includes("expiry") && key.includes("date")) ||
    (key.includes("expiration") && key.includes("date"))
  ) {
    return "1990-01-01";
  }

  if (/(^|_)(leadid|contactid|accountid)(_|$)/i.test(leaf) || /(^|_)id$/i.test(leaf)) {
    if (/lead/i.test(leaf)) return SFDC_LEAD_ID;
    if (/contact/i.test(leaf)) return SFDC_CONTACT_ID;
    return SAMPLE_UUID;
  }

  // Loan / income (PreBureau / PostBureau–style payloads; edit if your row differs)
  if (key === "tenor") return 48;
  if (key === "tenor_lc" || key.includes("tenor_lc")) return 0;
  if (key === "loanamount" || key.includes("loan_amount") || key === "loan_amount") {
    return 325_506;
  }
  if (key === "netsalary" || key.includes("netsalary")) return 38_696;
  if (key === "decision_count") return 2;

  if (key.includes("pincode") || key.includes("pin_code")) return "635202";

  // PostBureau string booleans / sentinels (often String-typed, mixed case) — before broad `income` match
  if (key === "income_model_data" || key === "finbox_applicable") return "False";
  if (key.includes("is_campaign_available")) return "false";
  if (key.startsWith("atleast_one_")) {
    if (/_cc$/i.test(key) || /_pl$/i.test(key)) return "true";
    return "false";
  }
  if (key.startsWith("only_") && /gold|auto|two|wheeler|cdl|hl|pl/i.test(key)) {
    return "false";
  }
  if (key === "valid_syntax" || key === "valid_mailbox") return "true";
  if (key.includes("greater_than") && key.includes("dpd") && key.includes("flag")) return "true";
  if (key.includes("less_than") && key.includes("dpd") && key.includes("flag")) return "true";
  if (key.includes("ohp_isattached") || key === "ohp_isattached_flag") return "false";

  if (
    key.includes("short_term_category") ||
    key.includes("medium_term_category") ||
    key.includes("long_term_category")
  ) {
    return "Null";
  }
  if (
    key === "otherpincode" ||
    key.includes("mailing_neg_area") ||
    key.includes("ekyc_neg_area") ||
    key.includes("banking_required_from_campaign") ||
    key.includes("consolidated_risk_segment") ||
    key.includes("sector_model") ||
    key.includes("dealer_category") ||
    key.includes("dealer_segment") ||
    key.includes("dealer_region") ||
    key.includes("vehicle_type") ||
    key.includes("product_model") ||
    key.includes("standard_employment") ||
    key.includes("services_provided_for_reevaluation") ||
    key.includes("services_required_for_reevaluation") ||
    key.includes("campaign_risk_bucket") ||
    key.includes("app_score_data")
  ) {
    return "null";
  }

  if (
    key.includes("date_closed") ||
    key.includes("date_of_joining") ||
    key.includes("all_tradeline_date")
  ) {
    return "1990-01-01";
  }

  if (key === "risk_band" || key === "ntc_risk_band") return "5";
  if (key.includes("email_risk")) return "LOW";
  if (key.includes("loan_purpose")) return "Medical Expenses";
  if (key === "sub_category") return "Lower Middle";
  if (key === "leadsource") return "Finnable";
  if (key.includes("type_of_customer")) return "NTT";
  if (key === "profile") return "Super Thin 2";
  if (key === "customer_profile") return "Bureau Thick";
  if (key.includes("leverage_index")) return "0";
  if (key === "totalexp" || key === "totalexp__c") return "50";

  if (key.includes("derog_account_type") && key.includes("twl")) return "N/A";
  if (key.includes("derog_account_type") && key.includes("pl")) return "05";
  if (key.includes("derog_account_type") && key.includes("cc")) return "10";
  if (key.includes("hl_derog_account_type")) return "N/A";

  if (key === "bureau_score") return 789;
  if (key === "bscore") return 0;
  if (key === "partner_score") return 835;
  if (key === "add_age" || key === "account_age") return -1;
  if (
    key === "work_email_flag" ||
    key.includes("work_email_combined_flag") ||
    key.includes("work_email_name_flag") ||
    key === "negative_profile_flag"
  ) {
    return -1;
  }
  if (key === "email_flag" || key === "epfo_flag") return 1;

  if (
    key.includes("score_confidence") ||
    key === "emi_bucket" ||
    key === "campaign_loan_cap" ||
    key === "point_in_india" ||
    (key.includes("name_mismatch") && key.includes("flag") && key.includes("third_party"))
  ) {
    return -1;
  }

  if (
    (key.includes("income") || key.includes("turnover") || /(^|_)(py|cy)_?pat(_|$)/i.test(key)) &&
    key !== "income_model_data"
  ) {
    return 0;
  }

  // String flags / string-encoded numbers (not JSON booleans)
  if (key === "actico_flag" || (key.includes("actico") && key.includes("flag"))) return "True";
  if (key.includes("banking_indicator")) return "false";
  if (key === "fldg_flag") return "No";
  if (
    key.includes("dayofweek") ||
    key.includes("dl_status") ||
    key.includes("sector_risk") ||
    key.includes("samsungpolicy")
  ) {
    return "0";
  }

  if (key === "name_match_flag" || key === "delhivery_final_decision") return 0;

  // Scores that are empty strings in typical Actico success bodies
  if (key === "ts_score" || key === "capital_float_segment_score") return "";

  // Financial / numeric-shaped keys (JSON numbers)
  if (
    /\b(dscr|foir|emi|ltv|apr)\b/i.test(leaf) ||
    /^p\d+$/i.test(leaf) ||
    /\b(amount|balance|income|salary|revenue|premium|quantity|limit|offset)\b/i.test(key) ||
    (/(price|ratio|percent|score|rating)(_|$)/i.test(key) &&
      key !== "ts_score" &&
      key !== "bureau_score" &&
      key !== "partner_score" &&
      key !== "bscore" &&
      !key.includes("score_confidence")) ||
    (/month/i.test(key) && /loan|tenor/i.test(key) && !key.includes("tenor_lc"))
  ) {
    return 0;
  }

  if (key.includes("phone") || key.includes("mobile")) return "9000000005";
  if (key.includes("email")) return "sandbox.user@example.com";
  if (key.includes("age")) return 27;
  if (key.includes("uan")) return "UAN123456789012";
  if (key.includes("pan")) return "ABCDE1234F";
  if (key.includes("status") && key.includes("code")) return 200;
  if (key.endsWith("code") || key.includes("statuscode")) return 200;
  if (key.includes("message")) return "Sandbox OK";

  if (key === "sector") return "Salaried";
  if (key === "borrower_type") return "Borrower";
  if (key === "country") return "India";
  if (key === "type_of_loan") return "Term Loan";
  if (key.includes("opportunity_record_type") || key === "product_type" || key === "product_category") {
    return "Personal Loan";
  }
  if (key === "program_type") return "Prime";
  if (key.includes("gender")) return "Male";

  if (key.includes("tax") || key === "active") return "true";
  // Remaining *flag* keys: bureau APIs usually want string "0" / "1", not JSON true
  if (key.includes("flag")) return "0";

  return null;
}

function suggestFromAngleRef(ref: string): { value: unknown; hint: string } {
  const lower = ref.toLowerCase();
  if (lower.includes("phone") || lower.includes("mobile")) {
    return { value: "9000000005", hint: `Phone-style field from <${ref}> (10-digit sample)` };
  }
  if (lower.includes("email")) {
    return { value: "sandbox.user@example.com", hint: `Email from <${ref}>` };
  }
  if (lower.includes("age")) {
    return { value: 27, hint: `Age from <${ref}>` };
  }
  if (lower.includes("tenor") || (lower.includes("loan") && lower.includes("month"))) {
    return { value: 48, hint: `Loan tenor (months) from <${ref}>` };
  }
  if (lower.includes("foir") || lower.includes("dscr") || lower.includes("coverage_ratio")) {
    return { value: 0, hint: `Ratio / percent field from <${ref}>` };
  }
  if (lower.includes("purchase") && lower.includes("price")) {
    return { value: 0, hint: `Purchase price from <${ref}>` };
  }
  if (lower.includes("gender")) {
    return { value: "Male", hint: `Gender picklist from <${ref}>` };
  }
  if (lower.includes("brand")) {
    return { value: "sandbox-brand", hint: `Brand from <${ref}>` };
  }
  if (lower.includes("city")) {
    return { value: "Pune", hint: `City from <${ref}>` };
  }
  if (lower.includes("state") && !lower.includes("status")) {
    return { value: "Tamil Nadu", hint: `State / region from <${ref}>` };
  }
  {
    const lastSeg = angleRefLastSegment(ref);
    if (
      (lower.includes("lead") || lower.includes("contact")) &&
      (lastSeg.includes("validity_date") ||
        lastSeg.includes("date_of_") ||
        lastSeg.includes("birthdate") ||
        lastSeg.includes("date_closed") ||
        /(_date|_date__c)$/i.test(lastSeg))
    ) {
      return { value: "1990-01-01", hint: `Date field from <${ref}>` };
    }
  }
  if (lower.includes("lead") && angleRefLastSegmentLooksLikeSfIdField(ref)) {
    return { value: SFDC_LEAD_ID, hint: `Lead Id from <${ref}>` };
  }
  if (lower.includes("contact") && angleRefLastSegmentLooksLikeSfIdField(ref)) {
    return { value: SFDC_CONTACT_ID, hint: `Contact Id from <${ref}>` };
  }
  if (lower.endsWith(".id") || lower.includes(".id__c")) {
    return { value: SAMPLE_UUID, hint: `Id-shaped field from <${ref}>` };
  }
  return {
    value: sandboxPlaceHolder("angle", ref),
    hint: `Generic sample for <${ref}> — value encodes ref for unmarshalling errors`,
  };
}

/** True if template uses `NUMERIC:` anywhere (including nested inside CONDITION / TRANSFORM). */
function templateContainsNumericMarker(s: string): boolean {
  return /\bNUMERIC\s*:/i.test(s);
}

function suggestForTemplateString(s: string, jsonPath: string): { value: unknown; hint: string } {
  const fromKey = suggestFromLeafKey(jsonPath);
  const compact = s.replace(/\s+/g, " ").trim();

  if (/\(\([^)]*statusCode[^)]*\)\)/i.test(compact)) {
    return { value: 200, hint: "Upstream statusCode — sample 200" };
  }

  // Any NUMERIC (even deep inside CONDITION) → JSON number for the leaf
  if (templateContainsNumericMarker(compact)) {
    if (typeof fromKey === "number") {
      return {
        value: fromKey,
        hint: "NUMERIC in template (may be nested) — value also inferred from JSON key",
      };
    }
    return {
      value: 0,
      hint: "NUMERIC in template (incl. inside CONDITION/TRANSFORM) — sample number",
    };
  }

  if (/ARRAY\s*:/i.test(compact)) {
    if (/@NUMERIC/i.test(compact)) {
      return {
        value: 0,
        hint: "ARRAY with @NUMERIC — sample number",
      };
    }
    return {
      value: "999999999999999",
      hint: "ARRAY / aggregate — long numeric string sample; edit if API expects an object/array",
    };
  }

  if (/CONDITION/i.test(compact)) {
    const hasTrueLit = /:\s*true\s*:/i.test(compact);
    const hasFalseLit = /:\s*false\s*:/i.test(compact);
    if (hasTrueLit || hasFalseLit) {
      const value = hasFalseLit && !hasTrueLit ? "false" : "true";
      return {
        value,
        hint:
          'CONDITION with boolean literals — JSON string for String-typed params; edit to "false", "0", or "1" if needed',
      };
    }
    // e.g. == 'null':0:<Field> — still often a number when the “then” branch is 0
    if (/'null'\s*:\s*0\s*:/i.test(compact) || /:\s*0\s*:\s*</.test(compact)) {
      const v = typeof fromKey === "number" ? fromKey : 0;
      return {
        value: v,
        hint: "CONDITION with numeric literal branch (no NUMERIC marker) — sample from key or 0",
      };
    }
    return {
      value: "Sandbox OK",
      hint: "CONDITION — string sample; use false or a number if the API expects that",
    };
  }

  const angle = /<([^>]+)>/.exec(compact);
  if (angle) {
    const inner = suggestFromAngleRef(angle[1].trim());
    if (/\|\|/.test(compact)) {
      return {
        value: inner.value,
        hint: `${inner.hint} (first branch of || chain)`,
      };
    }
    return inner;
  }

  const dbl = /\(\(([^)]+)\)\)/.exec(compact);
  if (dbl) {
    const p = dbl[1].trim();
    if (/statusCode/i.test(p)) {
      return { value: 200, hint: `((…statusCode…)) — sample 200` };
    }
    if (/\.(tax|message|result|data)/i.test(p)) {
      return {
        value: "true",
        hint: `((…)) service flag — string "true" for String params; use "1" or "OK" if the API expects that`,
      };
    }
    return {
      value: sandboxPlaceHolder("service", p),
      hint: `((…)) service field — token encodes path: ${p.slice(0, 80)}${p.length > 80 ? "…" : ""}`,
    };
  }

  if (/\b(CUSTOM|TRANSFORM)\s*:/i.test(compact)) {
    const refs = [...compact.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim());
    for (const ref of refs) {
      const inner = suggestFromAngleRef(ref);
      if (!inner.hint.startsWith("Generic sample")) {
        return {
          value: inner.value,
          hint: `${inner.hint} (inside CUSTOM/TRANSFORM)`,
        };
      }
    }
    if (/\bformat_time\b/i.test(compact) || /birthdate|date/i.test(compact)) {
      return {
        value: "1990-01-15",
        hint: "TRANSFORM date / format_time — ISO date sample",
      };
    }
    return {
      value: sandboxPlaceHolder(
        "transform",
        refs.length ? refs.join("|") : jsonPath || compact.slice(0, 80),
      ),
      hint: `CUSTOM/TRANSFORM — no typed <field> ref; token encodes path/refs (${jsonPath || "template"})`,
    };
  }

  if (fromKey != null) {
    return { value: fromKey, hint: "Inferred from JSON key name" };
  }

  return {
    value: sandboxPlaceHolder("leaf", jsonPath || "unknown"),
    hint: "Generic placeholder — adjust type (quotes vs number) as needed; token encodes JSON path",
  };
}

/**
 * Text shown in suggestion inputs; parsed with {@link parseJsonValueLoose} on Apply.
 * Many bureau partners bind request fields as String: unquoted `true`/`false`/`null` would
 * become JSON boolean/null and fail unmarshalling — wrap those as JSON strings.
 */
function formatSuggestionInput(v: unknown): string {
  if (typeof v === "boolean") {
    return JSON.stringify(String(v));
  }
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "true" || t === "false" || t === "null") {
      return JSON.stringify(v);
    }
    // Single digit: unquoted parses as JSON number (e.g. Risk_Band "5", string flags "0")
    if (/^\d$/.test(t)) {
      return JSON.stringify(v);
    }
    // PostBureau totalExp "50", CC account type "10"; leading-zero codes like "05"
    if (t === "50" || t === "10" || /^0\d+$/.test(t)) {
      return JSON.stringify(v);
    }
    if (/^\+?\d{6,}$/.test(t)) {
      return JSON.stringify(v);
    }
    return v;
  }
  return JSON.stringify(v);
}

export function parseJsonPath(path: string): PathSegment[] {
  if (!path) return [];
  const segments: PathSegment[] = [];
  let i = 0;
  while (i < path.length) {
    if (path[i] === ".") {
      i += 1;
      continue;
    }
    if (path[i] === "[") {
      const close = path.indexOf("]", i);
      if (close === -1) break;
      const n = Number(path.slice(i + 1, close));
      if (Number.isFinite(n)) segments.push(n);
      i = close + 1;
      continue;
    }
    const nextDot = path.indexOf(".", i);
    const nextBr = path.indexOf("[", i);
    let end = path.length;
    if (nextDot !== -1 && (nextBr === -1 || nextDot < nextBr)) end = nextDot;
    else if (nextBr !== -1) end = nextBr;
    const part = path.slice(i, end);
    if (part) segments.push(part);
    i = end;
  }
  return segments;
}

function setAtPath(root: unknown, segments: PathSegment[], value: unknown): void {
  if (segments.length === 0) return;
  let cur: unknown = root;
  for (let j = 0; j < segments.length - 1; j++) {
    const seg = segments[j];
    if (typeof seg === "number") {
      if (!Array.isArray(cur)) return;
      cur = cur[seg];
    } else {
      if (cur === null || typeof cur !== "object") return;
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  const last = segments[segments.length - 1];
  if (typeof last === "number") {
    if (Array.isArray(cur)) cur[last] = value;
  } else {
    if (cur !== null && typeof cur === "object") {
      (cur as Record<string, unknown>)[last] = value;
    }
  }
}

export function parseJsonValueLoose(raw: string): unknown {
  const t = raw.trim();
  if (t === "") return "";
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Walk object/array tree; collect string leaves that look templated. */
export function collectBodyTemplateSuggestions(root: unknown): BodyTemplateSuggestion[] {
  const rows: BodyTemplateSuggestion[] = [];

  function walk(node: unknown, path: string) {
    if (typeof node === "string") {
      if (stringLooksTemplated(node)) {
        const { value, hint } = suggestForTemplateString(node, path);
        rows.push({
          path,
          templatePreview: node.length > 100 ? `${node.slice(0, 97)}…` : node,
          templateFull: node,
          suggestedInput: formatSuggestionInput(value),
          hint,
          angleRefKeys: extractAngleRefKeysFromTemplate(node),
        });
      }
    } else if (Array.isArray(node)) {
      node.forEach((item, idx) => walk(item, path ? `${path}[${idx}]` : `[${idx}]`));
    } else if (node !== null && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        const next = path ? `${path}.${k}` : k;
        walk(v, next);
      }
    }
  }

  if (Array.isArray(root)) {
    root.forEach((item, idx) => walk(item, `[${idx}]`));
  } else {
    walk(root, "");
  }
  return rows;
}

/** Returns updated JSON root (cloned); does not mutate input. */
export function applyLiteralAtJsonPath(
  root: unknown,
  path: string,
  rawInput: string,
): unknown {
  const clone = deepClone(root);
  const segments = parseJsonPath(path);
  const value = parseJsonValueLoose(rawInput);
  setAtPath(clone, segments, value);
  return clone;
}

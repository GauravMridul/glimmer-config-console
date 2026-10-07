import MiniSearch from "minisearch";
import {
  ESA_CUSTOM_FUNCTIONS,
  type EsaCustomFunction,
} from "@/lib/esaCustomFunctionsReference";
import {
  DM_CUSTOM_FUNCTIONS,
  type DmCustomFunction,
} from "@/lib/dmCustomFunctionsReference";

/** Split camelCase / PascalCase into separate words for matching "json path" → getJsonPath. */
export function camelToWords(identifier: string): string {
  return identifier
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();
}

/**
 * Extra natural-language terms users might type (synonyms, tasks, jargon).
 * Keys must match `EsaCustomFunction.name`.
 */
const ESA_SEMANTIC_EXTRAS: Record<string, string> = {
  base64Encode:
    "encode decode mime attachment binary utf8 b64 radix64 payload safe transport obfuscate",
  calculateAge:
    "dob birthday born how old years age from date of birth eligibility minor adult",
  calculateFOIR:
    "fixed obligation income ratio debt emi loan underwriting dti burden disposable salary obligation to income foir",
  cleanSpecialChars:
    "strip remove punctuation sanitize alphanumeric only letters digits spaces phone normalize special characters",
  dateWithinDays:
    "recent window eligibility stale fresh within last days range true false boolean compare today",
  daysSince:
    "elapsed duration since how long ago calendar days lag vintage from date",
  formatPhone:
    "indian mobile india msisdn telephone +91 ten digit twelve normalize handset",
  generateId:
    "random correlation reference request id unique suffix digits trace idempotency key",
  getCurrentTimestamp:
    "clock time now utc stamp audit iso8601 yyyymmdd dd mm yyyy current instant logging",
  getJsonPath:
    "extract nested field dot path jq jsonpath parse stringified json read key from json blob",
  getNumericValue:
    "parse amount currency rupee emi first number digit extract from text label strip words",
  mapDocumentType:
    "pan aadhaar aadhar kyc document code category type mapping length ten twelve sixteen",
  mapGender:
    "male female m f sex gender code salutation mr ms mrs normalize",
  monthsSince:
    "tenure months duration employment account age vintage calendar month difference",
  normalizeJsonNan:
    "invalid json nan not a number fix repair analytics response parse error javascript",
  resolveBureauStateCode:
    "state geography region cibil crif bureau code maharashtra karnataka mapping",
  sha256Hash:
    "cryptographic digest checksum fingerprint integrity secure hash algorithm hex 256 bit hmac signature",
  splitName:
    "firstname first name lastname last name given family full name token parse split",
  stringifyJSON:
    "serialize marshal json string long text area store object array as string escape compact",
  takeLast:
    "suffix tail right end substring last n characters digits truncate pan tail",
  validatePAN:
    "income tax permanent account number india format valid invalid boolean check regex",
};

const DM_SEMANTIC_EXTRAS: Record<string, string> = {
  abs: "absolute value magnitude distance from zero positive negative float",
  arrayToString:
    "join comma separated list aggregate csv tags pick field from array of objects flatten",
  ceil: "round up ceiling integer upper bound next whole number",
  concat:
    "join append build string concatenate prefix suffix glue together string builder string concat",
  floor: "round down truncate integer lower bound whole number",
  formatDate:
    "layout timestamp parse reformat timezone zulu iso token yyyy mm dd hh minute second millisecond layout go date",
  inList:
    "whitelist contains member enum any match allowed values one of equals or array membership",
  inListField:
    "array objects rows column property equals any row match accounts products line items",
  max: "largest greatest maximum upper bound biggest of many numbers",
  min: "smallest minimum lower bound least of many numbers",
  now: "current utc time instant rfc3339 nano clock today this moment",
  pow: "exponent power raise scientific interest compound",
  round: "nearest integer half away zero bank rounding whole number",
  serializeJson:
    "json compact one line marshal text field salesforce long string escape",
  serializeJsonPretty:
    "pretty print indent human readable debug log formatted multiline json",
  sqrt: "square root radical geometric mean",
  toLower: "lowercase case fold insensitive normalize downcase",
  toUpper: "uppercase caps shout case normalize uppercase",
};

type EsaSearchDoc = {
  id: string;
  name: string;
  summary: string;
  semantic: string;
  before: string;
};

type DmSearchDoc = {
  id: string;
  name: string;
  summary: string;
  semantic: string;
  before: string;
};

function esaDoc(f: EsaCustomFunction): EsaSearchDoc {
  return {
    id: f.name,
    name: `${f.name} ${camelToWords(f.name)}`,
    summary: f.summary,
    semantic: `${ESA_SEMANTIC_EXTRAS[f.name] ?? ""} ${f.after}`,
    before: f.before,
  };
}

function dmDoc(f: DmCustomFunction): DmSearchDoc {
  return {
    id: f.name,
    name: `${f.name} ${camelToWords(f.name)}`,
    summary: f.summary,
    semantic: `${DM_SEMANTIC_EXTRAS[f.name] ?? ""} ${f.after}`,
    before: f.before,
  };
}

const esaMini = new MiniSearch<EsaSearchDoc>({
  fields: ["name", "summary", "semantic", "before"],
  storeFields: ["id"],
  searchOptions: {
    boost: { name: 3.2, semantic: 2.4, summary: 1.7, before: 0.85 },
    prefix: true,
    fuzzy: 0.12,
  },
});
esaMini.addAll(ESA_CUSTOM_FUNCTIONS.map(esaDoc));

const dmMini = new MiniSearch<DmSearchDoc>({
  fields: ["name", "summary", "semantic", "before"],
  storeFields: ["id"],
  searchOptions: {
    boost: { name: 3.2, semantic: 2.4, summary: 1.7, before: 0.85 },
    prefix: true,
    fuzzy: 0.12,
  },
});
dmMini.addAll(DM_CUSTOM_FUNCTIONS.map(dmDoc));

function fallbackEsa(q: string): EsaCustomFunction[] {
  const qq = q.trim().toLowerCase();
  return ESA_CUSTOM_FUNCTIONS.filter((f) => {
    const blob = [
      f.name,
      camelToWords(f.name),
      f.summary,
      f.before,
      f.after,
      ESA_SEMANTIC_EXTRAS[f.name] ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return blob.includes(qq);
  });
}

function fallbackDm(q: string): DmCustomFunction[] {
  const qq = q.trim().toLowerCase();
  return DM_CUSTOM_FUNCTIONS.filter((f) => {
    const blob = [
      f.name,
      camelToWords(f.name),
      f.summary,
      f.before,
      f.after,
      DM_SEMANTIC_EXTRAS[f.name] ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return blob.includes(qq);
  });
}

/** Ranked full-text search (BM25-style via MiniSearch) plus substring fallback if nothing hits. */
export function searchEsaCustomFunctions(query: string): EsaCustomFunction[] {
  const q = query.trim();
  if (!q) return [...ESA_CUSTOM_FUNCTIONS];
  const hits = esaMini.search(q);
  const byId = new Map(ESA_CUSTOM_FUNCTIONS.map((f) => [f.name, f]));
  const out: EsaCustomFunction[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    const id = String(h.id);
    const f = byId.get(id);
    if (f && !seen.has(f.name)) {
      seen.add(f.name);
      out.push(f);
    }
  }
  return out.length > 0 ? out : fallbackEsa(q);
}

export function searchDmCustomFunctions(query: string): DmCustomFunction[] {
  const q = query.trim();
  if (!q) return [...DM_CUSTOM_FUNCTIONS];
  const hits = dmMini.search(q);
  const byId = new Map(DM_CUSTOM_FUNCTIONS.map((f) => [f.name, f]));
  const out: DmCustomFunction[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    const id = String(h.id);
    const f = byId.get(id);
    if (f && !seen.has(f.name)) {
      seen.add(f.name);
      out.push(f);
    }
  }
  return out.length > 0 ? out : fallbackDm(q);
}

import type { ServiceConfiguration, ServiceSfdcFieldMapping } from "@/types/models";

/** One line in the score breakdown (tooltip). */
export type ScoreLine = {
  label: string;
  /** Points added (credits) or magnitude of loss / missed opportunity (deductions). */
  points: number;
};

export type AlignmentScoreResult = {
  /** 0–100, rounded */
  score: number;
  /** What increased the score */
  credits: ScoreLine[];
  /** What lowered it: missing pieces, missed bonuses, or soft caps */
  deductions: ScoreLine[];
};

/** Options for {@link scoreEsaAlignment}. */
export type ScoreEsaAlignmentOptions = {
  serviceIdUsedInPartnerSequences: boolean;
  /**
   * When true, a small bonus is applied if the user recently got HTTP 2xx from Test request
   * (stored in this browser only; see `esaProbeLocalResults`).
   */
  recentProbeHttp2xx?: boolean;
};

const ESA_PROBE_SUCCESS_BONUS = 12;

/**
 * Heuristic “how complete / wired” an ESA row looks. Not runtime validation.
 *
 * Logic:
 * - Base for having a row; add for api_url, HTTP shape, non-empty request_body.
 * - Strong boost when the service id appears in at least one partner sequence.
 * - Soft cap when never used in partners (orphan / utility risk).
 * - Optional bonus when a recent Test probe returned HTTP 2xx (browser-local).
 */
export function scoreEsaAlignment(
  row: ServiceConfiguration | undefined,
  opts: ScoreEsaAlignmentOptions,
): AlignmentScoreResult {
  if (!row) {
    return {
      score: 0,
      credits: [],
      deductions: [
        {
          label: "There’s no External APIs row for this service name, so there’s nothing to score yet.",
          points: 0,
        },
      ],
    };
  }

  const credits: ScoreLine[] = [];
  const deductions: ScoreLine[] = [];
  let score = 0;

  score += 15;
  credits.push({ label: "You have a row in External APIs for this service.", points: 15 });

  const url = String(row.api_url ?? "").trim();
  if (url.length > 0) {
    score += 22;
    credits.push({ label: "Outbound URL is filled in.", points: 22 });
    if (/^https?:\/\//i.test(url)) {
      score += 13;
      credits.push({ label: "The URL starts with http:// or https://.", points: 13 });
    } else {
      deductions.push({
        label: "Use a full URL starting with http:// or https:// to get the extra points for a proper call.",
        points: 13,
      });
    }
  } else {
    deductions.push({
      label: "Outbound URL is missing—you’d get more points once it’s set (and more if it’s a full http/https link).",
      points: 35,
    });
  }

  const rb = row.request_body;
  let bodyKeys = 0;
  if (rb !== null && typeof rb === "object" && !Array.isArray(rb)) {
    bodyKeys = Object.keys(rb as Record<string, unknown>).length;
  }
  if (bodyKeys > 0) {
    score += 25;
    credits.push({
      label: `The request body JSON has ${bodyKeys} top-level field(s).`,
      points: 25,
    });
  } else {
    deductions.push({
      label:
        "The request body should be a non-empty JSON object with at least one field—we don’t see that yet.",
      points: 25,
    });
  }

  const method = String(row.request_method ?? "POST").trim().toUpperCase();
  if (method) {
    score += 5;
    credits.push({ label: `HTTP method is set (${method}).`, points: 5 });
  } else {
    deductions.push({
      label: "Set an HTTP method (for example POST) to pick up those points.",
      points: 5,
    });
  }

  const rawBeforePartner = score;

  if (opts.serviceIdUsedInPartnerSequences) {
    score += 25;
    credits.push({
      label: "This service’s id shows up in at least one partner journey, so it’s wired into a flow.",
      points: 25,
    });
  } else {
    const capped = Math.min(score, 62);
    const trimmed = rawBeforePartner > capped ? rawBeforePartner - capped : 0;
    deductions.push({
      label:
        trimmed > 0
          ? `This service isn’t in any partner sequence yet, so you miss the journey bonus and the score can’t go above 62 until it is. Your setup alone would have scored ${rawBeforePartner}; we reduce it by ${trimmed} to fit that cap.`
          : "This service isn’t in any partner sequence yet, so you miss the journey bonus and the score stays at or below 62 until you add it to a flow.",
      points: 25 + trimmed,
    });
    score = capped;
  }

  if (opts.recentProbeHttp2xx) {
    score = Math.min(100, score + ESA_PROBE_SUCCESS_BONUS);
    credits.push({
      label:
        "A recent Test request in this browser returned HTTP 2xx from the URL (remembered here for 30 days).",
      points: ESA_PROBE_SUCCESS_BONUS,
    });
  }

  return {
    score: Math.min(100, Math.round(score)),
    credits,
    deductions,
  };
}

function compositeSubRequestQuality(item: unknown): {
  hasUrl: boolean;
  sobjectUrl: boolean;
  bodyFieldCount: number;
} {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    return { hasUrl: false, sobjectUrl: false, bodyFieldCount: 0 };
  }
  const o = item as Record<string, unknown>;
  const url = typeof o.url === "string" ? o.url.trim() : "";
  const body = o.body;
  let bodyFieldCount = 0;
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    bodyFieldCount = Object.keys(body as Record<string, unknown>).length;
  }
  return {
    hasUrl: url.length > 0,
    sobjectUrl: url.includes("/sobjects/"),
    bodyFieldCount,
  };
}

/**
 * Heuristic quality of a Data Stamping (Composite) template. Not DM execution checks.
 *
 * Logic:
 * - Non-empty array of sub-requests with url + body objects.
 * - More sub-requests and more mapped fields → higher score (capped).
 * - Bonus when an ESA row shares the same service_name (join key consistency).
 * - Soft cap when SFDC exists without ESA (orphan stamping).
 */
export function scoreSfdcAlignment(
  row: ServiceSfdcFieldMapping | undefined,
  opts: { hasMatchingEsaRow: boolean },
): AlignmentScoreResult {
  if (!row) {
    return {
      score: 0,
      credits: [],
      deductions: [
        {
          label: "There’s no Data Stamping row for this service name yet, so there’s nothing to score.",
          points: 0,
        },
      ],
    };
  }

  const credits: ScoreLine[] = [];
  const deductions: ScoreLine[] = [];

  let score = 0;
  score += 12;
  credits.push({ label: "You have a Data Stamping row for this service.", points: 12 });

  const raw = row.request_body;
  if (!Array.isArray(raw) || raw.length === 0) {
    deductions.push({
      label:
        "Data Stamping should use a non-empty JSON array of Composite blocks. Right now it’s empty or not an array, so most of the score can’t apply.",
      points: 0,
    });
    return {
      score: Math.min(28, Math.round(score)),
      credits,
      deductions,
    };
  }

  score += 18;
  credits.push({ label: `The template has ${raw.length} Composite block(s).`, points: 18 });

  let withUrl = 0;
  let withSobject = 0;
  let totalBodyFields = 0;
  for (const item of raw) {
    const q = compositeSubRequestQuality(item);
    if (q.hasUrl) withUrl++;
    if (q.sobjectUrl) withSobject++;
    totalBodyFields += q.bodyFieldCount;
  }

  const urlPts = Math.min(22, 10 + withUrl * 4);
  if (withUrl > 0) {
    score += urlPts;
    credits.push({
      label: `${withUrl} of ${raw.length} block(s) include a url.`,
      points: urlPts,
    });
  } else {
    deductions.push({
      label: "None of the Composite blocks define a url—add at least one url per Salesforce call.",
      points: 22,
    });
  }

  const sobjectPts = Math.min(15, 5 + withSobject * 3);
  if (withSobject > 0) {
    score += sobjectPts;
    credits.push({
      label: `${withSobject} url(s) point at Salesforce’s /sobjects/ REST API.`,
      points: sobjectPts,
    });
  } else {
    deductions.push({
      label: "No urls use /sobjects/ — you’re missing the usual Salesforce object-write pattern.",
      points: 15,
    });
  }

  const fieldBoost =
    totalBodyFields > 0
      ? Math.min(23, 8 + Math.min(15, Math.floor(totalBodyFields / 4)))
      : 0;
  if (totalBodyFields > 0) {
    score += fieldBoost;
    credits.push({
      label: `Roughly ${totalBodyFields} field mapping(s) appear across the Composite bodies.`,
      points: fieldBoost,
    });
  } else {
    deductions.push({
      label: "The Composite bodies don’t show any field mappings yet—add keys under each body object.",
      points: 23,
    });
  }

  const rawBeforeEsaBonus = score;

  if (opts.hasMatchingEsaRow) {
    score += 12;
    credits.push({
      label: "The same service name exists in External APIs, so HTTP and stamping line up.",
      points: 12,
    });
  } else {
    const capped = Math.min(score, 68);
    const trimmed = rawBeforeEsaBonus > capped ? rawBeforeEsaBonus - capped : 0;
    deductions.push({
      label:
        trimmed > 0
          ? `There’s no External APIs row with this service name, so you miss the name-match bonus and stamping can’t score above 68 until it exists. On Composite alone you’d be at ${rawBeforeEsaBonus}; we reduce by ${trimmed} to fit that cap.`
          : "There’s no External APIs row with this service name yet, so you miss the name-match bonus and the score stays at or below 68 until you add one.",
      points: 12 + trimmed,
    });
    score = capped;
  }

  return {
    score: Math.min(100, Math.round(score)),
    credits,
    deductions,
  };
}

/** Scores at or above this value skip View-popup field highlights (same band as `scoreTier` “high”). */
export const VIEW_HIGHLIGHT_MAX_SCORE = 80;

/**
 * Field/banner keys for the External APIs preview when confidence is below {@link VIEW_HIGHLIGHT_MAX_SCORE}.
 * Matches the heuristic in {@link scoreEsaAlignment}.
 */
export function getEsaViewHighlights(
  row: ServiceConfiguration | undefined,
  opts: ScoreEsaAlignmentOptions,
): string[] {
  const { score } = scoreEsaAlignment(row, opts);
  if (score >= VIEW_HIGHLIGHT_MAX_SCORE || !row) return [];

  const keys: string[] = [];
  const url = String(row.api_url ?? "").trim();
  if (url.length === 0 || !/^https?:\/\//i.test(url)) {
    keys.push("api_url");
  }

  const rb = row.request_body;
  let bodyKeys = 0;
  if (rb !== null && typeof rb === "object" && !Array.isArray(rb)) {
    bodyKeys = Object.keys(rb as Record<string, unknown>).length;
  }
  if (bodyKeys === 0) {
    keys.push("request_body");
  }

  const method = String(row.request_method ?? "POST").trim().toUpperCase();
  if (!method) {
    keys.push("request_method");
  }

  if (!opts.serviceIdUsedInPartnerSequences) {
    keys.push("partner_wiring");
  }

  return [...new Set(keys)];
}

/**
 * Section keys for the Data Stamping preview when confidence is below {@link VIEW_HIGHLIGHT_MAX_SCORE}.
 * Matches the heuristic in {@link scoreSfdcAlignment}.
 */
export function getSfdcViewHighlights(
  row: ServiceSfdcFieldMapping | undefined,
  opts: { hasMatchingEsaRow: boolean },
): string[] {
  const { score } = scoreSfdcAlignment(row, opts);
  if (score >= VIEW_HIGHLIGHT_MAX_SCORE || !row) return [];

  const keys: string[] = [];
  const raw = row.request_body;
  if (!Array.isArray(raw) || raw.length === 0) {
    keys.push("request_body");
    return keys;
  }

  let withUrl = 0;
  let withSobject = 0;
  let totalBodyFields = 0;
  for (const item of raw) {
    const q = compositeSubRequestQuality(item);
    if (q.hasUrl) withUrl++;
    if (q.sobjectUrl) withSobject++;
    totalBodyFields += q.bodyFieldCount;
  }

  if (withUrl === 0) keys.push("composite_urls");
  if (withSobject === 0) keys.push("composite_sobjects");
  if (totalBodyFields === 0) keys.push("field_mappings");
  if (!opts.hasMatchingEsaRow) keys.push("esa_row");

  return [...new Set(keys)];
}

export function scoreTier(score: number): "none" | "low" | "mid" | "high" {
  if (score <= 0) return "none";
  if (score < 50) return "low";
  if (score < 80) return "mid";
  return "high";
}

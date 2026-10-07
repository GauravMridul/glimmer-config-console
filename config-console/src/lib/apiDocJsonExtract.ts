import { parseCurl } from "@/lib/parseCurl";

/** Find end index of balanced JSON starting at `start` (`{` or `[`). Returns -1 if not closed. */
export function findBalancedJsonEnd(s: string, start: number): number {
  const open = s[start];
  if (open !== "{" && open !== "[") return -1;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = false;
        continue;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export type JsonBlockCandidate = {
  id: string;
  raw: string;
  parsed: unknown;
  startIndex: number;
  score: number;
  /** Short labels from nearby lines (request / response / example …). */
  hints: string[];
};

function linesBefore(text: string, index: number, maxLines = 40): string[] {
  const head = text.slice(0, index);
  const lines = head.split("\n");
  return lines.slice(Math.max(0, lines.length - maxLines));
}

/** Plain-language tags for non-technical readers (shown in PDF import UI). */
function hintScore(lines: string[]): { score: number; hints: string[] } {
  const hints: string[] = [];
  let score = 0;
  const joined = lines.join("\n").toLowerCase();
  if (/\brequest\b|\binput\b|\bbody\b|\bpayload\b|\bparameters?\b/i.test(joined)) {
    score += 35;
    hints.push("Under request / input wording");
  }
  if (/\bresponse\b|\boutput\b|\bsuccess\b|\b200\b/i.test(joined)) {
    score += 35;
    hints.push("Under response / output wording");
  }
  if (/\bexample\b|\bsample\b|\bschema\b/i.test(joined)) {
    score += 15;
    hints.push("Near an example or sample");
  }
  if (/\berror\b|\b400\b|\b500\b/i.test(joined)) {
    score -= 10;
  }
  return { score, hints };
}

function scoreJsonBlock(
  raw: string,
  parsed: unknown,
  fullText: string,
  startIndex: number,
): { score: number; hints: string[] } {
  const lb = linesBefore(fullText, startIndex);
  const { score: hScore, hints } = hintScore(lb);
  let score = hScore + Math.min(40, Math.floor(raw.length / 80));
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    const keys = Object.keys(parsed as object);
    score += Math.min(20, keys.length * 2);
  }
  if (Array.isArray(parsed) && parsed.length > 0) score += 10;
  if (raw.length < 4) score -= 50;
  return { score, hints };
}

/**
 * Scan full document text for substrings that parse as JSON (objects or arrays).
 * Overlapping spans are deduped (keeps longer / higher-scoring).
 */
export function extractJsonBlocksFromText(fullText: string): JsonBlockCandidate[] {
  const s = fullText.replace(/\r\n/g, "\n");
  const rawCandidates: { raw: string; parsed: unknown; startIndex: number }[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== "{" && ch !== "[") continue;
    const end = findBalancedJsonEnd(s, i);
    if (end === -1) continue;
    const raw = s.slice(i, end + 1);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    rawCandidates.push({ raw, parsed, startIndex: i });
  }

  /** Drop strict subsets (same start, shorter end) */
  const sorted = rawCandidates.sort((a, b) => b.raw.length - a.raw.length);
  const kept: typeof rawCandidates = [];
  for (const c of sorted) {
    const contained = kept.some(
      (k) => k.startIndex <= c.startIndex && k.startIndex + k.raw.length >= c.startIndex + c.raw.length,
    );
    if (!contained) kept.push(c);
  }

  const scored: JsonBlockCandidate[] = kept.map((c, idx) => {
    const { score, hints } = scoreJsonBlock(c.raw, c.parsed, s, c.startIndex);
    return {
      id: `json-${idx}-${c.startIndex}`,
      raw: c.raw,
      parsed: c.parsed,
      startIndex: c.startIndex,
      score,
      hints,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

export type CurlBlockCandidate = {
  id: string;
  raw: string;
  score: number;
  method: string;
  url: string;
  headers: Record<string, string>;
  bodyJson: unknown | null;
};

/**
 * Extract curl-looking blocks (line-based; handles backslash continuation).
 */
export function extractCurlBlocksFromText(fullText: string): CurlBlockCandidate[] {
  const text = fullText.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (/^curl\s/i.test(line)) {
      const parts: string[] = [lines[i]];
      let j = i + 1;
      while (j < lines.length) {
        const prev = parts[parts.length - 1];
        if (/\\\s*$/.test(prev)) {
          parts.push(lines[j]);
          j++;
          continue;
        }
        break;
      }
      blocks.push(parts.join("\n"));
      i = j;
      continue;
    }
    i++;
  }

  const out: CurlBlockCandidate[] = [];
  for (let k = 0; k < blocks.length; k++) {
    const raw = blocks[k];
    const parsed = parseCurl(raw);
    if (!parsed.ok) continue;
    const lb = linesBefore(text, text.indexOf(raw));
    const { score: hScore } = hintScore(lb);
    let score = hScore + 25 + (parsed.bodyJson ? 20 : 0);
    if (parsed.url) score += 10;
    out.push({
      id: `curl-${k}`,
      raw,
      score,
      method: parsed.method,
      url: parsed.url,
      headers: parsed.headers,
      bodyJson: parsed.bodyJson,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

export function pickPlainObject(
  parsed: unknown,
): Record<string, unknown> | null {
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return null;
}

/** Wrap arrays so Smart Import always gets an object for `request_body`. */
export function coerceRequestBodyObject(parsed: unknown): Record<string, unknown> {
  const o = pickPlainObject(parsed);
  if (o) return o;
  if (Array.isArray(parsed)) return { items: parsed };
  return {};
}

/** First URL in doc text (for docs without curl). */
export function extractFirstHttpUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s\)\]'"<>]+/i);
  if (!m) return null;
  return m[0].replace(/[.,;:)]+$/, "");
}

export function mergePdfExtractIntoSample(opts: {
  serviceName: string;
  apiUrl: string;
  requestMethod: string;
  headers: Record<string, unknown>;
  requestBody: Record<string, unknown>;
  sampleResponse: unknown;
}): string {
  return JSON.stringify(
    {
      service_name: opts.serviceName,
      api_url: opts.apiUrl,
      request_method: opts.requestMethod,
      headers: opts.headers,
      request_body: opts.requestBody,
      sample_response: opts.sampleResponse,
      timeout: 30,
      salesforce_sobject: "Audit_Log__c",
      api_version: "v64.0",
    },
    null,
    2,
  );
}

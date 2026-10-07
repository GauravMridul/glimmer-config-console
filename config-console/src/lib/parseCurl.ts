import { parseJsonObject } from "@/lib/json";

export type ParsedCurlOk = {
  ok: true;
  method: string;
  url: string;
  headers: Record<string, string>;
  /** Raw body string from -d / --data* (joined). */
  bodyRaw: string | null;
  /** Parsed JSON body when valid JSON; otherwise null. */
  bodyJson: unknown | null;
};

export type ParsedCurl = ParsedCurlOk | { ok: false; error: string };

/** Collapse curl line continuations (backslash + newline). */
function normalizeCurlInput(input: string): string {
  return input.trim().replace(/\\\r?\n/g, " ");
}

/**
 * Split curl-like command into tokens respecting single- and double-quoted segments.
 */
function tokenizeCurl(input: string): string[] {
  const s = normalizeCurlInput(input);
  const tokens: string[] = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    const c = s[i];
    if (c === "'" || c === '"') {
      const quote = c;
      i++;
      let buf = "";
      while (i < s.length) {
        if (quote === '"' && s[i] === "\\" && i + 1 < s.length) {
          const n = s[i + 1];
          if (n === "n") {
            buf += "\n";
            i += 2;
            continue;
          }
          if (n === "r") {
            buf += "\r";
            i += 2;
            continue;
          }
          if (n === "t") {
            buf += "\t";
            i += 2;
            continue;
          }
          if (n === '"' || n === "\\") {
            buf += n;
            i += 2;
            continue;
          }
        }
        if (s[i] === quote) {
          i++;
          break;
        }
        buf += s[i];
        i++;
      }
      tokens.push(buf);
    } else {
      let buf = "";
      while (i < s.length && !/\s/.test(s[i])) buf += s[i++];
      tokens.push(buf);
    }
  }
  return tokens;
}

const DATA_FLAGS = new Set([
  "-d",
  "--data",
  "--data-raw",
  "--data-binary",
  "--data-urlencode",
]);

function looksLikeUrl(t: string): boolean {
  return /^https?:\/\//i.test(t);
}

/**
 * Parse a pasted curl command into method, URL, headers, and body.
 * Supports typical `-X`, `-H`, `-d` / `--data*` patterns. Does not read bodies from `@file`.
 */
export function parseCurl(input: string): ParsedCurl {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: "Paste a curl command first." };
  }

  const tokens = tokenizeCurl(trimmed);
  if (tokens.length === 0) {
    return { ok: false, error: "Could not parse curl command." };
  }

  let i = 0;
  if (tokens[i]?.toLowerCase() === "curl") i++;

  const headers: Record<string, string> = {};
  const dataParts: string[] = [];
  let method = "GET";
  const urls: string[] = [];

  while (i < tokens.length) {
    const t = tokens[i];
    const tl = t.toLowerCase();

    if (tl === "-x" || tl === "--request") {
      method = (tokens[i + 1] ?? "GET").toUpperCase();
      i += 2;
      continue;
    }
    if (tl === "-h" || tl === "--header") {
      const h = tokens[i + 1] ?? "";
      const colon = h.indexOf(":");
      if (colon > 0) {
        const name = h.slice(0, colon).trim();
        const value = h.slice(colon + 1).trim();
        headers[name] = value;
      }
      i += 2;
      continue;
    }
    if (DATA_FLAGS.has(tl)) {
      const payload = tokens[i + 1];
      if (payload === undefined) {
        return { ok: false, error: `${t} is missing a value.` };
      }
      if (payload.startsWith("@")) {
        return {
          ok: false,
          error: "Body from file (@…) is not supported — paste the JSON body or use -d '{…}'.",
        };
      }
      dataParts.push(payload);
      i += 2;
      continue;
    }
    if (tl === "-g" || tl === "--get") {
      method = "GET";
      i++;
      continue;
    }
    if (tl === "--url") {
      const u = tokens[i + 1];
      if (u !== undefined && looksLikeUrl(u)) urls.push(u);
      i += 2;
      continue;
    }
    if (looksLikeUrl(t)) {
      urls.push(t);
      i++;
      continue;
    }
    i++;
  }

  let url = urls.length ? urls[urls.length - 1] : "";
  if (!url) {
    const any = tokens.find((x) => looksLikeUrl(x));
    if (any) url = any;
  }

  let bodyRaw: string | null = null;
  if (dataParts.length === 1) {
    bodyRaw = dataParts[0];
  } else if (dataParts.length > 1) {
    bodyRaw = dataParts.join("&");
  }

  if (bodyRaw && method === "GET") {
    method = "POST";
  }

  let bodyJson: unknown | null = null;
  if (bodyRaw !== null && bodyRaw.length > 0) {
    const pj = parseJsonObject(bodyRaw);
    if (pj.ok) {
      bodyJson = pj.value;
    }
  }

  return {
    ok: true,
    method,
    url,
    headers,
    bodyRaw,
    bodyJson,
  };
}

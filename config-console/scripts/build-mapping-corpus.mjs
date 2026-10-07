/**
 * Builds src/data/mappingCorpusSeed.json from an ESA export JSON file.
 * Usage: node scripts/build-mapping-corpus.mjs path/to/service_configuration_export.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function flattenLeaves(value, prefix = "") {
  const out = {};
  if (value === null || value === undefined) {
    if (prefix) out[prefix] = value;
    return out;
  }
  if (typeof value !== "object") {
    if (prefix) out[prefix] = value;
    return out;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      if (prefix) out[prefix] = [];
      return out;
    }
    value.forEach((item, i) => {
      const p = prefix ? `${prefix}[${i}]` : `[${i}]`;
      Object.assign(out, flattenLeaves(item, p));
    });
    return out;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) {
    if (prefix) out[prefix] = {};
    return out;
  }
  for (const k of keys) {
    const v = value[k];
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object") {
      Object.assign(out, flattenLeaves(v, p));
    } else {
      out[p] = v;
    }
  }
  return out;
}

function normalizePath(path) {
  return path.replace(/\[\d+\]/g, "[*]");
}

function lastSegment(normalizedPath) {
  const i = normalizedPath.lastIndexOf(".");
  if (i === -1) return normalizedPath;
  return normalizedPath.slice(i + 1);
}

const SUFFIX_STOPLIST = new Set([
  "body",
  "code",
  "data",
  "flag",
  "id",
  "key",
  "name",
  "status",
  "type",
  "value",
]);

function valueToExpr(v) {
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return JSON.stringify(v);
  return JSON.stringify(v);
}

function coerceRequestBody(rb) {
  if (rb == null) return null;
  if (typeof rb === "string") {
    try {
      const p = JSON.parse(rb);
      if (p !== null && typeof p === "object" && !Array.isArray(p)) return p;
      return null;
    } catch {
      return null;
    }
  }
  if (typeof rb === "object" && !Array.isArray(rb)) return rb;
  return null;
}

function build(rows) {
  const acc = new Map();

  for (const row of rows) {
    if (row.is_deleted) continue;
    const obj = coerceRequestBody(row.request_body);
    if (!obj || Object.keys(obj).length === 0) continue;
    const flat = flattenLeaves(obj);
    for (const [p, val] of Object.entries(flat)) {
      const norm = normalizePath(p);
      const expr = valueToExpr(val);
      const inner = acc.get(norm) ?? new Map();
      const cur = inner.get(expr) ?? { count: 0, services: new Set() };
      cur.count += 1;
      cur.services.add(row.service_name ?? "?");
      inner.set(expr, cur);
      acc.set(norm, inner);
    }
  }

  const byPath = {};
  for (const [path, inner] of acc.entries()) {
    byPath[path] = [...inner.entries()]
      .map(([expression, v]) => ({
        expression,
        count: v.count,
        services: [...v.services].sort(),
      }))
      .sort((a, b) => b.count - a.count || a.expression.length - b.expression.length);
  }

  const suffixAcc = new Map();
  for (const [path, suggestions] of Object.entries(byPath)) {
    const seg = lastSegment(path);
    if (SUFFIX_STOPLIST.has(seg) || seg.length < 4) continue;
    for (const s of suggestions) {
      const inner = suffixAcc.get(seg) ?? new Map();
      const cur = inner.get(s.expression) ?? { count: 0, services: new Set() };
      cur.count += s.count;
      for (const n of s.services) cur.services.add(n);
      inner.set(s.expression, cur);
      suffixAcc.set(seg, inner);
    }
  }

  const bySuffix = {};
  for (const [suffix, inner] of suffixAcc.entries()) {
    bySuffix[suffix] = [...inner.entries()]
      .map(([expression, v]) => ({
        expression,
        count: v.count,
        services: [...v.services].sort(),
      }))
      .sort((a, b) => b.count - a.count || a.expression.length - b.expression.length);
  }

  return {
    byPath,
    bySuffix,
    meta: { leafPaths: Object.keys(byPath).length },
  };
}

const input =
  process.argv[2] ||
  path.join(process.env.HOME || "", "Downloads/service_configuration_202603241212.json");

const raw = JSON.parse(fs.readFileSync(input, "utf8"));
const rows = raw.service_configuration ?? raw;
if (!Array.isArray(rows)) {
  console.error("Expected { service_configuration: [...] } or an array");
  process.exit(1);
}

const index = build(rows);
const out = path.join(__dirname, "../src/data/mappingCorpusSeed.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(index));
console.log("Wrote", out, "leafPaths:", index.meta.leafPaths, "from", input);

/**
 * Builds stamping + SF field name corpus seeds from a Decision Manager export:
 * - src/data/sfdcStampingCorpusSeed.json (expression templates)
 * - src/data/sfdcFieldNameCorpusSeed.json (Composite body keys per response path)
 * Usage: node scripts/build-sfdc-corpus.mjs path/to/service_sfdc_field_mapping_export.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function normalizePath(p) {
  return p.replace(/\[\d+\]/g, "[*]");
}

function extractResponseSubpaths(expr) {
  const paths = [];
  const needle = ".response.";
  let from = 0;
  while (true) {
    const idx = expr.indexOf(needle, from);
    if (idx === -1) break;
    const j = idx + needle.length;
    let end = j;
    while (end < expr.length) {
      const c = expr[end];
      if (c === ")" || c === "}" || c === "," || c === " " || c === "|") break;
      end++;
    }
    const segment = expr.slice(j, end).replace(/^\./, "").trim();
    if (segment) paths.push(normalizePath(segment));
    from = idx + 1;
  }
  return paths;
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

function lastSegment(normalizedPath) {
  const i = normalizedPath.lastIndexOf(".");
  if (i === -1) return normalizedPath;
  return normalizedPath.slice(i + 1);
}

function collectBodyStrings(body, prefix = "") {
  if (body == null) return [];
  if (typeof body === "string") return [body];
  if (typeof body !== "object") return [];
  if (Array.isArray(body)) {
    const out = [];
    body.forEach((item, i) => {
      const p = prefix ? `${prefix}[${i}]` : `[${i}]`;
      out.push(...collectBodyStrings(item, p));
    });
    return out;
  }
  const out = [];
  for (const k of Object.keys(body)) {
    const v = body[k];
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.push(v);
    else if (v != null && typeof v === "object") out.push(...collectBodyStrings(v, p));
  }
  return out;
}

function collectBodyFieldPairs(body, prefix = "") {
  if (body == null || typeof body !== "object" || Array.isArray(body)) return [];
  const out = [];
  for (const k of Object.keys(body)) {
    const v = body[k];
    const fieldPath = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      out.push({ sfField: fieldPath, expr: v });
    } else if (v != null && typeof v === "object" && !Array.isArray(v)) {
      out.push(...collectBodyFieldPairs(v, fieldPath));
    }
  }
  return out;
}

function build(rows) {
  const acc = new Map();

  function accumulate(path, expression, serviceName) {
    const norm = normalizePath(path);
    if (!norm) return;
    const inner = acc.get(norm) ?? new Map();
    const cur = inner.get(expression) ?? { count: 0, services: new Set() };
    cur.count += 1;
    cur.services.add(serviceName);
    inner.set(expression, cur);
    acc.set(norm, inner);
  }

  for (const row of rows) {
    if (row.is_deleted) continue;
    let rb = row.request_body;
    if (typeof rb === "string") {
      try {
        rb = JSON.parse(rb);
      } catch {
        continue;
      }
    }
    if (!Array.isArray(rb)) continue;

    for (const op of rb) {
      if (op == null || typeof op !== "object") continue;
      const body = op.body;
      const strings = collectBodyStrings(body);
      for (const expr of strings) {
        const paths = extractResponseSubpaths(expr);
        if (paths.length === 0) continue;
        for (const p of paths) {
          accumulate(p, expr, row.service_name ?? "?");
        }
      }
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

function buildSfFields(rows) {
  const acc = new Map();

  function accumulate(path, sfField, serviceName) {
    const norm = normalizePath(path);
    if (!norm) return;
    const inner = acc.get(norm) ?? new Map();
    const cur = inner.get(sfField) ?? { count: 0, services: new Set() };
    cur.count += 1;
    cur.services.add(serviceName);
    inner.set(sfField, cur);
    acc.set(norm, inner);
  }

  for (const row of rows) {
    if (row.is_deleted) continue;
    let rb = row.request_body;
    if (typeof rb === "string") {
      try {
        rb = JSON.parse(rb);
      } catch {
        continue;
      }
    }
    if (!Array.isArray(rb)) continue;

    for (const op of rb) {
      if (op == null || typeof op !== "object") continue;
      const body = op.body;
      const pairs = collectBodyFieldPairs(body);
      for (const { sfField, expr } of pairs) {
        const paths = extractResponseSubpaths(expr);
        if (paths.length === 0) continue;
        for (const p of paths) {
          accumulate(p, sfField, row.service_name ?? "?");
        }
      }
    }
  }

  const byPath = {};
  for (const [path, inner] of acc.entries()) {
    byPath[path] = [...inner.entries()]
      .map(([field, v]) => ({
        field,
        count: v.count,
        services: [...v.services].sort(),
      }))
      .sort((a, b) => b.count - a.count || a.field.length - b.field.length);
  }

  const suffixAcc = new Map();
  for (const [path, suggestions] of Object.entries(byPath)) {
    const seg = lastSegment(path);
    if (SUFFIX_STOPLIST.has(seg) || seg.length < 4) continue;
    for (const s of suggestions) {
      const inner = suffixAcc.get(seg) ?? new Map();
      const cur = inner.get(s.field) ?? { count: 0, services: new Set() };
      cur.count += s.count;
      for (const n of s.services) cur.services.add(n);
      inner.set(s.field, cur);
      suffixAcc.set(seg, inner);
    }
  }

  const bySuffix = {};
  for (const [suffix, inner] of suffixAcc.entries()) {
    bySuffix[suffix] = [...inner.entries()]
      .map(([field, v]) => ({
        field,
        count: v.count,
        services: [...v.services].sort(),
      }))
      .sort((a, b) => b.count - a.count || a.field.length - b.field.length);
  }

  return {
    byPath,
    bySuffix,
    meta: { leafPaths: Object.keys(byPath).length },
  };
}

const input =
  process.argv[2] ||
  path.join(process.env.HOME || "", "Downloads/service_sfdc_field_mapping_202603241211.json");

const raw = JSON.parse(fs.readFileSync(input, "utf8"));
const rows = raw.service_sfdc_field_mapping ?? raw;
if (!Array.isArray(rows)) {
  console.error("Expected { service_sfdc_field_mapping: [...] } or an array");
  process.exit(1);
}

const index = build(rows);
const out = path.join(__dirname, "../src/data/sfdcStampingCorpusSeed.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(index));
console.log("Wrote", out, "leafPaths:", index.meta.leafPaths, "from", input);

const sfIndex = buildSfFields(rows);
const outSf = path.join(__dirname, "../src/data/sfdcFieldNameCorpusSeed.json");
fs.writeFileSync(outSf, JSON.stringify(sfIndex));
console.log("Wrote", outSf, "sfField leafPaths:", sfIndex.meta.leafPaths, "from", input);

/**
 * Angle-bracket / ARRAY placeholder extraction aligned with
 * `external-service-adapter/internal/app/utility/utility.go`
 * (`extractFromInterfaceWithConditions`, `extractFromStringWithConditions`, etc.).
 */

import { assertSafeSObjectName } from "./salesforceClient.mjs";

// Same patterns as ESA `utility.go` (pre-compiled there).
const objectFieldRe =
  /<([A-Za-z0-9_]+)\.([A-Za-z0-9_]+(?:\[[^\]]*\])?(?:\.[A-Za-z0-9_]+(?:\[[^\]]*\])?)*)>/g;

const fallbackRe =
  /(<[^>]+>|\(\([^)]*\)\))(\s*\|\|\s*(<[^>]+>|\(\([^)]*\)\)))*/g;

const conditionalPlaceholderRe =
  /^([A-Za-z0-9_]+)\[([^\]]+)\]\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)$/;

const arrayExpressionRe = /\{\{ARRAY:<([^>]+)>(?::([^}]+))?\}\}/g;

const objectNameRe = /^[A-Za-z_][A-Za-z0-9_]*$/;

const CONDITION_OPERATORS = [
  ">=",
  "<=",
  "==",
  "!=",
  ">",
  "<",
  " = ",
  " != ",
  "=",
  " IN ",
  " NOT IN ",
];

const CONDITION_SPLITS = [" AND ", " OR ", " && ", " || "];

/**
 * @param {string} content inner text without `<` `>`
 * @returns {{ objectName: string; condition: string; fieldName: string; isConditional: boolean }}
 */
export function parseConditionalPlaceholder(content) {
  const m = String(content).match(conditionalPlaceholderRe);
  if (m && m.length === 4) {
    return { objectName: m[1], condition: m[2], fieldName: m[3], isConditional: true };
  }
  const dot = String(content).indexOf(".");
  if (dot > 0) {
    return {
      objectName: content.slice(0, dot),
      condition: "",
      fieldName: content.slice(dot + 1),
      isConditional: false,
    };
  }
  return { objectName: "", condition: "", fieldName: "", isConditional: false };
}

/** @param {string} fieldName */
function isValidFieldName(fieldName) {
  if (!fieldName) return false;
  for (let i = 0; i < fieldName.length; i++) {
    const c = fieldName.charCodeAt(i);
    const ok =
      (c >= 65 && c <= 90) ||
      (c >= 97 && c <= 122) ||
      (c >= 48 && c <= 57) ||
      c === 95;
    if (!ok) return false;
  }
  return true;
}

/**
 * @param {(objectName: string, fieldName: string) => void} addPair
 */
function extractFieldsFromCondition(objectName, condition, addPair) {
  /** @type {string[]} */
  let parts = [condition];
  for (const sep of CONDITION_SPLITS) {
    parts = parts.flatMap((p) => p.split(sep));
  }
  for (let part of parts) {
    part = part.trim();
    if (!part) continue;
    for (const op of CONDITION_OPERATORS) {
      const idx = part.indexOf(op);
      if (idx > 0) {
        let fieldName = part.slice(0, idx).trim();
        fieldName = fieldName.replace(/^["'()]+|["'()]+$/g, "");
        if (fieldName && isValidFieldName(fieldName)) {
          addPair(objectName, fieldName);
        }
        break;
      }
    }
  }
}

/**
 * @param {string} placeholder full `<...>`
 * @param {(objectName: string, fieldName: string) => void} addPair
 */
function extractFromAngleBracketPlaceholderWithConditions(placeholder, addPair) {
  const content = placeholder.slice(1, -1);
  const { objectName, condition, fieldName, isConditional } = parseConditionalPlaceholder(content);
  if (objectName && fieldName) {
    addPair(objectName, fieldName);
    if (isConditional && condition) {
      extractFieldsFromCondition(objectName, condition, addPair);
    }
  }
}

/**
 * @param {string} chain
 * @param {(objectName: string, fieldName: string) => void} addPair
 */
function extractPlaceholdersFromChainWithConditions(chain, addPair) {
  const parts = chain.split("||");
  for (let part of parts) {
    part = part.trim();
    if (part.startsWith("<") && part.endsWith(">")) {
      extractFromAngleBracketPlaceholderWithConditions(part, addPair);
    }
  }
}

/**
 * @param {string} text
 * @param {(objectName: string, fieldName: string) => void} addPair
 */
function extractStandalonePlaceholdersWithConditions(text, addPair) {
  const textWithoutChains = text.replace(fallbackRe, "");
  const re = new RegExp(objectFieldRe.source, objectFieldRe.flags);
  let m;
  while ((m = re.exec(textWithoutChains)) !== null) {
    if (m.length >= 3) {
      addPair(m[1], m[2]);
    }
  }
}

/**
 * @param {string} objectName
 * @param {string} transformSpec
 * @param {(objectName: string, fieldName: string) => void} addPair
 */
function extractFieldsFromArrayTransformSpec(objectName, transformSpec, addPair) {
  if (!transformSpec) return;
  const parts = transformSpec.split(":");
  if (parts.length === 0) return;
  const op = parts[0].trim();

  switch (op) {
    case "transform":
    case "transform-only": {
      if (parts.length < 2) break;
      const fieldMappings = parts[1].trim().split(",");
      for (let mapping of fieldMappings) {
        mapping = mapping.trim();
        if (!mapping) continue;
        if (mapping.includes("@")) {
          mapping = mapping.split("@")[0];
        }
        if (!mapping.includes("->")) continue;
        const sourceField = mapping.split("->")[0].trim();
        if (sourceField && isValidFieldName(sourceField)) {
          addPair(objectName, sourceField);
        }
      }
      break;
    }
    case "map": {
      if (parts.length < 2) break;
      const fields = parts[1].trim().split(",");
      for (let field of fields) {
        field = field.trim();
        if (field && isValidFieldName(field)) {
          addPair(objectName, field);
        }
      }
      break;
    }
    default:
      break;
  }
  addPair(objectName, "Id");
}

/**
 * @param {string} text
 * @param {(objectName: string, fieldName: string) => void} addPair
 */
function extractFromArrayExpressions(text, addPair) {
  const re = new RegExp(arrayExpressionRe.source, arrayExpressionRe.flags);
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.length < 2) continue;
    const objectRef = m[1].trim();
    if (!objectRef || objectRef.includes(".")) continue;
    if (!objectNameRe.test(objectRef)) continue;
    const transformSpec = m.length >= 3 ? String(m[2] ?? "").trim() : "";
    extractFieldsFromArrayTransformSpec(objectRef, transformSpec, addPair);
  }
}

/**
 * Probe UI replaces `<Obj[cond].Field>` with `sbx-ref:Obj[cond].Field` (no brackets).
 * Treat it like an angle placeholder so SOQL collects the same object/field pairs.
 *
 * @param {string} text
 * @param {(objectName: string, fieldName: string) => void} addPair
 */
function extractFromSbxRefPlaceholders(text, addPair) {
  const s = String(text).trim();
  const m = /^sbx-ref:(.+)$/i.exec(s);
  if (!m) return;
  const inner = m[1].trim();
  if (!inner || inner.includes("<") || inner.includes(">")) return;
  extractFromAngleBracketPlaceholderWithConditions(`<${inner}>`, addPair);
}

/**
 * @param {string} text
 * @param {(objectName: string, fieldName: string) => void} addPair
 */
function extractFromStringWithConditions(text, addPair) {
  extractFromSbxRefPlaceholders(text, addPair);
  const s = String(text);
  const chains = s.match(fallbackRe);
  if (chains) {
    for (const chain of chains) {
      extractPlaceholdersFromChainWithConditions(chain, addPair);
    }
  }
  extractFromArrayExpressions(s, addPair);
  extractStandalonePlaceholdersWithConditions(s, addPair);
}

/**
 * @param {unknown} data
 * @param {(objectName: string, fieldName: string) => void} addPair
 */
function extractFromInterfaceWithConditions(data, addPair) {
  if (data === null || data === undefined) return;
  if (typeof data === "string") {
    extractFromStringWithConditions(data, addPair);
    return;
  }
  if (Array.isArray(data)) {
    for (const item of data) extractFromInterfaceWithConditions(item, addPair);
    return;
  }
  if (typeof data === "object") {
    for (const [key, val] of Object.entries(data)) {
      extractFromStringWithConditions(key, addPair);
      extractFromInterfaceWithConditions(val, addPair);
    }
  }
}

/**
 * Collect `<Object.field>` (including conditional, chain, ARRAY, dotted paths)
 * and whole-string `sbx-ref:…` tokens (probe UI reversible form) from a JSON body
 * the same way ESA does for angle placeholders.
 *
 * @param {unknown} body parsed JSON or string (string is parsed as JSON when possible, else scanned as raw text)
 * @returns {Map<string, { object: string; field: string }>} key = "Object.field" (first-seen casing)
 */
export function collectAngleRefsFromBody(body) {
  /** @type {Map<string, { object: string; field: string }>} */
  const acc = new Map();

  const addPair = (objectName, fieldName) => {
    try {
      assertSafeSObjectName(objectName);
    } catch {
      return;
    }
    const field = String(fieldName);
    const lo = objectName.toLowerCase();
    const lf = field.toLowerCase();
    const id = `${lo}\0${lf}`;
    if (!acc.has(id)) {
      acc.set(id, { object: objectName, field });
    }
  };

  if (typeof body === "string") {
    try {
      extractFromInterfaceWithConditions(JSON.parse(body), addPair);
    } catch {
      extractFromStringWithConditions(body, addPair);
    }
    return accToRefMap(acc);
  }

  extractFromInterfaceWithConditions(body, addPair);
  return accToRefMap(acc);
}

/** @param {Map<string, { object: string; field: string }>} acc */
function accToRefMap(acc) {
  /** @type {Map<string, { object: string; field: string }>} */
  const map = new Map();
  for (const { object, field } of acc.values()) {
    const key = `${object}.${field}`;
    map.set(key, { object, field });
  }
  return map;
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Modal } from "@/components/Modal";
import {
  DataTableShell,
  PageHero,
  PageStack,
  tableListHeadRowClass,
} from "@/components/PageChrome";

/** Lighter panel than default innerPanel — keeps this page visually quiet. */
const panelClass = "rounded-lg border border-ink/8 bg-white/90 p-4";
import { TextArea } from "@/components/Field";
import { useConfig } from "@/context/ConfigContext";
import { validateSfdcMapping } from "@/lib/configValidation";
import { parseJsonObject, stringifyJson } from "@/lib/json";
import {
  buildBureauStyleRequestBodyMulti,
  type BureauStampObjectBlock,
  buildSfdcMappingRowFromMapperExport,
  collectSobjectApiNamesFromMappings,
  defaultArrayPathForService,
  formatCurrentItemExpression,
  inferServiceNameFromPrimaryExpressions,
  longestCommonPathPrefix,
  parseSfdcMapperExport,
  relativePathAfterPrefix,
  stampFirstServicePrefixInExpression,
  salesforceSobjectRestUrl,
  serviceNameFromArrayPath,
  SFDC_DEFAULT_API_VERSION,
  SFDC_DEFAULT_ARRAY_TARGET_OBJECT,
  SFDC_DEFAULT_AUDIT_OBJECT,
} from "@/lib/sfdcMapperPush";
import type { ServiceSfdcFieldMapping } from "@/types/models";
import {
  fetchSalesforceDescribe,
  fetchSalesforceSObjectList,
  fetchSalesforceStatus,
  type SalesforceDescribeField,
  type SalesforceGlobalSObjectRow,
  type SalesforceStatusResponse,
} from "@/api/backend";
import { useSemanticRowFilter } from "@/lib/semanticTableSearch";
import {
  collectKeys,
  type FlattenMode,
} from "@/lib/flattenRequestBody";
import {
  corpusIndexFromJSON,
  getSuggestionsForPath,
  type CorpusIndexJSON,
} from "@/lib/mappingSuggestions";
import {
  buildSfdcStampingCorpus,
  buildSfFieldCorpus,
  getSfFieldSuggestionsForPath,
  mergeCorpusIndexes,
  mergeSfFieldCorpusIndexes,
  sfFieldCorpusFromJSON,
  type SfFieldCorpusIndexJSON,
} from "@/lib/sfdcStampingSuggestions";
import sfdcStampingCorpusSeed from "@/data/sfdcStampingCorpusSeed.json";
import sfdcFieldNameCorpusSeed from "@/data/sfdcFieldNameCorpusSeed.json";
import sfdcAutoMapperSampleResponse from "@/data/sfdcAutoMapperSampleResponse.json";
import { buildDescribeFieldIndex } from "@/lib/sfdcDescribeFieldMatch";

type MapperSource = "primary" | "secondary";

/** Extra JSON block — same role as legacy single Secondary JSON; multiple allowed. */
type ExtraApiBlock = {
  id: string;
  raw: string;
  serviceName: string;
};

function createExtraApiBlock(): ExtraApiBlock {
  return { id: crypto.randomUUID(), raw: "", serviceName: "" };
}

function secondaryRowKey(blockId: string, path: string): string {
  return `sec:${blockId}:${path}`;
}

/** Rows with no Salesforce object assignment — excluded from export until assigned. */
const UNASSIGNED_TARGET_ID = "__unassigned__";

type TargetObjectBlockState = {
  id: string;
  sObjectApiName: string;
  describeFields: SalesforceDescribeField[];
  fieldNames: string[];
  describeSourceObject: string;
  describeLoading: boolean;
  describeError: string | null;
};

function createTargetObjectBlock(initialName?: string): TargetObjectBlockState {
  return {
    id: crypto.randomUUID(),
    sObjectApiName:
      initialName !== undefined ? initialName : SFDC_DEFAULT_ARRAY_TARGET_OBJECT,
    describeFields: [],
    fieldNames: [],
    describeSourceObject: "",
    describeLoading: false,
    describeError: null,
  };
}

/** One flattened path; primary keys `pri:` + path; secondary keys `sec:{blockId}:{path}`. */
type MapperTableRow = {
  key: string;
  source: MapperSource;
  /** Secondary rows only — ties row to an {@link ExtraApiBlock}. */
  extraApiId?: string;
  leafPath: string;
  sample: unknown;
  kind: string;
};

export function SfdcAutoMapperPage() {
  const {
    bundle,
    apiMode,
    upsertSfdcMapping,
    createEmptySfdcMapping,
    clearError,
    error,
  } = useConfig();
  const [raw, setRaw] = useState("");
  /** Optional extra API samples (same shape as primary); empty when only one API is used. */
  const [extraApis, setExtraApis] = useState<ExtraApiBlock[]>([]);
  const [mode, setMode] = useState<FlattenMode>("all-leaves");
  /** Stamping expression per API output path */
  const [expressions, setExpressions] = useState<Record<string, string>>({});
  /** Salesforce field API name per path (keys of composite body) */
  const [sfFields, setSfFields] = useState<Record<string, string>>({});
  const [pushStep, setPushStep] = useState<0 | 1 | 2>(0);
  const [newServiceName, setNewServiceName] = useState("");
  const [confirmServiceName, setConfirmServiceName] = useState("");
  const [pushing, setPushing] = useState(false);
  const [pushBanner, setPushBanner] = useState<string | null>(null);
  /** Include Audit_Log__c sub-request with ((ServiceName.*)) templates. */
  const [includeAuditLog, setIncludeAuditLog] = useState(true);
  /** Salesforce REST API version segment (e.g. v64.0). */
  const [sfdcApiVersion, setSfdcApiVersion] = useState(SFDC_DEFAULT_API_VERSION);
  /** SObject API name for the audit sub-request URL + referenceId. */
  const [auditSObject, setAuditSObject] = useState(SFDC_DEFAULT_AUDIT_OBJECT);
  /** One or more Salesforce objects (Composite POST bodies); rows assign via checkbox/radio column. */
  const [targetObjects, setTargetObjects] = useState<TargetObjectBlockState[]>(() => [
    createTargetObjectBlock(),
  ]);
  /** Row key → target object block id, or {@link UNASSIGNED_TARGET_ID}. */
  const [rowTargetObjectId, setRowTargetObjectId] = useState<Record<string, string>>({});
  /** Salesforce body field for contact merge (angle-bracket path). */
  const [contactFieldValue, setContactFieldValue] = useState("<contact.Id>");
  /** Decision Manager `arrayPath` for the main SObject block — only exported when non-empty (or use “Fill from service name”). */
  const [arrayPath, setArrayPath] = useState("");
  /** Prefix shared by all paths under the array (e.g. body.body[*].) — used to build ((current.field)) expressions. */
  const [stripPrefix, setStripPrefix] = useState("");
  /** When true, export fills missing stamping expressions as ((current.<relative path>)) using stripPrefix. */
  const [useCurrentExpressions, setUseCurrentExpressions] = useState(false);

  const [sfStatus, setSfStatus] = useState<SalesforceStatusResponse | null>(null);
  const [sfStatusLoading, setSfStatusLoading] = useState(true);
  const [sfStatusError, setSfStatusError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSfStatusLoading(true);
    setSfStatusError(null);
    void (async () => {
      try {
        const s = await fetchSalesforceStatus();
        if (!cancelled) {
          setSfStatus(s);
          setSfStatusError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setSfStatus(null);
          setSfStatusError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setSfStatusLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Org-wide SObjects from Salesforce global describe — datalist autofill for Object API name (+ Audit). */
  const [globalSObjects, setGlobalSObjects] = useState<SalesforceGlobalSObjectRow[]>([]);

  useEffect(() => {
    if (!sfStatus?.connected) {
      setGlobalSObjects([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const rows = await fetchSalesforceSObjectList();
        if (!cancelled) setGlobalSObjects(rows);
      } catch {
        if (!cancelled) setGlobalSObjects([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sfStatus?.connected]);

  const loadOrgFieldsForBlock = useCallback(async (blockId: string) => {
    const block = targetObjects.find((b) => b.id === blockId);
    const obj = block?.sObjectApiName.trim();
    if (!obj) {
      setTargetObjects((prev) =>
        prev.map((b) =>
          b.id === blockId
            ? { ...b, describeError: "Set Object API name first (e.g. Multibureau_Data__c)." }
            : b,
        ),
      );
      return;
    }
    setTargetObjects((prev) =>
      prev.map((b) =>
        b.id === blockId ? { ...b, describeLoading: true, describeError: null } : b,
      ),
    );
    try {
      const d = await fetchSalesforceDescribe(obj);
      const names = [...new Set(d.fields.map((f) => f.name).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
      );
      setTargetObjects((prev) =>
        prev.map((b) =>
          b.id === blockId
            ? {
                ...b,
                describeFields: d.fields,
                fieldNames: names,
                describeSourceObject: d.sobject,
                sObjectApiName: d.sobject,
                describeLoading: false,
                describeError: null,
              }
            : b,
        ),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTargetObjects((prev) =>
        prev.map((b) =>
          b.id === blockId
            ? {
                ...b,
                describeFields: [],
                fieldNames: [],
                describeSourceObject: "",
                describeLoading: false,
                describeError: msg,
              }
            : b,
        ),
      );
    }
  }, [targetObjects]);

  const targetObjectDescribeFingerprint = useMemo(
    () => targetObjects.map((b) => `${b.id}:${b.sObjectApiName}`).join("|"),
    [targetObjects],
  );

  /** Invalidate per-block describe when Object API name diverges from loaded describe. */
  useEffect(() => {
    setTargetObjects((prev) =>
      prev.map((b) => {
        const t = b.sObjectApiName.trim();
        if (!b.describeSourceObject) return b;
        if (t.toLowerCase() !== b.describeSourceObject.toLowerCase()) {
          return {
            ...b,
            describeFields: [],
            fieldNames: [],
            describeSourceObject: "",
            describeError: null,
          };
        }
        return b;
      }),
    );
  }, [targetObjectDescribeFingerprint]);

  /** MiniSearch index per object describe — Org match column uses row's assigned object. */
  const describeIndexByBlockId = useMemo(() => {
    const m = new Map<string, ReturnType<typeof buildDescribeFieldIndex>>();
    for (const b of targetObjects) {
      if (b.describeFields.length > 0) m.set(b.id, buildDescribeFieldIndex(b.describeFields));
    }
    return m;
  }, [targetObjects]);

  const corpus = useMemo(() => {
    const live = buildSfdcStampingCorpus(bundle.sfdcMappings);
    if (live.meta.leafPaths >= 80) return live;
    return mergeCorpusIndexes(
      corpusIndexFromJSON(sfdcStampingCorpusSeed as CorpusIndexJSON),
      live,
    );
  }, [bundle.sfdcMappings]);

  const sfFieldCorpus = useMemo(() => {
    const live = buildSfFieldCorpus(bundle.sfdcMappings);
    if (live.meta.leafPaths >= 80) return live;
    return mergeSfFieldCorpusIndexes(
      sfFieldCorpusFromJSON(sfdcFieldNameCorpusSeed as SfFieldCorpusIndexJSON),
      live,
    );
  }, [bundle.sfdcMappings]);

  const auditLogUrlComputed = useMemo(
    () => salesforceSobjectRestUrl(sfdcApiVersion, auditSObject),
    [sfdcApiVersion, auditSObject],
  );

  /** SObject names mined from loaded Data Stamping rows (for datalist + chip autofill). */
  const sobjectNameSuggestions = useMemo(
    () => collectSobjectApiNamesFromMappings(bundle.sfdcMappings),
    [bundle.sfdcMappings],
  );

  /** Global org + corpus names for <datalist> on Object API name and Audit SObject. */
  const mergedSobjectDatalistEntries = useMemo(() => {
    const byName = new Map<string, string>();
    for (const row of globalSObjects) {
      byName.set(row.name, row.label);
    }
    for (const { name } of sobjectNameSuggestions) {
      if (!byName.has(name)) byName.set(name, name);
    }
    return [...byName.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, label]) => ({ name, label }));
  }, [globalSObjects, sobjectNameSuggestions]);

  const parsed = useMemo(() => {
    if (!raw.trim()) return { ok: false as const, error: "Paste JSON first." };
    const j = parseJsonObject(raw);
    if (!j.ok) return { ok: false as const, error: j.error };
    if (j.value === null || typeof j.value !== "object") {
      return { ok: false as const, error: "Root must be a JSON object." };
    }
    return { ok: true as const, value: j.value as Record<string, unknown> };
  }, [raw]);

  const rows = useMemo((): MapperTableRow[] => {
    const out: MapperTableRow[] = [];
    if (parsed.ok) {
      for (const r of collectKeys(parsed.value, mode)) {
        out.push({
          key: `pri:${r.path}`,
          source: "primary",
          leafPath: r.path,
          sample: r.sample,
          kind: r.kind,
        });
      }
    }
    for (const block of extraApis) {
      if (!block.raw.trim()) continue;
      const j = parseJsonObject(block.raw);
      if (
        !j.ok ||
        j.value === null ||
        typeof j.value !== "object" ||
        Array.isArray(j.value)
      ) {
        continue;
      }
      for (const r of collectKeys(j.value as Record<string, unknown>, mode)) {
        out.push({
          key: secondaryRowKey(block.id, r.path),
          source: "secondary",
          extraApiId: block.id,
          leafPath: r.path,
          sample: r.sample,
          kind: r.kind,
        });
      }
    }
    return out;
  }, [parsed, extraApis, mode]);

  /** Src column: API 1 = primary, API 2+ = extra blocks in order. */
  const extraApiSrcLabelById = useMemo(() => {
    const m = new Map<string, string>();
    extraApis.forEach((b, i) => m.set(b.id, String(i + 2)));
    return m;
  }, [extraApis]);

  useEffect(() => {
    const keys = rows.map((r) => r.key);
    const keySet = new Set(keys);
    setExpressions((prev) => {
      const next = { ...prev };
      for (const k of keys) {
        if (next[k] === undefined) next[k] = "";
      }
      for (const k of Object.keys(next)) {
        if (!keySet.has(k)) delete next[k];
      }
      return next;
    });
    setSfFields((prev) => {
      const next = { ...prev };
      for (const k of keys) {
        if (next[k] === undefined) next[k] = "";
      }
      for (const k of Object.keys(next)) {
        if (!keySet.has(k)) delete next[k];
      }
      return next;
    });
  }, [rows]);

  /** Default new paths to object 1; drop stale ids when an object block is removed. */
  useEffect(() => {
    const defaultId = targetObjects[0]?.id;
    if (!defaultId) return;
    const ids = new Set(targetObjects.map((t) => t.id));
    setRowTargetObjectId((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if (next[r.key] === undefined) next[r.key] = defaultId;
        const cur = next[r.key];
        if (cur && cur !== UNASSIGNED_TARGET_ID && !ids.has(cur)) {
          next[r.key] = defaultId;
        }
      }
      for (const k of Object.keys(next)) {
        if (!rows.some((row) => row.key === k)) delete next[k];
      }
      return next;
    });
  }, [rows, targetObjects]);

  const getSfdcMapperPathDoc = useCallback(
    (r: MapperTableRow) => {
      let sampleText = "";
      try {
        sampleText =
          typeof r.sample === "object" && r.sample !== null
            ? JSON.stringify(r.sample).slice(0, 3500)
            : String(r.sample ?? "");
      } catch {
        sampleText = "";
      }
      const secondarySvc =
        r.source === "secondary" && r.extraApiId
          ? extraApis.find((b) => b.id === r.extraApiId)?.serviceName ?? ""
          : "";
      return {
        id: r.key,
        text: [
          r.leafPath,
          r.source,
          r.kind,
          sampleText,
          secondarySvc,
        ].join(" "),
      };
    },
    [extraApis],
  );
  const [pathFilter, setPathFilter, filteredRows] = useSemanticRowFilter(rows, getSfdcMapperPathDoc);

  const unmatchedRows = useMemo(
    () => rows.filter((r) => rowTargetObjectId[r.key] === UNASSIGNED_TARGET_ID),
    [rows, rowTargetObjectId],
  );

  /**
   * Same SF field on the same target object from multiple paths — that object's body keeps one key
   * (last row in table order wins). Unmatched paths are ignored.
   */
  const duplicateSfFieldConflicts = useMemo(() => {
    const defaultBid = targetObjects[0]?.id ?? "";
    const byBlock = new Map<string, Map<string, string[]>>();
    for (const r of rows) {
      const a = rowTargetObjectId[r.key];
      const assigned =
        a === UNASSIGNED_TARGET_ID ? UNASSIGNED_TARGET_ID : (a ?? defaultBid);
      if (assigned === UNASSIGNED_TARGET_ID) continue;
      const sf = sfFields[r.key]?.trim() ?? "";
      if (!sf) continue;
      let fm = byBlock.get(assigned);
      if (!fm) {
        fm = new Map();
        byBlock.set(assigned, fm);
      }
      const list = fm.get(sf) ?? [];
      list.push(r.leafPath);
      fm.set(sf, list);
    }
    const out: { field: string; paths: string[]; objectLabel: string }[] = [];
    for (const [bid, fm] of byBlock) {
      const obj = targetObjects.find((t) => t.id === bid);
      const objectLabel = obj?.sObjectApiName.trim() || "object";
      for (const [field, paths] of fm) {
        if (paths.length > 1) out.push({ field, paths, objectLabel });
      }
    }
    return out.sort(
      (a, b) =>
        a.objectLabel.localeCompare(b.objectLabel) || a.field.localeCompare(b.field),
    );
  }, [rows, sfFields, rowTargetObjectId, targetObjects]);

  const commonPathPrefixGuess = useMemo(() => {
    const primaryLeaves = rows.filter((r) => r.source === "primary").map((r) => r.leafPath);
    if (primaryLeaves.length < 2) return "";
    return longestCommonPathPrefix(primaryLeaves);
  }, [rows]);

  const primaryRowKeysInOrder = useMemo(
    () => rows.filter((r) => r.source === "primary").map((r) => r.key),
    [rows],
  );

  /**
   * Service key for ((Name.*)), arrayPath auto-fill, and DB row — Export field wins, else arrayPath
   * segment, else first `Service` in primary stamping expressions (e.g. ((NTCModel.response…))), else placeholder.
   */
  const resolvedServiceName = useMemo(() => {
    return (
      newServiceName.trim() ||
      serviceNameFromArrayPath(arrayPath) ||
      inferServiceNameFromPrimaryExpressions(expressions, primaryRowKeysInOrder) ||
      "YourService"
    );
  }, [newServiceName, arrayPath, expressions, primaryRowKeysInOrder]);

  /**
   * Auto-fill `arrayPath` as `{service}.response.body.body` only when DM row-per-array-element flow is likely:
   * Dynamic arrays mode, a resolved service name, and no extra API JSON (mixed-service / Multibureau-style mappings skip auto-fill).
   */
  const arrayPathAutoApplicable = useMemo(
    () =>
      mode === "array-wildcards" &&
      resolvedServiceName.trim() !== "" &&
      resolvedServiceName !== "YourService" &&
      !extraApis.some((b) => b.raw.trim()),
    [mode, resolvedServiceName, extraApis],
  );

  const lastAutoArrayPathRef = useRef("");

  useEffect(() => {
    if (!arrayPathAutoApplicable) {
      const autoSnapshot = lastAutoArrayPathRef.current;
      setArrayPath((prev) => (prev === autoSnapshot ? "" : prev));
      lastAutoArrayPathRef.current = "";
      return;
    }
    const suggested = defaultArrayPathForService(resolvedServiceName.trim());
    setArrayPath((prev) => {
      if (prev === "" || prev === lastAutoArrayPathRef.current) {
        lastAutoArrayPathRef.current = suggested;
        return suggested;
      }
      return prev;
    });
  }, [arrayPathAutoApplicable, resolvedServiceName]);

  const exportPayload = useMemo(() => {
    if (!parsed.ok) return null;
    const svc = resolvedServiceName;
    const resolvedArrayPath = arrayPath.trim();

    const pathsWithSf = rows
      .filter((r) => (sfFields[r.key]?.trim() ?? "").length > 0)
      .map((r) => r.leafPath);
    const prefixForCurrentExport =
      stripPrefix.trim() ||
      (pathsWithSf.length > 0 ? longestCommonPathPrefix(pathsWithSf) : "");

    const prefix = stripPrefix.trim();
    const defaultBid = targetObjects[0]?.id ?? "";

    const buildExprForRow = (r: MapperTableRow): string | null => {
      let expr = expressions[r.key]?.trim() ?? "";
      if (!expr && useCurrentExpressions && prefix && r.source === "primary") {
        const rel = relativePathAfterPrefix(r.leafPath, prefix);
        if (rel) {
          const cur = formatCurrentItemExpression(rel);
          if (cur) expr = cur;
        }
      }
      if (!expr) return null;

      if (
        resolvedArrayPath.trim() &&
        prefixForCurrentExport &&
        r.source === "primary"
      ) {
        const rel = relativePathAfterPrefix(r.leafPath, prefixForCurrentExport);
        if (rel) expr = formatCurrentItemExpression(rel);
      }
      return expr;
    };

    const stampBlocks: BureauStampObjectBlock[] = [];
    for (const objBlock of targetObjects) {
      const bid = objBlock.id;
      const aScoreBody: Record<string, string> = {};
      for (const r of rows) {
        const a = rowTargetObjectId[r.key];
        const assigned =
          a === UNASSIGNED_TARGET_ID ? UNASSIGNED_TARGET_ID : (a ?? defaultBid);
        if (assigned === UNASSIGNED_TARGET_ID) continue;
        if (assigned !== bid) continue;
        const sf = sfFields[r.key]?.trim() ?? "";
        if (!sf) continue;
        const expr = buildExprForRow(r);
        if (!expr) continue;
        aScoreBody[sf] = expr;
      }
      stampBlocks.push({
        blockId: bid,
        arraySObjectApiName: objBlock.sObjectApiName,
        aScoreUrl: salesforceSobjectRestUrl(sfdcApiVersion, objBlock.sObjectApiName),
        body: aScoreBody,
        arrayPath: resolvedArrayPath,
      });
    }

    const arr = buildBureauStyleRequestBodyMulti(svc, stampBlocks, {
      includeAuditLog,
      auditLogUrl: auditLogUrlComputed,
      auditSObjectApiName: auditSObject,
      contactField: contactFieldValue.trim() || "<contact.Id>",
    });
    if (arr.length === 0) return { empty: true as const };
    return { empty: false as const, obj: arr };
  }, [
    parsed,
    rows,
    expressions,
    sfFields,
    useCurrentExpressions,
    stripPrefix,
    arrayPath,
    resolvedServiceName,
    includeAuditLog,
    auditLogUrlComputed,
    auditSObject,
    contactFieldValue,
    targetObjects,
    rowTargetObjectId,
    sfdcApiVersion,
  ]);

  const exportJson = useMemo(() => {
    if (!exportPayload || exportPayload.empty) return "";
    return stringifyJson(exportPayload.obj);
  }, [exportPayload]);

  const mapperExportParsed = useMemo(
    () => parseSfdcMapperExport(exportJson),
    [exportJson],
  );

  const pushRowDraft = useMemo((): ServiceSfdcFieldMapping | null => {
    if (!mapperExportParsed.ok) return null;
    return buildSfdcMappingRowFromMapperExport(
      createEmptySfdcMapping(),
      resolvedServiceName,
      mapperExportParsed,
      { compositeUrl: "", compositeMethod: "POST" },
    );
  }, [mapperExportParsed, resolvedServiceName, createEmptySfdcMapping]);

  const pushValidation = useMemo(() => {
    if (!pushRowDraft) return { ok: false as const, errors: [] as string[] };
    return validateSfdcMapping(pushRowDraft);
  }, [pushRowDraft]);

  const canPushToDb =
    apiMode &&
    mapperExportParsed.ok &&
    (newServiceName.trim().length > 0 || arrayPath.trim().length > 0) &&
    pushValidation.ok;

  const closePushModal = useCallback(() => {
    setPushStep(0);
    setConfirmServiceName("");
  }, []);

  const runPushToDb = useCallback(async () => {
    if (!pushRowDraft || !pushValidation.ok) return;
    setPushing(true);
    clearError();
    setPushBanner(null);
    try {
      await upsertSfdcMapping(pushRowDraft);
      closePushModal();
      const name = pushRowDraft.service_name;
      setNewServiceName("");
      const ap = arrayPath.trim();
      setPushBanner(
        `New Data Stamping row “${name}” saved (${Array.isArray(pushRowDraft.request_body) ? pushRowDraft.request_body.length : 0} Composite sub-request(s)${ap ? `; arrayPath: ${ap}` : " (no arrayPath)"}). Review under Data Stamping.`,
      );
      window.setTimeout(() => setPushBanner(null), 8000);
    } catch {
      /* Layout shows API error */
    } finally {
      setPushing(false);
    }
  }, [
    pushRowDraft,
    pushValidation.ok,
    upsertSfdcMapping,
    clearError,
    closePushModal,
    arrayPath,
  ]);

  const copyExport = useCallback(async () => {
    if (!exportJson) return;
    await navigator.clipboard.writeText(exportJson);
  }, [exportJson]);

  const applyTopExpressionSuggestions = useCallback(() => {
    const primaryApi = newServiceName.trim();
    setExpressions((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if ((next[r.key] ?? "").trim()) continue;
        const sug = getSuggestionsForPath(r.leafPath, corpus, 1)[0];
        if (!sug) continue;
        let api = primaryApi;
        if (r.source === "secondary" && r.extraApiId) {
          api = extraApis.find((b) => b.id === r.extraApiId)?.serviceName.trim() ?? "";
        }
        next[r.key] = api
          ? stampFirstServicePrefixInExpression(sug.expression, api)
          : sug.expression;
      }
      return next;
    });
  }, [rows, corpus, newServiceName, extraApis]);

  const applyTopSfFieldSuggestions = useCallback(() => {
    setSfFields((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if ((next[r.key] ?? "").trim()) continue;
        const sug = getSfFieldSuggestionsForPath(r.leafPath, sfFieldCorpus, 1)[0];
        if (sug) next[r.key] = sug.field;
      }
      return next;
    });
  }, [rows, sfFieldCorpus]);

  /** ((PrimaryService.leafPath)) for empty primary rows — e.g. ((CIBIL.response.body…)). */
  const applyPrimaryServicePathExpressions = useCallback(() => {
    const name = resolvedServiceName.trim();
    if (!name || name === "YourService") return;
    setExpressions((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if (r.source !== "primary") continue;
        if ((next[r.key] ?? "").trim()) continue;
        next[r.key] = `((${name}.${r.leafPath}))`;
      }
      return next;
    });
  }, [rows, resolvedServiceName]);

  /** ((service_name.leafPath)) for empty secondary rows — uses each block's API name. */
  const applySecondaryServicePathExpressions = useCallback(() => {
    setExpressions((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if (r.source !== "secondary" || !r.extraApiId) continue;
        if ((next[r.key] ?? "").trim()) continue;
        const name =
          extraApis.find((b) => b.id === r.extraApiId)?.serviceName.trim() ?? "";
        if (!name) continue;
        next[r.key] = `((${name}.${r.leafPath}))`;
      }
      return next;
    });
  }, [rows, extraApis]);

  const applyStripPrefixGuess = useCallback(() => {
    if (commonPathPrefixGuess) setStripPrefix(commonPathPrefixGuess);
  }, [commonPathPrefixGuess]);

  /** Writes ((current.*)) into expression cells where empty (same rules as export). */
  const applyCurrentExpressionsToEmpty = useCallback(() => {
    const prefix = stripPrefix.trim();
    if (!prefix || !useCurrentExpressions) return;
    setExpressions((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if (r.source !== "primary") continue;
        if ((next[r.key] ?? "").trim()) continue;
        const rel = relativePathAfterPrefix(r.leafPath, prefix);
        if (rel) next[r.key] = formatCurrentItemExpression(rel);
      }
      return next;
    });
  }, [rows, stripPrefix, useCurrentExpressions]);

  /** Rewrites first ((Service. segment on primary rows to match API name (blur). */
  const stampPrimaryExpressionsFromApiName = useCallback(() => {
    const api = newServiceName.trim();
    if (!api) return;
    setExpressions((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const k of Object.keys(next)) {
        if (!k.startsWith("pri:")) continue;
        const u = stampFirstServicePrefixInExpression(next[k] ?? "", api);
        if (u !== next[k]) {
          next[k] = u;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [newServiceName]);

  /** Rewrites first ((Service. segment for one extra-API block (blur on that block's service name). */
  const stampExpressionsForExtraApi = useCallback((blockId: string, apiRaw: string) => {
    const api = apiRaw.trim();
    if (!api) return;
    const prefix = `sec:${blockId}:`;
    setExpressions((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const k of Object.keys(next)) {
        if (!k.startsWith(prefix)) continue;
        const u = stampFirstServicePrefixInExpression(next[k] ?? "", api);
        if (u !== next[k]) {
          next[k] = u;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  return (
    <PageStack className="space-y-5">
      <PageHero
        eyebrow="Mapper"
        eyebrowClassName="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-muted"
        title="API → Salesforce stamping"
        titleClassName="text-xl font-semibold tracking-tight text-ink"
        description={
          <p>
            Paste JSON, map paths to SF fields and expressions. Use <strong className="font-medium text-ink">Add API</strong> when more than one External API supplies fields on the same row.
          </p>
        }
      />

      <div className={`${panelClass} space-y-2`}>
        <div>
          <h3 className="text-sm font-medium text-ink">API name</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
            Same as <strong className="font-medium text-ink">External APIs → service_name</strong>. Used for export and{" "}
            <strong className="font-medium text-ink">Primary ((Name.path))</strong>; blank infers from expressions. Optional{" "}
            <strong className="font-medium text-ink">Bulk fill → Past templates</strong> pulls transforms from saved configs (not derivable from JSON alone).
          </p>
        </div>
        <label className="flex max-w-[min(100%,28rem)] flex-col gap-1 text-[11px] text-ink-muted">
          <span className="font-medium text-ink">service_name</span>
          <input
            type="text"
            value={newServiceName}
            onChange={(e) => setNewServiceName(e.target.value)}
            onBlur={stampPrimaryExpressionsFromApiName}
            placeholder="e.g. BureauF, BureauBS_Ascore, NTCModel"
            autoComplete="off"
            spellCheck={false}
            className="rounded border border-ink/12 bg-white px-2 py-1.5 font-mono text-[13px]"
            aria-label="ESA API service name for stamping expressions and export"
            title="First ((Name. segment in primary expressions is stamped with this value on blur."
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-ink/[0.06] pb-3 text-xs">
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
            sfStatus?.connected ? "bg-emerald-500" : "bg-ink/25"
          }`}
          aria-hidden
        />
        <span className="text-ink-muted">
          {sfStatusLoading
            ? "Salesforce…"
            : sfStatusError
              ? sfStatusError
              : sfStatus && !sfStatus.configured
                ? "Salesforce not configured (server/.env)"
                : sfStatus && sfStatus.configured && !sfStatus.connected
                  ? `Login failed: ${sfStatus.error ?? "?"}`
                  : sfStatus?.connected
                    ? `${sfStatus.usernameMasked} · ${sfStatus.apiVersion}`
                    : "—"}
        </span>
      </div>

      <div className={panelClass}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium text-ink">Salesforce objects</h3>
            <p className="mt-1 max-w-[42rem] text-[11px] leading-relaxed text-ink-muted">
              One export can POST to multiple objects. Use the table columns to assign each API path to an object;{" "}
              <strong className="font-medium text-ink">Load org fields</strong> per object for SalesForce Matches + field datalist. Start with one object — same flow as before.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setTargetObjects((prev) => [...prev, createTargetObjectBlock("")])}
            className="shrink-0 rounded border border-ink/12 bg-white px-2.5 py-1.5 text-[11px] font-medium text-ink hover:bg-surface-2"
          >
            Add object
          </button>
        </div>
        {globalSObjects.length > 0 ? (
          <p className="mt-2 text-[10px] text-ink-muted/80">{globalSObjects.length} SObjects in autofill</p>
        ) : null}
        <div className="mt-3 space-y-3">
          {targetObjects.map((block, bi) => (
            <div
              key={block.id}
              className="rounded-lg border border-ink/10 bg-white/90 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-ink">
                  Object {bi + 1}
                  {targetObjects.length > 1 ? (
                    <button
                      type="button"
                      disabled={bi === 0}
                      onClick={() => {
                        if (bi === 0) return;
                        setTargetObjects((prev) => prev.filter((b) => b.id !== block.id));
                      }}
                      className="ml-2 rounded border border-ink/12 px-1.5 py-0.5 text-[10px] font-normal text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30"
                    >
                      Remove
                    </button>
                  ) : null}
                </span>
                <span className="break-all font-mono text-[10px] text-ink-muted/90">
                  {salesforceSobjectRestUrl(sfdcApiVersion, block.sObjectApiName) || "—"}
                </span>
              </div>
              <label className="mt-2 flex max-w-[min(100%,28rem)] flex-col gap-0.5 text-[11px] text-ink-muted">
                <span className="font-medium text-ink">Object API name</span>
                <input
                  type="text"
                  list="sfdc-sobject-names"
                  value={block.sObjectApiName}
                  onChange={(e) =>
                    setTargetObjects((prev) =>
                      prev.map((b) =>
                        b.id === block.id ? { ...b, sObjectApiName: e.target.value } : b,
                      ),
                    )
                  }
                  placeholder={SFDC_DEFAULT_ARRAY_TARGET_OBJECT}
                  className="rounded border border-ink/12 bg-white px-2 py-1.5 font-mono text-[13px]"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={`Salesforce object ${bi + 1}`}
                  title="Autofill when connected; pick a valid API name before Load org fields."
                />
              </label>
              {sobjectNameSuggestions.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-0.5">
                  {sobjectNameSuggestions.slice(0, 12).map(({ name, count }) => (
                    <button
                      key={`${block.id}-${name}`}
                      type="button"
                      title={`${count}×`}
                      onClick={() =>
                        setTargetObjects((prev) =>
                          prev.map((b) =>
                            b.id === block.id ? { ...b, sObjectApiName: name } : b,
                          ),
                        )
                      }
                      className="rounded border border-ink/8 px-1.5 py-0.5 font-mono text-[10px] hover:bg-surface-2"
                    >
                      {name}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={
                    sfStatusLoading || !sfStatus?.connected || !block.sObjectApiName.trim()
                  }
                  onClick={() => void loadOrgFieldsForBlock(block.id)}
                  className="rounded border border-ink/12 px-2 py-1 text-[11px] text-ink hover:bg-surface-2 disabled:opacity-40"
                  title="Describe this object — Org match + Field datalist for rows assigned here"
                >
                  {block.describeLoading ? "…" : "Load org fields"}
                </button>
                {block.describeError ? (
                  <span className="text-[11px] text-warn">{block.describeError}</span>
                ) : null}
                {block.fieldNames.length > 0 ? (
                  <span className="text-[11px] text-ink-muted">
                    <span className="tabular-nums">{block.fieldNames.length}</span> fields ·{" "}
                    <code className="font-mono text-[10px]">{block.describeSourceObject}</code>
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      <datalist id="sfdc-sobject-names">
        {mergedSobjectDatalistEntries.map(({ name, label }) => (
          <option key={name} value={name}>
            {label && label !== name ? label : name}
          </option>
        ))}
      </datalist>

      {targetObjects.map((b) =>
        b.fieldNames.length > 0 ? (
          <datalist key={b.id} id={`sfdc-org-fields-${b.id}`}>
            {b.fieldNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        ) : null,
      )}

      <div className={panelClass}>
        <TextArea
          label="Primary JSON"
          hint="Root object from your service."
          rows={10}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              setRaw(stringifyJson(sfdcAutoMapperSampleResponse as unknown))
            }
            className="rounded border border-ink/12 px-2 py-1 text-[11px] text-ink-muted hover:bg-surface-2 hover:text-ink"
          >
            Sample
          </button>
          <button
            type="button"
            onClick={() => setRaw("")}
            className="rounded border border-ink/12 px-2 py-1 text-[11px] text-ink-muted hover:bg-surface-2 hover:text-ink"
          >
            Clear
          </button>
        </div>
        {!parsed.ok && raw.trim() ? (
          <p className="mt-2 text-sm text-warn">
            {(parsed as { ok: false; error: string }).error}
          </p>
        ) : null}
      </div>

      <div className={panelClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-ink">Additional APIs (optional)</h3>
            <p className="mt-1 max-w-[42rem] text-[11px] leading-relaxed text-ink-muted">
              Only when multiple External APIs contribute to the same mapping. Each block is like Primary JSON plus its own{" "}
              <code className="font-mono text-[10px]">service_name</code> for{" "}
              <code className="font-mono text-[10px]">((Name.path))</code>. Skip this section if you only use one API.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setExtraApis((prev) => [...prev, createExtraApiBlock()])}
            className="shrink-0 rounded border border-ink/12 bg-white px-2.5 py-1.5 text-[11px] font-medium text-ink hover:bg-surface-2"
          >
            Add API
          </button>
        </div>
        {extraApis.length === 0 ? (
          <p className="mt-3 text-[11px] text-ink-muted">No extra APIs — table lists paths from Primary JSON only.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {extraApis.map((block, idx) => {
              const extraJsonError =
                block.raw.trim() === ""
                  ? null
                  : (() => {
                      const j = parseJsonObject(block.raw);
                      if (!j.ok) return j.error;
                      if (
                        j.value === null ||
                        typeof j.value !== "object" ||
                        Array.isArray(j.value)
                      ) {
                        return "Root must be a JSON object.";
                      }
                      return null;
                    })();
              return (
                <div
                  key={block.id}
                  className="rounded-lg border border-ink/10 bg-white/80 p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-ink">
                      API {idx + 2}{" "}
                      <span className="font-normal text-ink-muted">(extra sample)</span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setExtraApis((list) => list.filter((b) => b.id !== block.id))
                      }
                      className="rounded border border-ink/12 px-2 py-0.5 text-[11px] text-ink-muted hover:bg-surface-2 hover:text-ink"
                    >
                      Remove
                    </button>
                  </div>
                  <TextArea
                    label={`JSON`}
                    hint={`Merged as secondary paths. Match External APIs → service_name for API ${idx + 2}.`}
                    rows={6}
                    value={block.raw}
                    onChange={(e) =>
                      setExtraApis((list) =>
                        list.map((b) =>
                          b.id === block.id ? { ...b, raw: e.target.value } : b,
                        ),
                      )
                    }
                  />
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="flex min-w-[12rem] flex-1 flex-col gap-0.5 text-[11px] text-ink-muted">
                      <span>ESA service_name</span>
                      <input
                        type="text"
                        value={block.serviceName}
                        onChange={(e) =>
                          setExtraApis((list) =>
                            list.map((b) =>
                              b.id === block.id ? { ...b, serviceName: e.target.value } : b,
                            ),
                          )
                        }
                        onBlur={(e) =>
                          stampExpressionsForExtraApi(block.id, e.target.value)
                        }
                        placeholder="e.g. BureauF"
                        title="First ((Name. segment in this block's rows is stamped on blur."
                        className="rounded border border-ink/12 bg-white px-2 py-1 font-mono text-[11px]"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setExtraApis((list) =>
                          list.map((b) => (b.id === block.id ? { ...b, raw: "" } : b)),
                        )
                      }
                      className="rounded border border-ink/12 px-2 py-1 text-[11px] text-ink-muted hover:bg-surface-2"
                    >
                      Clear JSON
                    </button>
                  </div>
                  {extraJsonError ? (
                    <p className="mt-2 text-sm text-warn">{extraJsonError}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {parsed.ok ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5 border-b border-ink/[0.04] pb-1.5 text-[11px] leading-tight">
            <label className="flex shrink-0 items-center text-ink-muted">
              <span className="sr-only">Granularity</span>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as FlattenMode)}
                className="rounded border border-ink/12 bg-white py-0.5 pr-6 pl-1.5 font-medium text-[11px]"
              >
                <option value="array-wildcards">Dynamic arrays [*]</option>
                <option value="all-leaves">All leaves</option>
                <option value="top-level">Top-level only</option>
              </select>
            </label>
            <input
              type="search"
              placeholder="Filter paths…"
              value={pathFilter}
              onChange={(e) => setPathFilter(e.target.value)}
              className="w-[10.5rem] shrink-0 rounded border border-ink/12 bg-white px-1.5 py-0.5 font-mono text-[11px] outline-none focus:border-ink/25 sm:w-[12rem]"
            />
            <span className="shrink-0 tabular-nums text-[10px] text-ink-muted">
              {filteredRows.length}/{rows.length}
            </span>
            <details className="relative ml-auto shrink-0">
              <summary className="cursor-pointer list-none rounded border border-ink/12 px-1.5 py-0.5 text-[11px] text-ink-muted hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
                Bulk fill
                <span className="ml-1 tabular-nums text-[10px] text-ink-muted/70">
                  · corpus {corpus.meta.leafPaths}
                </span>
              </summary>
              <div className="absolute right-0 z-10 mt-1 flex w-[min(22rem,calc(100vw-2rem))] min-w-[18rem] flex-col gap-0.5 rounded border border-ink/12 bg-white p-2 shadow-lg">
                <button
                  type="button"
                  onClick={applyPrimaryServicePathExpressions}
                  disabled={!resolvedServiceName.trim() || resolvedServiceName === "YourService"}
                  className="rounded px-2 py-1.5 text-left text-[11px] leading-snug hover:bg-surface-2 disabled:opacity-40"
                  title="((service_name.response…)) from path + API name — default starting point"
                >
                  Primary ((Name.path))
                </button>
                <button
                  type="button"
                  onClick={applySecondaryServicePathExpressions}
                  disabled={
                    !extraApis.some((b) => {
                      if (!b.serviceName.trim() || !b.raw.trim()) return false;
                      const j = parseJsonObject(b.raw);
                      return (
                        j.ok &&
                        j.value !== null &&
                        typeof j.value === "object" &&
                        !Array.isArray(j.value)
                      );
                    })
                  }
                  className="rounded px-2 py-1.5 text-left text-[11px] leading-snug hover:bg-surface-2 disabled:opacity-40"
                  title="((service_name.path)) for empty rows — uses each extra API's service_name"
                >
                  Extra APIs ((Name.path))
                </button>
                <button
                  type="button"
                  onClick={applyTopExpressionSuggestions}
                  className="rounded px-2 py-1.5 text-left text-[11px] leading-snug hover:bg-surface-2"
                  title="Only empty rows; uses historical templates (e.g. serializeJson) — stamp uses API name"
                >
                  Past templates (expressions)
                </button>
                <button
                  type="button"
                  onClick={applyTopSfFieldSuggestions}
                  className="rounded px-2 py-1.5 text-left text-[11px] leading-snug hover:bg-surface-2"
                  title="Only empty rows; SF field names from corpus"
                >
                  SF fields (best match)
                </button>
              </div>
            </details>
          </div>

          <div className="space-y-2 rounded-lg border border-ink/8 p-3 text-[12px]">
            <p className="text-[11px] text-ink-muted">
              <strong className="font-medium text-ink">Dynamic arrays</strong>: one primary sample + API name →{" "}
              <code className="font-mono text-[10px]">arrayPath</code> often{" "}
              <code className="font-mono text-[10px]">{"{service}.response.body.body"}</code>. Extra API JSON clears it. Use{" "}
              <strong className="font-medium text-ink">All leaves</strong> / <strong className="font-medium text-ink">Top-level</strong> when DM should not iterate.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-muted">
                <input
                  type="checkbox"
                  checked={useCurrentExpressions}
                  onChange={(e) => setUseCurrentExpressions(e.target.checked)}
                  className="rounded border-ink/25"
                />
                ((current.*)) when empty
              </label>
              <label className="flex min-w-[8rem] flex-1 flex-col gap-0.5 text-[11px] text-ink-muted">
                Strip prefix
                <input
                  type="text"
                  value={stripPrefix}
                  onChange={(e) => setStripPrefix(e.target.value)}
                  placeholder="body.body[*]."
                  className="rounded border border-ink/12 bg-white px-2 py-1 font-mono text-[11px]"
                  autoComplete="off"
                />
              </label>
              <button
                type="button"
                disabled={!commonPathPrefixGuess}
                onClick={applyStripPrefixGuess}
                className="rounded border border-ink/12 px-2 py-1 text-[11px] hover:bg-surface-2 disabled:opacity-40"
                title={commonPathPrefixGuess || "Need at least two paths"}
              >
                Guess
              </button>
              <button
                type="button"
                disabled={!useCurrentExpressions || !stripPrefix.trim()}
                onClick={applyCurrentExpressionsToEmpty}
                className="rounded border border-ink/12 px-2 py-1 text-[11px] hover:bg-surface-2 disabled:opacity-40"
              >
                Fill ((current.*))
              </button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex min-w-[12rem] flex-1 flex-col gap-0.5 text-[11px] text-ink-muted">
                arrayPath
                <input
                  type="text"
                  value={arrayPath}
                  onChange={(e) => setArrayPath(e.target.value)}
                  placeholder="Optional"
                  className="rounded border border-ink/12 bg-white px-2 py-1 font-mono text-[11px]"
                  autoComplete="off"
                />
              </label>
              <button
                type="button"
                disabled={resolvedServiceName === "YourService"}
                onClick={() => {
                  const s = defaultArrayPathForService(resolvedServiceName.trim());
                  lastAutoArrayPathRef.current = s;
                  setArrayPath(s);
                }}
                className="rounded border border-ink/12 px-2 py-1 text-[11px] hover:bg-surface-2 disabled:opacity-40"
                title="ServiceName.response.body.body"
              >
                From service name
              </button>
            </div>
          </div>

          {duplicateSfFieldConflicts.length > 0 ? (
            <div
              className="rounded border border-warn/30 bg-warn/[0.06] px-2 py-1.5 text-[11px] text-ink"
              role="status"
            >
              <p className="text-warn">Duplicate SF fields (same object) — last row wins</p>
              <ul className="mt-1 font-mono text-[10px] text-ink-muted">
                {duplicateSfFieldConflicts.map(({ field, paths, objectLabel }) => (
                  <li key={`${objectLabel}:${field}`}>
                    <span className="text-ink-muted">{objectLabel}</span>
                    {" · "}
                    <span className="text-ink">{field}</span>
                    {": "}
                    {paths.join(" · ")}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <DataTableShell>
            <table className="w-full min-w-[84rem] text-left text-[13px]">
              <thead>
                <tr className={tableListHeadRowClass}>
                  {targetObjects.map((b, bi) => (
                    <th
                      key={b.id}
                      className="w-9 px-0.5 py-2 text-center align-bottom text-[10px] font-semibold normal-case tracking-normal text-ink-muted"
                      title={b.sObjectApiName.trim() || `Object ${bi + 1}`}
                    >
                      O{bi + 1}
                    </th>
                  ))}
                  <th
                    className="w-9 px-0.5 py-2 text-center align-bottom text-[10px] font-semibold normal-case tracking-normal text-ink-muted"
                    title="Unmatched — excluded from export"
                  >
                    ∅
                  </th>
                  <th className="px-2 py-2 pr-1 normal-case tracking-normal">Src</th>
                  <th className="py-2 pr-1 pl-2 normal-case tracking-normal">Path</th>
                  <th className="py-2 pr-2 pl-1 normal-case tracking-normal">Sample</th>
                  <th
                    className="px-2 py-2 pr-1 normal-case tracking-normal"
                    title="Historical Data Stamping mappings (corpus)"
                  >
                    Past
                  </th>
                  <th
                    className="px-2 py-2 pr-1 normal-case tracking-normal"
                    title="MiniSearch on assigned object's describe"
                  >
                    SalesForce Matches
                  </th>
                  <th className="px-2 py-2 pr-1 normal-case tracking-normal">Field to be Used</th>
                  <th className="min-w-0 px-2 py-2 pr-1 normal-case tracking-normal">Expression</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/[0.05]">
                {filteredRows.map((r) => {
                  const fieldSug = getSfFieldSuggestionsForPath(r.leafPath, sfFieldCorpus, 4);
                  const defaultObjId = targetObjects[0]?.id ?? "";
                  const rowAssigned =
                    rowTargetObjectId[r.key] === UNASSIGNED_TARGET_ID
                      ? UNASSIGNED_TARGET_ID
                      : (rowTargetObjectId[r.key] ?? defaultObjId);
                  const describeIdx =
                    rowAssigned !== UNASSIGNED_TARGET_ID && rowAssigned
                      ? describeIndexByBlockId.get(rowAssigned)
                      : null;
                  const orgMatches = describeIdx?.search(r.leafPath, 4) ?? [];
                  const fieldListId =
                    rowAssigned !== UNASSIGNED_TARGET_ID &&
                    targetObjects.find((t) => t.id === rowAssigned)?.fieldNames.length
                      ? `sfdc-org-fields-${rowAssigned}`
                      : undefined;
                  return (
                    <tr key={r.key} className="align-top hover:bg-surface-2/40">
                      {targetObjects.map((b) => (
                        <td key={b.id} className="px-0.5 py-1.5 text-center align-middle">
                          <input
                            type="radio"
                            name={`sf-obj-${r.key}`}
                            className="h-3.5 w-3.5 cursor-pointer accent-dm"
                            checked={rowAssigned === b.id}
                            onChange={() =>
                              setRowTargetObjectId((m) => ({ ...m, [r.key]: b.id }))
                            }
                            title={`Include in ${b.sObjectApiName.trim() || "object"}`}
                            aria-label={`Assign path to object ${b.sObjectApiName}`}
                          />
                        </td>
                      ))}
                      <td className="px-0.5 py-1.5 text-center align-middle">
                        <input
                          type="radio"
                          name={`sf-obj-${r.key}`}
                          className="h-3.5 w-3.5 cursor-pointer accent-dm"
                          checked={rowAssigned === UNASSIGNED_TARGET_ID}
                          onChange={() =>
                            setRowTargetObjectId((m) => ({
                              ...m,
                              [r.key]: UNASSIGNED_TARGET_ID,
                            }))
                          }
                          title="Unmatched — not exported"
                          aria-label="No Salesforce object"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-[11px] text-ink-muted">
                        {r.source === "primary"
                          ? "1"
                          : r.extraApiId
                            ? (extraApiSrcLabelById.get(r.extraApiId) ?? "—")
                            : "—"}
                      </td>
                      <td className="break-words py-1.5 pr-1 pl-2 font-mono text-[11px] leading-snug text-ink">
                        {r.leafPath}
                      </td>
                      <td className="truncate py-1.5 pr-2 pl-1 font-mono text-[11px] text-ink-muted" title={String(r.sample)}>
                        {previewSample(r.sample)}
                      </td>
                      <td className="max-w-[14rem] overflow-hidden px-2 py-1.5 align-top">
                        {fieldSug.length === 0 ? (
                          <span className="text-[11px] text-ink-muted">—</span>
                        ) : (
                          <div className="flex flex-wrap content-start gap-x-1 gap-y-1">
                            {fieldSug.map((s) => (
                              <button
                                key={s.field}
                                type="button"
                                title={`${s.field}\n\nServices: ${s.services.join(", ")}`}
                                onClick={() =>
                                  setSfFields((m) => ({ ...m, [r.key]: s.field }))
                                }
                                className="max-w-[calc(100%-0.25rem)] break-words rounded border border-ink/10 bg-white/90 px-1.5 py-0.5 text-left font-mono text-[10px] leading-snug text-ink hover:bg-surface-2"
                              >
                                <span className="text-ink-muted">×{s.count}</span> {s.field}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="max-w-[14rem] overflow-hidden px-2 py-1.5 align-top">
                        {rowAssigned === UNASSIGNED_TARGET_ID ? (
                          <span className="text-[11px] text-ink-muted">—</span>
                        ) : !describeIdx ? (
                          <span className="text-[11px] text-ink-muted">Load org fields</span>
                        ) : orgMatches.length === 0 ? (
                          <span className="text-[11px] text-ink-muted">—</span>
                        ) : (
                          <div className="flex flex-wrap content-start gap-x-1 gap-y-1">
                            {orgMatches.map((m) => (
                              <button
                                key={m.name}
                                type="button"
                                title={`${m.label}\nscore ${(Number.isFinite(m.score) ? m.score : 0).toFixed(2)}`}
                                onClick={() =>
                                  setSfFields((prev) => ({ ...prev, [r.key]: m.name }))
                                }
                                className="max-w-[calc(100%-0.25rem)] break-words rounded border border-ink/10 bg-white/90 px-1.5 py-0.5 text-left font-mono text-[10px] leading-snug text-ink hover:bg-surface-2"
                              >
                                {m.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          className="w-full min-w-[7rem] rounded border border-ink/12 bg-white px-1.5 py-1 font-mono text-[11px]"
                          placeholder="Field__c"
                          list={fieldListId}
                          value={sfFields[r.key] ?? ""}
                          onChange={(e) =>
                            setSfFields((m) => ({ ...m, [r.key]: e.target.value }))
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          className="w-full rounded border border-ink/12 bg-white px-1.5 py-1 font-mono text-[11px]"
                          placeholder={(() => {
                            if (
                              r.source === "primary" &&
                              useCurrentExpressions &&
                              stripPrefix.trim()
                            ) {
                              const rel = relativePathAfterPrefix(
                                r.leafPath,
                                stripPrefix.trim(),
                              );
                              if (rel) {
                                const ph = formatCurrentItemExpression(rel);
                                if (ph) return ph;
                              }
                            }
                            if (r.source === "secondary" && r.extraApiId) {
                              const sn =
                                extraApis.find((b) => b.id === r.extraApiId)?.serviceName.trim() ??
                                "";
                              if (sn) return `((${sn}.${r.leafPath}))`;
                            }
                            return "((Service.response…)) or ((current.field))";
                          })()}
                          value={expressions[r.key] ?? ""}
                          onChange={(e) =>
                            setExpressions((m) => ({ ...m, [r.key]: e.target.value }))
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DataTableShell>

          {unmatchedRows.length > 0 ? (
            <div
              className="rounded-lg border border-ink/10 bg-surface-2/40 px-3 py-2 text-[11px] text-ink"
              role="status"
            >
              <p className="font-medium text-ink-muted">
                Unmatched paths ({unmatchedRows.length}) — not exported
              </p>
              <p className="mt-0.5 text-[10px] text-ink-muted">
                Assign each row to a Salesforce object column (O1, O2, …) or leave under ∅ to exclude.
              </p>
              <ul className="mt-2 max-h-40 overflow-auto font-mono text-[10px] leading-snug text-ink-muted">
                {unmatchedRows.map((r) => (
                  <li key={r.key} className="break-all border-t border-ink/[0.06] py-1 first:border-t-0 first:pt-0">
                    {r.leafPath}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className={panelClass}>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full">
                <h3 className="text-sm font-medium text-ink">Export</h3>
                <p className="mt-1 text-[11px] text-ink-muted">
                  Data Stamping <code className="font-mono text-[10px]">service_name</code>:{" "}
                  <code className="rounded bg-surface-2/80 px-1 font-mono text-[11px] text-ink">
                    {newServiceName.trim() || "—"}
                  </code>{" "}
                  <span className="text-ink-muted/90">(from API name at top)</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => void copyExport()}
                disabled={!exportJson}
                className="rounded border border-ink/12 bg-dm px-3 py-1.5 text-[13px] text-white hover:opacity-90 disabled:opacity-40"
              >
                Copy
              </button>
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-muted">
                <input
                  type="checkbox"
                  checked={includeAuditLog}
                  onChange={(e) => setIncludeAuditLog(e.target.checked)}
                  className="rounded border-ink/25"
                />
                Audit_Log__c
              </label>
              <button
                type="button"
                disabled={!canPushToDb}
                title={
                  !apiMode
                    ? "Enable API mode (VITE_USE_API) to write to the database."
                    : !mapperExportParsed.ok
                      ? mapperExportParsed.error
                      : !pushValidation.ok
                        ? pushValidation.errors[0]
                        : undefined
                }
                onClick={() => {
                  clearError();
                  setConfirmServiceName("");
                  setPushStep(1);
                }}
                className="rounded border border-ink/12 px-3 py-1.5 text-[13px] hover:bg-surface-2 disabled:opacity-40"
              >
                Push
              </button>
              <Link
                to="/sfdc"
                className="rounded border border-ink/12 px-3 py-1.5 text-[13px] text-ink-muted hover:bg-surface-2"
              >
                Data Stamping
              </Link>
            </div>
            <div className="mt-4 grid gap-3 text-[11px]">
              <label className="flex max-w-[8rem] flex-col gap-0.5 text-ink-muted">
                API version
                <input
                  type="text"
                  value={sfdcApiVersion}
                  onChange={(e) => setSfdcApiVersion(e.target.value)}
                  placeholder={SFDC_DEFAULT_API_VERSION}
                  className="rounded border border-ink/12 bg-white px-2 py-1 font-mono text-[11px]"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <div className="space-y-1">
                <label className="flex flex-col gap-0.5 text-ink-muted">
                  Audit SObject
                  <input
                    type="text"
                    list="sfdc-sobject-names"
                    value={auditSObject}
                    onChange={(e) => setAuditSObject(e.target.value)}
                    placeholder={SFDC_DEFAULT_AUDIT_OBJECT}
                    disabled={!includeAuditLog}
                    className="rounded border border-ink/12 bg-white px-2 py-1 font-mono text-[11px] disabled:opacity-40"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <p className="break-all font-mono text-[10px] text-ink-muted/90">
                  {includeAuditLog ? auditLogUrlComputed || "—" : "—"}
                </p>
                {sobjectNameSuggestions.length > 0 ? (
                  <div className="flex flex-wrap gap-0.5">
                    {sobjectNameSuggestions.slice(0, 8).map(({ name, count }) => (
                      <button
                        key={`audit-${name}`}
                        type="button"
                        disabled={!includeAuditLog}
                        title={`${count}×`}
                        onClick={() => setAuditSObject(name)}
                        className="rounded border border-ink/8 px-1.5 py-0.5 font-mono text-[10px] hover:bg-surface-2 disabled:opacity-40"
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <p className="text-[10px] text-ink-muted/80">
                Each Salesforce object block sets API name, describe, and corpus chips; table columns O1, O2, … assign paths to a block for export.
              </p>
              <label className="flex max-w-[20rem] flex-col gap-0.5 text-ink-muted">
                Contact merge (angle brackets)
                <input
                  type="text"
                  value={contactFieldValue}
                  onChange={(e) => setContactFieldValue(e.target.value)}
                  placeholder="<contact.Id>"
                  className="rounded border border-ink/12 bg-white px-2 py-1 font-mono text-[11px]"
                  autoComplete="off"
                />
              </label>
            </div>
            {pushBanner ? (
              <p className="mt-2 text-[13px] text-emerald-800" role="status">
                {pushBanner}
              </p>
            ) : null}
            {error ? (
              <p className="mt-2 whitespace-pre-wrap text-[13px] text-warn">{error}</p>
            ) : null}
            <pre className="mt-3 max-h-[22rem] overflow-auto rounded border border-ink/8 bg-white/80 p-3 font-mono text-[10px] leading-relaxed">
              {exportJson || "{}"}
            </pre>
          </div>

          <Modal
            title={pushStep === 1 ? "Push to database?" : "Confirm"}
            open={pushStep === 1 || pushStep === 2}
            onClose={closePushModal}
            footer={
              pushStep === 1 ? (
                <>
                  <button
                    type="button"
                    onClick={closePushModal}
                    className="rounded-lg border border-ink/15 px-4 py-2 text-sm hover:bg-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!canPushToDb}
                    onClick={() => setPushStep(2)}
                    className="rounded-lg bg-dm px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    Continue
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={closePushModal}
                    className="rounded-lg border border-ink/15 px-4 py-2 text-sm hover:bg-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={
                      pushing ||
                      confirmServiceName.trim() !== resolvedServiceName.trim()
                    }
                    onClick={() => void runPushToDb()}
                    className="rounded-lg bg-dm px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {pushing ? "Saving…" : "Push to database"}
                  </button>
                </>
              )
            }
          >
            {pushStep === 1 &&
            (newServiceName.trim() || arrayPath.trim()) ? (
              <div className="space-y-2 text-sm text-ink">
                <p>
                  New row <strong className="font-mono">{resolvedServiceName}</strong>
                  {" · "}
                  {Array.isArray(pushRowDraft?.request_body)
                    ? pushRowDraft.request_body.length
                    : 0}{" "}
                  sub-request(s).
                </p>
                <p className="text-xs text-ink-muted">
                  arrayPath:{" "}
                  <code className="break-all font-mono">{arrayPath.trim() || "—"}</code>
                </p>
              </div>
            ) : null}
            {pushStep === 2 &&
            (newServiceName.trim() || arrayPath.trim()) ? (
              <div className="space-y-2 text-sm text-ink">
                <p className="text-xs text-ink-muted">
                  Confirm: type <strong className="font-mono text-ink">{resolvedServiceName}</strong>
                </p>
                <label className="block">
                  <input
                    type="text"
                    value={confirmServiceName}
                    onChange={(e) => setConfirmServiceName(e.target.value)}
                    autoComplete="off"
                    className="w-full rounded border border-ink/12 bg-white px-2 py-1.5 font-mono text-sm"
                    placeholder={resolvedServiceName}
                  />
                </label>
              </div>
            ) : null}
          </Modal>
        </>
      ) : null}

      <details className={`${panelClass} text-[11px] text-ink-muted`}>
        <summary className="cursor-pointer list-none font-medium text-ink [&::-webkit-details-marker]:hidden">
          Reference
        </summary>
        <ul className="mt-2 space-y-1.5 border-t border-ink/8 pt-2">
          <li>
            <strong className="font-medium text-ink">API name</strong> (blur) rewrites the first{" "}
            <code className="font-mono text-[10px]">((Service.</code> in primary cells; extra API blocks each stamp their own{" "}
            <code className="font-mono text-[10px]">service_name</code> on blur. Default paths:{" "}
            <strong className="font-medium text-ink">Bulk fill → Primary ((Name.path))</strong>.
          </li>
          <li>
            <strong className="font-medium text-ink">Past templates</strong> pulls historical Composite expressions (transforms) by path — use when{" "}
            <code className="font-mono text-[10px]">((Name.path))</code> is not enough.
          </li>
          <li>
            <strong className="font-medium text-ink">Salesforce objects</strong>: <strong className="font-medium text-ink">Add object</strong> for multiple Row SObjects; <strong className="font-medium text-ink">Load org fields</strong> per block — each row uses the describe for its assigned column (O1, O2, …). <strong className="font-medium text-ink">Past</strong> is corpus-only. ∅ excludes a path from export; unmatched paths are listed below the table.
          </li>
          <li>
            Export needs SF field + expression per row; <code className="font-mono text-[10px]">arrayPath</code> only when DM iterates an array.
          </li>
          <li>
            Mixed array rows: union of keys; duplicate SF fields on the same object → last row wins.
          </li>
          <li>
            Use <strong className="font-medium text-ink">Add API</strong> only when needed; each block has its own JSON and{" "}
            <code className="font-mono text-[10px]">service_name</code> (e.g. <code className="font-mono text-[10px]">BureauF</code>) so{" "}
            <code className="font-mono text-[10px]">((Name…))</code> matches External APIs.
          </li>
          <li>
            Corpus rebuild: <code className="font-mono text-[10px]">npm run build:sfdc-corpus -- path/to/sfdc_export.json</code>
          </li>
        </ul>
      </details>
    </PageStack>
  );
}

function previewSample(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "object") {
    const s = stringifyJson(v, false);
    return s.length > 80 ? `${s.slice(0, 80)}…` : s;
  }
  return String(v);
}

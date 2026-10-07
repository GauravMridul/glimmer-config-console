import { type ChangeEvent, useCallback, useMemo, useState } from "react";
import { extractTextFromPdfFile } from "@/lib/pdfTextExtract";
import {
  coerceRequestBodyObject,
  extractCurlBlocksFromText,
  extractJsonBlocksFromText,
  extractFirstHttpUrl,
  mergePdfExtractIntoSample,
  type CurlBlockCandidate,
  type JsonBlockCandidate,
} from "@/lib/apiDocJsonExtract";

export type PdfApiDocImportPanelProps = {
  onApplySampleJson: (json: string) => void;
};

function sanitizeServiceNameFromFilename(name: string): string {
  const base = name.replace(/\.pdf$/i, "").replace(/^[^a-zA-Z0-9]+/, "");
  const cleaned = base.replace(/[^a-zA-Z0-9_]+/g, "_").replace(/_+/g, "_") || "ImportedService";
  return cleaned.slice(0, 80);
}

/** How strongly this block matched (ordering only; not a percentage). */
function matchStrengthLabel(score: number): string {
  if (score >= 85) return "Best guess";
  if (score >= 65) return "Good guess";
  if (score >= 45) return "Possible match";
  return "Weaker match";
}

function formatJsonDropdownLine(j: JsonBlockCandidate): string {
  const strength = matchStrengthLabel(j.score);
  const tags =
    j.hints.length > 0 ? j.hints.join(" · ") : "Structured data found in the document";
  const len = `${j.raw.length.toLocaleString()} characters long`;
  return `${strength} — ${tags} — ${len}`;
}

function formatCurlDropdownLine(c: CurlBlockCandidate, index: number): string {
  const strength = matchStrengthLabel(c.score);
  const urlBit = c.url
    ? `${c.url.slice(0, 48)}${c.url.length > 48 ? "…" : ""}`
    : "no web address in this line";
  return `Sample command ${index + 1}: ${c.method} ${urlBit} — ${strength}`;
}

export function PdfApiDocImportPanel({ onApplySampleJson }: PdfApiDocImportPanelProps) {
  const [fileLabel, setFileLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState("");
  const [jsonBlocks, setJsonBlocks] = useState<JsonBlockCandidate[]>([]);
  const [curlBlocks, setCurlBlocks] = useState<CurlBlockCandidate[]>([]);
  const [showRawText, setShowRawText] = useState(false);

  const [serviceName, setServiceName] = useState("");
  const [apiUrlOverride, setApiUrlOverride] = useState("");
  const [curlId, setCurlId] = useState<string>("");
  const [requestJsonId, setRequestJsonId] = useState<string>("");
  const [responseJsonId, setResponseJsonId] = useState<string>("");

  const selectedCurl = useMemo(
    () => curlBlocks.find((c) => c.id === curlId) ?? null,
    [curlBlocks, curlId],
  );

  const onPickFile = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Please choose a PDF file.");
      return;
    }
    setBusy(true);
    setError(null);
    setFileLabel(file.name);
    setServiceName(sanitizeServiceNameFromFilename(file.name));
    setApiUrlOverride("");
    setCurlId("");
    setRequestJsonId("");
    setResponseJsonId("");
    try {
      const text = await extractTextFromPdfFile(file);
      setExtractedText(text);
      const jsons = extractJsonBlocksFromText(text);
      const curls = extractCurlBlocksFromText(text);
      setJsonBlocks(jsons);
      setCurlBlocks(curls);
      if (curls.length > 0) {
        setCurlId(curls[0].id);
        if (curls[0].url) setApiUrlOverride(curls[0].url);
      } else {
        const guess = extractFirstHttpUrl(text);
        if (guess) setApiUrlOverride(guess);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setExtractedText("");
      setJsonBlocks([]);
      setCurlBlocks([]);
    } finally {
      setBusy(false);
    }
  }, []);

  const apply = useCallback(() => {
    const name = serviceName.trim();
    if (!name) {
      setError("Enter a short name for this service (first box below).");
      return;
    }
    let apiUrl = apiUrlOverride.trim();
    let requestMethod = "POST";
    const headers: Record<string, unknown> = { "Content-Type": "application/json" };

    if (selectedCurl) {
      if (!apiUrl && selectedCurl.url) apiUrl = selectedCurl.url;
      requestMethod = selectedCurl.method || "POST";
      for (const [k, v] of Object.entries(selectedCurl.headers)) {
        headers[k] = v;
      }
    }

    if (!apiUrl) {
      const guess = extractFirstHttpUrl(extractedText);
      if (guess) apiUrl = guess;
    }

    if (!apiUrl) {
      setError(
        "Add the full web address (URL) for the API, or upload a PDF that includes a link or a sample command line.",
      );
      return;
    }

    let requestBody: Record<string, unknown> = {};
    const reqJson = jsonBlocks.find((j) => j.id === requestJsonId);
    if (reqJson) {
      requestBody = coerceRequestBodyObject(reqJson.parsed);
    } else if (selectedCurl?.bodyJson) {
      requestBody = coerceRequestBodyObject(selectedCurl.bodyJson);
    }

    let sampleResponse: unknown = null;
    const resJson = jsonBlocks.find((j) => j.id === responseJsonId);
    if (resJson) {
      sampleResponse = resJson.parsed;
    }

    const json = mergePdfExtractIntoSample({
      serviceName: name,
      apiUrl,
      requestMethod,
      headers,
      requestBody,
      sampleResponse,
    });
    setError(null);
    onApplySampleJson(json);
  }, [
    serviceName,
    apiUrlOverride,
    selectedCurl,
    requestJsonId,
    responseJsonId,
    jsonBlocks,
    extractedText,
    onApplySampleJson,
  ]);

  const hasExtract = extractedText.length > 0;

  return (
    <div className="rounded-[var(--radius-card)] border border-accent/25 bg-gradient-to-b from-accent/[0.06] to-transparent p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">PDF import</p>
      <h3 className="mt-1 text-base font-semibold text-ink">Start from a PDF API document</h3>
      <p className="mt-2 max-w-3xl text-sm text-ink-muted">
        We read the PDF in your browser and look for blocks that look like structured data and for
        sample command lines. We then guess which parts belong to requests, responses, or examples
        from the words around them. Every PDF is laid out differently—always check the choices
        below, then you can still edit the result in the next step.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm font-medium text-ink shadow-sm hover:bg-surface-2">
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={onPickFile}
            disabled={busy}
          />
          <span>{busy ? "Reading PDF…" : "Choose PDF"}</span>
        </label>
        {fileLabel ? (
          <span className="text-sm text-ink-muted">
            <span className="font-medium text-ink">{fileLabel}</span>
            {hasExtract ? (
              <span className="ml-2">
                · {extractedText.length.toLocaleString()} characters read · {jsonBlocks.length} data
                block(s) found · {curlBlocks.length} sample command line(s) found
              </span>
            ) : null}
          </span>
        ) : null}
      </div>

      {error ? <p className="mt-3 text-sm text-warn">{error}</p> : null}

      {hasExtract ? (
        <div className="mt-5 space-y-4 border-t border-ink/10 pt-5">
          <button
            type="button"
            onClick={() => setShowRawText((v) => !v)}
            className="text-sm font-medium text-accent hover:underline"
          >
            {showRawText ? "Hide" : "Show"} the plain text we pulled from the PDF
          </button>
          {showRawText ? (
            <pre className="max-h-48 overflow-auto rounded-lg border border-ink/10 bg-surface-2 p-3 font-mono text-[10px] leading-relaxed text-ink-muted">
              {extractedText.slice(0, 12000)}
              {extractedText.length > 12000 ? "\n…" : ""}
            </pre>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-ink-muted" htmlFor="pdf-svc-name">
                Name for this API (used in your configuration)
              </label>
              <input
                id="pdf-svc-name"
                type="text"
                value={serviceName}
                onChange={(e) => setServiceName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink shadow-sm"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-muted" htmlFor="pdf-api-url">
                Web address (URL) of the API
              </label>
              <input
                id="pdf-api-url"
                type="url"
                placeholder="https://…"
                value={apiUrlOverride}
                onChange={(e) => setApiUrlOverride(e.target.value)}
                className="mt-1 w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink shadow-sm"
                autoComplete="off"
              />
            </div>
          </div>

          <p className="text-xs leading-relaxed text-ink-muted">
            <span className="font-medium text-ink">About “Best guess” / “Good guess”:</span> we only use
            these to sort options. They reflect how well the <em>surrounding words</em> in the PDF
            matched common phrases (like “request” or “example”). They are not a score out of 100 and
            not a guarantee that the block is correct—always use your judgment.
          </p>

          <div className="grid gap-4 lg:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-ink-muted" htmlFor="pdf-curl-pick">
                Sample command from the PDF (optional)
              </label>
              <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">
                If the document shows a full command line, pick it to fill the web address, headers,
                and any data sent with the request.
              </p>
              <select
                id="pdf-curl-pick"
                value={curlId}
                onChange={(e) => {
                  const id = e.target.value;
                  setCurlId(id);
                  const c = curlBlocks.find((x) => x.id === id);
                  if (c?.url) setApiUrlOverride(c.url);
                }}
                className="mt-1 w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink shadow-sm"
              >
                <option value="">Don’t use a sample command</option>
                {curlBlocks.map((c, idx) => (
                  <option key={c.id} value={c.id}>
                    {formatCurlDropdownLine(c, idx)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-muted" htmlFor="pdf-req-json">
                Data you send to the API (request)
              </label>
              <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">
                Choose the block that matches what the customer or system sends in the request. If
                you pick one here, it replaces the data from the sample command.
              </p>
              <select
                id="pdf-req-json"
                value={requestJsonId}
                onChange={(e) => setRequestJsonId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink shadow-sm"
              >
                <option value="">Don’t pick from the PDF—use the sample command or leave empty</option>
                {jsonBlocks.map((j) => (
                  <option key={`req-${j.id}`} value={j.id}>
                    {formatJsonDropdownLine(j)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-muted" htmlFor="pdf-res-json">
                Data you get back from the API (response)
              </label>
              <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">
                Choose a block that looks like an example reply. This helps build the Salesforce side
                of the mapping.
              </p>
              <select
                id="pdf-res-json"
                value={responseJsonId}
                onChange={(e) => setResponseJsonId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink shadow-sm"
              >
                <option value="">No example response from the PDF</option>
                {jsonBlocks.map((j) => (
                  <option key={`res-${j.id}`} value={j.id}>
                    {formatJsonDropdownLine(j)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-ink/10 bg-white/90">
            <table className="w-full min-w-[40rem] text-left text-xs">
              <thead className="border-b border-ink/10 text-ink-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Block</th>
                  <th className="px-3 py-2 font-medium">What we noticed nearby in the PDF</th>
                  <th className="px-3 py-2 font-medium">Start of the text</th>
                </tr>
              </thead>
              <tbody>
                {jsonBlocks.slice(0, 8).map((j, idx) => (
                  <tr key={j.id} className="border-b border-ink/10 align-top odd:bg-surface-2/40">
                    <td className="px-3 py-2 text-ink">Snippet {idx + 1}</td>
                    <td className="px-3 py-2 text-ink">
                      {j.hints.length > 0 ? j.hints.join(" · ") : "No clear heading—still valid data"}
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-ink-muted">
                      {j.raw.slice(0, 160)}
                      {j.raw.length > 160 ? "…" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={apply}
            className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-accent-hover"
          >
            Fill the import form below with these choices
          </button>
        </div>
      ) : null}
    </div>
  );
}

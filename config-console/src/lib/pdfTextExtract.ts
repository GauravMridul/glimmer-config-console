import * as pdfjsLib from "pdfjs-dist";

/** Vite resolves the worker asset URL. */
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

let workerConfigured = false;

function ensurePdfWorker(): void {
  if (workerConfigured) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
  workerConfigured = true;
}

/**
 * Extract plain text from every page of a PDF (browser).
 * Layout varies by producer; tables and code blocks may lose structure.
 */
export async function extractTextFromPdfFile(file: File): Promise<string> {
  ensurePdfWorker();
  const buf = await file.arrayBuffer();
  const task = pdfjsLib.getDocument({ data: buf });
  const pdf = await task.promise;
  const parts: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const lineChunks: string[] = [];
    let lastY: number | null = null;
    for (const item of content.items) {
      if (!("str" in item) || typeof item.str !== "string") continue;
      const tr = "transform" in item && Array.isArray(item.transform) ? item.transform : null;
      const y = tr ? Math.round(tr[5] * 10) / 10 : null;
      if (y !== null && lastY !== null && Math.abs(y - lastY) > 3) {
        lineChunks.push("\n");
      }
      lineChunks.push(item.str);
      if (y !== null) lastY = y;
    }
    parts.push(lineChunks.join(""));
    parts.push("\n\n");
  }
  return parts.join("").replace(/\r\n/g, "\n");
}

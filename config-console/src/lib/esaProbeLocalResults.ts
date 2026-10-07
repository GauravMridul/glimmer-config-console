/**
 * Last HTTP probe outcome per External API row (browser localStorage only).
 * Used to bump Overview ESA confidence when a Test request returned 2xx.
 */

const STORAGE_KEY = "config-console.esaProbe.v1";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const ESA_PROBE_UPDATED_EVENT = "config-console-esa-probe";

type Entry = { status: number; at: number };

function parseStored(raw: string): Record<string, Entry> {
  try {
    const j = JSON.parse(raw) as Record<
      string,
      { status?: number; at?: string | number }
    >;
    const out: Record<string, Entry> = {};
    const now = Date.now();
    for (const [k, v] of Object.entries(j)) {
      if (typeof v?.status !== "number") continue;
      const at =
        typeof v.at === "number"
          ? v.at
          : new Date(String(v.at)).getTime();
      if (!Number.isFinite(at) || now - at > TTL_MS) continue;
      out[k] = { status: v.status, at };
    }
    return out;
  } catch {
    return {};
  }
}

function readAll(): Record<string, Entry> {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  return parseStored(raw);
}

function writeAll(entries: Record<string, Entry>) {
  if (typeof window === "undefined") return;
  const serial: Record<string, { status: number; at: string }> = {};
  for (const [k, v] of Object.entries(entries)) {
    serial[k] = { status: v.status, at: new Date(v.at).toISOString() };
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(serial));
}

/** Call after a completed probe (upstream returned headers). */
export function recordEsaProbeHttpResult(serviceId: number, status: number): void {
  if (typeof window === "undefined" || !Number.isFinite(serviceId) || serviceId <= 0) {
    return;
  }
  const all = readAll();
  all[String(serviceId)] = { status, at: Date.now() };
  writeAll(all);
  window.dispatchEvent(new Event(ESA_PROBE_UPDATED_EVENT));
}

/** True if the latest stored probe for this id was HTTP 2xx and is within TTL. */
export function hasRecentSuccessfulEsaProbe(serviceId: number): boolean {
  if (typeof window === "undefined" || !Number.isFinite(serviceId) || serviceId <= 0) {
    return false;
  }
  const e = readAll()[String(serviceId)];
  if (!e) return false;
  return e.status >= 200 && e.status < 300;
}

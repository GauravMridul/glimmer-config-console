export function stringifyJson(value: unknown, pretty = true): string {
  return JSON.stringify(value, null, pretty ? 2 : undefined);
}

export function parseJsonObject(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid JSON";
    return { ok: false, error: msg };
  }
}

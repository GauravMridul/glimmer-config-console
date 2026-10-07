/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_API?: string;
  readonly VITE_API_URL?: string;
  /** When true, ignore `VITE_API_URL` and use same-origin `/api/...` only. */
  readonly VITE_API_RELATIVE?: string;
  /** Public URL path prefix for the SPA (e.g. `/decisioning-portal`). Must match server `PUBLIC_BASE_PATH`. */
  readonly VITE_PUBLIC_BASE_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

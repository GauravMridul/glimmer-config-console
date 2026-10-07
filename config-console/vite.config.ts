import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Read `PORT=` from `server/.env` so the dev proxy matches `npm run server` without extra env. */
function portFromServerDotEnv(): number | null {
  const p = path.join(__dirname, "server", ".env");
  try {
    const txt = fs.readFileSync(p, "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = /^\s*PORT\s*=\s*["']?(\d+)["']?\s*(?:#.*)?$/.exec(line);
      if (m) {
        const n = Number(m[1]);
        return Number.isFinite(n) && n > 0 ? n : null;
      }
    }
  } catch {
    // missing or unreadable
  }
  return null;
}

/** Must match `PORT` in server/.env when it is not 4000 (see .env.example). */
function apiProxyTarget(mode: string): string {
  const env = loadEnv(mode, process.cwd(), "");
  const t = env.VITE_DEV_API_PROXY_TARGET?.trim();
  if (t) return t;
  const port = portFromServerDotEnv();
  if (port != null) return `http://localhost:${port}`;
  return "http://localhost:4000";
}

function logApiProxyTargetPlugin(target: string) {
  return {
    name: "config-console-log-api-proxy",
    configureServer() {
      console.info(
        `\n[config-console] Vite /api proxy → ${target} (override with VITE_DEV_API_PROXY_TARGET in .env)\n`,
      );
    },
    configurePreviewServer() {
      console.info(
        `\n[config-console] Vite preview /api proxy → ${target}\n`,
      );
    },
  };
}

/** Vite `base` (must end with `/` when not `/`). From `VITE_PUBLIC_BASE_PATH` or `PUBLIC_BASE_PATH` (file or process env, e.g. Docker `ARG`). */
function vitePublicBase(mode: string): string {
  const env = loadEnv(mode, process.cwd(), "");
  const raw = (
    env.VITE_PUBLIC_BASE_PATH ??
    env.PUBLIC_BASE_PATH ??
    process.env.VITE_PUBLIC_BASE_PATH ??
    process.env.PUBLIC_BASE_PATH ??
    ""
  ).trim();
  if (!raw || raw === "/") return "/";
  const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

export default defineConfig(({ mode }) => {
  const target = apiProxyTarget(mode);
  const base = vitePublicBase(mode);
  return {
    base,
    plugins: [react(), tailwindcss(), logApiProxyTargetPlugin(target)],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      proxy: {
        "/api": {
          target,
          changeOrigin: true,
        },
      },
    },
    /** Same as `server.proxy` so `vite preview` forwards `/api` to the config-console Node server. */
    preview: {
      proxy: {
        "/api": {
          target,
          changeOrigin: true,
        },
      },
    },
  };
});

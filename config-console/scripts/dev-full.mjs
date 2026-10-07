#!/usr/bin/env node
/**
 * Starts the Node API, waits until it accepts TCP on PORT, then starts Vite.
 * Use this when `npm run dev` alone causes HTML 404 / "Cannot POST /api/…"
 * because nothing was listening behind the Vite proxy.
 *
 * If PORT is already taken by a running config-console API, starts Vite only.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function portFromServerDotEnv() {
  const p = path.join(root, "server", ".env");
  try {
    const txt = fs.readFileSync(p, "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = /^\s*PORT\s*=\s*["']?(\d+)["']?\s*(?:#.*)?$/.exec(line);
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
  } catch {
    // ignore
  }
  return 4000;
}

/** Resolves if nothing is listening on 127.0.0.1:port (brief bind test). */
function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", (err) => {
      if (err && err.code === "EADDRINUSE") {
        reject(
          Object.assign(new Error("EADDRINUSE"), {
            code: "EADDRINUSE",
            port,
          }),
        );
        return;
      }
      reject(err);
    });
    s.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
      s.close(() => resolve());
    });
  });
}

function looksLikeConfigConsoleHealth(port) {
  return new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${port}/api/health`,
      { timeout: 2500 },
      (res) => {
        let body = "";
        res.on("data", (c) => {
          body += c;
        });
        res.on("end", () => {
          resolve(
            res.statusCode === 200 &&
              /"ok"\s*:\s*true/.test(body) &&
              /"database"\s*:\s*"connected"/.test(body),
          );
        });
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function waitForListen(port, serverProc, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (serverProc.exitCode != null) {
        reject(
          new Error(
            `Server exited with code ${serverProc.exitCode} before listening on port ${port}`,
          ),
        );
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`Timed out waiting for API on port ${port}`));
        return;
      }
      const s = net.createConnection({ host: "127.0.0.1", port });
      s.once("connect", () => {
        s.end();
        resolve();
      });
      s.once("error", () => {
        setTimeout(tick, 250);
      });
    };
    tick();
  });
}

function spawnVite() {
  return spawn("npm", ["run", "dev"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
}

const port = portFromServerDotEnv();
console.info(`[config-console] dev:full → API port ${port}, then Vite\n`);

let server = null;
let web = null;

function shutdown() {
  try {
    server?.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  try {
    web?.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  setTimeout(() => process.exit(0), 400);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function attachServerExit() {
  server?.on("exit", (code, signal) => {
    if (web) {
      web.kill(signal || "SIGTERM");
      process.exit(code ?? 0);
      return;
    }
    if ((code ?? 0) !== 0) process.exit(code ?? 1);
  });
}

async function main() {
  let startServer = true;
  try {
    await assertPortFree(port);
  } catch (e) {
    if (e && e.code === "EADDRINUSE") {
      const reuse = await looksLikeConfigConsoleHealth(port);
      if (reuse) {
        console.info(
          `[config-console] Port ${port} is already in use by this API — starting Vite only.\n` +
            `          (Stop the other terminal’s \`npm run server\` if you want a fresh API process.)\n`,
        );
        startServer = false;
      } else {
        console.error(
          `Port ${port} is already in use, and /api/health did not look like config-console.\n` +
            `  Free the port:  lsof -nP -iTCP:${port} -sTCP:LISTEN\n` +
            `  Or use another PORT in server/.env (and restart).\n` +
            `  If config-console is already running here, use only:  npm run dev\n`,
        );
        process.exit(1);
      }
    } else {
      throw e;
    }
  }

  if (startServer) {
    server = spawn("node", ["server/index.mjs"], {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    attachServerExit();
    try {
      await waitForListen(port, server, 90_000);
    } catch (err) {
      console.error(err);
      shutdown();
      process.exit(1);
    }
  }

  web = spawnVite();
  web.on("exit", (code) => {
    shutdown();
    process.exit(code ?? 0);
  });
}

main().catch((e) => {
  console.error(e);
  shutdown();
  process.exit(1);
});

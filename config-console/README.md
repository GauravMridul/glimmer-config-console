# Config console

A small React (Vite + TypeScript + Tailwind) UI for three configuration surfaces:

| Screen | Table | Typical service DB |
|--------|--------|---------------------|
| **service_configuration** | ESA | `external-service-adapter` |
| **partner_service_mapping** | Decision Manager | `decision-manager` |
| **service_sfdc_field_mapping** | Decision Manager | `decision-manager` |

## Mode A — Browser only (localStorage)

```bash
cd config-console
npm install
npm run dev
```

Do **not** set `VITE_USE_API`. Data is stored under `localStorage` key `config-console/v1`.

## Mode B — PostgreSQL (Node API)

1. **Install server dependencies**

   ```bash
   cd config-console/server
   npm install
   cd ..
   ```

2. **Create a database** and apply the schema (tables `service_configuration`, `partner_service_mapping`, `service_sfdc_field_mapping` for a single dev DB):

   ```bash
   createdb config_console   # or use Docker / cloud Postgres
   psql "$DATABASE_URL" -f server/schema.sql
   ```

3. **Configure env**

   - Copy `server/.env.example` → `server/.env` and set `DATABASE_URL`.
   - Copy `.env.example` → `.env` in the **config-console** root and set `VITE_USE_API=true`.

   With `VITE_USE_API=true` and no `VITE_API_URL`, the Vite dev server **proxies** `/api` to the URL printed at dev startup (see `vite.config.ts`). By default that is `http://localhost:4000`, or **`http://localhost:<PORT>`** when `PORT` is set in **`server/.env`**.

4. **Run API + UI** (one terminal — recommended)

   ```bash
   cd config-console
   npm run dev:full
   ```

   This starts **`npm run server`**, waits until that port accepts connections, then runs **`npm run dev`**. It avoids HTML **404 / Cannot POST `/api/…`** when only Vite was running. If **`PORT`** is already taken by a running config-console API, **`dev:full`** starts **Vite only** and reuses that API.

   **Or** use two terminals: **`npm run server`** then **`npm run dev`**.

   **`EADDRINUSE` on `PORT`:** Another process (often a leftover **`npm run server`**) is using that port. Stop it (`lsof -nP -iTCP:4000 -sTCP:LISTEN` → kill the PID) or change **`PORT`** in **`server/.env`**. If the API is already running, **`npm run dev`** alone is enough.

5. Open the URL Vite prints (often **`http://localhost:5173`** or **`:5174`**). You should see **“API + Postgres”** in the header and rows loaded from the database. Use **Reload from database** to refetch.

### Split databases (optional)

Set `ESA_DATABASE_URL` and `DM_DATABASE_URL` in `server/.env` if `service_configuration` lives in one Postgres instance and the Decision Manager tables in another. If both are unset, `DATABASE_URL` is used for all tables.

**`query_object_relationship_map` pool:** If **`QUERY_OBJECT_RELATIONSHIP_MAP_DATABASE_URL`** is set, **Fill from Salesforce** and **`GET /api/salesforce/query-object-relationship-map`** use that URI. If it is unset and **`ESA_DATABASE_URL`** differs from **`DATABASE_URL`**, the map defaults to **`DATABASE_URL`** (so the table can live on the config-console DB while `service_configuration` stays on ESA). Otherwise the map uses the same pool as ESA. Each request runs a fresh `SELECT` so new rows are visible without redeploying.

### Production preview (`vite build`)

`vite.config.ts` sets **`preview.proxy`** for `/api` to the same target as dev (from **`PORT`** in **`server/.env`** or **`4000`**). Run **`npm run server`** in another terminal, then **`npm run preview`** — relative `/api` calls should reach the Node API without extra env.

If you serve the built static files from another host (no Vite preview), set **`VITE_API_URL=http://localhost:4000`** in `.env` at build time, or put a reverse proxy in front that forwards `/api` to the Node server.

### Troubleshooting

**`Cannot POST /api/test/process-sequence` (HTML error page)**  
That response is from **Express** when no route matches — almost always one of:

1. **Stale API process** — Stop and restart **`npm run server`** from the **`config-console`** folder so it loads the current `server/index.mjs` (the `POST /api/test/process-sequence` handler).
2. **API not running (most common)** — Vite proxies `/api` to the Node server. If **`npm run server`** is not running, or another process is on that port, you get **404** or **Cannot POST**. **Fix:** run **`npm run dev:full`** from **`config-console`**, or keep **`npm run server`** running in a second terminal while using **`npm run dev`**. **`vite.config.ts`** reads **`PORT`** from **`server/.env`** for the proxy when **`VITE_DEV_API_PROXY_TARGET`** is unset. You can still set **`VITE_DEV_API_PROXY_TARGET=http://localhost:5000`** in **`config-console/.env`** if the API listens elsewhere.  
   **Quick check:** With the API running, open **`http://localhost:4000/api/test/process-sequence`** in the browser (GET). You should see JSON with `"ok": true`. If you use another port, use that port in the URL instead. If GET works but the UI still fails, fix **`VITE_DEV_API_PROXY_TARGET`** or **`VITE_API_URL`**.
3. **`VITE_API_URL` mismatch** — If **`VITE_API_URL`** is set (e.g. `http://localhost:4000`), the browser calls the API **directly** and bypasses the Vite proxy. It must match the **same host and port** as **`npm run server`**.
4. **Preview without proxy** — If you opened a **static** build from a server that does not proxy `/api`, set **`VITE_API_URL`** to your API base URL, or use **`npm run preview`** (with proxy) instead.

## Security

Follow these steps so credentials stay off the wire and out of git.

1. **Keep secrets out of the repo**  
   - Use **`server/.env`** and **`.env`** only on your machine; both paths are listed in **`.gitignore`**.  
   - Never paste database URLs, passwords, or API keys into issues, chats, or committed files.  
   - Copy from **`.env.example`** / **`server/.env.example`** only; add real values locally.

2. **Know what is public vs server-only**  
   - Anything prefixed with **`VITE_`** is bundled into the browser. **Do not** put database passwords, `X-Api-Key`, or other secrets in `VITE_*` variables.  
   - **`ESA_PROCESS_SEQUENCE_API_KEY`** and **`DATABASE_URL`** / **`DM_*`** belong in **`server/.env`** only. The **Test sequence** page calls staging through **`POST /api/test/process-sequence`**, so the key never ships to the client.

3. **Configure the process-sequence test safely**  
   - Set **`ESA_PROCESS_SEQUENCE_API_KEY`** in **`server/.env`**.  
   - Optionally set **`ESA_PROCESS_SEQUENCE_URL`** if the target is not the default staging URL.  
   - Restart **`npm run server`** after changing env vars.

4. **Rotate credentials if they leak**  
   - If an API key or DB password was shared or committed by mistake, **rotate** it in your infrastructure (new key / new password) and update **`server/.env`** only.  
   - Remove the secret from git history if it was ever committed (e.g. `git filter-repo` or your org’s process).

5. **Lock down before exposing the stack**  
   - Run the Node API **on localhost** only during local dev, or put it behind a **reverse proxy** with **TLS** and **authentication** before any untrusted network can reach it.  
   - Prefer **RDS / managed Postgres** with least-privilege DB users for the console.  
   - Treat **`RDS_SSL_REJECT_UNAUTHORIZED=false`** as a **temporary** dev workaround; production should use proper CA verification where possible.

6. **Review access**  
   - Limit who can reach staging and production URLs that carry **`X-Api-Key`** and correlation IDs.  
   - Do not log full request bodies containing PII in shared logs without policy and redaction.

## AWS / container deployment

See **[docs/AWS-DEPLOYMENT.md](docs/AWS-DEPLOYMENT.md)** for ECS, RDS, ALB, and ECR. Build a single image with the **`Dockerfile`** in this folder (UI + API on one origin).

## Next steps

- Align `server/schema.sql` with your real Goose migrations if column names differ.

## About this repo (portfolio copy)
"Glimmer" is an internal configuration console for the External Service Adapter and Decision Manager microservices. It replaces hand-written SQL with a UI that validates configs, suggests field mappings from a corpus of existing configurations, and lets engineers test a sequence end to end. Hostnames, identifiers and sample data in this copy were replaced with placeholders.

# Deploying config-console on AWS

This app is a **single container**: the Node server serves the built React UI from `/app/dist` and JSON APIs under `/api/*`. The browser uses **relative** `/api/...` when `VITE_API_URL` is empty at build time (default in the Dockerfile).

Hand this document to your platform team with the **checklist** and **runtime environment** sections. For a full **variable name checklist** (Secrets Manager / ECS), see **`SECRETS-MANAGER-ENV-LIST.md`** in this folder.

## Database: reuse existing UAT (no new RDS for this app)

**Postgres for ESA / Decision Manager is already running in UAT.** Deploying config-console does **not** require creating new database instances or changing connection strings you already use today.

- Point the **ECS task** at the **same** credentials and URLs you use locally in `server/.env`: `DATABASE_URL`, or `ESA_DATABASE_URL` + `DM_DATABASE_URL`, or discrete `DM_*` vars (see `server/.env.example`). Optionally set **`QUERY_OBJECT_RELATIONSHIP_MAP_DATABASE_URL`** if the relationship-map table lives on another Postgres instance than ESA.
- **Networking:** ensure the **ECS task security group** can reach the **existing RDS** security group on **5432** (same rules you would use for any other UAT service in that VPC). No schema migration is implied by this doc if UAT already has the three tables; otherwise align with `server/schema.sql` as you already do for other apps.

Store those values in **Secrets Manager / SSM** for the task definition—they are not baked into the Docker image.

## What to provision (for the console itself)

| Component | Purpose |
|-----------|---------|
| **ECS on Fargate** (or EKS / App Runner) | Runs the Docker image from this repo’s `Dockerfile`. |
| **Application Load Balancer** | HTTPS listener → target group → ECS tasks on container port **4000** (or whatever you set `PORT` to). |
| **Secrets Manager or SSM Parameter Store** | **Same DB URLs/passwords as UAT** (and optional `ESA_PROCESS_SEQUENCE_API_KEY`, etc.). Injected as env vars on the task definition. |
| **ECR** | Host the built image (`aws ecr get-login-password` … `docker push`). |

**Already in place (reuse):** UAT **RDS PostgreSQL** (or Aurora) hosting `service_configuration`, `partner_service_mapping`, `service_sfdc_field_mapping`.

Optional: **WAF** on the ALB, **NAT** for outbound probes if ECS tasks have no public IP.

## Build and push the image

From the `config-console` directory (repository root of this package):

```bash
aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com

docker build -t config-console:latest \
  --build-arg VITE_USE_API=true \
  --build-arg VITE_API_URL= \
  --build-arg VITE_API_RELATIVE=true \
  --build-arg PUBLIC_BASE_PATH=/decisioning-portal \
  .

docker tag config-console:latest <account>.dkr.ecr.<region>.amazonaws.com/config-console:latest
docker push <account>.dkr.ecr.<region>.amazonaws.com/config-console:latest
```

- **`VITE_USE_API=true`** — required for production (UI talks to Postgres via API).
- **`VITE_API_URL` empty** — UI calls **`/api/...` on the same host** as the ALB (recommended). If you split UI and API onto different hostnames, set `VITE_API_URL` to the **public API base** (no trailing slash) and configure **CORS** on the server for that UI origin (currently `origin: true` is permissive—tighten for production).

## Container environment variables

Set these on the **ECS task definition** (values from Secrets Manager / SSM as appropriate).

### Required (database)

| Variable | Notes |
|----------|--------|
| `DATABASE_URL` | Postgres URI for ESA + DM if using one DB. |
| **or** `ESA_DATABASE_URL` + `DM_DATABASE_URL` | Split databases. |
| **or** `DM_HOST`, `DM_PORT`, `DM_DB`, `DM_USER`, `DM_PASSWORD` / `DM_PASSWORD_BASE64` | Discrete DM connection (see `server/.env.example`). |

### Server / HTTP

| Variable | Default | Notes |
|----------|---------|--------|
| `PORT` | `4000` | Must match ALB target group port. |
| `STATIC_DIST_DIR` | (set in image to `/app/dist`) | Override only if you change layout. |
| `TRUST_PROXY` | unset | Set to `1` or `true` behind ALB so Express trusts `X-Forwarded-*`. |
| `PUBLIC_BASE_PATH` | `/` (root) | No trailing slash, e.g. `/decisioning-portal`. **Must match** the same value passed as `PUBLIC_BASE_PATH` at **image build** (bakes Vite `base` + Router). Ingress must forward requests **with this path prefix** to the container (do not strip the prefix unless you use a matching rewrite). Portal: `https://<host><PUBLIC_BASE_PATH>/`. Health works at **`/api/health`** and **`<PUBLIC_BASE_PATH>/api/health`** (UI uses the prefixed API when `VITE_API_RELATIVE=true`). |

### Optional

| Variable | Purpose |
|----------|---------|
| `RDS_SSL_REJECT_UNAUTHORIZED` | `false` only if you must relax TLS to RDS during bring-up; prefer proper CA bundle in production. |
| `ESA_PROCESS_SEQUENCE_API_KEY` | Server-only key for **Test sequence** proxy. |
| `ESA_PROCESS_SEQUENCE_URL` | Override staging URL for that proxy. |
| `HTTP_PROBE_HOST_ALLOWLIST` | Comma-separated hostnames allowed for **Test request** HTTP probe. |
| `QUERY_OBJECT_RELATIONSHIP_MAP_DATABASE_URL` | Optional Postgres URI for `query_object_relationship_map` (SOQL / **Fill from Salesforce** when that table is not on the ESA DB). If unset, the server reuses ESA / `DATABASE_URL` per pool logic in `server/index.mjs` and `server/.env.example`. |
| `SALESFORCE_*` | Optional: `GET /api/salesforce/status`, describe, **`GET /api/salesforce/query-object-relationship-map`**, and **`POST /api/salesforce/resolve-probe-templates`** (Test request → Fill from Salesforce). See `server/.env.example`. |

Do **not** put database passwords or API keys in `VITE_*` variables (they are public in the browser bundle).

**If “Fill \<…\> from Salesforce” returns HTML `Cannot POST /api/salesforce/resolve-probe-templates`:** the browser is not hitting the config-console container (for example `VITE_API_URL` was built to another host such as aa-calc-api, or ECS is still on an old image). Rebuild the image from this repo, redeploy, and either leave `VITE_API_URL` empty (same ALB as the UI) or set it to the URL that serves `server/index.mjs`. `GET /api/salesforce/resolve-probe-templates` should return JSON (400) on the correct server.

## Health checks

- **ALB target group**: HTTP `GET /api/health` on the task port. Success when status **200** and body indicates DB connectivity (server returns 503 if DB down).
- **ECS container**: Dockerfile `HEALTHCHECK` uses the same path.

## Split architecture (optional)

If your standards require **S3 + CloudFront** for static assets and a separate API service:

1. Build the UI with `VITE_API_URL=https://api.your-domain.example` pointing at the API load balancer.
2. Run an image that **only** runs the Node API (omit `STATIC_DIST_DIR` / do not copy `dist`, or use a second Dockerfile).
3. Configure CORS on Express for the CloudFront domain.

The default Dockerfile is optimized for **one ALB → one service** (simplest operations).

## Credentials handoff (app owner → platform team)

The platform team needs the **same logical values** you use in `server/.env` (never committed). They create entries in **Secrets Manager** / **SSM** and map **env var names** exactly as in `server/.env.example`.

**Do not** put secrets in Git, public tickets, or plain email if your org forbids it. Prefer:

- Your org’s **approved** channel: enterprise password manager **share**, **encrypted** ticket, **short-lived** secure file drop, or a **live session** where they watch you paste into the AWS console once.
- A **checklist of names** (from `.env.example`) in email is fine; **values** should use an approved secret channel only.
- After handoff, **rotate** anything that may have crossed an untrusted medium (DB passwords, Salesforce integration password, API keys).

You can send a **single JSON object** (one secret) whose keys match env var names, or agree on **one secret per variable**—either works if the ECS task definition `valueFrom` ARNs match their convention.

## Security checklist for the AWS team

- [ ] TLS termination on ALB; redirect HTTP → HTTPS.
- [ ] **Existing UAT RDS:** security groups allow **only** the config-console **ECS task SG** (and other approved clients) → RDS port **5432**; avoid exposing Postgres to the open internet.
- [ ] Restrict security groups on ALB → tasks to known CIDRs or use **IAM / SSO** in front of the app if it must not be public.
- [ ] Secrets in **Secrets Manager**; task execution role with `secretsmanager:GetSecretValue` (or SSM equivalent).
- [ ] Tighten **`cors`** `origin` in `server/index.mjs` from `true` to an explicit allowlist once UI URL is known.
- [ ] Review `HTTP_PROBE_HOST_ALLOWLIST` in production to reduce SSRF risk from the probe endpoint.

## Support contacts

Application owners should confirm **schema** parity with UAT (`server/schema.sql` vs what is already deployed) and **split DB** vs single `DATABASE_URL`—using the **same** connection pattern as today, not a new database product.

# syntax=docker/dockerfile:1
# Single image: Vite static UI + Express API (same origin, relative /api calls).
# See docs/AWS-DEPLOYMENT.md for ECS, RDS, and ALB wiring.

FROM node:22-bookworm-slim AS frontend-build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY src ./src
ARG VITE_USE_API=true
ARG VITE_API_URL=
# Default true: always use same-origin `/api` in the bundle (avoids wrong VITE_API_URL in CI).
# Split-host deploy: docker build --build-arg VITE_API_RELATIVE=false --build-arg VITE_API_URL=https://api.example.com
ARG VITE_API_RELATIVE=true
# Subpath SPA (no trailing slash), e.g. /decisioning-portal — must match runtime PUBLIC_BASE_PATH on the server.
ARG PUBLIC_BASE_PATH=/decisioning-portal
ENV VITE_USE_API=${VITE_USE_API}
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_API_RELATIVE=${VITE_API_RELATIVE}
ENV PUBLIC_BASE_PATH=${PUBLIC_BASE_PATH}
RUN npm run build

FROM node:22-bookworm-slim AS production
ARG PUBLIC_BASE_PATH=/decisioning-portal
WORKDIR /app
ENV NODE_ENV=production
ENV STATIC_DIST_DIR=/app/dist
ENV PUBLIC_BASE_PATH=${PUBLIC_BASE_PATH}
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server/*.mjs ./server/
COPY --from=frontend-build /src/dist ./dist
RUN chown -R node:node /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD sh -c 'curl -fsS "http://127.0.0.1:${PORT:-4000}/api/health" >/dev/null || exit 1'
CMD ["node", "server/index.mjs"]

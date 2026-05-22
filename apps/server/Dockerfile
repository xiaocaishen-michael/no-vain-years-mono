# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:22-alpine
ARG PNPM_VERSION=10.33.2

# ---------- Stage 1: builder ----------
# Full monorepo install + swc build + Prisma generate + pnpm deploy.
# Native bcrypt binding compiled here against node:22-alpine ABI; reused by runner.
FROM ${NODE_IMAGE} AS builder

RUN apk add --no-cache python3 make g++ libc6-compat

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /workspace

# Workspace manifests first (better layer cache)
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json nx.json tsconfig.base.json tsconfig.json ./
COPY apps/server/package.json ./apps/server/
COPY packages/api-client/package.json ./packages/api-client/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Source after deps for caching
COPY apps/server ./apps/server
COPY packages ./packages
COPY eslint.config.mjs ./

# Prisma 7 driver-adapter mode: TS client generated, no query engine binary at runtime
RUN pnpm -C apps/server exec prisma generate

# Compile TS → JS via @nx/js:swc (output to apps/server/dist/)
RUN pnpm nx run server:build --skip-nx-cache

# pnpm deploy: produce portable prod folder at /deploy.
# Runs in workspace context so it honors root pnpm.onlyBuiltDependencies allowlist
# (bcrypt/prisma/@prisma/engines build scripts run). --legacy because
# inject-workspace-packages is not enabled (default false in pnpm 10).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter=server --prod --legacy deploy /deploy

# ---------- Stage 2: runner ----------
FROM ${NODE_IMAGE} AS runner

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

# Strip global npm shipped with node:22-alpine — we use pnpm exclusively at
# build time and run plain `node main.js` at runtime, so npm is unused. Its
# bundled transitive deps (picomatch etc.) drag in HIGH/CRITICAL CVEs that
# Trivy flags (real, not false positives — e.g. CVE-2026-33671).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Deployed prod folder (package.json + node_modules with native bindings pre-built).
COPY --from=builder --chown=node:node /deploy /app

# dist/ and src/generated/prisma are gitignored so pnpm deploy skipped them —
# copy explicitly. dist/ already contains generated/prisma compiled JS.
COPY --from=builder --chown=node:node /workspace/apps/server/dist /app/dist

USER node

EXPOSE 3000

# Liveness probe — `/healthz/live` only asserts the Node process is alive
# (no Prisma/Redis check, per gap-audit A1). Lets docker/k8s restart a wedged
# container even when its dependency layer is intermittently down. Readiness
# (`/healthz/ready`) is exercised by orchestrator probes, not this HEALTHCHECK.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --spider --tries=1 http://localhost:3000/healthz/live || exit 1

# `docker run --init` recommended for proper PID 1 signal handling.
CMD ["node", "dist/main.js"]

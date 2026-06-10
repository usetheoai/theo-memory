# syntax=docker/dockerfile:1.7
#
# Multi-stage Dockerfile for `@usetheo/memory` standalone distribution.
#
# Strategy (per ADR D6 amended + ADR D13 + EC-38/39/40/47):
#   Stage 1 `builder`        — Node 22 bookworm-slim; npm ci with full dev
#                              deps; runs `npm run build` (tsc emits dist/).
#                              EC-40: typecheck failures abort the build.
#   Stage 2 `production-deps`— Same Node 22 slim base; npm ci --omit=dev
#                              produces a lean node_modules suitable for
#                              copying into the distroless runtime.
#   Stage 3 runtime          — gcr.io/distroless/nodejs22-debian12:nonroot
#                              (Debian 12 glibc → @xenova/transformers ONNX
#                              runtime + native deps compatible per EC-38).
#                              No shell present (EC-47 hard requirement);
#                              entrypoint invokes node binary directly per
#                              ADR D13 — Migrations-on-startup discipline
#                              lives inside `themory server` (T2.3) so no
#                              docker-entrypoint.sh needed.
#
# Image target: < 200MB. nonroot user (UID 65532) by base default.
#
# @see Plan theo-memory-standalone-p0 § T3.1 + ADR D6 + ADR D13
# @see EC-38 (glibc distroless) + EC-39 (optional deps included) + EC-40
#      (tsc gate in build) + EC-47 (distroless no-shell invariant)

ARG NODE_VERSION=22

###############################################################################
# Stage 1 — builder: install ALL deps + emit dist/ via tsc
###############################################################################
FROM node:${NODE_VERSION}-bookworm-slim AS builder

WORKDIR /build

# Copy manifests first so layer cache survives source-only edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

# Enable corepack for pnpm, then install all deps (incl. dev for typecheck + build).
RUN corepack enable && corepack prepare pnpm@10.34.1 --activate && \
    pnpm install --frozen-lockfile

# Copy ONLY the surface needed to run the build. Tests, docs, examples,
# .claude/ are excluded via .dockerignore — keeps the build context small.
COPY tsconfig.json tsconfig.build.json tsconfig.contract.json ./
COPY src/ ./src/

# EC-40 — tsc emits dist/ + postbuild copies migrations. Failure aborts
# the entire image build (no escape hatch by design).
RUN pnpm build

###############################################################################
# Stage 2 — production-deps: prune dev deps for the runtime image
###############################################################################
FROM node:${NODE_VERSION}-bookworm-slim AS production-deps

WORKDIR /build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

# Enable corepack for pnpm.
RUN corepack enable && corepack prepare pnpm@10.34.1 --activate

# Production-only install (omit dev + optional) — yields a lean node_modules
# tree suitable for copying into distroless.
ARG INCLUDE_OPTIONAL=false
RUN if [ "$INCLUDE_OPTIONAL" = "true" ]; then \
      pnpm install --prod --frozen-lockfile; \
    else \
      pnpm install --prod --frozen-lockfile --no-optional; \
    fi

###############################################################################
# Stage 3 — runtime: distroless Node 22 (no shell, nonroot)
###############################################################################
FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime

WORKDIR /app

# Bring the built artifacts + production deps into the runtime image.
# `node_modules/` must be co-located with `dist/` for ESM import resolution.
COPY --from=builder /build/dist/ /app/dist/
COPY --from=production-deps /build/node_modules/ /app/node_modules/
COPY package.json /app/package.json

# REST port (overridable at runtime via --port or PORT env).
EXPOSE 8080

# Default command — start the REST server. ADR D13: ENTRYPOINT invokes
# the Node binary directly (no shell layer); `themory server` owns the
# migrate-on-startup + SIGTERM graceful shutdown discipline (T2.3 + EC-32).
# Operator override pattern for migrate/health (T3.4):
#   docker run --entrypoint /nodejs/bin/node usetheo/themory:0.2.0 \
#     /app/dist/agent-tools/cli.js migrate
ENTRYPOINT ["/nodejs/bin/node", "/app/dist/agent-tools/cli.js", "server"]
CMD []

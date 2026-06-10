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
COPY package.json package-lock.json ./

# Full install (incl. dev deps for typecheck + build).
RUN npm ci --no-audit --no-fund

# Copy ONLY the surface needed to run the build. Tests, docs, examples,
# .claude/ are excluded via .dockerignore — keeps the build context small.
COPY tsconfig.json tsconfig.build.json tsconfig.contract.json ./
COPY src/ ./src/

# EC-40 — tsc emits dist/ + postbuild copies migrations. Failure aborts
# the entire image build (no escape hatch by design).
RUN npm run build

###############################################################################
# Stage 2 — production-deps: prune dev deps for the runtime image
###############################################################################
FROM node:${NODE_VERSION}-bookworm-slim AS production-deps

WORKDIR /build

COPY package.json package-lock.json ./

# Production-only install (omit dev + optional) — yields a lean node_modules
# tree suitable for copying into distroless.
#
# EC-39 absorption: the optional deps `@xenova/transformers`, `natural`, and
# `openai` are excluded by default to keep the image under the 200MB target.
# Consumers needing the Local embedder (`@usetheo/memory/embedders/local`)
# or the OpenAI providers add the dep at consumer-image build time, OR build
# this image with `--build-arg INCLUDE_OPTIONAL=true` (omit-optional flag is
# removed in that case).
ARG INCLUDE_OPTIONAL=false
RUN if [ "$INCLUDE_OPTIONAL" = "true" ]; then \
      npm ci --omit=dev --no-audit --no-fund; \
    else \
      npm ci --omit=dev --omit=optional --no-audit --no-fund; \
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

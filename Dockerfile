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
# Image size: ~476MB with INCLUDE_OPTIONAL=true + node-linker=hoisted (the default
# local embedder's @xenova/transformers + onnxruntime-node dominate; isolated-vm
# adds the skill-exec sandbox). The earlier "<200MB" target held only for the
# OpenAI-embedder-only profile (INCLUDE_OPTIONAL=false), which strips @xenova/onnx
# but also isolated-vm — choose that profile for a lean OpenAI-only deployment that
# needs neither the local embedder nor skill execution. nonroot user (UID 65532) by base default.
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

# Copy root manifests + ALL workspace package sources BEFORE install: pnpm needs
# every workspace package.json present to create the `node_modules/@usetheo/*`
# symlinks the build resolves against. The monorepo split (extract-cli-to-packages
# 2026-06-15) means `pnpm build` compiles core/api/mcp/agent-core/cli together;
# `scripts/` is required by postbuild:rewrite-aliases. Tests/docs/examples/.claude
# are excluded via .dockerignore — the context stays small.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY tsconfig.json tsconfig.build.json tsconfig.contract.json ./
COPY scripts/ ./scripts/
COPY packages/ ./packages/

# Native-addon build toolchain (python3/make/g++) — REQUIRED since M1
# (agentic-skill-execution-sandbox) added `isolated-vm`, an OPTIONAL native
# dependency. The slim base lacks node-gyp's toolchain, so without this pnpm
# silently SKIPS the optional native build and `pnpm build` (tsc) then fails with
# "Cannot find module 'isolated-vm'" (the type import in sandboxed-skill-executor.ts
# cannot resolve). onnxruntime-node (the local embedder's optional dep) compiles
# here too. Discarded with this stage; only dist/ is copied forward.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Enable corepack for pnpm, then install all deps (incl. dev for typecheck + build).
# BUILD RESILIENCE (production-runtime-hardening T3.1 / ADR D4): `sharp` (a
# transitive OPTIONAL dep of @xenova/transformers, the default local embedder)
# downloads libvips from a GitHub CDN at install — a transient-network flake that
# would abort the whole image build. Retry the install up to 3 times with backoff;
# fail LOUD after the cap (never infinite, never silent-skip a needed dep).
RUN corepack enable && corepack prepare pnpm@10.34.1 --activate && \
    MAX=3; for i in $(seq 1 $MAX); do \
      pnpm install --frozen-lockfile && break; \
      echo "pnpm install attempt $i/$MAX failed (transient CDN?); retrying in $((i*5))s..."; \
      sleep $((i*5)); \
      [ "$i" = "$MAX" ] && echo "pnpm install failed after $MAX attempts" && exit 1; \
    done

# EC-40 — tsc emits dist/ + postbuild copies migrations. Failure aborts the entire
# image build (no escape hatch by design). build:core runs FIRST so the main tsc
# resolves @usetheo/memory/* subpaths against core's freshly-built dist/*.d.ts
# (clean-checkout build-order fix).
RUN pnpm build

###############################################################################
# Stage 2 — production-deps: prune dev deps for the runtime image
###############################################################################
FROM node:${NODE_VERSION}-bookworm-slim AS production-deps

WORKDIR /build

# COPY the workspace package.json files (via the full packages/ tree) BEFORE the
# prod install. WITHOUT them, pnpm cannot see packages/core's OPTIONAL deps
# (`isolated-vm`, `onnxruntime-node`) — it installs the regular workspace deps
# (pg/drizzle/openai, hoisted from the lockfile) but SILENTLY SKIPS the optionals,
# so the distroless runtime is missing isolated-vm (skill-exec → 503) AND
# onnxruntime-node (local embedder broken). Sources are discarded with this stage;
# only node_modules is copied to the runtime. (production-runtime-hardening — the
# distroless 503 root cause found by the M2 live-test.)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/ ./packages/

# Native-addon build toolchain — the production install compiles the optional
# native deps (onnxruntime-node for the local embedder; isolated-vm for M1 skill
# execution) so the compiled `.node` binaries land in node_modules for the
# distroless runtime. Discarded with this stage; only node_modules is copied.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Enable corepack for pnpm.
RUN corepack enable && corepack prepare pnpm@10.34.1 --activate

# Production install — yields a lean node_modules tree for distroless.
# INCLUDE_OPTIONAL defaults to TRUE: the default LocalTransformerEmbedder
# (@xenova/transformers) requires `onnxruntime-node`, which @xenova declares as
# an OPTIONAL dependency. `--no-optional` strips it → the embedder crashes at
# runtime ("Cannot find package 'onnxruntime-node'"). Set the arg to false ONLY
# for an OpenAI-embedder-only deployment that never constructs the local embedder.
# BUILD RESILIENCE (T3.1 / ADR D4): same bounded retry as the builder stage —
# the prod install also pulls sharp→libvips from the CDN. Retry 3× then fail loud.
# DISTROLESS FLAT LAYOUT (production-runtime-hardening — the distroless 503 fix):
# `--config.node-linker=hoisted` produces a FLAT node_modules (every dep, incl.
# the OPTIONAL native `isolated-vm` + `onnxruntime-node`, at the top level) so the
# runtime — which copies ONLY this stage's root node_modules and runs the
# flattened /app/dist — can resolve them. pnpm's default (isolated) layout keeps
# optional workspace deps under packages/*/node_modules, which the runtime never
# copies → skill-exec 503 + local-embedder broken (the M2-live-test root cause).
ARG INCLUDE_OPTIONAL=true
RUN OPT_FLAG=$([ "$INCLUDE_OPTIONAL" = "true" ] && echo "" || echo "--no-optional"); \
    MAX=3; for i in $(seq 1 $MAX); do \
      pnpm install --prod --frozen-lockfile --config.node-linker=hoisted $OPT_FLAG && break; \
      echo "prod install attempt $i/$MAX failed (transient CDN?); retrying in $((i*5))s..."; \
      sleep $((i*5)); \
      [ "$i" = "$MAX" ] && echo "prod install failed after $MAX attempts" && exit 1; \
    done

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

# @xenova/transformers caches the downloaded MiniLM model. The distroless image
# runs as nonroot, so the default cache dir (under node_modules/) is read-only —
# without this, @xenova spams EACCES and cannot cache the model. Point the cache
# at a writable path so the model is reused within the container's lifetime.
# (Mount a volume here to persist across restarts / avoid re-download.)
ENV TRANSFORMERS_CACHE=/tmp/.transformers-cache

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

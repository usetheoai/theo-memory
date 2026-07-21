#!/usr/bin/env bash
# Dev deploy — M5 CD pipeline (playbook Phase 4). Runs ON the dev host
# (165.227.121.20), invoked by the publish workflow's deploy-dev job over SSH after a
# fresh image lands on GHCR. The workflow syncs this checkout to the published commit
# and logs into GHCR *before* calling this script; here we only pull the image and
# (re)start the themory API. pgvector (themem_pgvector) is left untouched. Fails the
# deploy (non-zero exit) unless the running image is the expected commit AND
# /v1/health + /v1/health/db are green.
set -euo pipefail

PORT="${THEMORY_PORT:-8080}"
COMPOSE=(docker compose -f docker-compose.yaml -f docker-compose.deploy.yml)

cd "$(dirname "$0")/.."

# Pull the just-built app image (app services only — pgvector is the pinned base image,
# already running from the platform local-env; left untouched to not disrupt neighbours).
# themory_mcp is the MCP upstream the Theo MCP Gateway fronts; it runs the SAME image
# under the `mcp` verb, so it MUST be redeployed in lockstep or the edge keeps serving
# an older MCP build than the REST API (M7).
"${COMPOSE[@]}" pull themory themory_mcp
# Bring up pgvector + both app services together so they share the compose network and
# resolve the DB by service name (pgvector:5432). The existing themem_pgvector (same
# compose project) is reused; its named volume preserves data across recreation.
"${COMPOSE[@]}" up -d pgvector themory themory_mcp

# VERSION GATE — assert the RUNNING image is the exact commit we deployed. The image
# carries the git sha as an OCI label (org.opencontainers.image.revision, stamped at
# build by the org reusable build-publish), so comparing it to the expected sha catches
# a stale :develop pull or a container that never recreated — the "did the version
# actually update?" failure this check exists for. EXPECTED_SHA is injected by the deploy
# job; falls back to HEAD.
#
# Both containers are gated: themory_app alone passing would let the MCP surface silently
# lag behind. A common cause of a mismatch here is benign but important to see — several
# commits landing in quick succession move the :develop tag ahead of the sha this job was
# queued for, so the pulled image is NEWER than expected, not stale.
EXPECTED_SHA="${EXPECTED_SHA:-$(git rev-parse HEAD)}"
for container in themory_app themory_mcp; do
  RUNNING_SHA="$(docker inspect "$container" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)"
  if [ "$RUNNING_SHA" != "$EXPECTED_SHA" ]; then
    echo "deploy FAILED — running ${container} image revision '${RUNNING_SHA}' != expected '${EXPECTED_SHA}'" >&2
    echo "  (a stale :develop image was pulled, the container did not recreate, or a newer commit already moved :develop)" >&2
    "${COMPOSE[@]}" ps themory themory_mcp || true
    exit 1
  fi
  echo "version verified — ${container} running image revision ${RUNNING_SHA}"
done

# HEALTH GATE — the deploy only succeeds when the API is alive (liveness, /v1/health)
# AND its DB is reachable (readiness, /v1/health/db). Gating on readiness means a deploy
# that cannot reach Postgres is reported failed, never silently green. (The playbook's
# /v1/healthz{,/ready} aliases are a deferred M5 follow-up; /v1/health{,/db} are the
# shipped equivalents.)
#
# themory_mcp is gated too, via its container healthcheck (it speaks MCP over TLS, not
# HTTP/JSON, so curl is the wrong probe). Gating only the REST API let a crash-looping
# MCP upstream — the very surface this milestone delivers — pass as a green deploy.
for _ in $(seq 1 30); do
  MCP_HEALTH="$(docker inspect themory_mcp --format '{{.State.Health.Status}}' 2>/dev/null || echo missing)"
  if curl -fsS "http://127.0.0.1:${PORT}/v1/health" >/dev/null 2>&1 \
    && curl -fsS "http://127.0.0.1:${PORT}/v1/health/db" >/dev/null 2>&1 \
    && [ "$MCP_HEALTH" = "healthy" ]; then
    echo "deploy ok — /v1/health + /v1/health/db green on :${PORT}; themory_mcp healthy"
    "${COMPOSE[@]}" ps themory themory_mcp
    exit 0
  fi
  sleep 2
done

echo "deploy FAILED — liveness/readiness not green after 60s (themory_mcp: ${MCP_HEALTH:-unknown})" >&2
"${COMPOSE[@]}" logs --tail=50 themory || true
"${COMPOSE[@]}" logs --tail=50 themory_mcp || true
exit 1

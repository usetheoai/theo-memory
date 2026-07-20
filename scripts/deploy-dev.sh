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

# Pull the just-built app image (themory only — pgvector is the pinned base image,
# already running from the platform local-env; left untouched to not disrupt neighbours).
"${COMPOSE[@]}" pull themory
# Bring up pgvector + themory together so they share the compose network and themory
# resolves the DB by service name (pgvector:5432). The existing themem_pgvector (same
# compose project) is reused; its named volume preserves data across recreation.
"${COMPOSE[@]}" up -d pgvector themory

# VERSION GATE — assert the RUNNING image is the exact commit we deployed. The image
# carries the git sha as an OCI label (org.opencontainers.image.revision, stamped at
# build by the org reusable build-publish), so comparing it to the expected sha catches
# a stale :develop pull or a container that never recreated — the "did the version
# actually update?" failure this check exists for. EXPECTED_SHA is injected by the deploy
# job; falls back to HEAD.
EXPECTED_SHA="${EXPECTED_SHA:-$(git rev-parse HEAD)}"
RUNNING_SHA="$(docker inspect themory_app --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)"
if [ "$RUNNING_SHA" != "$EXPECTED_SHA" ]; then
  echo "deploy FAILED — running themory image revision '${RUNNING_SHA}' != expected '${EXPECTED_SHA}'" >&2
  echo "  (a stale :develop image was pulled, or the container did not recreate)" >&2
  "${COMPOSE[@]}" ps themory || true
  exit 1
fi
echo "version verified — themory running image revision ${RUNNING_SHA}"

# HEALTH GATE — the deploy only succeeds when the API is alive (liveness, /v1/health)
# AND its DB is reachable (readiness, /v1/health/db). Gating on readiness means a deploy
# that cannot reach Postgres is reported failed, never silently green. (The playbook's
# /v1/healthz{,/ready} aliases are a deferred M5 follow-up; /v1/health{,/db} are the
# shipped equivalents.)
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/v1/health" >/dev/null 2>&1 \
    && curl -fsS "http://127.0.0.1:${PORT}/v1/health/db" >/dev/null 2>&1; then
    echo "deploy ok — /v1/health + /v1/health/db green on :${PORT}"
    "${COMPOSE[@]}" ps themory
    exit 0
  fi
  sleep 2
done

echo "deploy FAILED — liveness/readiness not green after 60s" >&2
"${COMPOSE[@]}" logs --tail=50 themory || true
exit 1

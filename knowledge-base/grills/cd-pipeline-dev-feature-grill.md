---
slug: cd-pipeline-dev
generated_by: roadmap-feature
milestone_id: M5
date: 2026-07-20
status: completed
out_of_scope_overlap: none (3 out-of-scope items are all memory-layer, orthogonal to CI/CD)
dod_shape: end-to-end ("100% funcional em dev") — owner provides infra prerequisites
sources:
  - Theo CD Pipeline — Ecosystem Playbook (claude.ai artifact c0455f76; 8 phases)
  - sibling reference impl: theo-rag (workflows + deploy files + endpoints, already adapted)
  - gap map (this session): in-repo vs infra boundary
---

# Grill — M5 cd-pipeline-dev (CD pipeline, 100% functional in dev)

## Q1 — What is this feature and why NOW?

Give theo-memory the same CD pipeline the sibling theo-rag already runs (the "Theo CD
Pipeline" 8-phase playbook): **every push to `develop`** builds an image, pushes it to GHCR,
and updates the dev host — gated three ways (the running image's git-sha equals the deployed
commit, liveness green, readiness/DB green); **a `v*` tag** publishes a signed release image
and deploys nothing (dev host untouched).

**Why now:** (1) the `publish` CI is currently **RED** — the recall-trace work (S2/M4) added the
`@usetheo/memory/recall-trace-pg` subpath, imported by the server + MCP entrypoints, but
`scripts/rewrite-dist-aliases.mjs` was not updated, so the fail-loud postbuild aborts
`pnpm build` → docker build fails → **no image ships at all** (this is the real blocker, NOT the
sharp/libvips CDN flake previously suspected). (2) theo-memory is the *reference* data-plane
capability yet is the only one without continuous delivery to a dev host — theo-rag already has
it. (3) The shared org substrate is ready: the self-hosted runner `theo-ci-theo-memory` is
online, the reusable `build-publish.yml` + GHCR exist.

## Q2 — Dependencies

- **M4 `[x]`** (done) — most recent milestone; no code dependency, just recency.
- **Owner-provided infra prerequisites** (block the end-to-end *proof*, not the code): repo
  secrets `DEV_SSH_KEY` + `OPENAI_API_KEY` set; repo variable `DEV_HOST` set; dev host
  provisioned (theo-memory mirror + docker/compose + deploy pubkey authorized + a running
  pgvector the deploy leaves untouched); the GHCR image coordinate confirmed (`ghcr.io/usetheo`
  vs `usetheodev` divergence between compose and the publish job — owner call).
- Already satisfied: Phase 1 runner (online), Phase 8 org fixes (in `usetheodev/theo`).

## Q3 — Definition of Done (end-to-end)

1. **Build green** — `@usetheo/memory/recall-trace-pg` (and sibling subpaths) registered in
   `rewrite-dist-aliases.mjs`; `pnpm build` + `docker build` succeed; the `publish` run passes
   the Trivy gate and pushes `ghcr.io/<org>/themory:develop`.
2. **`deploy-dev` job** (on `develop` only) SSHes to the dev host, syncs to the pushed sha,
   `docker login ghcr.io`, runs `scripts/deploy-dev.sh` which passes BOTH the **version gate**
   (running `themory_app` container's `org.opencontainers.image.revision` == pushed sha) and the
   **health gate** (liveness + readiness green). A `v*` tag SKIPS this job (dev host unchanged).
3. **Observability** — `GET /v1/version` → `{name,version,git_sha,built_at,node}` (deployed sha);
   `/v1/healthz` (liveness) + `/v1/healthz/ready` (readiness, `SELECT 1` 2s timeout) aliases;
   all auth-exempt + covered by the OpenAPI contract test.
4. **CI hardening** — `integration.yml` (pgvector on ephemeral port, `test:integration` gate) +
   `security-sast.yml` (semgrep via `docker run`, SHA-pinned `uses:`) on the self-hosted runner;
   `publish.yml` switched from `secrets: inherit` to an explicit secrets block.
5. **Proof (live)** — a push to `develop` turns every check green and `/v1/version` on the dev
   host shows the pushed sha; a tag publishes the signed release image with `deploy-dev` skipped.

## Q4 — Top 2 NEW risks

1. **Deploy secrets + SSH to a (shared) dev host.** The `deploy-dev` job writes a runtime `.env`
   containing `OPENAI_API_KEY` over SSH and logs into GHCR; a leaked `DEV_SSH_KEY` or a `.env` on
   a shared box is real exposure. Mitigate: dedicated ed25519 deploy key as a repo secret,
   provisioned over stdin (never argv/process-list), removed in an `always` step; `.env` chmod
   600; deploy dir isolated so it cannot disrupt neighbouring stacks (theo-rag's dev host is
   shared infra).
2. **Version-gate trusts an OCI label stamped by the ORG reusable workflow, not the Dockerfile.**
   `deploy-dev.sh` proves "which code runs" via `org.opencontainers.image.revision`, but the
   theo-memory Dockerfile does not stamp it — it relies on `usetheodev/theo`'s metadata-action.
   If the label is absent, or the GHCR coordinate (`usetheo` vs `usetheodev`) is wrong, the gate
   either always-fails or silently passes the wrong image. Mitigate: verify the label is present
   on a real pushed image + confirm the exact published coordinate before trusting the gate.

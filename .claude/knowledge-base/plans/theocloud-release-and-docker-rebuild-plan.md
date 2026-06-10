# Plan: TheoCloud Release PR + Docker Dual-Publish + API Key Rotation Docs

> **Version 1.0** — Ship the 10+ pending theo-cloud commits via a develop-to-main release PR, rebuild the Docker image to v0.2.0 with dual-publish to Docker Hub and GHCR, and document the API key rotation procedure. Operational plan — minimal production code, heavy CI config and documentation.

## Goal

> "Ship theo-cloud release PR with 10 pending commits, rebuild Docker image to v0.2.0 with dual-publish to Docker Hub (`usetheo/themory`) and GHCR (`ghcr.io/usetheo/themory`), and document API key rotation procedure, measured by `docker pull usetheo/themory:0.2.0` succeeding + theo-cloud PR merged + README key rotation section present."

## Context

theo-cloud's `develop` branch has 10+ commits ahead of `main` including BFF category forwarding (`627f4ef9`), Dashboard CSP fix (`addbf7b5`), F7 Clear filters (`1874cf68`), BFF date-range validation (`c898b2c6`), Dashboard test pin (`1cdc6005`), and RED TEAM documentation. Zero open PRs against main. The Docker image at `ghcr.io/usetheo/themory:0.1.0-alpha` is stale — it predates rate-limit middleware, CORS hardening, and category filter code shipped in v0.2.0. The README Docker section references only GHCR, missing the Docker Hub discoverability path. API key rotation has no operational documentation despite the FAANG auth lifecycle (Item 20) having shipped.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `.github/workflows/docker-publish.yml` | 101 | `7c65b0c` (2026-06-03) | GHCR build + Trivy scan workflow | Trivy CRITICAL+HIGH gate; `v*` tag trigger; `main` push trigger; permissions block |
| `docker-compose.prod.yaml` | 89 | `fc4ec5c` (2026-06-03) | Production compose stack for standalone distribution | `THEMORY_IMAGE` override pattern; pgvector healthcheck; EC-42 default-value discipline |
| `README.md` | 303 | `2cb8cac` (2026-06-09) | Public-facing project documentation | Voice rules per `public-copy.md`; Pre-release status; HERO/BODY/DEEP DIVE boundary |
| `CHANGELOG.md` (existing) | — | — | Release changelog | `[Unreleased]` section format per Keep a Changelog |

### Current callers / dependents

- **`.github/workflows/docker-publish.yml`** — consumed by GitHub Actions on tag push + main push. No other workflow references it.
- **`docker-compose.prod.yaml`** — consumed by operators running `docker compose -f docker-compose.prod.yaml up`. Referenced in README Docker section. Referenced in Dockerfile comments (line 96-97).
- **`README.md`** — consumed by npm/GitHub visitors. No programmatic consumer.

### Domain glossary

- **GHCR** — GitHub Container Registry (`ghcr.io`), GitHub's built-in Docker image registry
- **Dual-publish** — pushing the same Docker image to two registries (Docker Hub + GHCR) from one CI workflow
- **Trivy gate** — Aqua Trivy vulnerability scanner configured to fail CI on CRITICAL/HIGH CVEs
- **API key rotation** — replacing an active `theo_live_*` API key with a new one without downtime

### Architecture boundaries affected

- CI/CD layer (`.github/workflows/`) — extended with Docker Hub login + push step
- Documentation layer (`README.md`) — extended with dual registry + key rotation sections
- No DIP boundary crossed; no production TypeScript code touched

## Prior Art & Related Work

- **Internal**: Plan `theo-memory-standalone-p0` T3.3 established the GHCR workflow pattern now being extended
- **Internal**: Plan `theo-memory-faang-auth-lifecycle` shipped the `ApiKeyAuthVerifier` + `themory keys {create,list,rotate,revoke}` CLI that the rotation docs will reference
- **External**: Docker's multi-registry publish pattern — `docker/login-action` supports multiple registry logins in sequence; standard pattern used by Grafana, Prometheus, Caddy

## Objective

- [ ] O1 — theo-cloud PR develop-to-main opened with summary of 10+ commits, awaiting human approval
- [ ] O2 — `docker-compose.prod.yaml` default VERSION updated from `0.1.0-alpha` to `0.2.0`
- [ ] O3 — CI workflow publishes to both Docker Hub (`usetheo/themory`) and GHCR (`ghcr.io/usetheo/themory`) on tag push
- [ ] O4 — README documents API key rotation procedure
- [ ] O5 — README Docker section updated with dual registry + `docker pull usetheo/themory` as primary

## ADRs

### D1 — Dual-publish to Docker Hub + GHCR

**Decision:** Publish every release image to both `usetheo/themory` on Docker Hub and `ghcr.io/usetheo/themory` on GHCR. GHCR stays primary (CI already wired); Docker Hub added for discoverability.

**Rationale:** Docker Hub is the default registry for `docker pull` — no prefix needed (`docker pull usetheo/themory:0.2.0` vs `docker pull ghcr.io/usetheo/themory:0.2.0`). Higher discoverability for OSS consumers who search Docker Hub. GHCR unlimited pulls for public images means no rate-limit risk on the primary path; Docker Hub free tier has 100 pulls/6h anonymous but this is acceptable for an OSS project at pre-release stage.

**Alternatives considered:**
- *GHCR-only (status quo)* — rejected because Docker Hub is the industry default; requiring `ghcr.io/` prefix hurts adoption for users who expect bare `docker pull`.
- *Docker Hub-only* — rejected because GHCR is already wired, zero-config with `GITHUB_TOKEN`, unlimited pulls. Dropping it would lose CI simplicity.

**Consequences:** CI workflow adds ~10 lines (Docker Hub login step + additional tags). Requires Docker Hub org `usetheo` to exist + `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` secrets in GitHub repo settings. Operator must create Docker Hub org before the first tag push.

### D2 — Image tagging convention

**Decision:** On tag push (`v*`): publish `x.y.z` + `x.y` + `latest` to both registries. On `main` push: publish `edge` + `sha-<short>` to GHCR only (Docker Hub gets stable tags only).

**Rationale:** `latest` on Docker Hub is the default pull target for new users. `edge` on GHCR serves CI/preview consumers who want bleeding-edge. Keeping `edge` off Docker Hub prevents accidental production use of unstable builds.

**Alternatives considered:**
- *Publish `edge` to Docker Hub too* — rejected because Docker Hub's `latest` confusion is already bad enough; adding `edge` increases risk of operators accidentally pulling unstable images.
- *No `latest` tag* — rejected because `docker pull usetheo/themory` (no tag) defaults to `latest`; omitting it breaks the zero-friction install path.

**Consequences:** `docker/metadata-action` tags block needs conditional logic for Docker Hub vs GHCR. Slightly more complex tag matrix but well within the action's capabilities.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Docker Hub org `usetheo` does not exist yet — first tag push will fail if not created | High | Pre-flight operator action: create org + add secrets before merging. Document in plan T2.2 as prerequisite. | Operator |
| Docker Hub rate limits (100 pulls/6h anonymous) may affect high-traffic consumers | Low | GHCR remains primary in docs for CI/automated use; Docker Hub for human `docker pull` | Plan author |
| theo-cloud PR is cross-repo — cannot be automated from theo-memory's CI | Low | Manual PR via `gh pr create` in theo-cloud directory. Human approval gate per Unbreakable Rule 4. | Operator |
| README edits may conflict with concurrent theo-memory work on develop | Low | Coordinate with any in-flight PRs; atomic commit on develop | Plan author |

## Unresolved Questions

- Q1 — Does the Docker Hub org `usetheo` already exist, or does the operator need to create it? (Prerequisite for T2.2; must be resolved before CI runs.)

## Dependency Graph

```
Phase 1 (theo-cloud PR) ──▶ Phase 4 (Integration Validation)
                                    ▲
Phase 2 (Docker rebuild)  ──────────┘
         T2.1 ──▶ T2.2             ▲
                                    │
Phase 3 (Operational docs) ────────┘
         T3.1 ──▶ T3.2
```

Phases 1, 2, and 3 can run in parallel. Phase 4 validates all three.

---

## Phase 1: theo-cloud Release PR

**Objective:** Open a develop-to-main PR in the theo-cloud repository summarizing 10+ pending commits. Halt at human approval gate.

### T1.1 — Open theo-cloud release PR

#### Objective
Open PR develop-to-main in theo-cloud with structured summary of all pending commits.

#### Why this step (action + reasoning)

1. **What this step does** — runs `gh pr create` in the theo-cloud repo targeting `main` from `develop`, with a PR body summarizing the 10+ commits by category (BFF, Dashboard, Security, Docs).
2. **Why it is necessary now** — theo-cloud `develop` has drifted 10+ commits from `main`. The Docker image rebuild (Phase 2) depends on these changes being on `main` for the tag-triggered CI to include them. Per D1, the release PR is the vehicle.

#### Evidence
- `git log --oneline origin/main..origin/develop` in theo-cloud shows 10+ commits including `627f4ef9`, `addbf7b5`, `1874cf68`, `c898b2c6`, `1cdc6005`
- Zero open PRs: `gh pr list --base main --head develop --state open` returns empty

#### Files to edit
```
(none in theo-memory — this task operates on the theo-cloud repo via gh CLI)
```

#### Deep file dependency analysis
No theo-memory files touched. Cross-repo operation only.

#### Deep Dives
- PR body must categorize commits: BFF changes, Dashboard fixes, Security hardening (rate-limit, CORS), Documentation
- PR must NOT be auto-merged — Unbreakable Rule 4 requires human approval

#### TDD
```
RED:     Verify no open PR exists: `gh pr list --base main --head develop --state open` returns 0 results
GREEN:   Run `gh pr create --base main --head develop --title "..." --body "..."`
REFACTOR: None expected
VERIFY:  `gh pr list --base main --head develop --state open` returns exactly 1 result
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] PR opened in theo-cloud targeting main from develop
- [ ] PR body summarizes all pending commits grouped by category
- [ ] PR is NOT auto-merged — awaiting human approval
- [ ] PR passes any existing CI checks on theo-cloud

#### DoD
- [ ] PR URL recorded in implementation log
- [ ] CHANGELOG.md updated under `[Unreleased]` with the theo-cloud release entry

---

## Phase 2: Docker Image Rebuild

**Objective:** Update compose defaults to v0.2.0 and add Docker Hub as a secondary publish target in CI.

### T2.1 — Update docker-compose.prod.yaml default VERSION

#### Objective
Bump the default VERSION from `0.1.0-alpha` to `0.2.0` so operators pulling without explicit VERSION get the current release.

#### Why this step (action + reasoning)

1. **What this step does** — edits the `${VERSION:-0.1.0-alpha}` default in `docker-compose.prod.yaml` line 36 to `${VERSION:-0.2.0}`.
2. **Why it is necessary now** — the v0.2.0 tag is already pushed to git. The compose file's default must track the latest stable tag so `docker compose up` without `VERSION=` env pulls the right image. Per Baseline Context, EC-42 established the fail-safe-default pattern.

#### Evidence
- `docker-compose.prod.yaml` line 36: `image: ${THEMORY_IMAGE:-ghcr.io/usetheo/themory:${VERSION:-0.1.0-alpha}}`
- v0.2.0 tag exists: `git tag -l 'v0.2*'`

#### Files to edit
```
docker-compose.prod.yaml — update VERSION default from 0.1.0-alpha to 0.2.0
```

#### Deep file dependency analysis
- **`docker-compose.prod.yaml`** (89 LoC) — holds the `THEMORY_IMAGE` default with embedded `VERSION`. Change is a 1-line string substitution. No downstream callers beyond operators and README docs.

#### Deep Dives
- The `THEMORY_IMAGE` override pattern (line 36) must be preserved — operators may set it to `themory:dev` for local builds
- The pgvector image tag (`ankane/pgvector:v0.5.1`) is NOT touched — it tracks the pgvector version, not themory

#### TDD
```
RED:     grep '0.1.0-alpha' docker-compose.prod.yaml returns a match (current state)
GREEN:   Edit the file; grep '0.2.0' docker-compose.prod.yaml returns a match
REFACTOR: None expected
VERIFY:  docker compose -f docker-compose.prod.yaml config (validates YAML syntax)
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] `docker-compose.prod.yaml` default VERSION is `0.2.0`
- [ ] `docker compose -f docker-compose.prod.yaml config` parses without error
- [ ] `THEMORY_IMAGE` override pattern preserved

#### DoD
- [ ] Commit on develop: `chore(docker): bump compose default VERSION to 0.2.0`
- [ ] CHANGELOG.md updated

---

### T2.2 — Add Docker Hub dual-publish to CI workflow

#### Objective
Extend `.github/workflows/docker-publish.yml` to publish to Docker Hub (`usetheo/themory`) alongside GHCR on tag push.

#### Why this step (action + reasoning)

1. **What this step does** — adds a Docker Hub login step using `docker/login-action` with `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` secrets, extends the metadata-action tags to emit Docker Hub image references, and adds a second push step (or extends the existing one) targeting Docker Hub. Per D2, `edge` tags go to GHCR only; stable tags go to both.
2. **Why it is necessary now** — per D1, Docker Hub discoverability is a competitive advantage for OSS adoption. The CI workflow is the single place where image publishing happens; extending it now means v0.2.0 (the next tag push after this plan ships) will be the first dual-published release.

#### Evidence
- Current workflow at `.github/workflows/docker-publish.yml` (101 LoC, `7c65b0c`) publishes to GHCR only
- `docker/login-action@v3` supports Docker Hub via `registry: docker.io` (or omitting registry, which defaults to Docker Hub)

#### Files to edit
```
.github/workflows/docker-publish.yml — add Docker Hub login + dual-publish tags
```

#### Deep file dependency analysis
- **`.github/workflows/docker-publish.yml`** (101 LoC) — the only CI workflow for Docker image publishing. Adding Docker Hub login requires `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` as repository secrets. The Trivy scan step is unchanged — it scans the locally-built image before any push. The existing GHCR push step is preserved; a second metadata-action + push step targets Docker Hub.

#### Deep Dives
- **Secrets prerequisite:** `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` must be added to GitHub repo settings before the workflow runs. The workflow should use `if: secrets.DOCKERHUB_TOKEN != ''` to gracefully skip Docker Hub publish when secrets are not configured (fail-open for GHCR-only environments).
- **Tag matrix per D2:**
  - Tag push (`v*`): Docker Hub gets `x.y.z` + `x.y` + `latest`; GHCR gets `x.y.z` + `x.y` + `sha-<short>`
  - Main push: GHCR gets `edge` + `sha-<short>`; Docker Hub skipped
- **Trivy gate unchanged** — scan happens on the locally-built image before either push

#### Pseudo-code / Signatures

```yaml
# New step after GHCR login:
- name: Log in to Docker Hub
  if: env.DOCKERHUB_TOKEN != ''
  uses: docker/login-action@v3
  with:
    username: ${{ secrets.DOCKERHUB_USERNAME }}
    password: ${{ secrets.DOCKERHUB_TOKEN }}

# New metadata step for Docker Hub tags:
- name: Extract Docker Hub metadata
  if: env.DOCKERHUB_TOKEN != ''
  id: meta-dockerhub
  uses: docker/metadata-action@v5
  with:
    images: docker.io/usetheo/themory
    tags: |
      type=semver,pattern={{version}}
      type=semver,pattern={{major}}.{{minor}}
      type=raw,value=latest,enable=${{ startsWith(github.ref, 'refs/tags/v') }}

# New push step for Docker Hub:
- name: Push image to Docker Hub
  if: env.DOCKERHUB_TOKEN != '' && steps.meta-dockerhub.outputs.tags != ''
  uses: docker/build-push-action@v6
  with:
    context: .
    push: true
    tags: ${{ steps.meta-dockerhub.outputs.tags }}
    cache-from: type=gha
```

#### TDD
```
RED:     Validate current workflow has no 'docker.io' reference: grep 'docker.io' .github/workflows/docker-publish.yml returns 0
GREEN:   Edit workflow; grep 'docker.io' returns matches; `actionlint .github/workflows/docker-publish.yml` passes (if available)
REFACTOR: Ensure DOCKERHUB_TOKEN conditional guards are consistent across all new steps
VERIFY:  YAML syntax valid; workflow_dispatch manual trigger can be tested
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Workflow contains Docker Hub login step with `if` guard on `DOCKERHUB_TOKEN`
- [ ] Workflow contains Docker Hub metadata step producing `x.y.z` + `x.y` + `latest` tags
- [ ] Workflow contains Docker Hub push step
- [ ] GHCR publish path unchanged (existing steps unmodified)
- [ ] Trivy gate position unchanged (before any push)
- [ ] `edge` tag only goes to GHCR, not Docker Hub (per D2)
- [ ] Pass: YAML syntax validation

#### DoD
- [ ] Commit on develop: `feat(ci): T2.2 dual-publish Docker Hub + GHCR (D1)`
- [ ] CHANGELOG.md updated

---

## Phase 3: Operational Documentation

**Objective:** Document API key rotation and update README Docker section for dual registry.

### T3.1 — Document API key rotation in README

#### Objective
Add an operational section to README covering the API key rotation procedure using the `themory keys` CLI.

#### Why this step (action + reasoning)

1. **What this step does** — adds a subsection under or near the existing CLI section documenting the key rotation workflow: create new key, update consumers, revoke old key.
2. **Why it is necessary now** — Item 20 (FAANG auth lifecycle) shipped `themory keys {create,list,rotate,revoke}` but no README documentation exists for the operational rotation procedure. An operator encountering a compromised key has no documented path.

#### Evidence
- README CLI section (lines 192-206) lists `themory keys create/list/revoke` but no rotation procedure
- `themory keys rotate` command exists per Item 20 acceptance

#### Files to edit
```
README.md — add API key rotation subsection
```

#### Deep file dependency analysis
- **`README.md`** (303 LoC) — public documentation. The CLI section at lines 192-206 already lists key commands. Adding a rotation subsection (~15-20 lines) after the CLI block. Voice rules from `public-copy.md` apply: DEEP DIVE section, technical-direct tone is appropriate.

#### Deep Dives
- Rotation procedure: (1) `themory keys create --name app-v2 --scope memory:read,memory:write` (2) update consumer env `THEMEMORY_API_KEY` (3) verify consumer works with new key (4) `themory keys revoke <old-id>`
- Must emphasize zero-downtime pattern: create new before revoking old
- Section belongs in DEEP DIVE zone (below `## How it works` boundary) per `public-copy.md`

#### TDD
```
RED:     grep 'rotation' README.md returns 0 matches
GREEN:   Add rotation section; grep 'rotation' returns matches
REFACTOR: Ensure voice compliance per public-copy.md
VERIFY:  Manual review of README rendering
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] README contains API key rotation subsection
- [ ] Subsection documents create-then-revoke zero-downtime pattern
- [ ] `themory keys rotate` command referenced
- [ ] Voice rules respected (technical-direct in DEEP DIVE)

#### DoD
- [ ] Commit on develop: `docs(readme): T3.1 API key rotation procedure`
- [ ] CHANGELOG.md updated

---

### T3.2 — Update README Docker section for dual registry

#### Objective
Update the README Docker section to show `docker pull usetheo/themory` as the primary pull command, with GHCR as alternative.

#### Why this step (action + reasoning)

1. **What this step does** — rewrites the Docker section (lines 177-188) to lead with the Docker Hub coordinate (`usetheo/themory:0.2.0`), mention GHCR as alternative, and bump the version from `0.1.0-alpha` to `0.2.0`.
2. **Why it is necessary now** — per D1, Docker Hub is the discoverability path. The README is the first place a new user looks for install instructions. Leading with the shorter `docker pull usetheo/themory` removes friction vs the `ghcr.io/` prefix.

#### Evidence
- README Docker section (lines 177-188) currently shows only `ghcr.io/usetheo/themory:0.1.0-alpha`

#### Files to edit
```
README.md — rewrite Docker section with dual registry + v0.2.0
```

#### Deep file dependency analysis
- **`README.md`** — Docker section at lines 177-188. Rewrite replaces `ghcr.io/usetheo/themory:0.1.0-alpha` with `usetheo/themory:0.2.0` as primary, adds note about GHCR alternative. Dockerfile ENTRYPOINT comment (line 96-97) references `ghcr.io/usetheo/themory:0.1.0-alpha` — update that reference too for consistency.

#### Deep Dives
- Voice: Docker section is DEEP DIVE (below `## How it works` equivalent), so technical-direct is fine
- Must preserve the distroless/Trivy/healthcheck feature bullets (line 188)
- Add both registries so users can choose based on their environment

#### TDD
```
RED:     grep '0.1.0-alpha' README.md returns matches in Docker section
GREEN:   Edit section; grep 'usetheo/themory:0.2.0' README.md returns matches; grep 'docker.io\|Docker Hub' README.md returns matches
REFACTOR: Ensure Dockerfile comment at line 96-97 also updated
VERIFY:  Manual review of README rendering
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] README Docker section leads with `docker pull usetheo/themory:0.2.0`
- [ ] GHCR alternative documented
- [ ] Version references updated from `0.1.0-alpha` to `0.2.0`
- [ ] Feature bullets preserved (distroless, Trivy, healthcheck)
- [ ] Dockerfile comment updated for consistency

#### DoD
- [ ] Commit on develop: `docs(readme): T3.2 dual registry Docker section + v0.2.0`
- [ ] CHANGELOG.md updated

---

## Phase 4: Integration Validation (MANDATORY)

**Objective:** Validate all changes work together — compose file parses, CI workflow is valid, README is consistent.

### Execution

```bash
# Compose file validation
docker compose -f docker-compose.prod.yaml config

# CI workflow YAML syntax (if actionlint available)
actionlint .github/workflows/docker-publish.yml 2>/dev/null || echo "actionlint not installed — manual review"

# README consistency checks
grep -c 'usetheo/themory:0.2.0' README.md    # expect >= 2 (Docker section)
grep -c '0.1.0-alpha' README.md                # expect 0 (all references updated)
grep -c 'rotation' README.md                   # expect >= 1 (key rotation section)

# theo-cloud PR status
gh pr list --repo usetheo/theo-cloud --base main --head develop --state open
```

### Acceptance Criteria

- [ ] `docker compose -f docker-compose.prod.yaml config` exits 0
- [ ] No `0.1.0-alpha` references remain in README.md Docker section
- [ ] README contains `usetheo/themory:0.2.0` references
- [ ] README contains API key rotation section
- [ ] CI workflow YAML is syntactically valid
- [ ] theo-cloud PR is open and awaiting approval

### If Validation Fails

1. Identify which check failed
2. Fix in the originating phase's file
3. Re-run validation chain
4. Pre-existing issues logged but do not block plan completion

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | theo-cloud 10+ commits not on main | T1.1 | Release PR opened |
| 2 | Docker image stale at 0.1.0-alpha | T2.1 | Compose default bumped to 0.2.0 |
| 3 | No Docker Hub publishing | T2.2 | Dual-publish CI workflow |
| 4 | No API key rotation docs | T3.1 | README rotation section |
| 5 | README Docker section GHCR-only | T3.2 | Dual registry documentation |

**Coverage: 5/5 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] `docker compose -f docker-compose.prod.yaml config` passes
- [ ] CI workflow YAML valid
- [ ] README updated with dual registry + key rotation
- [ ] CHANGELOG.md updated under `[Unreleased]`
- [ ] theo-cloud PR opened and URL recorded
- [ ] No `0.1.0-alpha` stale references in modified files
- [ ] Plan archived — after `/review` returns `READY_TO_MERGE` AND the PR has been merged, move to `knowledge-base/plans/completed/`

## Failure scenarios (when I/O external)

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| Docker Hub registry | `DOCKERHUB_TOKEN` secret missing | Run workflow without secret configured | `if` guard skips Docker Hub steps; GHCR publish succeeds alone |
| Docker Hub org | `usetheo` org does not exist | Attempt push without org creation | Push step fails with 403; GHCR push unaffected (separate step) |
| GitHub API (`gh pr create`) | Rate limit or auth failure | `gh auth status` pre-check | Fail-fast with clear error; retry after auth refresh |

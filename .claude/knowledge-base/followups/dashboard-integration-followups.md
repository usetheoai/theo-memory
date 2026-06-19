# Follow-ups — TheMemory ↔ theo-cloud dashboard integration

**Created:** 2026-06-19
**Source:** the dashboard-integration session (theo-memory v0.7.0 + theo-cloud v0.1.0 released) + its `/review` reports.
**Status legend:** ACTIONABLE (plan-ready) · BLOCKED-EXTERNAL · FROZEN-P0 · OWNER-DECISION

Tracks the deferred items so they are not lost in chat. The two actionable LOW review findings (`attributedPeerOf` DRY extract, cross-subject entities isolation e2e leg) were **already closed** in `theo-memory 6ee371e` + `theo-cloud 73f9c95` and are NOT listed here.

---

## 1. Clean-rebuild e2e — make the TheMemory image build resilient to the `sharp` CDN

**Status:** DONE / SHIPPED (2026-06-19, CTO request) — durable fix landed; clean `make e2e` GREEN.

**Problem (resolved).** `make e2e` (theo-cloud) builds the TheMemory image from source; `pnpm install --frozen-lockfile` ran `sharp@0.32.6`'s postinstall, which downloaded libvips from the GitHub CDN. That CDN timed out persistently, making the clean rebuild non-reproducible.

**Why `sharp` is there.** `pnpm why sharp` → pulled by `@xenova/transformers@2.17.2` (the LocalTransformerEmbedder). It is listed in `package.json` pnpm build-allowlist (`onlyBuiltDependencies`) so its postinstall runs. TheMemory uses TEXT embeddings only; `sharp` (image processing) is never invoked at runtime — Transformers.js lazy-loads it only for `RawImage` inputs.

**Fix shipped (version pin).** Pinned `sharp` to `^0.33.5` via a pnpm `overrides` entry. sharp 0.33+ resolves libvips from npm-hosted `@img/sharp-libvips-*` packages (NO GitHub CDN), so `pnpm install --frozen-lockfile` is hermetic. Rejected alternatives: (a) removing `sharp` from the build-allowlist was unsafe — `@xenova/transformers` `image.js:16` does a STATIC `import sharp from 'sharp'`, so dropping the built binary risks the text path; (b) the apt+`SHARP_FORCE_GLOBAL_LIBVIPS` route failed (Debian libvips 8.14.1 < sharp 0.32.6's required 8.14.5, and `SHARP_FORCE_GLOBAL_LIBVIPS` only exists in sharp 0.33+, so it would have needed the upgrade anyway).

**Validation (all GREEN).** Clean `make e2e` (no `THEMORY_IMAGE` override) PASS — image built from source, `sharp@0.33.5 install: Done` in both builder + production-deps stages with NO `github.com/lovell` download; `TestMemoryE2E_FullVerbSurface` (incl. attribution round-trip + cross-subject isolation) + `TestMemoryE2E_GatewayProxyRoundTrip` PASS. theo-memory api 169/169 + root contract suite 971/971 (after a co-shipped index-signature type fix in `metrics-entities.test.ts`). `@xenova/transformers` imports cleanly against 0.33.x.

**Classification:** hardening (CI reliability), NOT a frozen feature. Shipped on `theo-memory` `develop` (`[Unreleased] § Fixed`). Memory updated: [[themory-image-build-sharp-cdn]].

---

## 2. Skills (Repo tier) dashboard surface — unfreeze required

**Status:** FROZEN-P0 + OWNER-DECISION (CLAUDE.md Rule 10 — no plan/PR/discovery-implementation until the owner unfreezes Roadmap Item 8's dashboard surface)

**What exists.** The `dashboard-phase2-skills-bitemporal-attribution` blueprint (SHIPPABLE 98.5) already drafted the contract (ADR D2): a NEW read-only TheMemory REST endpoint `GET /v1/scopes/skill/:repoId/skills` (today `GET /v1/scopes/skill/*` returns `501 SKILL_LISTING_NOT_IMPLEMENTED`), fronted by the gateway BFF, surfaced as a dashboard Skills tab. Letta evidence confirms a browse view needs only `{name/hash, source, json_schema}` rows + ZERO sandbox deps (e2b/modal are optional extras).

**Gate.** Project-owner unfreeze of the skills dashboard surface (it is decision-support for that conversation). On unfreeze → `/to-plan` from the blueprint's ADR D2.

**Do NOT** open a plan/PR/implementation against this until unfrozen.

---

## 3. Entities NER extraction — richer than `attributed_to`

**Status:** FROZEN-P0 (new feature; post-P0 / owner)

**What shipped.** `GET /v1/scopes/:type/:id/entities` derives entities from the distinct `attributed_to` peers (v1.1 multi-peer attribution — a REAL populated column). The standalone `entities` table is an entity-boost store the current write pipeline does NOT populate (verified: zero `INSERT INTO entities`), so a true NER-style "people/places the agent remembers" extraction is not available.

**Remediation (post-P0).** Build an entity extraction-and-persist pipeline (LLM/NER over memory text) + a scope link + a migration, then have `entities` aggregate from it. New feature → FROZEN under P0; plan post-closure.

**Today's behavior is honest:** entities = attributed peers; the dashboard renders empty gracefully when no `attributed_to` is set; disclosed in CHANGELOG + the blueprint.

---

## 4. Skill `forget` scope guard — add `workspace_id` to the ownership check (adjacent debt)

**Status:** ACTIONABLE (small hardening) — surfaced by `/review dashboard-phase2b-skills-browse` (LOW-1). NOT reachable through the read-only browse feature.

**Problem.** `LocalScopedSkillMemory.forget` (`packages/core/src/infrastructure/db/scoped-skill-memory.ts`) verifies `row.metadata['agent_id'] === this.scope.repoId` but does NOT also assert `row.metadata['workspace_id'] === (this.deps.workspaceId ?? 'default')`. On a multi-workspace deployment, a skillId from another workspace that shares the same `agent_id`/repoId would pass this in-memory guard (the canonical `forgetDelegate`/`LocalMemory.forget` may re-scope downstream, but the guard itself is incomplete).

**Why deferred.** The `dashboard-phase2b-skills-browse` feature is read-only — no `forget` path is exposed through the gateway/dashboard, so this is not reachable via the shipped surface. Pre-existing; not introduced by that cycle. Fix is a one-line guard extension + a unit test.

**Remediation.** Add `&& row.metadata['workspace_id'] === (this.deps.workspaceId ?? 'default')` to the `isOwnedSkill` check; add a cross-workspace forget-rejection unit test. Classification: hardening (multi-tenant isolation), permitted under P0.

## Cross-references
- Blueprint: `.claude/knowledge-base/discoveries/blueprints/dashboard-phase2-skills-bitemporal-attribution-blueprint.md`
- Reviews: `dashboard-phase2a-attribution-asof-review-2026-06-19.md`, `theo-memory-dashboard-full-integration` review
- Releases: theo-memory `v0.7.0`, theo-cloud `v0.1.0`
- Memory: [[themory-entities-table-unpopulated]] (entities table never written)
- Inquebrável Rule 10 (P0 freeze) — `/home/paulo/Projetos/usetheo/theo-data/theo-memory/CLAUDE.md § PRIORITY 0`

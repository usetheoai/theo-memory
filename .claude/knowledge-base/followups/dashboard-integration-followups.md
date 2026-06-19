# Follow-ups — TheMemory ↔ theo-cloud dashboard integration

**Created:** 2026-06-19
**Source:** the dashboard-integration session (theo-memory v0.7.0 + theo-cloud v0.1.0 released) + its `/review` reports.
**Status legend:** ACTIONABLE (plan-ready) · BLOCKED-EXTERNAL · FROZEN-P0 · OWNER-DECISION

Tracks the deferred items so they are not lost in chat. The two actionable LOW review findings (`attributedPeerOf` DRY extract, cross-subject entities isolation e2e leg) were **already closed** in `theo-memory 6ee371e` + `theo-cloud 73f9c95` and are NOT listed here.

---

## 1. Clean-rebuild e2e — make the TheMemory image build resilient to the `sharp` CDN

**Status:** BLOCKED-EXTERNAL (today) → ACTIONABLE (small hardening cycle when picked up)

**Problem.** `make e2e` (theo-cloud) builds the TheMemory image from source; `pnpm install --frozen-lockfile` runs `sharp@0.32.6`'s postinstall, which downloads libvips from the GitHub CDN. That CDN timed out persistently this session (≥5 attempts), so the clean rebuild could not run. The Phase 1 + Phase 2A e2e were validated against `themory-e2e:patched` (the prior image + the fixed handlers overlaid via esbuild); the fixes are also unit-proven (169/169). Disclosed in both repos' CHANGELOGs + PRs.

**Why `sharp` is there.** `pnpm why sharp` → pulled by `@xenova/transformers@2.17.2` (the LocalTransformerEmbedder). It is listed in `package.json` pnpm build-allowlist (`onlyBuiltDependencies`) so its postinstall runs. TheMemory uses TEXT embeddings only; `sharp` (image processing) is never invoked at runtime — Transformers.js lazy-loads it only for `RawImage` inputs.

**Remediation (validate before shipping).** Make the image build not depend on the libvips download. Candidate approaches (pick one after testing):
- (a) Remove `sharp` from the pnpm build-allowlist so its postinstall is skipped (installs without the native binary). **MUST TEST:** that `@usetheo/memory/embedders/local` (LocalTransformerEmbedder) still imports + produces a text embedding without `sharp` built — i.e. `@xenova/transformers` does not eager-`require('sharp')` at module load. If it does, this approach is out.
- (b) Pin/cache the libvips binary in the builder layer (vendored or a registry mirror) so the build is hermetic.
- (c) `--no-optional` on the production-deps install IF `sharp` is genuinely optional in the resolved tree.

**Acceptance:** a clean `make e2e` (no `THEMORY_IMAGE` override) goes GREEN, including the Phase 2A attribution round-trip + cross-subject isolation legs. Re-run the existing e2e once the CDN recovers as the immediate first check — it may already pass without any change.

**Classification:** hardening (CI reliability), NOT a frozen feature → a small TDD cycle is permitted under P0.

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

## Cross-references
- Blueprint: `.claude/knowledge-base/discoveries/blueprints/dashboard-phase2-skills-bitemporal-attribution-blueprint.md`
- Reviews: `dashboard-phase2a-attribution-asof-review-2026-06-19.md`, `theo-memory-dashboard-full-integration` review
- Releases: theo-memory `v0.7.0`, theo-cloud `v0.1.0`
- Memory: [[themory-entities-table-unpopulated]] (entities table never written)
- Inquebrável Rule 10 (P0 freeze) — `/home/paulo/Projetos/usetheo/theo-data/theo-memory/CLAUDE.md § PRIORITY 0`

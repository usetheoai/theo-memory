# Implementation summary — M6 claude-code-memory-integration

**Slug:** claude-code-memory-integration · **Milestone:** M6 · **Date:** 2026-07-21
**Plan:** `knowledge-base/plans/claude-code-memory-integration-plan.md` (SHIPPABLE_WITH_CAVEATS)
**Blueprint:** `knowledge-base/discoveries/blueprints/claude-code-theo-memory-integration-blueprint.md`

## What shipped (all committed on develop)

| Task | Deliverable | Commit | Evidence |
|---|---|---|---|
| T1.1 | `app.ts` SRP refactor (427→168 LoC) → `register-middleware.ts` + `register-routes.ts`; + `/v1/version` + `/v1/healthz{,/ready}` (closes M5 deferred) | `40d6743` | api suite 275/275; behavior-preserving (routing+auth+rbac green) |
| T1.2+T1.3 | `POST /v1/remember/batch` (array, `infer:false`, composite-UPSERT idempotency, `memory:write`) | `eee1c13` | integration 2/2 vs real pgvector (import N, provenance round-trips, re-run dedups) + failure-isolation unit 1/1 |
| T2.1 | `scripts/migrate-claude-code-memory.mjs` (parse both variants + wikilinks; fail-closed scrub; dry-run; idempotent batch import) | `9f18623` | unit 12/12 (planted secret never reaches payload — 3-layer assertion); dry-run real corpus 411 nodes/107 redacted/0 leaked |
| T3.1 | `docs/claude-code-kit/` (SessionStart recall + Stop remember + PreCompact hooks + idempotent settings-merge installer + MCP registration) | `a7e168d` | merge test PASS (preserves existing hooks, idempotent); failure-safe (dead endpoint → exit 0) |

## Live proofs (against the deployed theo-memory REST `165.227.121.20:8080`)

1. **Batch endpoint LIVE** — auto-deployed by the M5 CD pipeline (dogfood: M5 shipping M6);
   `POST /v1/remember/batch` → 201 `{imported:1}`.
2. **Kit round-trip** — `theo-remember.mjs` (Stop) wrote a fact; `theo-recall.mjs` (SessionStart,
   fresh session, same project) recalled it + emitted valid `additionalContext`. **DoD item 4 proven.**
3. **Migration `--commit` LIVE** — fixture w/ planted secret: 4 imported (1 request), 1 redacted, 1
   skipped (private-key block); re-run `imported=0 deduped=4` (idempotent). **DB check: the planted
   secret `sk-proj-FAKE…` appears in 0 stored rows** (scrubbed before persist); a redacted fact stored
   with `[REDACTED:openai_key]`. **DoD scrub proven end-to-end.**
4. **Benchmark** (`docs/benchmarks/m6-batch-import.md`) — batch 1.9±0.1 facts/sec; per-fact
   progressively rate-limited (20/20 → 10/20 → **0/20**). The bottleneck is the 30-writes/60s limiter;
   the batch bypasses it (N facts = 1 slot → 1000× ceiling for the migration). **ADR-1 proven with data.**

## Coverage vs M6 DoD (ROADMAP)

- [x] `POST /v1/remember/batch` + integration test (idempotent, provenance) — T1.2/T1.3
- [x] Migration tool (both variants + wikilinks; fail-closed scrub; dry-run; planted-secret test) — T2.1
- [x] Global kit (SessionStart recall + Stop remember + PreCompact; merge; MCP; project-namespaced) — T3.1
- [x] Live proof (fact written in one session auto-recalled in a fresh session) — kit round-trip above
- [x] Auth documented + kit endpoint config knob — kit README + `theo-memory.env`

## Honest caveats / owner follow-ups

- **Production gateway edge host** for `/v1/memory/*` with `theo_live_*` remains owner-gated
  (`app-dev.usetheo.dev` is the SPA). Build + all proofs ran against the deployed REST
  (`165.227.121.20:8080`); the kit endpoint is a single config knob — swap when the prod edge is confirmed.
- The migration live proof used the controlled fixture (not the real 411-node corpus) to avoid polluting
  the shared DB + handling real secrets in prod. The dry-run of the real corpus is clean (0 leaked).
- Batch server-side embedding is sequential per item; an `embedBatch` optimization is a future follow-up
  (out of M6 scope — the endpoint contract + rate-limit bypass is what M6 needed).

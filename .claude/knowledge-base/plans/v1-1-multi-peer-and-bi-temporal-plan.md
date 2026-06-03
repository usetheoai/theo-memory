# Plan: v1.1 Multi-Peer Attribution + Bi-Temporal Local Runtime

> **Version 1.3** (2026-06-03) — Absorbs `/review` 2026-06-03 fix-up cycle. Three v1.1-introduced MAJOR findings addressed: (1) F-arch-11/12/13 paper-name violations fixed via 3 single-line edits (commit pending); (2) F-dom-dbmig-1 partial-index parity gap closed by declaring `idx_memories_user_attributed_to` in `schema.ts` + Drizzle snapshot regen (migration `0009_v1_1_index_parity.sql` is idempotent no-op via `IF NOT EXISTS`); (3) F-xval-1/F-tests-1/F-wire-1 EC-9 (skill-scope + asOf) DEFERRED to a follow-up cycle via amendment to ADR D4 — honest deferral over silent miss. v1.3 does NOT widen `SkillRecallOptions` and does NOT add a skill-scope integration test. Three pre-existing MAJOR (F-arch-2 ad-hoc structural type, F-arch-6 pgvector-store.ts LoC budget, F-arch-7 index.ts LoC budget) deferred to a dedicated refactor plan per `/review` recommendation. 14 MINOR + 22 INFO surfaced honestly in the review report.
>
> **Version 1.2** (2026-06-02) — Absorbs `/deps-audit` report (verdict INVALID_PLAN_DEPS 4× `plan_dep_version_unspecified`). Replaces the 4 `(current)` placeholders in `### Existing — use as-is` with explicit manifest pins: `drizzle-orm ^0.45.0`, `drizzle-kit ^0.31.0`, `pg ^8.13.0`, `zod ^3.25.0`. Adds new ADR D7 pinning zod to `^3.25.0` (defers 4.x migration) to clear the soft cap `plan_dep_major_outdated_unpinned`. Surfaces the allowlisted MODERATE drizzle-kit chain (esbuild dev-server-leak per existing allowlist sunset 2026-08-23) as documented soft signal — downgraded to LOW, `plan_dep_low_cve` caps at 89 (SHIPPABLE_WITH_CAVEATS).
>
> **Version 1.1** (2026-06-02) — Absorbs `/edge-case-plan` report (13 edge cases: 4 MUST FIX + 5 SHOULD TEST + 4 DOCUMENT). MUST FIX absorptions (EC-2 verbatim path RememberOptions widening + EC-3 asOf boundary NaN validation + EC-4 stale-reference grep audit gate + EC-5 entity-boost filter consistency) land in ADRs + Acceptance Criteria of T1.1/T2.1/T2.2/T3.1. SHOULD TEST (EC-6/EC-7/EC-8/EC-9/EC-10) inlined into respective TDD sections. DOCUMENT (EC-1 honest no-backfill clarification + EC-11 GDPR caveat + EC-12 skill rows NULL inheritance + EC-13 TheoKit+UI deferral) inlined as ADR Consequences. **EC-1 reclassified** from MUST FIX to DOCUMENT after empirical audit revealed pre-v1.1 pipeline DISCARDS `attributed_to` at payload composition (`src/core/extraction/pipeline.ts:285` `buildPayload(text, hash, filters, metadata)` doesn't propagate `extracted[i].attributed_to`); backfill from payload would be a no-op, so the honest contract is "historical rows have NULL attribution permanently".
>
> **Version 1.0** (2026-06-02) — Original. Ships v1.1 milestone bundling Roadmap row 12 (`attributed_to` first-class promoted column with N-valent semantic) AND lifting ADR-0006's `BiTemporalNotSupportedLocally` runtime gate (recall accepts `asOf` against the EXISTING `t_valid`/`t_invalid` columns on local Postgres). Anchored on the multi-peer-and-bi-temporal-gaps blueprint (SHIPPABLE_WITH_CAVEATS 89/100, 2026-06-02) — Q3 Mem0 promoted-key precedent + Q5 Honcho N-valent semantic + Q6 Graphiti Apache-2.0 `valid_at`/`invalid_at` reference. R3 (runtime-gate lift) requires strategic review via ADR-0011 supplementary; T0.1 gates the entire plan on that ADR landing first.

## Goal

> "Ship `attributed_to` as a first-class promoted column AND lift `BiTemporalNotSupportedLocally` so that `recall({ asOf, attributedTo })` returns the correct point-in-time + peer-attributed memories, measured by an end-to-end integration test (`tests/integration/v1-1-multi-peer-bitemporal.test.ts`) returning 100% PASS against real `ankane/pgvector:v0.5.1`."

## Context

### What exists today

- `attributed_to` is HALF-shipped:
  - Present in LLM extraction prompt (`src/core/extraction/prompt.ts:39`) with TRINARY vocabulary `"user|system|agent"` (NOT Mem0 BIVALENT, NOT Honcho N-VALENT).
  - Parsed by zod (`prompt.ts:94`) as `z.string().optional()`.
  - Flowed through pipeline (`extraction/pipeline.ts:225`).
  - **NOT persisted to a column** in `src/local/schema.ts`. Lives in payload only.
  - Acknowledged as "v1.1 Roadmap Item 12 — not in v0.0 contract" in `src/agent-tools/tools/recall-schema.ts:45`.

- Bi-temporal is HALF-shipped per ADR-0006 path (c):
  - `t_valid` + `t_invalid` TIMESTAMPTZ columns exist on `src/local/schema.ts:79-80` since v0.1.
  - `RecallOptions.asOf?: Date` declared on `src/core/options.ts:29` with `@throws BiTemporalNotSupportedLocally` JSDoc.
  - Throw site at `src/local/index.ts:324-325` when `options.asOf !== undefined`.
  - Existing assertion test at `src/local/__tests__/factory.test.ts:105-110` (`rejects.toThrow(BiTemporalNotSupportedLocally)`).
  - `pgvector-store.ts:566` already prepares the WHERE-clause locus with a `t_valid <= NOW()` comment.

### Evidence motivating NOW (not later)

- **Multi-peer** — blueprint Q5 confirmed Honcho's only moat is N-valent peer-attribution under AGPL-3.0. v1.1 ships the N-valent semantic on Mem0's promoted-key SHAPE under MIT — attacks Honcho's vertical without legal exposure.
- **Bi-temporal** — blueprint Q6 confirmed Graphiti (Apache-2.0) ships working bi-temporal at the same column shape ADR-0006 already locked. ADR-0006's "wait for v0.5 cloud" pessimism was grounded in the absence-of-local-prior-art assumption (Q4 falsified: Letta `block_history` is audit-log-only, unrelated). The gate is no longer load-bearing; lifting it is single-WHERE-clause work plus an ADR amendment.
- **Strategic** — CLAUDE.md Roadmap row 12 (v1.1 `attributed_to`) was already planned; Roadmap row 7 (v0.5 bi-temporal as cloud premium) is REINTERPRETED — local runs the OSS-grade bi-temporal; cloud runs the MULTI-REGION + AUDIT-MGMT premium. The shape decision (ADR-0006 path c) stands; only the runtime-gate clause is amended.

## Objective

- [ ] Sub-goal 1 — ADR-0011 supplementary lands first, documenting the ADR-0006 runtime-clause amendment (T0.1, STRATEGIC REVIEW).
- [ ] Sub-goal 2 — `attributed_to text NULL` column persisted on `memories` table via migration 0008 + indexed for filter queries (T1.1).
- [ ] Sub-goal 3 — `MemoryItem.attributedTo?: string` AND `RememberOptions.attributedTo?: string` widened on contract (EC-2 absorption); LLM prompt relaxed to N-valent vocabulary (T1.1 + T1.2).
- [ ] Sub-goal 4 — pgvector-store hoists `attributed_to` payload→column on write AND projects column→DTO on read (T2.1).
- [ ] Sub-goal 5 — `RecallOptions.attributedTo?: string` filter widening with SQL WHERE clause (T2.2).
- [ ] Sub-goal 6 — `BiTemporalNotSupportedLocally` removed from throw site; `asOf` composes `t_valid <= :asOf AND (t_invalid IS NULL OR t_invalid > :asOf)` (T3.1).
- [ ] Sub-goal 7 — Existing `rejects.toThrow` test replaced with positive `returns time-correct results` assertion (T3.2).
- [ ] Sub-goal 8 — Integration test exercises all 4 R-paths end-to-end against real `ankane/pgvector:v0.5.1` (T4.1).

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| drizzle-orm | `^0.45.0` | npm | Schema definition + query builder per `architecture.md § 5`. Up-to-date; 0 CVEs. |
| drizzle-kit | `^0.31.0` | npm | Migration generation; existing 0007 migration follows the same pattern. **CVE note:** carries allowlisted MODERATE GHSA-67mh-4wv8-2f99 (esbuild dev-server-leak via deprecated `@esbuild-kit/esm-loader`) — sunset 2026-08-23 per `.claude/rules/deps-audit-allowlist.txt`. Allowlist downgrade → LOW; devDep-only usage (CLI db:push/db:generate); no dev-server invocation in our pipeline. |
| pg | `^8.13.0` | npm | Postgres driver for raw SQL parametric WHERE clauses. Up-to-date; 0 CVEs. |
| zod | `^3.25.0` | npm | LLM extraction validation per existing `prompt.ts:94`. Pinned to 3.x per ADR D7 (defers 4.x migration to dedicated future cycle). |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | | | This plan introduces ZERO new dependencies. R1+R2+R3+R4 all leverage existing infrastructure. Rule 9 satisfied by NOT-adding rather than choosing-among-alternatives. | n/a |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

**Rationale for zero-dep:** Q1+Q2 of the blueprint proved Letta uses stock SQLAlchemy with zero bi-temporal libs; Graphiti uses Apache-2.0 source patterns (column names + WHERE shape) directly portable to TheMemory's existing Drizzle + pg stack. No vendor lib is required for either gap.

## ADRs

### D1 — Single-plan approach for R1+R2+R3+R4

**Decision:** Ship all 4 Recommendations in ONE plan; gate R3 (runtime-clause lift) on T0.1 ADR-0011 supplementary landing first.

**Rationale:** Blueprint Q7 confirmed the two gaps decouple cleanly but they share the same dogfood scenario (a user wants point-in-time queries scoped to a specific peer perspective). Bundling reduces overhead (1 cycle-plan + 1 cycle-implement + 1 cycle-review vs 2x); risk isolated because T0.1 STRATEGIC REVIEW gates R3 independently.

**Alternatives considered:**
- Two separate plans (v1.1-multi-peer + v1.1-bi-temporal) — REJECTED: 2x cycle overhead, no integration benefit, ignores shared dogfood scenario.
- Three plans (multi-peer + asOf-only + runtime-gate-lift) — REJECTED: R3+R4 are jointly load-bearing (lifting the gate without `asOf` wiring is useless; wiring `asOf` while it still throws is incoherent).
- Defer R3 to v1.2 — REJECTED: blueprint Q6 evidence is fresh; deferring loses the moat-attack window vs Zep.

**Consequences:** R3 STRATEGIC REVIEW becomes the critical path; if ADR-0011 is rejected by the project owner, T3.1+T3.2 abort and the plan ships partially (R1+R2 only via partial-merge or plan rewrite).

### D2 — `attributed_to` as first-class promoted COLUMN (R1) + verbatim-path widening (EC-2)

**Decision:** Add `attributed_to text NULL` as a dedicated column on `memories` table (not jsonb payload field) + partial index `(user_id, attributed_to) WHERE attributed_to IS NOT NULL`. **EC-2 absorption:** ALSO widen `RememberOptions.attributedTo?: string` so verbatim-path callers (`remember(text, { infer: false })`) can set attribution without going through LLM extraction. T2.1 reads it from `RememberOptions.attributedTo` when `infer: false`; from the LLM-extracted `extracted[i].attributed_to` field when `infer: true`.

**Rationale:** Q3 of blueprint confirmed Mem0's promoted-key tier (alongside `id`, `created_at`) gives O(1) projection + indexed filter — matches our retrieval-shaped access pattern. Column-shape under Apache-2.0 license precedent is portable to MIT. The verbatim-path widening is additive (optional field) and preserves ADR-0008 method-count cap (0 new methods; 1 new optional param on existing `RememberOptions`).

**Alternatives considered:**
- Payload-only convention (Mem0 BEFORE promotion shape) — REJECTED: filter requires `payload->>'attributed_to'` JSON-path scan, no index hit; precedence is Mem0 explicitly PROMOTED past payload at the search-result enrichment layer (`mem0/memory/main.py:996,1102,1408`).
- Separate `peer_attributions` join table — REJECTED: complicates joins for the 90% case where attribution is a single string; YAGNI (Rule 11). Future Honcho-style `(observer, observed)` collection-keying would justify a join table; not v1.1 scope.
- Verbatim path NOT widened (EC-2 alternative) — REJECTED: leaves `infer: false` callers without any way to set attribution; contradicts ADR-0001's escape-hatch rationale that `infer: false` is for callers who have ALREADY extracted facts (which implies they also know the attribution).

**Consequences:**
- Existing memories with `attributed_to=NULL` work unchanged (backward compat per Inquebrável Rule 4). New writes hoist the LLM-extracted field; new recall filters compose `WHERE attributed_to = :attributedTo`. Storage cost: 1 nullable text column per row (trivial).
- **EC-1 absorbed (DOCUMENT):** Pre-v1.1 rows have `attributed_to=NULL` PERMANENTLY. Empirical audit confirmed `src/core/extraction/pipeline.ts:285` `buildPayload(text, hash, filters, metadata)` discards `extracted[i].attributed_to` at the payload composition phase before v1.1 — historical rows never had the value in payload either. Backfill is a no-op (no source data exists). The honest contract is "we don't know who said this for pre-v1.1 facts"; consumers see `attributedTo: undefined` and must treat as "unknown attribution". CHANGELOG migration notes will surface this.
- **EC-12 absorbed (DOCUMENT):** Skill rows (kind='skill', v0.6) inherit the `attributed_to` column with NULL because `memory.skills(repoId).remember(skillPayload)` does NOT flow through the LLM extraction pipeline. Adding a skill-side attribution-setting path is YAGNI per Rule 11 (no consumer asking). Future v1.x widens `ScopedSkillMemory.remember` if demand surfaces.

### D3 — Lift `BiTemporalNotSupportedLocally` via supplementary ADR-0011 — STRATEGIC REVIEW REQUIRED

**Decision:** R3 amends ADR-0006's RUNTIME-CLAUSE only (not the schema clause). New ADR-0011 (supplementary to ADR-0006) authored at T0.1 and signed off by the project owner BEFORE T3.1 implementation begins.

**Rationale:** Blueprint Q6 demonstrated the implementation path is single-WHERE-clause work (Graphiti precedent + ADR-0006 columns already exist). ADR-0006's pessimism was grounded in the unsubstantiated assumption "no local OSS prior art exists" — Q4 falsified this assumption for Letta, and Q6 supplied a positive Apache-2.0 reference. The original ADR-0006 trade-off is no longer load-bearing.

**Alternatives considered:**
- Edit ADR-0006 directly — REJECTED: ADRs are append-only history per ADR convention; editing destroys audit trail. Supplementary ADR preserves the original decision context plus the amendment rationale.
- Keep the runtime gate; defer R3 to v0.5 cloud — REJECTED: blueprint Q6 changes the cost-benefit; deferral preserves a moat-window for competitors (Zep's bi-temporal "premium" framing becomes commoditized when local OSS ships it).
- Make ADR-0011 a full replacement (deprecate ADR-0006) — REJECTED: the SCHEMA clause of ADR-0006 is REINFORCED by Q6 (column names match), not contradicted. Supersession scope is the runtime-clause only.

**Consequences:** STRATEGIC REVIEW becomes the critical path; if the project owner rejects ADR-0011, T3.1+T3.2 abort and R1+R2 ship as v1.1-partial. The CLAUDE.md Roadmap row 7 line item is REINTERPRETED (cloud runtime still owns multi-region + audit-mgmt premium; OSS gets the temporal queries).

### D4 — Simple `recall(query, { asOf })` API, NOT Graphiti DNF (R4)

**Decision:** Add `asOf?: Date` (already declared on `RecallOptions` per ADR-0006) wired to `t_valid <= :asOf AND (t_invalid IS NULL OR t_invalid > :asOf)`. Defer Graphiti-style `SearchFilters.valid_at: list[list[DateFilter]]` DNF to a future widening.

**Rationale:** Inquebrável Rule 10 (KISS) + Rule 11 (YAGNI): `asOf` covers the 95% case; DNF adds API surface for the 5% edge cases without a concrete consumer asking. ADR-0008 (DIP method-count caps) preserves cleanly: 0 new methods, 1 existing optional param wired through.

**Alternatives considered:**
- Ship Graphiti-style DNF verbatim — REJECTED: Rule 11 + 4 surface additions to RecallOptions (`valid_at`, `invalid_at`, `created_at`, `expired_at`) + the `DateFilter` + `ComparisonOperator` types. Speculative widening per the blueprint Q6 strategic_finding.
- Two separate verbs (`recall.atTime(query, ts, opts)`) — REJECTED: contradicts ADR-0004 (API verbs locked to 4: remember/recall/forget/reflect); ADR-0008 method-count cap on `MemoryStore` interface.
- Use `Date | null` literal for "always-valid" rows instead of NULL — REJECTED: TypeScript `Date | undefined` (current shape) is the idiomatic optional; NULL semantics live at the SQL layer only.

**Consequences:** Future widening via additive `RecallOptions.temporalFilter?: TemporalFilter` is non-breaking. Public docs flag `asOf` as v1.1+ feature (no longer "cloud-only until v0.5"). JSDoc `@throws` annotation removed from `options.ts:33`.

#### D4 amendment (2026-06-03) — EC-9 skill-scope `asOf` deferred to a follow-up cycle

`/review` 2026-06-03 surfaced that v1.1 ships `asOf` wired ONLY at the memory-scope path (`memory.user(id).recall(...)` / `memory.session(id).recall(...)` / `memory.agent(id).recall(...)`). The skill-scope path (`memory.skills(repoId).recall(...)`) does NOT accept `asOf`: `SkillRecallOptions` at `src/core/skill.ts:102-114` declares only `{ topK, threshold, includeSuperseded }`. THE GOAL TEST covers memory scopes only; no `tests/integration/v1-1-multi-peer-bitemporal.test.ts` scenario exercises skills + asOf.

T3.1 § Tasks step 10 originally required this RED test ("EC-9: Write RED integration test: skill row recall with `asOf` honors bi-temporal predicate"). The implementation gap is honest: the skill path is a structurally separate flow (`LocalScopedSkillMemory.recall` at `src/local/scoped-skill-memory.ts:124` vs `ScopedMemory.recall` at `src/local/index.ts`) and adding `asOf` to it requires widening `SkillRecallOptions` + routing through `applySkillFilters` + writing the integration test against `memory.skills(repoId)`.

**Deferral decision:** EC-9 is deferred to a follow-up v1.x cycle. The v1.1 contract for `asOf` covers memory scopes only; skill-scope `asOf` is OUT OF SCOPE for v1.1.

**Rationale:** Honest deferral (Inquebrável Rule 3) is preferable to silent contract drift. The memory-scope path covers the v1.1 Goal verbatim (`recall({ asOf, attributedTo })` against `memory.user(...).recall`); skill-scope `asOf` was an absorption SHOULD TEST (EC-9), not a Goal criterion. THE GOAL TEST passes 7/7 on the in-scope contract. Closing the gap requires ~30-50 LoC across 3 files + 1 new integration RED test; doing so post-/review during fix-up shifts scope creep into a merge-time decision rather than letting it land as silent miss.

**CHANGELOG contract:** v1.1 `### Added` section MUST declare the boundary explicitly so consumers understand the contract surface they receive. Format: `"\`asOf\` is honored on memory-scope recall (\`memory.user/session/agent(id).recall({ asOf })\`); skill-scope recall (\`memory.skills(repoId).recall(...)\`) does NOT accept \`asOf\` in v1.1 — tracked as a follow-up cycle."`

**Wiring triad status (skill-scope path):**
- pillar (a) static caller: ❌ field does not exist → cannot be called
- pillar (b) integration test: ❌ not written (RED test from T3.1 step 10 deferred)
- pillar (c) runtime metric: n/a per plan Global DoD

These three holes are surfaced honestly in `.claude/knowledge-base/reviews/v1-1-multi-peer-and-bi-temporal-review-2026-06-03.md § F-xval-1/F-tests-1/F-wire-1`.

**Follow-up scope (NOT in v1.1):** Future cycle slug e.g. `v1-2-skill-scope-bi-temporal` MAY add `asOf?: Date` to `SkillRecallOptions`, route through `applySkillFilters` (already widened in v1.1 T3.1), and ship the RED test originally specified in T3.1 step 10.

### D5 — Relax LLM extraction vocabulary from TRINARY to N-VALENT

**Decision:** Update the LLM extraction prompt (`src/core/extraction/prompt.ts:39`) to accept arbitrary string values for `attributed_to`, dropping the current `"user|system|agent"` vocabulary lock.

**Rationale:** Blueprint Q5 strategic_finding — Honcho's N-valent moat is the differentiation point against Mem0's BIVALENT vocabulary. The current TRINARY in TheMemory is a middle-ground that doesn't capture either competitor's vertical. Relaxing to arbitrary peer IDs (any user-supplied string) takes the Mem0 SHAPE + Honcho SEMANTIC under MIT — pattern is not copyrightable.

**Alternatives considered:**
- Keep TRINARY `"user|system|agent"` — REJECTED: blueprint Q5 shows N-valent is the moat surface; TRINARY is a half-step that captures no competitive vertical.
- Adopt Mem0 BIVALENT `"user|assistant"` verbatim — REJECTED: forfeits the Honcho-attack window per blueprint R1 rationale.
- Enforce N-valent at the runtime (validate string is a known peer ID against a registry) — REJECTED: Rule 11 (YAGNI); no peer-registry exists in TheMemory contract today. Future v1.x can add a peer-registry DIP if needed.

**Consequences:** Existing tests asserting `attributed_to: 'user'` continue to pass (BIVALENT is a subset of N-VALENT). Existing TRINARY-aware test fixture at `src/core/__tests__/extraction-prompt.test.ts:135` updated to assert acceptance of arbitrary string values.

### D7 — Pin `zod` to `^3.25.0`; defer 4.x migration to a dedicated cycle

**Decision:** Plan declares `zod ^3.25.0` explicitly (not `^4.x.x` despite zod 4.4.3 being available on npm). v1.1 milestone does NOT include zod-4.x migration. Future v1.x dedicated cycle will handle the migration if/when demand surfaces.

**Rationale:** zod 4.0 introduces breaking changes to the schema API surface (the `z.string().optional()` shape used at `src/core/extraction/prompt.ts:94` continues to work in 4.x but several other patterns shift). Bundling a major-version migration into the v1.1 milestone would expand scope significantly + risk regressions in the extraction pipeline that we'd then need to re-validate. KISS (Rule 10) + YAGNI (Rule 11): no consumer is asking for zod 4 features; v1.1 ships a focused multi-peer + bi-temporal scope.

**Alternatives considered:**
- Bump to `^4.4.0` as part of v1.1 — REJECTED: scope creep. Migration touches every zod-using file in src/core/, src/local/, examples/, and tests. Real impact: 3-5 day delay to v1.1 milestone for zero v1.1-goal-metric benefit.
- Leave `(current)` placeholder — REJECTED: deps-audit golden rule inquebrável #2 fires `plan_dep_version_unspecified` → INVALID_PLAN_DEPS cap 49. Placeholder is structurally non-compliant.
- Pin to `~3.25.0` (patch-only) — REJECTED: needlessly restrictive; minor 3.x bumps are explicitly permitted by the Existing-dep convention.

**Consequences:**
- `/deps-audit` continues to surface `plan_dep_major_outdated_unpinned` as a SOFT signal (cap 89). With THIS ADR present, the soft cap downgrades to "documented intentional pin" — acceptable trade-off per the rationale.
- Future v1.x zod-migration cycle will reference THIS ADR + supersede it when the migration ships.
- CHANGELOG sunset: review at v1.2 kickoff whether the pin remains justified or migration becomes load-bearing.

### D6 — Test file location follows existing `src/{domain}/__tests__/` convention

**Decision:** Unit tests live at `src/local/__tests__/` and `src/core/__tests__/`; integration tests at `tests/integration/`. NO new `tests/unit/` paths created.

**Rationale:** Existing convention proven across v0.1-v0.8; `vitest.contract.config.ts` includes both `src/{core,local,theokit,agent-tools}/**/__tests__/**/*.test.ts` and `tests/unit/**/*.test.ts` but staying within `src/{domain}/__tests__/` avoids the dual-pattern split. Path-validation guard per `to-plan` Step 0 pre-flight: confirmed all task paths match include patterns.

**Alternatives considered:**
- New `tests/unit/v1-1/` umbrella dir — REJECTED: bifurcates the test-file location convention for no semantic gain. v0-4a T0.1 retrospective absorbed this lesson.
- Tests embedded in source files (no separate `__tests__/`) — REJECTED: contradicts existing TheMemory convention; would require vitest config widening.

**Consequences:** All RED tests resolvable by `vitest.contract.config.ts` include patterns without config changes.

## Dependency Graph

```
T0.1 (STRATEGIC REVIEW gate — ADR-0011)
  │
  ├─▶ T1.1 (schema migration + DTO)        ──┐
  │                                            │
  ├─▶ T1.2 (LLM prompt relax)                ─┤─▶ T2.1 (write+read hoist) ──▶ T2.2 (filter API)
  │                                            │
  └─[gates]─▶ T3.1 (lift throw + SQL asOf) ──▶ T3.2 (factory.test rewrite)
                                                                                          │
                                                                                          ▼
                                                                              T4.1 (integration E2E)
```

- T0.1 BLOCKS T3.1 + T3.2 (STRATEGIC REVIEW gate); T1.x can proceed in parallel with T0.1 (no R3 dependency).
- T1.1 + T1.2 can run in parallel (independent files).
- T2.1 depends on T1.1 (column exists) + T1.2 (DTO field exists).
- T2.2 depends on T2.1 (column wired through).
- T3.1 depends on T0.1 (ADR landed); independent of T1.x/T2.x in code (different files).
- T3.2 depends on T3.1 (replacement test cannot precede the lift).
- T4.1 depends on T2.2 + T3.2 (all R-paths must be wired before E2E).

---

## Phase 0: ADR-0011 supplementary (STRATEGIC REVIEW)

**Objective:** Land the ADR amendment authorizing ADR-0006's runtime-clause lift BEFORE any implementation touches the throw site.

### T0.1 — ADR-0011 supplementary "Bi-temporal local-runtime gate lifted given Graphiti prior art"

#### Objective

Author the supplementary ADR + obtain project-owner sign-off via strategic review, unblocking T3.1+T3.2.

#### Evidence

- Blueprint Q6 (Graphiti Apache-2.0 prior art) — `.claude/knowledge-base/discoveries/blueprints/multi-peer-and-bi-temporal-gaps-blueprint.md § Q6` + snapshot `90ef10ceda07a5601e1e2cb9140d9b065e300d368dacd0be5ab80a44a25b60ff.md`.
- ADR-0006 path (c) wording "local v0.1 runtime throws" — the exact clause being amended.
- Blueprint ADR D8 — strategic-review surface declared.

#### Files to edit

```
.claude/knowledge-base/adrs/ADR-0011-bi-temporal-local-runtime-gate-lift.md — NEW supplementary ADR
.claude/knowledge-base/adrs/ADR-0006-bi-temporal-local-schema.md — append "**Superseded in part:** runtime-clause superseded by ADR-0011 (2026-06-02)" at top
CLAUDE.md — update Roadmap row 7 ("v0.5 — TheoCloud runtime + bi-temporal premium") to reflect cloud-tier scope narrowed to multi-region + audit-mgmt; local OSS owns the temporal queries from v1.1
```

#### Deep file dependency analysis

- **ADR-0011 (NEW):** authoritative source for the runtime-clause amendment. T3.1 cites this ADR in code JSDoc. Reviewers cite this ADR during `/review`.
- **ADR-0006 (UPDATE):** preserves the original decision context + records the partial supersession. Cross-reference link to ADR-0011 inserted near the top.
- **CLAUDE.md (UPDATE):** Roadmap row 7 line item narrows. NOT a contract change (cloud premium is a strategic positioning shift, not an API change).

#### Deep Dives

- **STRATEGIC REVIEW gate**: this task does NOT enter implementation phase until the project owner signs off on ADR-0011. Sign-off is the literal acceptance criteria.
- **Reversibility**: ADR-0011 supersession is reversible (revert the file + restore ADR-0006 original wording). Implementation reversibility is via standard git workflow.

#### Tasks

1. Draft ADR-0011 using MADR-3.0 format (Context / Decision / Rationale / Alternatives / Consequences / References).
2. Cross-reference the blueprint Q6 finding + the snapshot SHA256 filenames as anchor evidence.
3. Append the "Superseded in part" note to ADR-0006 line 1-3.
4. Update CLAUDE.md Roadmap row 7 with the narrowed cloud-premium scope.
5. **EC-4 absorbed:** Enumerate stale references via `grep -rn "BiTemporalNotSupportedLocally\|ADR-0006\|v0.5+\|bi-temporal asOf surface v0.5" src/ tests/ examples/ docs/`. Write the hit list to `.claude/knowledge-base/reviews/v1-1-stale-refs-2026-06-02.md` so T3.1 has an authoritative checklist to clear (NOT to update them here; this task is documentation only).
6. Surface to project owner for sign-off (manual step — `AskUserQuestion` if `/implement` is the actor).

#### TDD

Not applicable — this task is a documentation + governance artifact. No code changes.

```
RED:     n/a (no test asserts ADR content; the assertion is human review)
GREEN:   ADR-0011 + ADR-0006 amendment + CLAUDE.md update committed
REFACTOR: None expected
VERIFY:  git log -1 --name-only HEAD | grep -E "ADR-0011|ADR-0006|CLAUDE.md"
```

#### Acceptance Criteria

- [ ] `.claude/knowledge-base/adrs/ADR-0011-bi-temporal-local-runtime-gate-lift.md` exists with MADR-3.0 sections.
- [ ] ADR-0006 carries a "Superseded in part by ADR-0011" header at top.
- [ ] CLAUDE.md Roadmap row 7 narrowed scope reflected.
- [ ] **EC-4:** Stale-reference enumeration written to `.claude/knowledge-base/reviews/v1-1-stale-refs-2026-06-02.md` with hit list grouped by file.
- [ ] Project owner has signed off on ADR-0011 via `AskUserQuestion` decision OR explicit user statement.
- [ ] Pass: lint — `npm run lint` zero warnings (no code changes, but markdown linter if configured).

#### DoD (Definition of Done)

- [ ] All 5 tasks completed and validated.
- [ ] Project-owner sign-off recorded in the commit message of the ADR-0011 file.
- [ ] T3.1 + T3.2 unblocked (no further dependency on T0.1).
- [ ] File-size budget respected (per `architecture.md`).

---

## Phase 1: Schema + DTO + LLM prompt widening

**Objective:** Make `attributed_to` a first-class column persisted at the DB layer, surfaced on the DTO, and emitted by the LLM with N-valent semantic.

### T1.1 — Migration 0008 + schema.ts + MemoryItem DTO widening

#### Objective

Add the persisted column shape + DTO field that all downstream tasks consume.

#### Evidence

- Blueprint Q3 strategic_finding: Mem0 promoted-key shape proven; LOW migration cost.
- Current `src/local/schema.ts:79-80` shows the `t_valid`/`t_invalid` precedent for nullable timestamp columns added since v0.1.
- Current `src/local/migrations/0007_distillation_columns.sql` shows the exact migration file format.

#### Files to edit

```
src/local/migrations/0008_attributed_to.sql — NEW migration: ALTER TABLE memories ADD COLUMN attributed_to text NULL + partial index (uses ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS for idempotency per EC-6)
src/local/migrations/meta/_journal.json — Drizzle journal entry (auto-generated via drizzle-kit, validated manually)
src/local/migrations/meta/0008_snapshot.json — Drizzle snapshot for migration 0008
src/local/schema.ts — add `attributedTo: text('attributed_to')` field to `memories` table definition
src/core/memory-item.ts — add `attributedTo?: string` field to MemoryItem type
src/core/options.ts — EC-2: add `attributedTo?: string` field to RememberOptions interface (verbatim-path support)
src/local/__tests__/schema.test.ts — RED test added first (TDD)
src/core/__tests__/memory-item.test.ts — RED test added first (TDD)
src/core/__tests__/options.test.ts — EC-2: RED test asserts RememberOptions.attributedTo is optional string
```

#### Deep file dependency analysis

- **Migration 0008**: applied via `runMigrations(pool)` AND `drizzle-kit push`. Both paths must converge. Partial index `(user_id, attributed_to) WHERE attributed_to IS NOT NULL` keeps storage cost LOW per blueprint R2 sketch.
- **schema.ts**: widens the Drizzle row type. Downstream: pgvector-store.ts INSERT/SELECT typing.
- **memory-item.ts**: widens the public DTO. Downstream: every consumer of `MemoryItem` (agent-tools, theokit binding, examples/chat-with-memory).

#### Deep Dives

- **Backward compat**: column is nullable; existing rows have NULL; existing INSERT paths that don't supply the value work unchanged (Postgres uses DEFAULT NULL).
- **Partial index rationale**: most rows will likely have `attributed_to=NULL` (not all extractions emit it). Indexing only non-NULL rows is the standard Postgres optimization for sparse data + matches Mem0 promoted-key precedent (Q3).
- **Drizzle journal sync**: per architecture.md § 10.2, `drizzle-kit push` vs `runMigrations()` reconciliation is a known gap. Use `drizzle-kit generate` to author 0008 + manually verify `_journal.json` increment.

#### Tasks

1. Author `0008_attributed_to.sql` mirroring 0007 format (header docstring + `ALTER TABLE ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`). NOTE: NO backfill UPDATE statement — EC-1 absorption documented in ADR D2 Consequences confirms pre-v1.1 rows have no source data for `attributed_to` (pipeline discarded it pre-v1.1); backfill would be a no-op.
2. Run `npm run db:generate` (or equivalent) to bump journal; if journal sync drifts, edit `_journal.json` manually per architecture.md § 10.2.
3. Add `attributedTo` Drizzle column on `memories` table in `schema.ts`.
4. Add `attributedTo?: string` field to `MemoryItem` interface in `memory-item.ts`.
5. **EC-2:** Add `attributedTo?: string` field to `RememberOptions` interface in `options.ts` with JSDoc citing ADR D2 + ADR-0001 escape-hatch interaction.
6. Write RED test asserting `schema.memories.attributedTo` resolves to `text NULL`.
7. Write RED test asserting `MemoryItem.attributedTo` is optional string on contract.
8. **EC-2:** Write RED test asserting `RememberOptions.attributedTo` is optional string on contract.
9. **EC-6:** Write RED integration test asserting `runMigrations(pool)` invoked twice in succession produces zero error + identical schema state (idempotency guard).
10. Run integration `tests/integration/` shaped test against `ankane/pgvector:v0.5.1` to confirm migration applies cleanly.

#### TDD

```
RED:     test('schema declares attributed_to column nullable text', ...) — asserts Drizzle column metadata
RED:     test('MemoryItem.attributedTo is optional string', ...) — TS-level assertion via Expect<>
RED:     test('RememberOptions.attributedTo is optional string', ...) — EC-2 TS-level assertion
RED:     test('integration: runMigrations(pool) twice in succession is no-op', ...) — EC-6 idempotency guard
GREEN:   Implement migration + schema field + DTO field + RememberOptions widening
REFACTOR: None expected (additive change)
VERIFY:  npm test -- src/local/__tests__/schema.test.ts src/core/__tests__/memory-item.test.ts src/core/__tests__/options.test.ts
```

#### Acceptance Criteria

- [ ] `runMigrations(pool)` against fresh DB applies 0008 idempotently (re-runs are no-ops via EC-6 test).
- [ ] `drizzle-kit push` against fresh DB applies 0008 without manual side-channel.
- [ ] `INSERT INTO memories (..., attributed_to) VALUES (..., 'alice')` succeeds.
- [ ] `INSERT INTO memories (...)` without `attributed_to` succeeds with NULL default.
- [ ] **EC-2:** `RememberOptions.attributedTo?: string` field exists with JSDoc citing ADR D2.
- [ ] **EC-1:** Migration 0008 SQL has NO `UPDATE memories SET attributed_to = ...` statement (honest no-backfill per pipeline pre-v1.1 audit).
- [ ] **EC-6:** Migration idempotency test passes against real `ankane/pgvector:v0.5.1`.
- [ ] Pass: complexity — every changed file has cyclomatic complexity ≤ 10.
- [ ] Pass: coverage — `npm run test:coverage` ≥ 90% on changed files (critical paths: 100%).
- [ ] Pass: lint — `npm run lint` zero warnings on changed files.
- [ ] Pass: size — every changed file ≤ 500 lines (per `architecture.md § Module hygiene`).

#### DoD (Definition of Done)

- [ ] All tasks completed and validated.
- [ ] All tests passing — `npm test` green.
- [ ] Zero TypeScript errors — `npm run typecheck`.
- [ ] Zero lint warnings — `npm run lint`.
- [ ] Drizzle journal sync verified (`_journal.json` index === 8).
- [ ] File-size budget respected.

---

### T1.2 — LLM extraction prompt relaxed to N-valent vocabulary

#### Objective

Drop the TRINARY `"user|system|agent"` vocabulary lock from the LLM extraction spec; accept arbitrary string for `attributed_to`.

#### Evidence

- Current `src/core/extraction/prompt.ts:39` JSON schema example: `"attributed_to": "user|system|agent"` (TRINARY enum-like guidance).
- Current `prompt.ts:94` zod parser already permits arbitrary string (`z.string().optional()`); only the prompt-spec NL guidance is restrictive.
- Blueprint R1 strategic finding: N-valent semantic is the Honcho-attack vector.

#### Files to edit

```
src/core/extraction/prompt.ts — relax the prompt spec NL wording for attributed_to; keep zod loose
src/core/__tests__/extraction-prompt.test.ts — update fixture to assert arbitrary string acceptance
src/llms/__tests__/stub.test.ts — fixture comment update if affected
```

#### Deep file dependency analysis

- **prompt.ts**: the prompt text is what the LLM reads. Relaxing the example vocabulary doesn't change the parser; it changes what the LLM is likely to emit. Downstream `pipeline.ts:225` already accepts arbitrary string.
- **extraction-prompt.test.ts**: existing test at line 135 uses `attributed_to: 'user'` — kept (BIVALENT remains a subset of N-VALENT). Add new test case asserting `attributed_to: 'alice'` round-trips.

#### Deep Dives

- **Why this is prompt-engineering, not type-system**: zod permits any string today; only the prompt's NL example was TRINARY. The "constraint" was advisory, not enforced. Relaxing the advisory IS the entire change.
- **Backward compat**: existing producers (callers handcrafting `attributed_to: 'user'`) continue to work. New producers can use arbitrary IDs.

#### Tasks

1. Update the prompt JSON schema example from `"attributed_to": "user|system|agent"` to `"attributed_to": "<peer-id-arbitrary-string>"`.
2. Update the prompt NL guidance to describe N-valent semantic ("the perspective owner of this fact — typically a user ID, agent ID, or `'system'` for self-statements").
3. Add new fixture test in `extraction-prompt.test.ts` asserting arbitrary string acceptance.
4. Verify existing `attributed_to: 'user'` fixture still passes (BIVALENT subset).

#### TDD

```
RED:     test('extraction-prompt accepts arbitrary attributed_to string like "alice"', ...) — currently fails because the prompt spec advises TRINARY
RED:     test('existing user/assistant/agent fixtures continue to round-trip', ...) — regression guard
RED:     test('stub LLM fixtures parse cleanly against relaxed Zod schema', ...) — EC-8 stability guard for hand-authored stub fixtures in src/llms/__tests__/stub.test.ts
GREEN:   Update prompt spec + NL wording
REFACTOR: None expected
VERIFY:  npm test -- src/core/__tests__/extraction-prompt.test.ts src/llms/__tests__/stub.test.ts
```

#### Acceptance Criteria

- [ ] Prompt spec example shows arbitrary-string example (no `|`-delimited enum).
- [ ] Zod parser unchanged (already `z.string().optional()`).
- [ ] New test fixture `attributed_to: 'alice'` round-trips through extraction pipeline.
- [ ] Existing `attributed_to: 'user'` fixture unchanged AND still passes.
- [ ] Pass: complexity — ≤ 10.
- [ ] Pass: coverage — ≥ 90%.
- [ ] Pass: lint — zero warnings.
- [ ] Pass: size — ≤ 500 lines.

#### DoD (Definition of Done)

- [ ] All tasks completed and validated.
- [ ] All tests passing — `npm test` green.
- [ ] Zero TypeScript errors.
- [ ] Zero lint warnings.
- [ ] File-size budget respected.

---

## Phase 2: pgvector-store wiring + filter API

**Objective:** Wire `attributed_to` end-to-end through the persistence layer and expose the recall-side filter.

### T2.1 — pgvector-store write-side hoist + read-side projection

#### Objective

Hoist LLM-extracted `attributed_to` from the payload to the column on INSERT; project the column back into the DTO on SELECT.

#### Evidence

- Blueprint Q3 storage pattern at `mem0/memory/main.py:815-816` (payload hoist on insert) — direct reference.
- Current pgvector-store INSERT path (audit before editing) builds row tuples that already accept the bi-temporal columns; analogous wiring for `attributed_to`.

#### Files to edit

```
src/local/pgvector-store.ts — INSERT path: hoist payload.attributed_to → row.attributed_to column; SELECT path: project row.attributed_to → MemoryItem.attributedTo
src/local/__tests__/pgvector-store.test.ts — RED test for round-trip
tests/integration/multi-peer-roundtrip.test.ts — NEW integration test (Phase 2 scope)
```

#### Deep file dependency analysis

- **pgvector-store.ts**: the persistence boundary. INSERT path must read `payload.attributed_to` (string | undefined) and pass it as a column value; SELECT path must read the column and surface it on the `MemoryItem` projection.
- **pgvector-store.test.ts**: contract-suite assertion that round-trip preserves the value.
- **tests/integration/multi-peer-roundtrip.test.ts**: integration assertion against real pgvector — `remember({ attributedTo: 'alice' })` → `recall(...)` returns item with `attributedTo === 'alice'`.

#### Deep Dives

- **Two write paths to audit**: `remember(text, opts)` (LLM-extraction path) AND `remember(text, { infer: false }, opts)` (verbatim path per ADR-0001 escape hatch). Both MUST hoist `attributed_to` correctly. The verbatim path takes `attributedTo` directly from `RememberOptions.attributedTo` (EC-2 absorbed via ADR D2).
- **NULL handling**: existing memories have `attributed_to=NULL`; SELECT projects undefined for those. DTO documents `attributedTo?: string` so undefined is honored.

#### Tasks

1. Audit current INSERT path; identify the row-tuple construction site.
2. **EC-2 absorbed:** Add `attributed_to` to INSERT tuple, sourced from EITHER `extracted[i].attributed_to` (LLM/`infer: true` path — propagated via pipeline.ts buildPayload widening OR direct hoist at persist site) OR `options.attributedTo` (verbatim/`infer: false` path — per ADR D2 widening). Both paths converge on the same column write.
3. Audit current SELECT path; identify the projection site (where DB row becomes MemoryItem).
4. Project `attributed_to` column into `attributedTo` DTO field (camelCase rename at the boundary).
5. Write RED contract test for INSERT/SELECT round-trip (LLM path).
6. Write RED contract test for `infer: false` + `options.attributedTo` round-trip (EC-2 verbatim path).
7. Write RED integration test (real pgvector) for `remember/recall` round-trip with `attributed_to`.
8. **EC-10:** Write RED integration test for concurrent `Promise.all([remember(text, opts1), remember(text, opts2)])` where opts carry different `attributedTo` values; assert deterministic behavior (dedup-hash collision keeps first writer's attribution per existing dedup semantics — `extraction/pipeline.ts:276` `if (existingHashes.has(hash)) continue;`).

#### TDD

```
RED:     test('pgvector-store INSERT writes attributed_to column from LLM-extracted field', ...)
RED:     test('pgvector-store INSERT writes attributed_to column from options.attributedTo when infer:false', ...) — EC-2
RED:     test('pgvector-store SELECT projects attributed_to column into DTO', ...)
RED:     test('integration: remember(text)→recall returns memory with attributedTo set', ...)
RED:     test('integration: concurrent remember(text, {attributedTo: a/b}) — dedup keeps first writer attribution', ...) — EC-10
GREEN:   Implement INSERT hoist (both LLM + verbatim paths) + SELECT projection
REFACTOR: None expected (additive change)
VERIFY:  npm test -- src/local/__tests__/pgvector-store.test.ts && npm test -- tests/integration/multi-peer-roundtrip.test.ts
```

#### Acceptance Criteria

- [ ] INSERT path (LLM/`infer: true`) passes `attributed_to` column value when extraction emits it.
- [ ] **EC-2:** INSERT path (verbatim/`infer: false`) passes `attributed_to` column from `options.attributedTo`.
- [ ] INSERT path passes NULL when neither source supplies the field (backward compat).
- [ ] SELECT path returns `attributedTo: undefined` for NULL column.
- [ ] SELECT path returns `attributedTo: 'alice'` for `'alice'` column.
- [ ] Integration test passes against real `ankane/pgvector:v0.5.1`.
- [ ] **EC-10:** Concurrent-remember test passes deterministically (dedup-hash collision behavior documented).
- [ ] Pass: complexity — ≤ 10.
- [ ] Pass: coverage — ≥ 90% (critical path: 100%).
- [ ] Pass: lint — zero warnings.
- [ ] Pass: size — ≤ 500 lines.

#### DoD (Definition of Done)

- [ ] All tasks completed and validated.
- [ ] All tests passing — `npm test` green.
- [ ] Zero TypeScript errors.
- [ ] Zero lint warnings.
- [ ] File-size budget respected.

---

### T2.2 — RecallOptions.attributedTo filter widening + SQL WHERE clause

#### Objective

Add `attributedTo?: string` to `RecallOptions` and wire to a SQL WHERE clause on the recall query.

#### Evidence

- Current `src/core/options.ts:23-55` (RecallOptions interface) — extension point.
- Blueprint R2 query API: `metadata.attributed_to = :attributedTo` Mem0 pattern + Graphiti DateFilter shape as inspiration; we use simpler direct-equality.

#### Files to edit

```
src/core/options.ts — add `attributedTo?: string` field with JSDoc
src/local/pgvector-store.ts — recall path: AND attributed_to = :attributedTo (parametric, NULL-safe)
src/local/__tests__/pgvector-store.test.ts — RED test for filter scoping
tests/integration/multi-peer-roundtrip.test.ts — extend with filter-scope assertion
src/agent-tools/tools/recall-schema.ts — update the v1.1 Roadmap comment to "shipped v1.1 multi-peer"
```

#### Deep file dependency analysis

- **options.ts**: public type; widening cascades through agent-tools recall-schema, theokit binding, examples. Optional field is backward-compat.
- **pgvector-store.ts**: recall query builder needs a conditional WHERE clause that only fires when `attributedTo` is provided. NULL safety: `attributed_to = :attributedTo` matches non-NULL only; consumers that want NULL-only filter use a separate path (not in v1.1 scope).
- **recall-schema.ts**: agent-tools MCP schema needs the new optional input field declared for tool consumers.

#### Deep Dives

- **DIP method count (ADR-0008)**: this is a widening of an existing OPTIONAL field on an existing options bag; not a new method on `MemoryStore` interface. Method count unchanged.
- **Filter semantics**: when `attributedTo: 'alice'` is supplied, only rows with `attributed_to = 'alice'` return. When omitted, all rows (including `attributed_to IS NULL` and `attributed_to = 'anyone'`) return. This is the Mem0-pattern Q3 strategic finding.

#### Tasks

1. Add `attributedTo?: string` field to `RecallOptions` interface in `options.ts`.
2. Update JSDoc to cite blueprint R1+R2 + ADR-0008 method-count preservation.
3. Audit current recall query builder in `pgvector-store.ts`; add conditional WHERE clause on the PRIMARY memory query.
4. **EC-5 absorbed:** Audit the entity-boost subquery composition in `pgvector-store.ts` (the path that fires when `entityBoost=true` per ADR-0007 default). Ensure `AND attributed_to = :attributedTo` is applied to the entity-boost SQL fragment AS WELL — either inline in the subquery WHERE or as a post-UNION filter. Cross-attribution isolation MUST hold regardless of entityBoost setting.
5. Write RED contract test: filter-scoped recall returns only matching rows (entityBoost=false).
6. **EC-5:** Write RED contract test: filter-scoped recall with `entityBoost=true` ALSO returns only matching rows (no cross-attribution leakage via entity hits).
7. **EC-7:** Write RED contract test: empty-string `attributedTo: ''` matches rows where `attributed_to = ''` and does NOT match rows where `attributed_to IS NULL` (documents Postgres null-equality semantics).
8. Extend integration test to cover the filter scope.
9. Update `agent-tools/tools/recall-schema.ts` to drop the "v1.1 Roadmap Item 12 — not in v0.0 contract" comment.

#### TDD

```
RED:     test('recall({attributedTo}) filters by exact match (entityBoost=false)', ...)
RED:     test('recall({attributedTo}) filters by exact match (entityBoost=true)', ...) — EC-5
RED:     test('recall() without attributedTo returns all rows', ...) — regression guard
RED:     test('recall({attributedTo: ""}) matches empty-string rows, NOT NULL rows', ...) — EC-7 Postgres NULL semantics
RED:     test('integration: cross-attribution isolation works under entityBoost=true', ...) — EC-5 + integration
GREEN:   Implement conditional WHERE clause on PRIMARY + entity-boost sub-paths
REFACTOR: None expected
VERIFY:  npm test -- src/local/__tests__/pgvector-store.test.ts && npm test -- tests/integration/multi-peer-roundtrip.test.ts
```

#### Acceptance Criteria

- [ ] `RecallOptions.attributedTo?: string` declared with JSDoc.
- [ ] Recall WHERE clause fires only when option is provided.
- [ ] Filter returns 0 rows when no match; >0 rows when match.
- [ ] **EC-5:** Cross-attribution isolation holds under entityBoost=true (default).
- [ ] **EC-7:** Empty-string filter semantics documented + tested.
- [ ] Cross-attribution isolation test passes (alice's rows ∩ bob's rows = ∅).
- [ ] agent-tools schema updated.
- [ ] Pass: complexity, coverage, lint, size (per template).

#### DoD (Definition of Done)

- [ ] All tasks completed and validated.
- [ ] All tests passing.
- [ ] Zero TypeScript errors.
- [ ] Zero lint warnings.
- [ ] File-size budget respected.

---

## Phase 3: Bi-temporal runtime-gate lift

**Objective:** Honor `RecallOptions.asOf` on the local runtime by composing the SQL temporal predicate against `t_valid`/`t_invalid`.

### T3.1 — Lift `BiTemporalNotSupportedLocally` throw + add `asOf` SQL composition

#### Objective

Replace the runtime throw with a working WHERE clause: `t_valid <= :asOf AND (t_invalid IS NULL OR t_invalid > :asOf)`.

#### Evidence

- T0.1 ADR-0011 signed off (BLOCKER if not).
- Current throw site at `src/local/index.ts:324-325`.
- Current pgvector-store.ts comment at line 566 prepares the locus.
- Blueprint Q6 query-API shape (snapshot `90ef10ceda07a5601e1e2cb9140d9b065e300d368dacd0be5ab80a44a25b60ff.md`).

#### Files to edit

```
src/local/index.ts — remove the `if (options?.asOf !== undefined) throw` block at lines 324-325; ADD EC-3 boundary validation `if (options?.asOf !== undefined && Number.isNaN(options.asOf.getTime())) throw new InvalidScope('asOf must be a valid Date')`; let valid asOf flow through to pgvector-store
src/local/pgvector-store.ts — recall path: when options.asOf is supplied, add conditional WHERE `t_valid <= :asOf AND (t_invalid IS NULL OR t_invalid > :asOf)` on BOTH memory query AND skill query (per EC-9)
src/core/options.ts — remove `@throws BiTemporalNotSupportedLocally` JSDoc; replace with v1.1+ availability note + EC-11 GDPR caveat note
src/core/errors.ts — KEEP the error class (no removal; future cloud retains the option to throw if asOf is unsupported there for some edge reason); mark as `@deprecated for local` JSDoc
src/local/__tests__/pgvector-store.test.ts — RED test for asOf-correct SQL composition + EC-3 boundary validation + EC-9 skill rows asOf
tests/integration/bi-temporal-asof.test.ts — NEW integration test (Phase 3 scope) with EC-9 skill-row scenario
src/agent-tools/tools/recall-schema.ts — EC-4: update stale JSDoc comment at line 44 ("bi-temporal asOf surface v0.5+") to reflect v1.1+ availability
[other files surfaced by EC-4 grep audit from T0.1 stale-refs report] — update each cited reference
```

#### Deep file dependency analysis

- **index.ts**: removing the throw is the structural change. The 2-line block at 324-325 evaporates; `asOf` flows naturally into `options` passed to `pgvector-store.recall`.
- **pgvector-store.ts**: the SQL composition is where the actual work lives. Existing WHERE patterns for scope use parameterized queries; same shape applies. Comment at line 566 (`t_valid <= NOW()`) needs the asOf-aware variant.
- **options.ts**: JSDoc says "throws BiTemporalNotSupportedLocally" — this is a public API doc lie post-T3.1. Must update.
- **errors.ts**: class is still EXPORTED through `src/core/index.ts` (line 62). Keep exported (consumers retain the ability to catch it for forward-compat); add `@deprecated for local v1.1+` JSDoc.

#### Deep Dives

- **NULL semantics**: `t_valid IS NULL` rows are "always-valid since creation" (historical convention); they MUST match `asOf` queries per conservative choice: treat NULL `t_valid` as `-Infinity` (always-valid). SQL: `(t_valid IS NULL OR t_valid <= :asOf)`. `t_invalid IS NULL` means "still valid"; SQL: `(t_invalid IS NULL OR t_invalid > :asOf)`.
- **Backward compat**: callers passing `asOf=undefined` see ZERO change in returned results (the conditional WHERE clause doesn't fire). Callers passing a date now get historical results instead of an exception.
- **Index opportunity**: `t_invalid IS NULL` is currently used in existing partial indexes (verify in schema.ts:136-142). The new WHERE doesn't add an index; future v1.x can add `(user_id, t_valid, t_invalid)` composite if needed.

#### Tasks

1. Remove the throw block at `src/local/index.ts:324-325`; let valid `asOf` flow to pgvector-store.
2. **EC-3 absorbed:** Add boundary validation at `src/local/index.ts` ABOVE the recall delegation: `if (options?.asOf !== undefined && Number.isNaN(options.asOf.getTime())) throw new InvalidScope('asOf must be a valid Date');` (2 lines; uses existing `InvalidScope` error class at `src/core/errors.ts:19`). Per architecture.md § 8 (Error handling): validate at boundaries.
3. In pgvector-store recall path, add conditional WHERE composition when `asOf` is supplied (on PRIMARY memory query path).
4. **EC-9 absorbed:** Apply the same WHERE composition to the SKILL query path (kind='skill') in pgvector-store. The bi-temporal predicate operates on `t_valid`/`t_invalid` columns which exist on both memory and skill rows.
5. Update `options.ts` JSDoc to remove `@throws` and replace with availability note. **EC-11 absorbed:** Add caveat note to JSDoc: "Soft-deleted memories (`forget(id)` without `{ hard: true }`) remain recoverable via historical `asOf` queries. GDPR-strict erasure REQUIRES `forget(id, { hard: true })` (per ADR-0006 + the v0.4b forgetting-pipeline hard-delete option shipped 2026-05-31)".
6. Mark `errors.ts` `BiTemporalNotSupportedLocally` class as `@deprecated for local v1.1+` (kept exported).
7. **EC-4 absorbed:** Consume the stale-references audit report from T0.1 (`.claude/knowledge-base/reviews/v1-1-stale-refs-2026-06-02.md`). Update EVERY cited reference — JSDoc, comments, README snippets, examples. Verify by re-running the same grep at the end of the task and confirming zero hits remain (excluding errors.ts class declaration itself + intentional `@deprecated` JSDoc).
8. Write RED contract test: SQL composition with `asOf` matches expected predicate shape.
9. **EC-3:** Write RED contract test: `recall({ asOf: new Date('not-a-date') })` rejects with `InvalidScope`.
10. **EC-9:** Write RED integration test: skill row recall with `asOf` honors bi-temporal predicate.
11. Write RED integration test: remember + forget(hard:false) + recall({asOf: t_pre_forget}) returns the row; recall({asOf: t_post_forget}) excludes it.

#### TDD

```
RED:     test('recall with asOf composes correct WHERE clause', ...)
RED:     test('recall({asOf: invalid-Date}) throws InvalidScope', ...) — EC-3 boundary validation
RED:     test('integration: asOf-pre-forget returns forgotten memory', ...)
RED:     test('integration: asOf-post-forget excludes forgotten memory', ...)
RED:     test('integration: asOf=undefined behavior unchanged (regression guard)', ...)
RED:     test('integration: skill row recall with asOf honors bi-temporal predicate', ...) — EC-9
GREEN:   Remove throw + add EC-3 boundary validation + add SQL composition (memory + skill paths)
REFACTOR: None expected
VERIFY:  npm test -- src/local/__tests__/pgvector-store.test.ts && npm test -- tests/integration/bi-temporal-asof.test.ts
```

#### Acceptance Criteria

- [ ] T0.1 ADR-0011 signed off BEFORE this task starts.
- [ ] `src/local/index.ts:324-325` throw block removed.
- [ ] **EC-3:** Boundary validation guard added; invalid Date input throws `InvalidScope`.
- [ ] Recall with `asOf` returns time-correct results against real pgvector.
- [ ] Recall without `asOf` returns unchanged results (regression guard).
- [ ] **EC-9:** Skill rows honor `asOf` filter at the WHERE-clause level.
- [ ] `BiTemporalNotSupportedLocally` class still exported; JSDoc marks it deprecated for local.
- [ ] `options.ts` JSDoc updated (no `@throws BiTemporalNotSupportedLocally`; EC-11 GDPR caveat note added).
- [ ] **EC-4:** Stale-references audit cleared — grep `BiTemporalNotSupportedLocally\|ADR-0006\|v0.5+` shows zero non-deliberate hits in src/ tests/ examples/ docs/.
- [ ] Pass: complexity, coverage, lint, size.

#### DoD (Definition of Done)

- [ ] All tasks completed and validated.
- [ ] All tests passing.
- [ ] Zero TypeScript errors.
- [ ] Zero lint warnings.
- [ ] File-size budget respected.

---

### T3.2 — Replace factory.test.ts `rejects.toThrow` assertion with positive case

#### Objective

Update existing assertion test that pinned the previous `throws` behavior; replace with an assertion that `asOf` returns valid results.

#### Evidence

- Current test at `src/local/__tests__/factory.test.ts:105-110` (`test('ADR-0006: recall with options.asOf throws BiTemporalNotSupportedLocally'...)`).

#### Files to edit

```
src/local/__tests__/factory.test.ts — replace the assertion: rejects.toThrow → resolves to a result array; rename test descriptor to reflect ADR-0011 supersession
```

#### Deep file dependency analysis

- **factory.test.ts:105**: pins the v0.1-v1.0 contract (throws). Post-T3.1, the contract changes. Either replace the test OR delete it; replacement is preferred (asserts the NEW positive behavior).

#### Deep Dives

- **Test rename**: `test('ADR-0011: recall with options.asOf returns time-correct results'...)` mirrors the original naming pattern.
- **What to assert**: minimum viable is that the promise resolves (no throw). Stronger assertion is that result count > 0 when `asOf` is in the future (all rows valid) — but integration test covers this fully; the factory unit test can stop at "no throw".

#### Tasks

1. Locate the assertion at line 105-110.
2. Rewrite as positive assertion: `await expect(memory.user('alice').recall('q', { asOf: new Date() })).resolves.toBeDefined();`
3. Update the test descriptor to cite ADR-0011 supersession.

#### TDD

```
RED:     test('ADR-0011: recall with options.asOf returns results, not throws', ...) — fails until T3.1 lands
GREEN:   Update the test body
REFACTOR: None expected
VERIFY:  npm test -- src/local/__tests__/factory.test.ts
```

#### Acceptance Criteria

- [ ] Test descriptor cites ADR-0011 supersession.
- [ ] Assertion verifies `resolves` (not `rejects`).
- [ ] Pass: lint, size, complexity.
- [ ] No other test in factory.test.ts touched (scope discipline).

#### DoD (Definition of Done)

- [ ] All tasks completed and validated.
- [ ] All tests passing.
- [ ] Zero TypeScript errors.
- [ ] Zero lint warnings.
- [ ] File-size budget respected.

---

## Phase 4: Integration Validation (END-TO-END)

### T4.1 — End-to-end integration test bundling all 4 R-paths

#### Objective

Single integration test asserting R1+R2+R3+R4 wired together end-to-end against real `ankane/pgvector:v0.5.1`.

#### Evidence

- Goal metric: this test is THE goal metric for the plan.
- All previous tasks' integration tests cover individual R-paths; T4.1 bundles them into one scenario.

#### Files to edit

```
tests/integration/v1-1-multi-peer-bitemporal.test.ts — NEW: end-to-end goal-metric test
CHANGELOG.md — under `[Unreleased]`: `### Added` (attributedTo + asOf); `### Changed` (ADR-0006 runtime clause superseded by ADR-0011)
```

#### Deep file dependency analysis

- **v1-1-multi-peer-bitemporal.test.ts**: single test file with N scenarios exercising the full surface. Provides the goal metric (`100% PASS` is the binary).
- **CHANGELOG.md**: updates under `[Unreleased]` per Inquebrável Rule 6.

#### Deep Dives

- **Scenario design**: at least 3 cases — (a) multi-peer isolation (alice's memories vs bob's), (b) bi-temporal point-in-time (remember → forget → asOf-pre-forget returns), (c) combined (remember with attributedTo + forget + asOf with attributedTo).
- **Real pgvector**: uses the same testcontainers / docker-compose pattern as existing integration tests.

#### Tasks

1. Author `v1-1-multi-peer-bitemporal.test.ts` with 3+ scenarios.
2. Run against real `ankane/pgvector:v0.5.1`; iterate until 100% PASS.
3. Update `CHANGELOG.md` `[Unreleased]` with:
   - `### Added`: "First-class `attributed_to` promoted column + `RememberOptions.attributedTo` + `RecallOptions.attributedTo` (N-valent peer semantic; SDK contract). TheoKit binding + examples/chat-with-memory UI updates deferred to v1.2 (EC-13)."
   - `### Added`: "Local-runtime bi-temporal `recall({ asOf })` (lifted via ADR-0011 supplementary). GDPR-strict erasure still requires `forget(id, { hard: true })` — soft-deleted memories remain recoverable via historical `asOf` queries (EC-11)."
   - `### Changed`: "ADR-0006 runtime-clause superseded in part by ADR-0011 (2026-06-02). Pre-v1.1 rows have `attributed_to=NULL` permanently because the prior pipeline discarded the LLM-extracted value (EC-1)."
   - Each entry MUST end with a `(#PRNUMBER)` reference per Inquebrável Rule 6 (Keep a Changelog).

#### TDD

```
RED:     test('multi-peer isolation: alice and bob memories disjoint', ...)
RED:     test('bi-temporal asOf: forgotten memory recoverable by historical asOf', ...)
RED:     test('combined: attributedTo + asOf filters compose correctly', ...)
GREEN:   All previous tasks' implementation should make these pass; if not, identify the gap and re-iterate
REFACTOR: None expected
VERIFY:  npm test -- tests/integration/v1-1-multi-peer-bitemporal.test.ts
```

#### Acceptance Criteria

- [ ] `tests/integration/v1-1-multi-peer-bitemporal.test.ts` exists with ≥ 3 scenarios.
- [ ] All scenarios PASS against real `ankane/pgvector:v0.5.1`.
- [ ] `CHANGELOG.md [Unreleased]` updated.
- [ ] Pass: lint, size, complexity.

#### DoD (Definition of Done)

- [ ] All tasks completed and validated.
- [ ] All tests passing — `npm test` green.
- [ ] Zero TypeScript errors.
- [ ] Zero lint warnings.
- [ ] File-size budget respected.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | R1: `attributed_to` first-class promoted column | T1.1 + T2.1 | Migration 0008 + Drizzle schema + DTO field + pgvector-store hoist |
| 2 | R1: LLM extraction emits N-valent semantic | T1.2 | Prompt spec relaxed; zod already permissive |
| 3 | R2: drizzle migration sketch matches blueprint R2 table | T1.1 | Migration 0008 with partial index per R2 SQL sketch |
| 4 | R2: scope estimate 5-8 PRs | T1.1 + T1.2 + T2.1 + T2.2 + T3.1 + T3.2 + T4.1 = 7 tasks (within 5-8 estimate) | All tasks accounted for |
| 5 | R2: TheoKit + agent-tools deferral surfaced | T2.2 (agent-tools schema updated; TheoKit binding deferred per blueprint R2 out-of-scope deferrals) | Honest deferral documented inline |
| 6 | R3: ADR-0011 supplementary REQUIRES STRATEGIC REVIEW | T0.1 | Authoring + sign-off as Acceptance Criteria; gates T3.1+T3.2 |
| 7 | R3: ADR-0006 runtime-clause amended without breaking schema-clause | T0.1 | "Superseded in part" annotation only |
| 8 | R3: CLAUDE.md Roadmap row 7 narrows cloud-premium scope | T0.1 | Inline update in same commit |
| 9 | R3: Throw site lifted; SQL composition wired | T3.1 | Remove throw + add WHERE clause |
| 10 | R3: factory.test.ts assertion updated from negative to positive | T3.2 | Replace `rejects.toThrow` with `resolves` |
| 11 | R4: simple `asOf` param, NOT DNF | T3.1 | Single optional param widening; no new types added |
| 12 | R4: forward path to future DNF preserved | T3.1 (via JSDoc note + RecallOptions extensibility) | `RecallOptions.temporalFilter?: TemporalFilter` future widening is additive non-breaking |
| 13 | R4: ADR-0008 DIP method-count cap preserved | T2.2 + T3.1 | 0 new methods; only optional param widenings |
| 14 | Integration validation end-to-end | T4.1 | Goal-metric test |
| 15 | CHANGELOG.md updated | T4.1 | `[Unreleased]` Added + Changed entries |
| 16 | Backward compat preserved (existing rows + callers) | T1.1 + T2.1 + T3.1 | Nullable columns + optional params + asOf=undefined behavior unchanged |
| 17 | `architecture.md § Module hygiene` LoC budget | T1.1, T1.2, T2.1, T2.2, T3.1, T3.2, T4.1 | ≤ 500 lines per file; cited in every task DoD |
| 18 | `architecture.md § DIP` boundary respected | T1.1, T1.2, T2.1, T2.2, T3.1, T3.2 | All changes within respective layer; no cross-layer imports |
| 19 | `testing.md` TDD pyramid | All tasks | Unit + integration; e2e via TheoKit binding deferred (consistent with blueprint R2 deferral) |
| 20 | `no-paper-names-in-code.md` | T0.1, T1.1, T1.2, T2.1, T2.2, T3.1, T3.2, T4.1 | "Mem0-pattern" / "Graphiti precedent" cited in ADR Rationale only, NOT in src/ JSDoc or test names |
| 21 | **EC-1 (DOCUMENT):** Pre-v1.1 rows have NULL attribution permanently | ADR D2 Consequences + T1.1 Tasks step 1 + CHANGELOG T4.1 | Empirical audit confirmed pipeline discarded attributed_to pre-v1.1; backfill impossible; honest contract documented |
| 22 | **EC-2 (MUST FIX):** Verbatim path attribution contract decided | ADR D2 + T1.1 + T2.1 | `RememberOptions.attributedTo?: string` widening; T2.1 reads from options when `infer: false` |
| 23 | **EC-3 (MUST FIX):** asOf boundary validation against Invalid Date / NaN | T3.1 Files + Tasks + AC + TDD | `if (Number.isNaN(asOf.getTime())) throw new InvalidScope` at boundary |
| 24 | **EC-4 (MUST FIX):** Stale-references grep audit gate | T0.1 (enumerate) + T3.1 (clear) | Audit report written by T0.1; consumed and cleared by T3.1 with zero-hit verification |
| 25 | **EC-5 (MUST FIX):** Entity-boost path attribution filter consistency | T2.2 Tasks + AC + TDD | WHERE clause applied to BOTH primary memory query AND entity-boost subquery; cross-attribution isolation tested under entityBoost=true |
| 26 | **EC-6 (SHOULD TEST):** Migration 0008 idempotency | T1.1 TDD | Integration test asserts 2x runMigrations is no-op |
| 27 | **EC-7 (SHOULD TEST):** Empty-string vs NULL attribution filter semantics | T2.2 TDD | Postgres NULL-equality semantics tested + documented |
| 28 | **EC-8 (SHOULD TEST):** Stub LLM fixture stability post-prompt-relax | T1.2 TDD | Hand-authored stub fixtures parse cleanly against relaxed Zod schema |
| 29 | **EC-9 (SHOULD TEST):** Skill rows + asOf filter interaction | T3.1 TDD | WHERE clause applied to skill query path; integration test asserts skill rows honor temporal predicate |
| 30 | **EC-10 (SHOULD TEST):** Concurrent dedup-hash collision with different attributions | T2.1 TDD | Deterministic behavior tested + documented (first writer attribution kept) |
| 31 | **EC-11 (DOCUMENT):** Soft-deleted memories recoverable via asOf — GDPR caveat | T3.1 options.ts JSDoc + T4.1 CHANGELOG | GDPR-strict consumers must use `forget(id, { hard: true })`; surfaced in public docs |
| 32 | **EC-12 (DOCUMENT):** Skill rows inherit attributed_to=NULL | T1.1 (ADR D2 Consequences amendment lands in the ADR-bearing commit alongside the schema change) | YAGNI per Rule 11; future v1.x widens ScopedSkillMemory.remember if demand surfaces |
| 33 | **EC-13 (DOCUMENT):** TheoKit binding + example UI updates deferred to v1.2 | T4.1 CHANGELOG | Honest scope deferral; v1.1 ships SDK contract; v1.2 ships consumer-facing UX |
| 34 | **`/deps-audit` — `plan_dep_version_unspecified`** (4× Existing rows used `(current)` placeholder) | T1.1 (Dependencies section v1.2 bump ships in the migration-bearing commit alongside the schema change) | Replaced placeholders with explicit `^X.Y.Z` from package.json |
| 35 | **`/deps-audit` — `plan_dep_major_outdated_unpinned`** (zod 3.x → 4.x available, no ADR pinning) | T1.2 (ADR D7 zod ^3.25.0 pin ships in the prompt-relax commit; T1.2 is the canonical zod-touching task) | Explicit zod ^3.25.0 pin + rationale for deferring 4.x migration |
| 36 | **`/deps-audit` — drizzle-kit allowlisted MODERATE GHSA-67mh-4wv8-2f99** | T1.1 (drizzle-kit IS the migration tool for T1.1; the allowlist note lives in the same v1.2 Dependencies section update) | Surface visible in plan; downgrade to LOW → soft cap 89 acceptable; devDep-only |

**Coverage: 36/36 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed (T0.1 → T1.1 → T1.2 → T2.1 → T2.2 → T3.1 → T3.2 → T4.1).
- [ ] All tests passing — `npm test` green.
- [ ] Zero TypeScript errors — `npm run typecheck`.
- [ ] Zero lint warnings — `npm run lint`.
- [ ] File-size budget respected (per `.claude/rules/architecture.md § Module hygiene`).
- [ ] CHANGELOG.md updated under `[Unreleased]` (Inquebrável Rule 6).
- [ ] Backward compatibility preserved across public API (`src/index.ts` + subpath exports).
- [ ] **Plan-specific criterion 1:** ADR-0011 supplementary signed off by project owner BEFORE T3.1 implementation.
- [ ] **Plan-specific criterion 2:** Goal-metric test `tests/integration/v1-1-multi-peer-bitemporal.test.ts` returns 100% PASS against real `ankane/pgvector:v0.5.1`.
- [ ] **Plan-specific criterion 3:** ADR-0006 carries "Superseded in part by ADR-0011" annotation; CLAUDE.md Roadmap row 7 narrows cloud-premium scope.
- [ ] **Plan-specific criterion 4 (EC absorption tracking):** All 4 MUST FIX items closed (EC-2 verbatim path widening shipped, EC-3 boundary validation in place, EC-4 stale-references zero-hit, EC-5 entity-boost filter consistency). All 5 SHOULD TEST items shipped as RED tests in their owning tasks (EC-6/EC-7/EC-8/EC-9/EC-10). All 4 DOCUMENT items surfaced in ADR D2 Consequences (EC-1, EC-12) OR JSDoc + CHANGELOG (EC-11, EC-13).
- [ ] **Runtime-metric proof** — n/a for this plan (no new runtime counters introduced; existing `pgvector_recall_duration_ms` continues to fire and is observable via existing integration tests).
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND the PR has been merged to `main`, move `.claude/knowledge-base/plans/v1-1-multi-peer-and-bi-temporal-plan.md` to `.claude/knowledge-base/plans/completed/`.

## Final Phase: Integration Validation (MANDATORY)

> Runs AFTER all phases (T0.1 → T4.1) complete. Plan is NOT done until this chain passes.

**Objective:** Validate that the v1.1 multi-peer + bi-temporal changes work end-to-end in a real workload.

### Execution

```bash
npm test                        # unit + integration tests (incl. v1-1-multi-peer-bitemporal.test.ts)
npm run test:coverage           # ≥ 90% on changed files (critical paths: pgvector-store.ts, options.ts, extraction/prompt.ts at 100%)
npm run typecheck               # zero TS errors
npm run lint                    # zero lint warnings
```

E2E (TheoKit binding paths) NOT required for v1.1 per blueprint R2 deferrals (TheoKit binding attributedTo support deferred to v1.2).

### Acceptance Criteria

- [ ] All test suites green.
- [ ] Coverage ≥ 90% on changed files (critical paths 100% — `pgvector-store.ts`, `options.ts`, `extraction/prompt.ts`).
- [ ] Zero TypeScript errors.
- [ ] Zero lint warnings.
- [ ] Goal-metric test PASSES end-to-end.

### If Validation Fails

1. Identify which failures are caused by this plan's changes vs pre-existing.
2. Fix all plan-caused failures before declaring the plan complete.
3. Re-run the validation chain to confirm fixes.
4. Pre-existing issues logged but do NOT block plan completion (document in PR description).

# Review: auto-categorization-write-pipeline

**Date:** 2026-07-12
**Reviewers (spawned agents):** 6 — architecture, tests, wiring, cross-validation, domain-memory-layer, domain-database
**Findings:** BLOCKER 0 · HIGH 1 · MEDIUM 1 · LOW 5 · INFO many (positive confirmations)
**Verdict:** NEEDS_FIXES → **READY_TO_MERGE** after fixes-cycle-1 (commit `69927b2`)

## Resolution — fixes-cycle-1 (2026-07-12, commit `69927b2`)

- **F-H1 (HIGH) — CLOSED.** `autoCategorize?: AutoCategorizeConfig` added to `LocalMemoryConfig` (`config.ts:153`) and threaded into `ExtractionDeps` at `scoped-memory.ts:215` (like `ontology`); `AutoCategorizeConfig` / `DEFAULT_CATEGORY_TAXONOMY` / `classifyCategorySource` exported from `domain/index.ts`. New integration test `scoped-memory-autocategory.test.ts` proves — through the real `createLocalMemory` factory — that `enabled:false` restores operator-only AND default-on auto-categorizes. The off-switch + custom taxonomy are now reachable via the public surface.
- **F-M1 (MEDIUM) — CLOSED.** New `category_auto_dropped` OTel event (`memory-event.ts`), emitted in the pipeline branch ONLY when the LLM proposed a string that `boundedAutoCategory` rejected (EC-1/EC-5) — a real drop is now observable (Princípio 3); no event on mere absence. Asserted via stub tracer.
- **LOW findings** (F-L1..F-L5) — accepted for merge (optional hardening; F-L4 case-fold is a documented explicit decision — auto/operator both store verbatim for mutual consistency).
- **Post-fix gates:** full suite **1330 passed | 2 skipped**, 0 type errors, lint clean, `/code-quality` **PASS**. 0 regression.

> Note: `consolidate_findings.py` mis-parsed the agent YAML (reported 0 findings / false READY_TO_MERGE); this report is the authoritative hand-consolidation of the 6 agents' returned findings.

Feature range reviewed: the 10 feature commits `1f6f9d3~1..HEAD` on `develop` (NOT the full `main..develop`, which is many merged features ahead). Plan is the frozen contract; no post-implementation drift.

## HIGH findings

### F-H1 — `autoCategorize` config knob never threaded from the Memory factory into `ExtractionDeps`
- **Severity:** HIGH (HIGH by `wiring` + `domain-memory-layer`; MEDIUM by `architecture` + `cross-validation` — same root issue, 4 independent agents)
- **Files:** `packages/core/src/infrastructure/db/scoped-memory.ts:196-213` (assembles `ExtractionDeps`, threads `ontology`/`entityExtractor`/`reranker`/… from `this.config` but NOT `autoCategorize`); `packages/core/src/infrastructure/db/config.ts` (`LocalMemoryConfig` does not declare `autoCategorize`); `packages/core/src/domain/options.ts` (`MemoryConfig` likewise).
- **Plan ref:** ADR D3 (off-switch "a deployment sets `autoCategorize.enabled = false`"), ADR D2 (custom taxonomy override), Objective bullet "disabling it restores the operator-only behavior", Coverage Matrix row 4, Drawbacks table.
- **Evidence:** `grep autoCategorize` across `packages/` minus the 4 slug source files + tests = **0 hits**. The `disabled_flag_restores_operator_only` test passes only because it injects `ExtractionDeps` directly into `runExtractionPipeline`.
- **Honest nuance:** **the Goal IS met.** Default-on fires end-to-end through the real `remember()` path because `deps.autoCategorize?.enabled !== false` is `true` when undefined (`pipeline.ts:107`), and the taxonomy defaults to `DEFAULT_CATEGORY_TAXONOMY`. GOAL TEST green. What is unreachable is the **off-switch** and the **custom-taxonomy override** via `createLocalMemory` / REST / MCP — there is no public surface to set `autoCategorize`.
- **Recommended action (small):** add `autoCategorize?: AutoCategorizeConfig` to `LocalMemoryConfig`, thread it at `scoped-memory.ts:196` exactly like `ontology`, export `AutoCategorizeConfig` publicly, and add ONE integration test through `LocalScopedMemory.remember()` with `enabled:false`. OR write a one-line ADR narrowing the off-switch to the `ExtractionDeps` layer.

## MEDIUM findings

### F-M1 — Princípio 3: a dropped/oversized LLM category is a SILENT IGNORE (no event)
- **Severity:** MEDIUM (`domain-memory-layer`)
- **File:** `packages/core/src/domain/extraction/pipeline.ts` (auto branch) — when `boundedAutoCategory` returns `null` (EC-1 oversized / EC-5 whitespace / EC-3 non-string), the value is dropped with NO event.
- **Plan ref:** CLAUDE.md Princípio 3 (IGNORE is never silent); Drawbacks table (wants the `suggested`/degradation ratio measured). Precedents: `recall_threshold_filtered`, `entity_noise_filtered`.
- **Recommended action:** emit a discard event with `{reason}` when a non-null LLM category is dropped by the bound. Small; aligns with the project's own IGNORE-observability convention. Correctness is fine; only observability is missing.

## LOW findings

- **F-L1** (`tests`) — the `source:'suggested'` branch is only unit-tested in `classifyCategorySource`; no pipeline test proves an unlisted label emits `source:'suggested'` end-to-end.
- **F-L2** (`tests`) — the event test asserts `source` but not the declared `fact_count` attribute.
- **F-L3** (`tests`, `domain-memory-layer`) — `fact_count: 1` is hard-coded (plan open Q2 — multi-fact untested).
- **F-L4** (`domain-database`) — stored auto-category is `.trim()`ed but NOT lowercased; `?category=X` is case-sensitive exact match, so `"Work"` won't match `?category=work`. Matches EC-2 wording (prompt hint) so arguably as-designed; flagged for an explicit decision. Operator path also stores verbatim → auto/operator stay mutually consistent.
- **F-L5** (`tests`) — `StubVectorStore` (~75 lines) duplicated from `extraction-pipeline-category.test.ts` despite the plan's "reuse the stubs (DRY)". Acceptable per the per-file stub convention.

## INFO — verified correct (positive confirmations)

- **F1 split (pipeline.ts → pipeline-helpers.ts):** behavior-preserving; public surface intact (`ExtractionDeps`, `applyOntologyToEntities`, `Payload`, `runExtractionPipeline`); NO new import cycle; both files < 500 (438 / 334).
- **ADR D2 + D5 (DB):** ZERO new migration, ZERO drizzle change, ZERO backfill `UPDATE`. Category stored in the pre-existing `category text` column via the unchanged pgvector payload hoist.
- **Immutability (EC-7):** dedup `ON CONFLICT DO UPDATE` omits `category` (`pgvector-store.ts:433`) — first-write-wins.
- **Fail-soft (ADR D4):** auto branch composes only total functions; cannot throw; `remember()` never fails on a categorization miss.
- **Mem0-shape single round-trip:** category piggybacks the existing extraction call; mirrors `attributed_to`.
- **Operator precedence:** `options.category` first; LLM branch strict `else if`; no auto-event on override.
- **Language-correction rebuild:** `category` preserved through `{ ...fact, text }`.
- **no-paper-names:** compliant. **No SQL-injection regression** (parameter-bound filter). **1-64 bound** consistent with the operator path (fail-soft); DB column unconstrained → no DB-integrity risk.

## Cross-validation summary

| | Count |
|---|---|
| Plan tasks fully implemented | 4 (T1.1, T1.2, T2.1, T4.1) |
| Partial (off-switch seam) | 1 (T3.1) |
| Missing / Diverged | 0 / 0 |
| Coverage Matrix rows mapped to real code | 17/17 |
| ADRs respected | 4 fully + 1 with-caveat (D3 off-switch) |

## Edge-case coverage (from `tests` agent — authoritative; the keyword script false-negatived)

Covered end-to-end: EC-1..EC-5, operator precedence, disabled flag (deps seam), fail-soft persist-uncategorized, event source=taxonomy, GOAL test. Documented-only: EC-6 (verbatim), EC-7 (re-remember immutability) — structurally guaranteed by existing code.

## Quality gates

- `npm test`: **1327 passed | 2 skipped**, 0 failures · `typecheck`: **0 errors** · `lint`: **0 warnings** · `/code-quality`: **PASS (100)**.
- Wiring triad: (a) 7/7, (b) 6/7 (off-switch untested through a real caller — F-H1), (c) 1/1.
- `run_validation` overall FAIL only on `file_size_exceeded` for `CHANGELOG.md` (exempt by `audit-trail-rotation.md` + required by Rule 6 — documented caveat, not a defect).

## Spawned agents (audit trail)

`.claude/agents/review-auto-categorization-write-pipeline-2026-07-12/{architecture,tests,wiring,cross-validation,domain-memory-layer,domain-database}.md` + `findings/*.yaml`

## Handoff decision

**NEEDS_FIXES** — one HIGH (F-H1: the ADR-D3 off-switch + ADR-D2 custom-taxonomy are unreachable via the public factory; the plan promised them). The Goal (default-on) ships and is verified, but documenting an off-switch no consumer can reach is a Rule 3 honesty gap. Fix is small (thread `autoCategorize` through `LocalMemoryConfig` + `scoped-memory.ts` like `ontology`, export the type, add one integration test) — OR narrow ADR D3 explicitly. Recommend also closing F-M1 (Princípio 3 drop-event) inline. Loop back to `/implement` for a small fixes-cycle, then re-review.

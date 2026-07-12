# Re-review: auto-categorization-write-pipeline (fixes-cycle-1)

**Date:** 2026-07-12
**Reviewers (spawned agents):** 6 — architecture, tests, wiring, cross-validation, domain-memory-layer, domain-database (registered subagent types)
**Scope:** the fixes-cycle-1 diff `69927b2` (F-H1 + F-M1) + a sanity re-scan of the whole feature (`1f6f9d3~1..HEAD`)
**Verdict:** **READY_TO_MERGE** (unanimous — 6/6 agents)

## Resolution — both first-review findings CLOSED

| Finding | Sev | Status | Verified by |
|---|---|---|---|
| **F-H1** — off-switch + custom taxonomy unreachable via factory | HIGH | **CLOSED** | architecture, wiring (pillar b 6/7→7/7), cross-validation (exact match), tests, domain-memory-layer |
| **F-M1** — dropped LLM category = silent IGNORE | MEDIUM | **CLOSED** | architecture, wiring (pillar c), cross-validation, tests, domain-memory-layer (Princípio 3 hardened) |

### F-H1 verification (unanimous)
`autoCategorize?: AutoCategorizeConfig` on `LocalMemoryConfig` (`config.ts:143`, type-only import — no DIP cycle) → threaded into `ExtractionDeps` at `scoped-memory.ts:215` with the byte-identical conditional-spread `ontology`/`reranker` use → `AutoCategorizeConfig`/`CategorySource`/`DEFAULT_CATEGORY_TAXONOMY`/`classifyCategorySource` exported from `domain/index.ts`. `scoped-memory-autocategory.test.ts` proves BOTH default-on AND `enabled:false` (operator-only) **through the real `createLocalMemory` factory** — not a direct `ExtractionDeps` injection. ADR-D3 off-switch, ADR-D2 taxonomy override, Coverage-Matrix row 4 now reachable + tested end-to-end.

### F-M1 verification (unanimous)
`category_auto_dropped` added to `MEMORY_EVENTS` (union 38→39) and emitted in `pipeline.ts:333` inside `else if (typeof rawCategory === 'string')` — fires ONLY on a real drop (LLM proposed a string that failed the 1-64 bound), never on absence. Consistent with the `recall_threshold_filtered` / `entity_noise_filtered` Princípio-3 precedents. Asserted via stub tracer.

## New findings this re-review: 0

All 6 agents report zero new defects. Confirmed intact by the domain agents:
- **No DB regression:** `git show 69927b2 -- "*.sql"` empty; zero drizzle change; payload→`category`-column hoist unchanged (ADR D2/D5 no-migration invariant holds).
- **Memory-layer invariants intact:** single-round-trip, `attributed_to` mirror, ADD-only immutability (dedup does not overwrite category), fail-soft (remember never throws), no-paper-names.
- **F-dom-mem-3 clarified (was LOW):** `fact_count: 1` is CORRECT per-fact emission (per-fact events emit 1; batch events like `extraction_language_mismatch` emit the count). Not a defect.
- **No plan drift / no scope creep:** `69927b2` touches no plan file; all 9 changed files map 1:1 to F-H1 / F-M1 / CHANGELOG (Rule 6).

## Remaining (accepted for merge — optional hardening)

- **F-L1** source=`suggested` not e2e-tested through the pipeline (unit-tested in `classifyCategorySource`).
- **F-L2** event test asserts `source` but not `fact_count`.
- **F-L4** auto-category stored verbatim (not lowercased) — documented explicit decision; operator path also stores verbatim, so auto/operator stay mutually consistent.
- **F-L5** `StubVectorStore` duplicated per test file (per-file stub convention).
- **CHANGELOG.md file_size** — exempt by `audit-trail-rotation.md` + required by Rule 6 (a check limitation, not a defect).

## Quality gates (post-fix, re-verified by run)

- `npm test`: **1330 passed | 2 skipped**, 0 failures · `typecheck`: **0 errors** · `lint`: **0 warnings** · `/code-quality`: **PASS** · 0 regression.
- Wiring triad: (a) 4/4 live callers, (b) 1/1 real-factory integration test, (c) 2/2 events observed.

## Handoff decision

**READY_TO_MERGE** — both targeted findings CLOSED with exact matches + re-verified test evidence; no new issues, no regression, no drift. The feature ships (default-on auto-categorization) with a reachable off-switch and full Princípio-3 observability. Next: `/release` (PR `develop→main`, human-approved).

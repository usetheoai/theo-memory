# Review: entity-extraction-noise-filter (EG-2)

**Date:** 2026-06-23
**Reviewers (spawned agents):** 4 — architecture, tests, wiring+cross-validation, domain(memory-layer/entity-graph)
**Findings:** 0 BLOCKER, 1 HIGH, 1 MEDIUM, 3 LOW + INFO — all actionable closed inline
**Verdict:** READY_TO_MERGE

## Summary

EG-2 adds a pure deterministic `isEntityNoise` predicate at the `linkEntities`/`upsertNodes` chokepoint (covering both the LLM-primary and compromise-fallback node sources) + defense-in-depth in the compromise extractor. Architecture (7 INFO, clean) and wiring+cross-validation (all INFO/LOW, all "zero-change" claims verified empirically) passed clean. The tests + domain agents each surfaced one real issue, both closed inline.

## Findings closed inline

### F-test-1 (HIGH): GOAL was vacuous for the chokepoint
- Found by: tests (empirically — the agent RAN the compromise extractor and proved `anyNoise: false`). Because T2.2 added the filter INSIDE the extractor, the GOAL's compromise-fallback path emitted no noise → the `upsertNodes` chokepoint (T2.1) was never exercised; the GOAL would pass even if T2.1 were deleted (EC-4 violated).
- **Fix (`3e206b2`):** rerouted the GOAL through the **LLM-primary** node path — a deterministic LLM that returns an `entities` list provably carrying noise (`I'm`, `love science`, `user`) alongside the real ones. The LLM path has NO extractor-layer filter, so the chokepoint is the ONLY defense → non-vacuous + covers the dominant previously-unfiltered source (also closes **F-test-2 MEDIUM**: LLM-primary path now has integration coverage).

### F-dom-1 (MEDIUM): capitalized pronoun homographs dropped (recall regression)
- Found by: domain. The single-token `PRONOUNS` branch was case-insensitive, so `It` / `Her` / `Us` / `Them` (film titles) were dropped — the recall hole D2 explicitly aimed to avoid.
- **Fix (`3e206b2`):** applied the EC-1 capitalized-proper exception to the `PRONOUNS` branch — a bare pronoun is dropped only when lowercase; a capitalized pronoun homograph is kept (likely a title). Generic-role + contraction-remnants still drop regardless of case. Added `It`/`Her`/`Us` to the keep-set test; changed the drop-set `I`→`i`.

### F-dom-6 (LOW): silent drop vs Princípio 3
- Found by: domain (strong on-point argument: the project's own `recall_threshold_filtered` precedent + "IGNORE nunca é silencioso").
- **Fix (`3e206b2`):** added the `entity_noise_filtered` OTel event (attribute `filtered_count`, emitted only when `> 0`, mirroring `recall_threshold_filtered`). `MEMORY_EVENTS` 34→35; updated the count test + a `toContain` + the `index.ts` JSDoc (which also corrected stale "23 members" drift → 35).

## Findings accepted (no change)

- **F-test-3 (LOW):** the GOAL does not assert the fail-soft row / `entity_linked` metric — covered by the totality unit test + the event still fires; the GOAL proves the write succeeded (entities persisted). Accepted.
- **F-test-4 (LOW):** the compromise-path unit test uses a fake extractor — correct unit boundary; integration covers the LLM path. Accepted.
- **F-xval-3/4 (LOW):** extra contraction remnant `'t'` (improvement) + QUOTED-bypass-via-enclosing-block (functionally identical to the plan pseudo-code). Accepted.
- **F-dom-2/3 (LOW/INFO):** `people`/`person` standalone drop is the documented EC-5 trade; single-char remnants are safe given EC-2 ordering. Accepted.

## Cross-validation summary

| Task | Status |
|---|---|
| T1.1 pure `isEntityNoise` + unit tests | fully |
| T2.1 chokepoint filter (both node sources) | fully |
| T2.2 compromise extractor defense-in-depth | fully |
| T3.1 GOAL vs real pgvector (now LLM-primary, non-vacuous) | fully |

ADRs D1 (chokepoint), D2 (multilingual-safe), D3 (`fiction novels` kept) honored. ZERO new dependency, no DIP widening (ADR-0008), no migration; one additive public event literal (`entity_noise_filtered`) — empirically verified.

## Quality gates (post-fix)

- `npm run typecheck`: PASS (0 errors).
- `npm run lint` on changed files: PASS (0 warnings).
- Unit (domain + extraction): 486 passed.
- GOAL integration vs real `ankane/pgvector:v0.5.1`: 1/1 (non-vacuous — chokepoint is the sole defense on the LLM path).
- `/code-quality`: PASS (score_cap 100, 0 caps).

## Pre-existing (NOT introduced; disclosed per Inquebrável Rule 3)

Lint debt in `pipeline.ts` / `factory.ts` / `heuristic-policy.ts` / `in-memory-graph-expansion-store.ts` / `scoped-memory-adaptive.test.ts` (v0.18.0/v0.19.0 cycles) — not in this diff.

## Spawned agents (audit trail)

architecture (a78df708), tests (ac2fe8d0), wiring+cross-validation (a6d967e3), domain-memory-layer (af1643c1).

## Handoff decision

READY_TO_MERGE — 0 BLOCKER; the 1 HIGH (vacuous GOAL) + 1 MEDIUM (pronoun recall hole) + 1 LOW (Princípio 3 observability) closed inline at `3e206b2`; remaining LOW/INFO accepted. Proceed to `/release` (patch bump → v0.20.1, a `### Fixed`-only release).

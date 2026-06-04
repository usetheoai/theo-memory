# T0.0 Pre-cycle Audit — principles-alignment-hardening

**Date:** 2026-06-04
**Plan:** `principles-alignment-hardening` v1.1
**Task:** T0.0 (Phase Pre-T0 — EC-2 + EC-7 absorption audit)
**Status:** COMPLETE — 1 must-edit hit found (already in T1.1's "Files to edit"); 0 surprises requiring plan amendment.

## Why this audit exists

EC-2 absorption (from `/edge-case-plan principles-alignment-hardening` 2026-06-04): adding 3 literals to the `MEMORY_EVENTS` const array (`as const` exhaustive union at `src/core/memory-event.ts:16-30`) WILL break any test that pins `MEMORY_EVENTS.length === 13` (or `.toHaveLength(13)`) OR uses `expect(MEMORY_EVENTS).toEqual([...verbatim 13 strings...])`.

EC-7 absorption: widening `MemoryItem` with 2 optional fields (`confirmationCount?: number`, `rejectedAsDuplicate?: boolean`) is technically backward-compat for `toEqual`/`toMatchObject` (vitest ignores `undefined` fields) BUT WOULD break `expect(Object.keys(item).length).toBe(N)` patterns if any existed.

T0.0 enumerates BOTH surfaces so downstream tasks (T1.1, T3.1, T4.1 for `MEMORY_EVENTS`; T2.1 for `MemoryItem`) know exactly what to edit and the /implement halt-loop doesn't fail at GREEN with cascading test breaks.

## Surface 1 — `MEMORY_EVENTS` pinning

### Grep commands run

```bash
grep -rln "MEMORY_EVENTS" src/ tests/
grep -rnE "MEMORY_EVENTS\.length" src/ tests/
grep -rnE "toHaveLength\(13\)|toBe\(13\)" src/ tests/
grep -rnE "toEqual.*extraction_started" src/ tests/
```

### Full inventory

| File:Line | Pattern | Classification | Reason |
|---|---|---|---|
| `src/core/memory-event.ts:16` | `export const MEMORY_EVENTS = [` | source-definition | THIS is the array being extended — T1.1 + T3.1 + T4.1 add literals here |
| `src/core/memory-event.ts:32` | `export type MemoryEvent = (typeof MEMORY_EVENTS)[number];` | safe | Type derives from array; auto-updates on literal additions |
| `src/core/__tests__/memory-event.test.ts:6` | `import { MEMORY_EVENTS, emitEvent } from '../memory-event.js';` | safe | Plain import |
| **`src/core/__tests__/memory-event.test.ts:11`** | **`expect(MEMORY_EVENTS).toHaveLength(13);`** | **MUST-EDIT** | **Rigid length pin — breaks when 13 → 16. Bump to `toHaveLength(16)` OR delete (the per-event `toContain` checks below already protect the contract).** |
| `src/core/__tests__/memory-event.test.ts:15` | `expect(MEMORY_EVENTS).toContain('extraction_failed');` | safe | Per-literal `toContain` — additive-safe |
| `src/core/__tests__/memory-event.test.ts:28` | `expect(MEMORY_EVENTS).toContain(e);` | safe | Loops over a list of expected events; additive-safe |
| `src/core/index.ts:179` | `export { MEMORY_EVENTS, emitEvent } from './memory-event.js';` | safe | Barrel re-export |

### `toEqual([...verbatim...])` pattern

Zero hits. No test uses verbatim 13-element array equality.

### Verdict

**1 must-edit hit:** `src/core/__tests__/memory-event.test.ts:11`. This file ALREADY appears in T1.1's "Files to edit" list (`src/core/__tests__/memory-event.test.ts (EDIT — pin new literal)`). T1.1 commit bumps the count from 13 → 16 when adding `dedup_collision_confirmed` (T1.1), `extraction_zero_facts` (T3.1), and `recall_threshold_filtered` (T4.1).

**Recommendation:** T1.1 / T3.1 / T4.1 commit bodies must each note the running count update so the final count = 16 lands atomically at the LAST of the 3 tasks (T4.1 per Dependency Graph). Alternatively, each task bumps the literal count when it adds its event — T1.1 bumps to 14, T3.1 bumps to 15, T4.1 bumps to 16. Either pattern works; the running-count discipline matters more than the exact bump cadence.

## Surface 2 — `MemoryItem` shape rigid assertions

### Grep commands run

```bash
grep -rln "MemoryItem" src/ tests/
grep -rnE "Object\.keys.*[Mm]emor" src/ tests/
grep -rnE "expect.*keys.*length" src/ tests/
grep -rnE "Object\.keys.*\.length" src/ tests/
```

### Full inventory of `Object.keys` patterns

| File:Line | Pattern | Classification | Reason |
|---|---|---|---|
| `tests/integration/public-paths.test.ts:59` | `expect(Object.keys(mod)).not.toContain('memoryFromCtx');` | safe | Checks EXPORT surface of a barrel module, NOT a MemoryItem instance. Pattern is `.not.toContain` (negation), additive-safe. |

### Verdict

**Zero must-edit hits.** No test pins `Object.keys(memoryItem).length` or uses verbatim full-shape `toEqual({verbatim shape})` against a `MemoryItem` instance. T2.1's widening of `MemoryItem` with 2 optional fields is contract-additive and breaks no existing assertion.

## Cross-reference with downstream task "Files to edit"

| Task | Plan's "Files to edit" list | Audit-driven additions | Status |
|---|---|---|---|
| T1.1 | Includes `src/core/__tests__/memory-event.test.ts (EDIT — pin new literal)` | NONE — file already listed | ✅ Plan correct |
| T3.1 | Includes `src/core/__tests__/extraction-pipeline.test.ts (EDIT — append RED test)` + NOT `memory-event.test.ts` | NONE if literal count bumped at T1.1 OR T4.1 | ✅ Plan correct (shared pinning file consumed at T1.1 or T4.1) |
| T4.1 | Includes `src/core/__tests__/retrieval-pipeline.test.ts (EDIT — append RED test)` + NOT `memory-event.test.ts` | NONE if literal count finalized at T4.1 | ✅ Plan correct |
| T2.1 | Includes `src/core/__tests__/memory-item.test-d.ts (NEW — type-narrow test)` | NONE — zero rigid shape assertions exist today | ✅ Plan correct |

**No plan amendment required.** The plan's "Files to edit" lists ALREADY capture the only must-edit hit. T0.0's value is the NEGATIVE confirmation: no other rigid assertions exist that would cascade-break.

## EC-2 absorption — final state

- [x] Grep audit completed for `MEMORY_EVENTS` pinning
- [x] 1 must-edit hit found (`memory-event.test.ts:11`)
- [x] Hit already covered by T1.1's "Files to edit"
- [x] Recommendation: running-count discipline across T1.1 → T3.1 → T4.1 (13 → 14 → 15 → 16)

## EC-7 absorption — final state

- [x] Grep audit completed for `MemoryItem` rigid shape assertions
- [x] Zero must-edit hits — additive widening is contract-safe across the entire codebase
- [x] No preemptive `toMatchObject` migrations needed

## DoD verification

- [x] Audit report exists at declared path (`.claude/knowledge-base/audits/principles-alignment-hardening-precycle-audit-2026-06-04.md`)
- [x] Grep command output recorded
- [x] Each hit classified (`must-edit` / `safe` / `false-positive`)
- [x] `must-edit` hit cross-referenced to downstream task ("Files to edit" of T1.1 — already lists the file)
- [x] Zero hits remain `unclassified`
- [x] `npm test` baseline unchanged (no source edits at T0.0)

## Related

- Plan: `.claude/knowledge-base/plans/principles-alignment-hardening-plan.md` § Phase Pre-T0 / T0.0
- Edge-case review: `.claude/knowledge-base/reviews/principles-alignment-hardening-edge-cases-2026-06-04.md` § EC-2 + § EC-7
- ADR D2: 3 new `MemoryEvent` literals over existing `emitEvent` infra
- ADR D4: `MemoryItem.rejectedAsDuplicate` as optional flag on existing shape

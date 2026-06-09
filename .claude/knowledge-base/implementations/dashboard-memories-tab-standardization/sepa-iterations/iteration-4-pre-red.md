# SEPA — Iteration 4 / Task T6.1 / Phase pre-RED (TIGHT)

## Verdict: PROCEED TO RED — 1 MAJOR (line-drift) to honor in GREEN

## Findings
- [MAJOR] M1 — Plan T6.1 § Evidence cites stale lines `643, 756, 957` from pre-T1.1/T2.1 state. Current lines after cf17aee + cea60b9 commits are:
  | # | File | Current line |
  |---|---|---|
  | 1 | `src/local/index.ts` | 644 (recall MemoryItem) |
  | 2 | `src/local/index.ts` | 757 (reflect derived MemoryItem) |
  | 3 | `src/local/index.ts` | 980 (history/retrieval MemoryItem) |
  | 4 | `src/local/scoped-skill-memory.ts` | 104 (skill scope) |
  | 5 | `src/local/skills/payload.ts` | 78 (skill payload) |

  DRAFT file MUST cite current lines, NOT plan's stale ones.

## RED test shape (EC-5)
- Location: `tests/integration/plans/followup-draft-file.test.ts` (new dir; first occupant)
- Assertions:
  1. `fs.existsSync(canonical path) === true`
  2. Frontmatter contains: `slug`, `status: DRAFT`, `created_at: 2026-06-08`, `goal`
  3. All 5 current-state file:line refs present (cite the SEPA-corrected list, not plan's stale)
  4. References `ADR D5` + `dashboard-memories-tab-standardization-plan.md`
  5. References `asOf` + `v1.1` + `empirical validation` (validation gap)

## Gates
- Canonical DRAFT path does not yet exist (RED pre-condition holds)
- No name collision
- All 5 deferred sites unchanged (D5 read-only intact)

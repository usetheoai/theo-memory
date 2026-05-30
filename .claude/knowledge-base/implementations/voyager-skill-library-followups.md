# Follow-ups — voyager-skill-library

Opportunistic improvements logged during the halt-loop that are out-of-scope for the current task.
Per cycle-implement.md anti-pattern #7 (no scope creep), these land in separate commits/PRs.

## Pre-existing paper-name references to clean up (per [[no-paper-names-in-code]] feedback 2026-05-30)

- `src/agent-tools/server.ts:34` — comment: `traffic is emitted (Voyager-style skill library lands v0.6 per CLAUDE.md Roadmap Item 8)`. Rephrase to drop "Voyager-style" — replace with "code-as-skill library lands v0.6 per CLAUDE.md Roadmap Item 8". Predates this halt-loop; clean up next time `src/agent-tools/server.ts` is touched (or in a dedicated docs-pass PR).

## Pre-existing integration test failures (NOT v0.6 regressions — confirmed by running tests against `develop` HEAD)

- `tests/integration/schema-v0-4a-constraints.test.ts > kind='derived' with derived_from=NULL violates CHECK` — Postgres CHECK constraint returns NULL (not false) for the `(kind='derived' AND jsonb_array_length(NULL)>=1)` arm because `jsonb_array_length(NULL)` is NULL; Postgres treats NULL as PASS in CHECK constraints. The 2-arm v0.4a CHECK has the same defect (test was already failing on `develop` — verified via `git stash` swap). Fix: tighten the derived arm to `(kind='derived' AND derived_from IS NOT NULL AND jsonb_array_length(derived_from)>=1)` in a follow-up migration that ALSO updates the skill arm symmetrically. Out of scope for v0.6 T5.1.
- `tests/integration/reflection/threshold-policy.test.ts > THE GOAL TEST T6.1 — 50 memories → reflect() → ≥ 1 derived` — fails at PgvectorStore.initialize with `this.pool.query is not a function` because the test passes a non-pool object to the constructor. Also fails on `develop` HEAD — pre-existing test setup issue unrelated to v0.6. Track separately.

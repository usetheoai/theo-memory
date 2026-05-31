# SEPA brief — task T0.1 (phase: post-GREEN) — iteration 1

**Recap of plan declaration:** T0.1 adds 4 nullable columns to `memories` (`superseded_by` UUID self-FK ON DELETE SET NULL, `code` TEXT, `description` TEXT, `code_language` VARCHAR(20)) and extends `memories_kind_derived_from_check` with a 3rd arm for `kind = 'skill'` where `derived_from` is optional/array. Migration MUST cite the constraint name verbatim per EC-1.

**Watchpoints for this phase:**
- EC-1 (constraint name verbatim) — VERIFIED.
- Self-FK with ON DELETE SET NULL — VERIFIED (uses `AnyPgColumn` forward-ref idiom).
- SRP / DIP / naming / file-size / no any / no console.log — all OK.
- TDD discipline — OK (RED→GREEN; 8 new tests; 424 = 416 baseline + 8).
- ADR D3 cross-references — present in JSDoc on every new column + test header.

**Cross-references checked:**
- EC-1 absorption — present in both schema.ts (constraint name string) and migration SQL DROP/ADD pair.
- ADR D3 — cited in test header + schema.ts JSDoc.
- architecture.md § Naming — snake_case SQL / camelCase TS consistent.
- testing.md § Pyramid — CHECK enforcement explicitly deferred to integration tier per file header comment.

**Recommendations:**
- OK — Diff is tight, TDD intact, EC-1 landed in both schema constraint and migration SQL, all 4 columns + 3-arm CHECK present. Ready for REFACTOR (none needed) and pre-COMMIT.
- CAUTION (non-blocking) — Pillar (b) integration test deferred via ADR-DEFER-WIRING-B marker in implementation contract; landing site declared (T5.1 GOAL TEST). Pillar (a) vacuous for schema columns until T1.x/T2.x. Pillar (c) vacuous (no metrics in plan).
- CAUTION (snapshot sanity) — Verified: `meta/0002_snapshot.json` reflects the 3-arm CHECK verbatim (`grep -c "'skill'" returns 1`; full CHECK value confirmed).

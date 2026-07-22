# Review: m12-themory-import-cli

**Date:** 2026-07-22
**Reviewers (spawned agents):** 2 parallel general-purpose agents — (1) architecture + wiring + security; (2) tests + cross-validation — over the M12 diff on `develop` vs the v0.40.0 baseline.
**Findings:** 9 total (BLOCKER: 1, HIGH: 1, MEDIUM: 4, LOW: 3)
**Verdict:** READY_TO_MERGE (all BLOCKER/HIGH/MEDIUM closed in the fix-cycle commit; LOWs documented)

## BLOCKER findings (fixed)

### F-arch-1: Documented invocation unreachable for kit users
- Severity: BLOCKER — the skill's PRIMARY path (`npx --yes @usetheo/memory import claude-code`) fails on every kit machine: the package ships NO npm bin (Docker-only topology per `complete-workspace-publish-topology` ADR D2-a).
- Fix (structural, not doc-only): `install.sh` now SHIPS the engine to `~/.claude/hooks/migrate-claude-code.mjs` (7 hook files); SKILL.md/README/RUNBOOK rewritten — primary `node ~/.claude/hooks/migrate-claude-code.mjs`, alternatives checkout `dist/agent-tools/cli.js import claude-code` and Docker `-v ~/.claude:/root/.claude`. Third byte-parity sentinel (engine canonical ↔ kit copy) added in `tests/unit/scrub-parity.test.ts`; installer test asserts the copy lands.

## HIGH findings (fixed)

### F-tests-1 / F-arch-4: No dist-boot proof of the shipped subcommand
- The `postbuild:copy-import` step had no sentinel — the rewrite-dist-aliases class of red.
- Fix: `tests/integration/import/cli-dist-import-boot.test.ts` — env-free `--help` exit 0 + dist dry-run vs temp `--source` (reports, dials nothing).

## MEDIUM findings (fixed)

- **F-arch-2:** `~/.claude/theo-memory.env` parsing did not strip quotes (theo-lib does) → `parseKitEnvFile` strips one surrounding pair; unit-pinned.
- **F-arch-5:** `run-import.ts` mutated `process.env` to pass config → D2 resolution moved INSIDE the engine (`resolveImportEndpoint`); runner is a pure flag→argv mapper. Bonus: the kit standalone path became zero-config.
- **F-tests-3:** GOAL test exercised engine internals, not the CLI layer → both commits now route through `main(['--commit','--source',…])` with `THEOMEM_MIGRATE_URL`.
- **SEC-05:** `metadata.type`/`file` bypassed the scrub in `nodeToBatchItem` → both scrubbed.

## LOW findings (documented, not blocking)

- **F-tests-2:** `THEOMEM_MIGRATE_TOKEN`-only preservation not separately pinned (covered transitively by the precedence suite).
- **F-arch-3:** engine `.mjs` (not TS) — deliberate: the kit hooks channel runs stdlib-only standalone; typed seam via `.d.mts`.
- **F-arch-6:** back-compat shim `scripts/migrate-claude-code-memory.mjs` retained one release (17 legacy tests ride through it).

## Edge-case coverage report
- Covered: secret-dominated skip ratio, UUID-as-suspected-token scrub, quoted env values, missing kit env file (→ `{}`), idempotent re-run (deduped), env-free boot.
- The explicit `THEOMEM_MIGRATE_URL` override deliberately does NOT inherit the kit token (cross-endpoint credential leak guard) — pinned in `run-import-env.test.ts`.

## Cross-validation summary
- Plan tasks (m12-themory-import-cli-plan): T1.1, T1.2, T2.1, T3.1, T3.2 — fully implemented; ROADMAP M12 DoD 5/5 satisfiable (CLI subcommand + kit skill + scrub single-source parity + GOAL idempotent round-trip + docs).

## Quality gates summary
- typecheck: PASS (0 errors) · lint: PASS (0 errors, 0 warnings — 4 pre-existing import/order autofixed)
- Unit (M12 set): 28 passed / 1 skipped — scrub-parity (3 sentinels), run-import-env (5), migrator (17 via shim), kit-install, locked-names
- Integration: 3/3 — GOAL round-trip via `main()` on real pgvector (imported=3, secret REDACTED in DB, re-run deduped=3, rows=3) + dist-boot 2/2

## Handoff decision
READY_TO_MERGE — proceed to `/release` (v0.41.0), flip M12.

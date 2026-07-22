---
slug: m12-themory-import-cli
milestone_id: M12
created_at: 2026-07-22
goal: Ship the Claude-Code-memory migration as `themory import claude-code` (dry-run default, fail-closed scrub, kit-env zero-config) + a `/migrate-theo-memory` kit skill, proven by a real-pgvector idempotent round-trip test (re-run → deduped, zero duplicate rows).
---

# M12 — `themory import claude-code` (CLI + kit skill)

## Goal

Ship the Claude-Code-memory migration as a first-class `themory import claude-code` subcommand
(dry-run default, fail-closed scrub, kit-env zero-config) + a thin `/migrate-theo-memory` kit skill,
proven by a real-`ankane/pgvector` **idempotent round-trip test**: `--commit` twice → second run reports
`deduped == n`, `imported == 0`, zero duplicate rows.

## Context

Productizes the M6 T2.1 script per the SHIPPABLE_WITH_CAVEATS blueprint at
`.claude/knowledge-base/discoveries/blueprints/m12-themory-import-cli-blueprint.md` (ADRs D1–D4) and
the grill `knowledge-base/grills/themory-import-cli-feature-grill.md`. LLM-driven migration REJECTED
(recorded): the scrub is a security control (fail-closed), verbatim fidelity, 1 batch request vs 432
MCP calls, deterministic idempotency. The CLI is the engine; the skill orchestrates.

## Baseline Context

### Files that will be touched

| File | LoC | Last sha | Role in M12 |
|---|---|---|---|
| `packages/cli/src/cli.ts` | 505 | `cd3a34d` | register `import` group + `claude-code` sub (keys-group precedent `:273-293`), lazy runner |
| `packages/cli/src/run-import.ts` | 0 (NEW) | — | the subcommand runner (env resolution + invoke the migrator) |
| `packages/cli/src/import/theo-scrub.mjs` | 0 (NEW — moved) | — | CANONICAL scrub (from the kit copy, 81 LoC) |
| `packages/cli/src/import/migrate-claude-code.mjs` | 0 (NEW — moved) | — | the migrator pipeline (from `scripts/`, 389 LoC) |
| `scripts/migrate-claude-code-memory.mjs` | 389 | `e35ec3a` | becomes a thin re-export shim (back-compat) |
| `tests/unit/migrate-claude-code-memory.test.ts` | 248 | `e35ec3a` | retargeted imports (pure functions unchanged) |
| `docs/claude-code-kit/hooks/theo-scrub.mjs` | 81 | `e35ec3a` | becomes the SYNCED COPY (parity-sentinel-guarded) |
| `docs/claude-code-kit/install.sh` | 88 | `e35ec3a` | + copy `skills/` → `~/.claude/skills/` |
| `docs/claude-code-kit/skills/migrate-theo-memory/SKILL.md` | 0 (NEW) | — | the orchestration skill |
| `tests/unit/scrub-parity.test.ts` | 0 (NEW) | — | byte-parity sentinel (M6-SEC-01) |
| `tests/integration/import/claude-code-roundtrip.test.ts` | 0 (NEW) | — | THE GOAL TEST (idempotent round-trip) |

### Current callers

- `scripts/migrate-claude-code-memory.mjs` — invoked manually (`node scripts/...`); unit test imports its pure exports (`parseNode`, `scrub`, `nodeToBatchItem`, `planMigration`).
- `docs/claude-code-kit/hooks/theo-scrub.mjs` — imported by the script (`:30`) AND by the kit hooks at runtime from `~/.claude/hooks` (standalone copies — cannot import an npm package).
- `packages/cli/src/cli.ts` — `themory` bin; `--help` boots env-free (guard `tests/integration/p0-audit/cli-dist-boot-envfree.test.ts`).

### Glossary

- **dry-run default** — the subcommand writes NOTHING without `--commit` (stricter than the mem0 reference — kept).
- **fail-closed scrub** — deny-list redaction BEFORE any write; secret-dominated nodes are SKIPPED.
- **parity sentinel** — a CI test asserting the kit's scrub file is byte-identical to the canonical package module.
- **kit-env precedence** — env > `~/.claude/theo-memory.env` > default (the kit's `theo-lib.mjs:20-28` shape).

### Architecture boundaries

The migrator stays a pure-stdlib module (no `pg`, no new deps — parsimony rung 4); the CLI runner does
env/flag resolution only; the kit skill contains NO logic (orchestration text). `architecture.md § 3`.

## Prior Art & Related Work

- Blueprint at `.claude/knowledge-base/discoveries/blueprints/m12-themory-import-cli-blueprint.md` (mem0 `oss-to-platform-migrate` ergonomics + test patterns; internal keys-group CLI seam).
- M6 T2.1 (the script + kit + scrub), M7 (gateway path the skill's verification uses).

## ADRs

### D1 — `import` group + `claude-code` sub, lazy runner (keys precedent)

Mirrors `cli.ts:273-293`; `run-import.ts` lazy-loaded so `--help` stays env-free. **Alternative
rejected:** overloading `themory migrate` — that verb means SCHEMA migrations; conflating corrupts it.

### D2 — Kit-style env precedence + `THEOMEM_MIGRATE_*` override

env > `~/.claude/theo-memory.env` > default → zero-config on kit machines; the script's current
`THEOMEM_MIGRATE_URL/TOKEN` stay honored as the highest-precedence override (back-compat).
**Alternative rejected:** env-only (forces manual config per machine).

### D3 — Canonical scrub in the package; kit carries a byte-parity-guarded copy (M6-SEC-01)

Kit hooks run standalone from `~/.claude/hooks` and cannot import an npm package, so a file copy is
forced; the sentinel test makes divergence a CI failure. **Alternative rejected:** kit imports the
package (impossible on kit machines); **rejected:** two free-floating copies (M12 risk #1 — leak).

### D4 — Skill = orchestration only (grill D2)

Dry-run → report → explicit user confirmation → `--commit` → recall verification. **Alternative
rejected:** LLM-driven migration (recorded rationale in the grill).

## Dependency Graph

```
Phase 1 (canonical scrub + CLI subcommand + unit ports) ─→ Phase 3 (integration + docs/locked-names)
Phase 2 (kit skill + installer)                        ─┘
```

## Phase 1 — CLI engine

### T1.1 — Canonical scrub + parity sentinel

#### Files to edit
- `packages/cli/src/import/theo-scrub.mjs` (NEW — content moved from the kit copy)
- `docs/claude-code-kit/hooks/theo-scrub.mjs` (now the synced copy; content unchanged)
- `tests/unit/scrub-parity.test.ts` (NEW)

#### Why this step
M12 risk #1: a diverged scrub copy leaks secrets. The canonical module + byte-parity sentinel makes
divergence a CI failure (blueprint D3). The kit file's CONTENT does not change — only its authority.

#### TDD
- `RED: test_scrub_parity_kit_copy_is_byte_identical_to_canonical` — reads both files, asserts byte equality.
- `RED: test_scrub_exports_unchanged` — `scrub()` redacts a `theo_live_x` token + an `npm_` token from a sample (behavior lock).

#### Concurrency tests
(none — single-threaded file assertion)

#### Acceptance criteria
- Parity test fails if either file drifts; scrub behavior locked by test.

#### DoD
- 2 unit tests green; typecheck 0.

### T1.2 — Move the migrator into the package + `run-import.ts` + registration

#### Files to edit
- `packages/cli/src/import/migrate-claude-code.mjs` (NEW — moved from `scripts/`, import retargeted to the canonical scrub)
- `packages/cli/src/run-import.ts` (NEW — flag parsing, kit-env resolution per D2, invokes the migrator)
- `packages/cli/src/cli.ts` (register `import` group + `claude-code` sub, lazy)
- `scripts/migrate-claude-code-memory.mjs` (thin re-export shim — back-compat for existing docs/tests)
- `tests/unit/migrate-claude-code-memory.test.ts` (imports retargeted; assertions unchanged)

#### Why this step
The engine must be SHIPPED (today it is repo-internal). The keys-group seam (`cli.ts:273-293`) + lazy
runner preserve the env-free `--help` boot (blueprint D1). Kit-env precedence (D2) gives kit machines
zero-config.

#### TDD
- `RED: test_import_command_registered` — `themory import claude-code --help` exits 0 and prints dry-run default (env-free).
- `RED: test_env_resolution_prefers_migrate_env_then_kit_file` — `THEOMEM_MIGRATE_URL` wins; absent → `~/.claude/theo-memory.env` values; absent → default (unit, temp env file).
- Existing 248-LoC suite re-green after retarget (parse/scrub/map/plan pure functions unchanged).

#### Failure scenarios
- Batch endpoint unreachable on `--commit` → typed error + non-zero exit + per-chunk report (never a silent partial success).
- Malformed memory file → node skipped with a reported reason (existing behavior, kept).

#### Concurrency tests
(none — sequential chunked HTTP)

#### Acceptance criteria
- `themory import claude-code` runs dry-run by default; `--commit` posts; unit suite green.

#### DoD
- typecheck 0; lint 0 errors; env-free `--help` guard still green.

## Phase 2 — Kit skill + installer

### T2.1 — `/migrate-theo-memory` skill + install.sh copy

#### Files to edit
- `docs/claude-code-kit/skills/migrate-theo-memory/SKILL.md` (NEW)
- `docs/claude-code-kit/install.sh` (copy `skills/` → `~/.claude/skills/`)
- `docs/claude-code-kit/README.md` (usage section)

#### Why this step
The agent-native UX (grill Q1): user types `/migrate-theo-memory`; the skill orchestrates the CLI
(dry-run → report → confirm → `--commit` → recall verification) and NEVER re-implements the pipeline
(blueprint D4). install.sh mirrors the hooks-copy semantics (blueprint Q6 — the mechanism is NEW).

#### TDD
- `RED: test_install_sh_copies_skill` — run install.sh against a temp HOME; assert `~/.claude/skills/migrate-theo-memory/SKILL.md` exists (shell-out unit test, mirrors the kit's `test-merge.mjs` style).

#### Acceptance criteria
- Skill instructs: dry-run first, show report, require explicit confirmation before `--commit`, verify via recall; no pipeline logic in the skill.

#### DoD
- install test green; README documents the flow.

## Phase 3 — Integration + docs

### T3.1 — THE GOAL TEST: real-pgvector idempotent round-trip

#### Files to edit
- `tests/integration/import/claude-code-roundtrip.test.ts` (NEW)

#### Why this step
The M12 DoD gate + the mem0 idempotency pattern (blueprint Corner 1) on our real boundary.

#### TDD
- `RED: test_import_roundtrip_idempotent` — temp source dir with 3 memory nodes (1 secret-bearing) → run import `--commit` against a `createServer` app on real pgvector → 3 imported, secret REDACTED in stored text; run again → `deduped == 3`, `imported == 0`, row count unchanged.

#### Failure scenarios
- pgvector unavailable (`THEOMEM_PG_URI` unset) → `describe.skip` (no false green).

#### Acceptance criteria
- Round-trip idempotent; the stored secret-bearing node contains the redaction marker, never the secret.

#### DoD
- Integration test green under `THEOMEM_PG_URI`.

### T3.2 — Locked-names amendment + docs + CHANGELOG

#### Files to edit
- `CLAUDE.md` (locked names: `themory` CLI verbs += `import` — owner sign-off = the M12 /goal)
- `docs/RUNBOOK.md` (migration section retargeted to the subcommand)
- `CHANGELOG.md` (`[Unreleased] § Added`)

#### Why this step
M12 DoD item 5; Unbreakable Rule 6; the locked-names governance requires the amendment be explicit.

#### TDD
- (docs task) verification = `grep` assertions in the DoD, not a runtime test.

#### Acceptance criteria
- CLAUDE.md lists `import` among the CLI verbs with the M12 provenance; RUNBOOK shows the new command.

#### DoD
- `grep -q "import" CLAUDE.md` (locked-names row) + CHANGELOG entry present.

## Coverage Matrix

| M12 DoD item (ROADMAP) | Task(s) |
|---|---|
| `themory import claude-code` shipped (dry-run default, `--commit`, `--source`, kit-env fallback) + unit tests ported | T1.2 |
| Scrub canonical + sentinel parity test (M6-SEC-01) | T1.1 |
| Kit skill `/migrate-theo-memory` + docs | T2.1 |
| Integration test: idempotent round-trip on real pgvector | T3.1 |
| CLI locked-names amended + CHANGELOG | T3.2 |

100% of the M12 DoD maps to ≥ 1 task.

## Drawbacks & Risks

1. **Diverged scrub copy leaks secrets (HIGH).** **Mitigation:** T1.1 canonical module + byte-parity
   sentinel (divergence = CI failure). **Owner:** T1.1.
2. **`import` namespace scope creep (MEDIUM).** **Mitigation:** ship ONLY `claude-code`; namespace
   documented future-extensible (YAGNI). **Owner:** T3.2.
3. **Moving the migrator breaks the existing script path for users following old docs (LOW).**
   **Mitigation:** `scripts/migrate-claude-code-memory.mjs` stays as a thin re-export shim; RUNBOOK
   updated. **Owner:** T1.2.

## Unresolved Questions

(none — every decision is resolved at plan time; the blueprint ADRs D1–D4 lock the packaging choices.)

## Failure scenarios

- **HTTP batch endpoint down on `--commit`** → typed error, non-zero exit, per-chunk report (T1.2).
- **Malformed memory file** → node skipped + reported reason (existing behavior, kept) (T1.2).
- **pgvector unavailable in CI** → integration `describe.skip` (T3.1).

## Global Definition of Done

- All phase DoDs green; `npm run typecheck` + lint clean; env-free `--help` guard green.
- THE GOAL TEST (T3.1) passes on real `ankane/pgvector`.
- `/plan-confidence` ≥ SHIPPABLE_WITH_CAVEATS; `/code-quality` ∉ {FAIL_HARD, INVALID}; `/review` READY_TO_MERGE before release.

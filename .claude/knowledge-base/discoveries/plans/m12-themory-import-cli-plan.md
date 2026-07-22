# Discovery Plan: M12 — `themory import claude-code` (productize the memory migration)

- **Version:** v1.0
- **Slug:** `m12-themory-import-cli`
- **Owner:** memory-core
- **Created:** 2026-07-22
- **Cycle:** discover (phase 1 → `/discover-edge-cases` → `/discover-plan-confidence` → `/discover-execute`)

## Context

M6 T2.1 shipped the Claude-Code-memory → theo-memory migrator as a repo-internal script
(`scripts/migrate-claude-code-memory.mjs`, 389 LoC + 248 LoC unit tests). The 2026-07-22 live test
proved the demand (432 nodes, 292 secret-bearing — kept off the server only by the fail-closed scrub).
M12 productizes it: a `themory import claude-code` CLI subcommand (deterministic engine) + a thin
`/migrate-theo-memory` kit skill (UX orchestration). The LLM-driven alternative was REJECTED with
recorded rationale (grill `knowledge-base/grills/themory-import-cli-feature-grill.md`). This discovery
grounds the PACKAGING decisions (CLI subcommand shape, canonical scrub location, skill contract)
against the internal baseline + the mem0 migration-tooling prior art.

## Objective

Produce a blueprint that grounds: (a) the CLI subcommand shape (`import claude-code`) against the
existing `run-*.ts` registration pattern + mem0's oss-to-platform migrate tooling; (b) the canonical
scrub packaging (single source with the kit, M6-SEC-01); (c) the kit-skill contract (orchestrate,
never re-implement).

**Measurable success:** every question answered with a citation that resolves on disk; the blueprint
names the exact CLI registration seam, the scrub's canonical module path, and the skill's step
contract; 4 corners populated; zero fabricated citations.

## In-Scope / Out-of-Scope

### In-Scope (per source)

- **Internal:** `packages/cli/src/` (subcommand pattern: `run-migrate.ts`, `run-keys.ts`, `cli.ts`),
  `scripts/migrate-claude-code-memory.mjs`, `tests/unit/migrate-claude-code-memory.test.ts`,
  `docs/claude-code-kit/` (hooks incl. `theo-scrub.mjs`, `install.sh`, `README.md`).
- **mem0** (`.claude/knowledge-base/references/mem0/`): `scripts/oss-to-platform-migrate.sh`,
  `tests/test_oss_to_platform_migrate.py`, `docs/migration/`.

### Out-of-Scope (explicit)

- Other import sources (openmemory/mem0 importers) — YAGNI per M12 risk #2; the namespace ships ONLY `claude-code`.
- Any change to the migration PIPELINE semantics (parse/scrub/map/batch are shipped + tested — this is packaging).
- The MCP surface (no batch MCP tool in M12; the skill verifies via the existing `recall`).
- mem0's platform SDK internals beyond the migrate script + its test.

## ADRs

### D1 — Time budget + stop conditions

Internal: 2h; mem0: 1h. Per-question stop: one resolving citation answers it — no adjacent spelunking.

### D2 — The CLI is the engine; the skill NEVER re-implements (locked by grill Q1)

The migration logic stays deterministic (fail-closed scrub, verbatim `infer:false`, batch, idempotent).
The skill's ONLY job is orchestration (dry-run → report → confirm → commit → recall verification).
**Alternative rejected (recorded):** LLM-driven migration — scrub would not be fail-closed, verbatim
fidelity at risk, 432 single-item MCP calls, non-deterministic partial state.

### D3 — Reuse-first packaging (Rule 9 / parsimony rung 4)

The subcommand reuses the existing commander registration (`cli.ts` + `run-*.ts` pattern) and the
shipped env resolution; NO new dependency. The scrub becomes ONE canonical module in the shipped
package with the kit consuming it (inverting today's script→kit import direction).

## Research Questions

Six questions across the four corners (techniques ×3, tests ×1, deps ×1, tools ×1). Every source and method path verified on disk (2026-07-22).

| # | Question | Corner | Source | Method | Expected answer shape |
|---|---|---|---|---|---|
| Q1 | What is the EXACT registration seam for a new `themory` subcommand (how `run-migrate.ts`/`run-keys.ts` mount in `cli.ts`, incl. lazy-import discipline for `--help` boot)? | techniques | `packages/cli/src/` | Grep `command\(`, `action\(`, `import\(` in `packages/cli/src/cli.ts` | Read `packages/cli/src/cli.ts` + `packages/cli/src/run-migrate.ts` | The seam + lazy-load pattern the `run-import.ts` must follow (env-free `--help` boot preserved) |
| Q2 | How does mem0 ship its OSS→platform migration tool (CLI shape, dry-run posture, batching, error reporting)? | techniques | `.claude/knowledge-base/references/mem0/` | Read `scripts/oss-to-platform-migrate.sh` | Grep `batch`, `dry`, `limit` in the script | Pattern comparison: their migrate ergonomics vs our dry-run-default + chunked batch (validates or challenges our flags) |
| Q3 | What does the current script's env/endpoint resolution look like vs the kit's (`theo-lib.mjs`), and where must the canonical scrub live so BOTH the CLI and the kit consume one module? | techniques | `scripts/migrate-claude-code-memory.mjs`, `docs/claude-code-kit/` | Grep `THEOMEM_`, `scrub`, `import` in the script + `docs/claude-code-kit/hooks/theo-lib.mjs` + `theo-scrub.mjs` | Read the import graph of the three files | The canonical module path + the kit-copy mechanism (`install.sh`) that preserves single-source (M6-SEC-01) |
| Q4 | How does mem0 TEST its migration tool (fixtures, dry-run assertions, idempotency)? | tests | `.claude/knowledge-base/references/mem0/` | Read `tests/test_oss_to_platform_migrate.py` | Grep `dry`, `mock`, `idempot` in that test | Test-pattern mapping onto porting our 248-LoC unit suite + the new real-pgvector idempotent round-trip test |
| Q5 | Does the subcommand need ANY new dependency (arg parsing, HTTP, fs) beyond what `packages/cli` already declares? | deps | `packages/cli/` | Read `packages/cli/package.json` | Grep `commander`, `dependencies` | Expected: NO new dep (commander + node stdlib fetch cover it — Rule 9); list the exact reused deps |
| Q6 | How does the kit install/distribute artifacts today (`install.sh` copy semantics, README contract), and where does a kit SKILL (`/migrate-theo-memory`) plug in? | tools | `docs/claude-code-kit/` | Read `docs/claude-code-kit/install.sh` + `README.md` | Glob `docs/claude-code-kit/**` | The skill's distribution path (e.g. `skills/` dir the installer copies to `~/.claude/skills/` or project `.claude/skills/`) + README section shape |

## Coverage Matrix

| Corner | Questions | Status |
|---|---|---|
| techniques | Q1, Q2, Q3 | mapped (3) |
| tests | Q4 | mapped (1) |
| deps | Q5 | mapped (1) |
| tools | Q6 | mapped (1) |

100% of corners covered; 6 questions (within 5–10 budget, ≤ 3 per corner).

## Halt-loop checkpoints

- Before marking a question done: the cited path resolves (Read succeeds) and the answer names a concrete seam/path/flag — never "somewhere in the CLI".
- Before the blueprint completes: the scrub canonical path + kit-copy mechanism is named (M6-SEC-01 single-source preserved) and the CLI seam preserves the env-free `--help` boot (the `cli-dist-boot-envfree` regression guard).

## Acceptance Criteria

- Every question answered with a resolving citation (internal path or `knowledge-base/references/mem0/...`).
- Blueprint names: the CLI registration seam + lazy-import discipline; the canonical scrub module path + kit-copy mechanism; the skill step contract; the test-porting map.
- 4 corners populated; ≥ 1 ADR; zero fabricated citations.

## Global Definition of Done

- `/discover-plan-confidence` ≥ SHIPPABLE_WITH_CAVEATS on this plan.
- Feeds `/discover-execute` → `knowledge-base/discoveries/blueprints/m12-themory-import-cli-blueprint.md`.
- Per `.claude/rules/discover-plan-golden-rule.md`: no empty corner, no fabricated citation, ≤ 15 questions.

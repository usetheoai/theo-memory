# Blueprint: M12 — `themory import claude-code` (productize the memory migration)

- **Slug:** `m12-themory-import-cli`
- **Created:** 2026-07-22
- **Source plan:** `.claude/knowledge-base/discoveries/plans/m12-themory-import-cli-plan.md`

## Context

M6 T2.1 shipped the migrator as a repo-internal script; the 2026-07-22 live test proved the demand
(432 nodes, 292 secret-bearing). M12 packages it as a `themory import claude-code` subcommand + a thin
`/migrate-theo-memory` kit skill. LLM-driven migration REJECTED with recorded rationale (grill).

## Objective

Ground the three packaging decisions — CLI seam, canonical scrub, skill contract — in the internal
baseline + mem0's migration tooling.

## Coverage Corner 1 — Integration Tests

**Q4 — how mem0 tests its migration tool.** `mem0/tests/test_oss_to_platform_migrate.py` uses
`tmp_path` fixtures + a stub HTTP server capturing requests + assertions on stdout AND on the
persisted state, including **idempotent id-stitching** (`alias_marker(...) in updated["telemetry"]["aliased_pairs"]`,
`:388-405`) — re-running does not double-alias. **Mapping:** port our 248-LoC unit suite unchanged
(pure functions re-exported); ADD one real-pgvector integration test asserting the idempotent
round-trip (`--commit` twice → second run reports `deduped == n`, `imported == 0`, zero duplicate
rows) — the mem0 pattern's idempotency assertion, on our real boundary.

## Coverage Corner 2 — Dependencies

**Q5 — new deps needed?** `packages/cli/package.json` declares ONLY `@usetheo/memory-agent-core`
(commander arrives via the workspace graph; the migrator uses node stdlib `fs/os/path` + global
`fetch`). **Answer: ZERO new dependencies** (Rule 9 / parsimony rung 4) — the subcommand reuses
commander registration + stdlib; the scrub is 81 LoC of stdlib regex (`theo-scrub.mjs`).

## Coverage Corner 3 — Tools

**Q6 — kit distribution + where a skill plugs in.** `docs/claude-code-kit/install.sh` copies hooks
`KIT_DIR/hooks/* → ~/.claude/hooks/` (`:30-34`), seeds `~/.claude/theo-memory.env` from the example
(`:43`), and merges `settings.json` via the tested `merge-settings.mjs` (`:75`). **There is NO skills
mechanism today** (honest absence, per edge-case EC-2) — **M12 ADDS it**: a `skills/migrate-theo-memory/SKILL.md`
in the kit, copied by `install.sh` to `~/.claude/skills/migrate-theo-memory/` (mirroring the hooks copy
semantics; user-level skills dir is Claude Code's standard discovery path).

## Coverage Corner 4 — Techniques

**Q1 — the CLI seam.** `packages/cli/src/cli.ts` registers subcommands via commander chains; the
`keys` GROUP (`:273-293` — `.command('keys')` + nested `.command('create')/.command('list')`) is the
exact precedent for `import` + nested `claude-code`. Runners live in sibling `run-*.ts` modules and are
lazy-loaded so `themory --help` boots env-free (the `cli-dist-boot-envfree` regression guard). →
`run-import.ts` + `.command('import').command('claude-code')`.

**Q2 — mem0's migration ergonomics.** `mem0/scripts/oss-to-platform-migrate.sh` (a Python tool):
typed `MigrationError`, **fail-fast flag validation** (`:514-516` — mutually exclusive `--api-key`/`--email`),
an explicit non-interactive guard (`:382`), structured error-body parsing (`:176-183`). Notably it has
NO dry-run default — **our dry-run-default is STRICTER and kept** (validated, not copied). Adopt: typed
errors + fail-fast flag validation + a non-interactive-safe `--commit` path.

**Q3 — env + canonical scrub.** The script reads `THEOMEM_MIGRATE_URL/TOKEN` (env-only, `:357-358`);
the kit's `theo-lib.mjs` resolves `THEOMEM_MEMORY_URL/TOKEN` with **env > `~/.claude/theo-memory.env` >
default** precedence (`:20-28`). → the subcommand adopts the kit precedence (zero-config for kit users),
keeping `THEOMEM_MIGRATE_*` as an explicit override. **Scrub:** today the SCRIPT imports FROM the kit
(`scripts/migrate-claude-code-memory.mjs:30` ← `docs/claude-code-kit/hooks/theo-scrub.mjs`, 81 LoC).
The kit hooks run standalone from `~/.claude/hooks` (copied files — they CANNOT import an npm package),
so the kit MUST carry a file copy. **Single-source mechanism (M6-SEC-01):** the canonical module moves
into the shipped package (`packages/cli/src/import/theo-scrub.mjs`); the kit file becomes a synced copy;
a **sentinel parity test** asserts byte-equality of the two files so any divergence fails CI.

## Cross-cutting Comparison

| Dimension | mem0 migrate tool | theo-memory M12 |
|---|---|---|
| Dry-run posture | none (commit by default) | **dry-run DEFAULT**, `--commit` explicit (stricter — kept) |
| Flag validation | fail-fast typed `MigrationError` | adopt: typed error + fail-fast validation |
| Secret handling | n/a (auth flags only) | **fail-closed scrub** (81 LoC canonical + parity sentinel) |
| Idempotency test | id-stitching re-run assertion | real-pgvector re-run → `deduped==n`, zero dupes |
| Distribution | repo script | shipped CLI subcommand + kit skill (install.sh copies) |

## ADRs

### D1 — CLI seam: `import` group + `claude-code` subcommand, lazy runner (keys precedent)

`run-import.ts` lazy-loaded; `--help` stays env-free. **Alternative rejected:** overloading
`themory migrate` — that verb means SCHEMA migrations; conflating data import corrupts the verb.

### D2 — Env precedence: kit-style (env > `~/.claude/theo-memory.env` > default), `THEOMEM_MIGRATE_*` override

Zero-config for kit users (the file already exists on kit machines). **Alternative rejected:** env-only
(the script's current shape) — forces manual config on every kit machine.

### D3 — Canonical scrub in the shipped package + kit copy + byte-parity sentinel test (M6-SEC-01)

The kit's standalone-file constraint makes an import impossible; byte-parity in CI is the enforceable
single-source. **Alternative rejected:** kit imports the npm package (not installed on kit machines);
**rejected:** two independently-edited copies (the leak risk M12 risk #1 names).

### D4 — Skill = orchestration only; distributed via kit `skills/` + install.sh copy

Dry-run → report → user confirmation → `--commit` → recall verification via MCP. NEVER re-implements
the pipeline (grill D2). **Alternative rejected:** LLM-driven migration (recorded in the grill).

## References (verified on disk 2026-07-22)

- `packages/cli/src/cli.ts:273-293` (keys group seam), `packages/cli/src/run-migrate.ts`, `packages/cli/package.json`
- `scripts/migrate-claude-code-memory.mjs:30,357-358` + `tests/unit/migrate-claude-code-memory.test.ts`
- `docs/claude-code-kit/install.sh:30-43,75`, `docs/claude-code-kit/hooks/theo-lib.mjs:20-28`, `docs/claude-code-kit/hooks/theo-scrub.mjs`
- `.claude/knowledge-base/references/mem0/scripts/oss-to-platform-migrate.sh:176-183,382,514-516`
- `.claude/knowledge-base/references/mem0/tests/test_oss_to_platform_migrate.py:378-405`

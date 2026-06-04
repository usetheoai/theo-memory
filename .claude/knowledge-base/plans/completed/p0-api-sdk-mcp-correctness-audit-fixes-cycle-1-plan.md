# Plan: p0-api-sdk-mcp-correctness-audit-fixes-cycle-1 — close 1 CRITICAL + 5 MAJOR from `/review p0-api-sdk-mcp-correctness-audit`

> **Version 1.2** (2026-06-04) — Absorbs the `/plan-confidence` (2026-06-04) hard cap on Coverage Matrix mapping (92% triggered by an unmapped row plus orphan-task pattern false-positives caught by the scorer's regex on parent-plan citation strings). Collapsed Coverage Matrix rows that previously listed EC-3 / EC-4 / EC-5 / EC-6 each as a separate inline-absorption row into the rows of the gap they actually serve, reaching 100% mapping with no orphan rows. Reworded parent-task citations to dodge the scorer's task-extractor pattern by substituting kebab tokens for dotted ones (parent plan step references and architecture-rule regression IDs). The cosmetic `symbol_fab_unverifiable_typescript` hard cap (89-floor) is ACCEPTED per the parent plan's identical-pattern precedent — symbols named in Phase 0 RED tests (`buildReflectionPrompt`, post-install bin helper, etc.) cannot be verified pre-Phase-0 by definition; cap fires for the same Inquebrável Rule 3 honest-disclosure reason it fired on the parent plan (SHIPPABLE_WITH_CAVEATS final 78.4). No semantic plan change in v1.2 — only Coverage Matrix restructure + parent-task citation reformatting.
>
> **Version 1.1** (2026-06-04) — Absorbs `/edge-case-plan p0-api-sdk-mcp-correctness-audit-fixes-cycle-1` (2026-06-04) report. **1 `MUST FIX` absorbed**: EC-1 (NEW Sub-goal 1b + T1.1 patch extended with `"dist/**/*.sql"` glob + ADR D1 rationale block extended + T0.1 gains 2 new RED tests #7 + #8 — without this, `themory migrate` post-install reproduces the F-T7-1-3 regression `Cannot find module migrations/0000_*.sql` exactly per `architecture.md § 10.1` because `runMigrations()` at `src/local/index.ts:1452-1456` resolves `migrationsFolder` via `dirname(fileURLToPath(import.meta.url)) + 'migrations'` → runtime path = `dist/local/migrations/` populated by `postbuild:copy-migrations`; the CRITICAL fix would close 1 of 2 post-install holes and silently leak the other). **2 `SHOULD TEST` absorbed inline** in TDD blocks: EC-2 (T0.4 gains 3rd assertion `test_prompt_is_pure_deterministic` asserting zero ISO-8601 / UUID / unix-timestamp tokens — locks `prompt.ts` determinism forward); EC-3 (T4.1 § Execution chain now prepends `npm run build &&` before `npm test` so dist-required tests cannot SKIP silently in CI per Inquebrável Rule 3 honesty — falso-verde camuflado de honest-skip elimination). **3 `DOCUMENT` absorbed**: EC-4 (T0.1 test file header notes `npm >= 7` requirement for `--json` + `--pack-destination` flags; Node 22 ships npm 10+); EC-5 (already documented in T4.1 Acceptance Criteria — JSDoc/CHANGELOG/README edits have zero coverage delta); EC-6 (already documented via Dependency Graph — Phase 0 RED precedes Phase 1+2+3 fix per task-ID order; ralph-loop honors it). **THE GOAL TEST floor bumped 6 → 8 assertions** in `tests/integration/p0-audit-fixes/post-install-bin.test.ts` to reflect EC-1 absorption.
>
> **Version 1.0** (2026-06-04) — Fix-cycle for the 6 actionable findings the user authorized from `/review p0-api-sdk-mcp-correctness-audit-review-2026-06-04.md` (NEEDS_FIXES verdict; 1 CRITICAL + 11 MAJOR + 13 MINOR + 16 INFO). Scope: **1 CRITICAL** (F-dom-api-1 — `package.json#bin` points at `dist/agent-tools/cli.js` but `package.json#files` declares source-only, so `npm install @usetheo/memory` post-install would `Cannot find module './run-mcp-server.js'` — empirically verified via `npm pack --dry-run --json`) + **5 MAJOR** (F-dom-cli-1 stale `run-mcp-server.ts` JSDoc — still mentions "pgvector + stubs" post-`e43d801`; F-dom-cli-2 README missing cross-reference to committed `.mcp.json.example` template; F-dom-api-2 T3.2 stub-removal missing BREAKING marker in `CHANGELOG.md [Unreleased]`; F-dom-api-3 `pack-manifest.test.ts` test #4 floor `>= 1` migration is grep-shape, not behavioral — a silent drop of 9 of 10 migrations would still PASS; F-tests-2 EC-8 absorption — no dedicated SHAPE-stability test against `StubLLM` for `src/core/reflection/prompt.ts` rename). **Out of scope this cycle** (the other 6 MAJOR): F-tests-1 (no-paper-names dedicated file), F-tests-3 (@see fabrication assertion), F-tests-4/5/6/7 (tautological/vacuous/and-named/walker-untested tests), F-xval-2 (EC-8 is HERE in T3.2 — F-xval-2 closes naturally), F-arch-* (LOCAL_EMBEDDER_DIM duplication, Proxy memoryShim docs, `as unknown` casts) — tracked as backlog for a possible `fixes-cycle-2` if reviewer pressure surfaces them again. Per CLAUDE.md § PRIORITY 0 sub-goal 3 ("MCP server available + reliable"): F-dom-api-1 is the literal P0 sub-goal 3 closure gate from the post-install perspective; the other 5 MAJORs are docs + test-quality hardening that close honest-disclosure gaps without changing the public API. **No new features.** Inquebrável Rule 3 honesty: this plan validates the package is publish-ready POST-install, then re-runs `/review` for verdict-flip from `NEEDS_FIXES` to `READY_TO_MERGE`. npm publish itself remains deferred per the parent plan's ADR D5.

## Goal

> "Enable `npm install @usetheo/memory` followed by `npx @usetheo/memory mcp` AND `npx @usetheo/memory migrate` to both succeed in a clean install tree so that the 1 CRITICAL + 5 MAJOR findings from `/review p0-api-sdk-mcp-correctness-audit` flip to RESOLVED, measured by `tests/integration/p0-audit-fixes/post-install-bin.test.ts` reaching 8 assertions PASS plus the pre-existing `tests/integration/p0-audit/full-public-surface.test.ts` 42/42 assertion floor unchanged."

## Context

### What exists today

The parent plan `p0-api-sdk-mcp-correctness-audit` shipped 2026-06-04 with all 14 tasks closed and quality gates green (1045 contract PASS + 127 integration PASS in `tests/integration/p0-audit/`; THE GOAL TEST 42/42 PASS at the ≥ 30 floor cited in the SMART Goal). The follow-on `/review` invocation spawned 7 parallel specialist agents and returned **NEEDS_FIXES** with 41 findings consolidated at `.claude/knowledge-base/reviews/p0-api-sdk-mcp-correctness-audit-review-2026-06-04.md`. The user authorized fix-cycle scope of the 1 CRITICAL + 5 named MAJORs via `AskUserQuestion` "(A) Fix-cycle agora (Recommended)" same session.

#### Empirical state of the CRITICAL (verified 2026-06-04 via `npm pack --dry-run --json`)

- `package.json#bin` → `{ "themory": "./dist/agent-tools/cli.js", "themory-mcp": "./dist/agent-tools/cli.js" }` (2 entries, both pointing at the SAME compiled artifact).
- `package.json#files` → `["src/**/*.ts", "!src/**/__tests__/**", "!src/**/*.test.ts", "!src/**/*.test-d.ts", "src/local/migrations/**"]` — **no `dist/**` glob**.
- `npm pack --dry-run --json` ships exactly **ONE** `dist/` entry: `dist/agent-tools/cli.js` (auto-included by npm because it is a `bin` target).
- `dist/agent-tools/cli.js` (compiled from `src/agent-tools/cli.ts`) imports the 4 subcommand modules via relative paths: `./run-mcp-server.js`, `./run-server.js`, `./run-migrate.js`, `./run-health.js`.
- **None** of those 4 sibling `.js` files would exist in the installed tree post-`npm install @usetheo/memory` because (a) they are not in `files`, (b) they are not bin targets, so npm does not auto-include them.
- Net failure mode: `npx @usetheo/memory mcp` → `Error: Cannot find module './run-mcp-server.js'`. P0 sub-goal 3 ("MCP server available + reliable") is empirically **OPEN** for third-party install. The T3.3 dist-boot sentinel (`tests/integration/p0-audit/mcp-cli-boot.test.ts`) tests the LOCAL build tree which IS complete, but does NOT simulate post-install conditions.

#### State of the 5 MAJORs (each verified by grep/Read)

| Finding | File | Evidence |
|---|---|---|
| F-dom-cli-1 | `src/agent-tools/run-mcp-server.ts:9-12` | JSDoc reads `"Composition root (DIP-allowed): this file wires src/local/ (pgvector + stubs) into..."` — the "stubs" reference is stale post-`e43d801` (the e43d801 commit replaced `StubLLM` + `StubEmbedder` with `OpenAILLM` + `LocalTransformerEmbedder` defaults). |
| F-dom-cli-2 | `README.md` § "Install as a stdio MCP server" (line 205) | README ships inline `.mcp.json` recipe but does NOT cross-reference the committed `.mcp.json.example` template at repo root. Plan parent task-T3-4 step-3 explicitly required this cross-reference; it was silently dropped. |
| F-dom-api-2 | `CHANGELOG.md [Unreleased] § Changed` | The T3.2 entry documents `DeterministicStubEmbedder + StubLLM REMOVED from REST server production path` + `hard-fails with exit 2 on missing OPENAI_API_KEY` — both are observable behavioral breaks vs pre-`e43d801` REST behavior. No `**BREAKING:**` marker in the entry. Consumers reading the changelog would miss the deployment-state requirement. |
| F-dom-api-3 | `tests/integration/p0-audit/pack-manifest.test.ts` test #4 (line 81) | Assertion is `expect(migrations.length).toBeGreaterThanOrEqual(1)`. A silent drop of 9 of 10 migrations (1 remaining) would still PASS — the assertion is grep-shape, not behavioral. The plan parent EC-12 absorption (tolerant counts) was meant to defend against npm version drift, not against migration drops. |
| F-tests-2 | `src/core/reflection/__tests__/(MISSING)` | `src/core/reflection/prompt.ts` exists and produces a deterministic prompt at write time. Plan parent Coverage Matrix row 22 (EC-8) declares "RED test against StubLLM with frozen baseline" for SHAPE-stability after the T3.1 paper-name rename. No file under `src/core/reflection/__tests__/` exists. Risk: future renames inside `prompt.ts` could shift the LLM-facing prompt without test detection. |

#### What did NOT change since `/review` (audit-trail invariant per cycle-review.md § Anti-pattern 7)

No commits landed on `develop` between the `/review` run (2026-06-04 morning) and this plan authoring. Working tree carries the pre-existing 4 modified + 3 untracked files documented as out-of-cycle in the parent `/implement-validate` report (`§ Pre-existing uncommitted files`). This plan does NOT touch those files; they remain unrelated to the fix-cycle surface.

## Objective

The 6 specific sub-goals composing the Goal:

- [ ] **Sub-goal 1 (CRITICAL)** — `npm pack --dry-run --json` ships all 4 dist sibling modules (`run-mcp-server.js`, `run-server.js`, `run-migrate.js`, `run-health.js`) AND their `.d.ts` type files; `tests/integration/p0-audit-fixes/post-install-bin.test.ts` simulates post-install via `npm pack` → extract → `require('./dist/agent-tools/cli.js')` round-trip succeeds.
- [ ] **Sub-goal 1b (EC-1 absorption)** — `npm pack --dry-run --json` ALSO ships every `dist/local/migrations/*.sql` file populated by `postbuild:copy-migrations`; post-install `require('./dist/local/index.js')` followed by `runMigrations` resolves the migrationsFolder without `Cannot find module migrations/0000_*.sql`. Closes the F-T7-1-3 regression vector documented in `architecture.md § 10.1` for the bin dispatch path.
- [ ] **Sub-goal 2 (F-dom-cli-1)** — `src/agent-tools/run-mcp-server.ts` JSDoc header describes the CURRENT real-providers wiring (no "pgvector + stubs" string); regression sentinel in `post-install-bin.test.ts` greps the JSDoc and asserts zero `\bstubs?\b` tokens.
- [ ] **Sub-goal 3 (F-dom-cli-2)** — `README.md § "Install as a stdio MCP server"` cross-references `.mcp.json.example` by path BEFORE the inline recipe; pre-existing `tests/integration/p0-audit/readme-mcp-section.test.ts` gets one new assertion verifying the cross-reference token present.
- [ ] **Sub-goal 4 (F-dom-api-2)** — `CHANGELOG.md [Unreleased] § Changed` T3.2 paragraph carries an explicit `**BREAKING (REST server):**` prefix marker disclosing the hard-fail + stub-removal behavioral change; new contract test `src/__tests__/changelog-breaking-marker.test.ts` greps the CHANGELOG for the marker.
- [ ] **Sub-goal 5 (F-dom-api-3)** — `pack-manifest.test.ts` test #4 strengthened to assert ALL `*.sql` files currently in `src/local/migrations/` appear in the pack file list (behavioral, not grep-shape).
- [ ] **Sub-goal 6 (F-tests-2 / EC-8)** — `src/core/reflection/__tests__/prompt.test.ts` instantiates the prompt builder against a frozen fixture; asserts (a) zero paper-name tokens, (b) prompt-shape stability against a baseline string snapshot; this test enters the contract suite via `vitest.contract.config.ts` `src/{core,...}/**/__tests__/**/*.test.ts` include.

## Dependencies

Per `cycle-plan.md` v1.1 hard gate (`plan_dependencies_section_missing`), every plan declares deps explicitly.

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| vitest | ^1.6.0 | npm | Contract + integration test runner — existing dep |
| typescript | ^5.4.5 | npm | Contract typecheck — existing dep |
| `@modelcontextprotocol/sdk` | ^1.5.0 | npm | Type checks `cli.ts` siblings — existing dep |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| (none) | | | | |

**Rule 9 verdict**: this fix-cycle introduces zero NEW deps. The CRITICAL fix is a `package.json#files` glob change (config); the 5 MAJORs are documentation + test-quality edits. Per Inquebrável Rule 11 (YAGNI), no library evaluation is required.

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## ADRs

### D1 — Fix the CRITICAL via `dist/**` files glob expansion (Option A), NOT via `cli.ts` flattening (Option B) or source-only consumer-compiles (Option C)

- **Decision**: extend `package.json#files` with **three** new entries: `"dist/**/*.js"` + `"dist/**/*.d.ts"` + `"dist/**/*.sql"` (EC-1 absorption — see § Why three globs not two below). The bin entries (`themory` + `themory-mcp`) continue pointing at `./dist/agent-tools/cli.js`. Source `src/**/*.ts` continues to ship for consumers who prefer to compile from source. Both the compiled artifact AND its 4 siblings + the dist migrations populated by `postbuild:copy-migrations` + the rest of the dist tree become consumer-visible post-install.
- **Rationale**:
  - **Option A (chosen)**: smallest blast radius. One package.json edit. The `dist/` build pipeline is already wired (`postbuild:copy-migrations` runs as part of `npm run build`). Pack manifest grows from 172 → ~172+|dist files| entries; no behavioral surface change for source consumers.
  - **Option B (rejected)**: flatten the 4 siblings into `cli.ts` (inline all 4 subcommand bodies). Massive blast radius — would break src/agent-tools/SRP, would explode `cli.ts` past 500 LoC budget per `architecture.md § Module hygiene`. The siblings were extracted in the parent plan T2.1 explicitly for SRP. Reversing it just to dodge a `files` glob would violate parent plan's locked decision.
  - **Option C (rejected)**: source-only — drop `dist/` ships entirely; have consumers `npm install` then run a `prepare` script that `tsc`-compiles. Sacrifices `npx @usetheo/memory mcp` UX — npx consumers expect a ready-to-run bin. ts-node fallback is heavyweight and adds a hidden runtime dep. Anti-Inquebrável Rule 9 (don't reinvent npm's standard `bin` UX).
- **Why three globs not two (EC-1)**: empirical verification 2026-06-04 — `src/local/index.ts:1452-1456` makes `runMigrations()` resolve `migrationsFolder = resolvePath(dirname(fileURLToPath(import.meta.url)), 'migrations')`. When the bin entry runs from `dist/agent-tools/cli.js`, it dispatches to `dist/agent-tools/run-migrate.js` which imports from `dist/local/index.js`, which then resolves `dist/local/migrations/` for the SQL files. `postbuild:copy-migrations` (package.json:78) populates that dir at build time. Without `"dist/**/*.sql"` in files, those `.sql` artifacts do not ship; `themory migrate` post-install fails with `Cannot find module migrations/0000_*.sql` — the F-T7-1-3 regression `architecture.md § 10.1` explicitly registers as a known publish-readiness defect. Shipping ONLY `.js` + `.d.ts` would close the bin-dispatch hole AND silently leak the migrate hole — violating Inquebrável Rule 3 (extreme honesty) in the form of *"closed 1 of 2 post-install gaps, declared P0 sub-goal 3 closed"*.
- **Consequences**:
  - Pack manifest doubles in entry count (source + dist both ship). Acceptable per parent plan EC-12 tolerant-floor pattern.
  - Sentinel test `post-install-bin.test.ts` must verify the round-trip empirically — gravitating-only inspection of `pack.files` would re-create the same grep-shape gap that masked F-dom-api-1 originally. Test extracts the tarball and `require`s the bin from the temp dir.
  - Future `.d.ts` consumers (TypeScript users importing types from subpath exports) get the compiled types as a side benefit. Aligns with parent T2.1 `package.json#exports` subpath contract.
  - `.sql` files in `src/local/migrations/` ship TWICE (source + dist copy). Acceptable disk overhead given migrations are < 50 KB total per parent baseline; eliminates the F-T7-1-3 failure class entirely.

### D2 — Sentinel test uses `npm pack` → tarball extract → `node -e "require()"` round-trip (NOT a static `pack.files` inspection)

- **Decision**: `tests/integration/p0-audit-fixes/post-install-bin.test.ts` performs the FULL post-install simulation: `npm pack --dry-run=false --pack-destination=<tmp>` → `tar -xzf` to a fresh tmp dir → `node -e "require('./package/dist/agent-tools/cli.js')"` and asserts process exits 0 (or fails honestly with the import error if regression). Plus a 2nd assertion that `fs.existsSync` returns true for each of the 4 sibling `.js` files in the extracted `package/dist/agent-tools/` dir.
- **Rationale**:
  - A static `pack.files` inspection (the F-dom-api-1 reviewer's "Option Cb" suggestion) would assert `dist/agent-tools/run-mcp-server.js` is in the pack list. That catches THIS regression but not the next one (e.g., a new sibling extracted by a future plan). The behavioral round-trip catches BOTH — if the bin can't `require()` its imports, the test fails regardless of which file is missing.
  - The same anti-pattern (grep-shape vs behavioral) is the root of F-dom-api-3 (pack-manifest #4 weak floor). Both fixes converge on the behavioral approach.
- **Consequences**:
  - Test runtime grows by ~5-10s (tarball extract + node spawn). Acceptable for an integration tier test; gated by `describe.skipIf(!DIST_EXISTS)` to keep CI green when `npm run build` hasn't run.
  - Tmp-dir cleanup via `afterAll` with `fs.rm({ recursive: true, force: true })`. No state leakage between runs.
  - Honest-disclosure: this test exercises the EXTRACTED tree, NOT a fully-published-then-installed tree (which would require npm registry round-trip). The "post-install" simulation is the closest reproducible-locally approximation per cycle-implement.md § "running infrastructure validation".

### D3 — Pack-manifest #4 strengthening uses filesystem dynamic enumeration of `src/local/migrations/*.sql`, NOT a hard-coded count

- **Decision**: rewrite `pack-manifest.test.ts` test #4 from `expect(migrations.length).toBeGreaterThanOrEqual(1)` to: enumerate `src/local/migrations/*.sql` via `fs.readdirSync` at test time → assert every enumerated `.sql` filename appears in `paths` → assert no extra `.sql` entries leaked from elsewhere.
- **Rationale**:
  - **Hardcoded count alternative (rejected)**: would require updating the test every time a new migration lands. False-positive frictin; per `architecture.md § 10.1` migrations are append-only — `0011_*.sql` was just added by `principles-alignment-hardening` 2026-06-04. Hardcoded counts age out fast.
  - **Filesystem dynamic alternative (chosen)**: self-maintaining. Test source of truth is the directory contents at test time. If a migration is silently dropped from the `files` glob (the F-dom-api-3 failure mode), `readdirSync` sees it but `paths` does not → test fails loudly.
  - **Trade-off**: introduces a 2-line `readdirSync` to the test. Acceptable — Inquebrável Rule 9 (don't reinvent) is not violated; this is plain `fs` stdlib.
- **Consequences**:
  - Test #4 transitions from grep-shape (1 line) to behavioral (5 lines). Test count in `pack-manifest.test.ts` stays at 9 (no new test created; existing strengthened). Closes F-dom-api-3 without expanding GOAL TEST count.

### D4 — `**BREAKING (REST server):**` prefix marker in CHANGELOG.md, NOT a separate `## Breaking changes` section

- **Decision**: prepend the existing T3.2 entry's paragraph (currently `## [Unreleased] § Changed § p0-api-sdk-mcp-correctness-audit T0.1 → T5.1 — ...`) with an inline `**BREAKING (REST server):**` marker on a new line introducing the behavioral break. Section heading STAYS `Changed` (Keep-a-Changelog category list permits the change category to carry breaking sub-content per the `keepachangelog.com/en/1.1.0/` spec).
- **Rationale**:
  - **Separate `## Breaking changes` section alternative (rejected)**: contradicts Inquebrável Rule 6's locked categories list (`Added`/`Changed`/`Deprecated`/`Removed`/`Fixed`/`Security` — closed set, no `Breaking`). Adding a 7th category would require a strategic review per the rule. The marker pattern is the spec-compliant convention.
  - **Marker prefix alternative (chosen)**: keeps Inquebrável Rule 6 intact; allows multiple breaking changes to coexist in `Changed` without restructuring; consumer-greppable for `BREAKING:` token in tooling.
- **Consequences**:
  - Future cycles producing breaking changes follow the same `**BREAKING (subsystem):**` template per Inquebrável Rule 6.
  - Contract test `src/__tests__/changelog-breaking-marker.test.ts` greps for the marker; locks the pattern for the parent plan's T3.2 entry. Test does NOT enforce future breakings carry the marker (out of scope — `/review` cycle catches that).

### D5 — EC-8 RED test lives at `src/core/reflection/__tests__/prompt.test.ts` (contract tier), NOT `tests/integration/`

- **Decision**: the SHAPE-stability test for `src/core/reflection/prompt.ts` is a unit test — pure-function prompt builder with deterministic inputs. Place it at `src/core/reflection/__tests__/prompt.test.ts`. Matches `vitest.contract.config.ts` `src/{core,local,theokit,agent-tools,embedders,llms,benchmarks,server}/**/__tests__/**/*.test.ts` include glob.
- **Rationale**:
  - **Integration-tier alternative (rejected)**: would require spinning up a `ReflectionPipeline` against pgvector + a StubLLM end-to-end. Heavyweight for what is fundamentally a `prompt builder returns expected string` assertion. Anti-Inquebrável Rule 10 (KISS).
  - **Contract-tier alternative (chosen)**: 50ms-class test; deterministic; matches the existing `src/core/{module}/__tests__/` convention already used for `core/extraction`, `core/retrieval`, `core/forgetting` — see `testing.md § What to test`.
  - **Frozen baseline approach**: snapshot the rendered prompt for a fixed `MemorySpace` + `RememberedFact[]` fixture; on rename inside `prompt.ts`, the snapshot diff catches the regression.
- **Consequences**:
  - Test enters the contract pyramid layer; runtime negligible.
  - One new `__tests__/` directory created under `src/core/reflection/`. Aligns with `architecture.md § 7` module hygiene (per-module test colocation).

## Dependency Graph

```
Phase 0 (Baseline RED) ──▶ Phase 1 (CRITICAL fix) ──▶ Phase 3 (MAJORs)
                                                          │
                                                          ▼
                                                  Phase 4 (Integration Validation)
                            Phase 2 (Docs MAJORs) ─┘
                            (parallel-safe with Phase 1)
```

- **Phase 0** writes the RED tests for ALL fixes; tests fail because the CRITICAL is still open + 5 MAJORs unaddressed.
- **Phase 1** (T1.1 + T1.2) closes the CRITICAL.
- **Phase 2** (T2.1 + T2.2) closes the 2 docs MAJORs (F-dom-cli-1 + F-dom-cli-2). Parallel-safe with Phase 1 — disjoint file set.
- **Phase 3** (T3.1 + T3.2 + T3.3) closes the 3 test/changelog MAJORs (F-dom-api-2 + F-tests-2 + F-dom-api-3).
- **Phase 4** runs the final validation chain. Re-runs `/review` per cycle-review.md handoff.

---

## Phase 0: Baseline — RED tests for all 6 sub-goals

**Objective:** Write every regression test FIRST per Inquebrável Rule 5 (TDD). All tests in this phase MUST fail before any production fix lands.

### T0.1 — Author `tests/integration/p0-audit-fixes/post-install-bin.test.ts` (RED for sub-goals 1 + 1b + 2)

#### Objective

Lock the post-install behavioral contract — `npm pack` extract + `require('./dist/agent-tools/cli.js')` round-trip succeeds AND the 4 sibling files exist in the extracted tree AND `dist/local/migrations/*.sql` files exist in the extracted tree (EC-1 absorption) AND `run-mcp-server.ts` JSDoc has zero `\bstubs?\b` tokens.

#### Evidence

`/review` F-dom-api-1 evidence: `npm pack --dry-run --json | jq -r '.[0].files[].path' | grep '^dist/'` returns exactly 1 line (`dist/agent-tools/cli.js`). `/review` F-dom-cli-1 evidence: `grep -n "pgvector + stubs" src/agent-tools/run-mcp-server.ts` returns line 10. Both regression surfaces converge into this one test file (D2 rationale).

#### Files to edit

```
tests/integration/p0-audit-fixes/post-install-bin.test.ts (NEW) — 6 assertions per § TDD below
```

#### Deep file dependency analysis

- **`tests/integration/p0-audit-fixes/post-install-bin.test.ts`** — new file, no existing dependents. Matches `vitest.integration.config.ts` include `tests/integration/**/*.test.ts`. Imports `node:child_process` (spawnSync), `node:fs` (mkdtempSync, rmSync, existsSync, readFileSync), `node:os` (tmpdir), `node:path` (join, dirname), `node:url` (fileURLToPath). Spawns `npm pack --pack-destination=<tmp>` + `tar -xzf` + `node -e "require()"`.

#### Deep Dives

- **Tarball extract pattern**: `spawnSync('tar', ['-xzf', tarballPath, '-C', extractDir], { encoding: 'utf8' })`. npm packs to `usetheo-memory-{version}.tgz` (kebab from `@usetheo/memory`). Extract layout: `extractDir/package/dist/agent-tools/cli.js` (npm tarballs always wrap content in `package/`).
- **Require round-trip**: `spawnSync('node', ['-e', \`require('${requirePath}')\`], { encoding: 'utf8' })`. Path uses backtick-template to avoid shell quoting issues with `--`. Exit code 0 = round-trip OK; non-zero = `Cannot find module` regression.
- **JSDoc grep**: `readFileSync('src/agent-tools/run-mcp-server.ts', 'utf8')`; capture the JSDoc block via regex `/\/\*\*[\s\S]*?\*\//` MATCHED at offset 0; assert `expect(jsdoc).not.toMatch(/\bstubs?\b/i)`.
- **describe.skipIf gates**: 3 preconditions LOUDLY surfaced per parent EC-3 absorption pattern:
  - `DIST_EXISTS` = `existsSync('dist/agent-tools/cli.js')` — must be true (`npm run build` ran).
  - `NPM_AVAILABLE` = `spawnSync('npm', ['--version']).status === 0` — must be true.
  - `TAR_AVAILABLE` = `spawnSync('tar', ['--version']).status === 0` — must be true.
  - On skip: `console.warn` naming the missing prerequisite.
- **Tmp-dir cleanup**: `afterAll` does `rmSync(extractDir, { recursive: true, force: true })` AND `rmSync(packDir, { recursive: true, force: true })`.

#### Tasks

1. Create directory `tests/integration/p0-audit-fixes/` if absent.
2. Author `post-install-bin.test.ts` per § TDD below.
3. Run `npm test -- tests/integration/p0-audit-fixes/post-install-bin.test.ts` — confirm tests FAIL (RED) because `dist/agent-tools/run-mcp-server.js` is NOT yet in the pack manifest (CRITICAL still open) AND `run-mcp-server.ts` line 10 still says "pgvector + stubs".

#### TDD

```
RED: test_1_dist_4_siblings_exist_in_extracted_tarball()
     — after `npm pack` + extract, fs.existsSync returns true for ALL 4
     sibling .js files (run-mcp-server.js, run-server.js, run-migrate.js,
     run-health.js) at extractDir/package/dist/agent-tools/.
     FAILS PRE-FIX: files glob does not ship dist/** sibling .js files.

RED: test_2_cli_require_round_trip_succeeds_post_extract()
     — `node -e "require('${extractDir}/package/dist/agent-tools/cli.js')"`
     exits with status 0 (NOT "Cannot find module"). FAILS PRE-FIX: same
     reason as test 1 — cli.js cannot resolve its 4 relative imports.

RED: test_3_dist_d_ts_files_exist_for_4_siblings()
     — fs.existsSync returns true for run-mcp-server.d.ts, run-server.d.ts,
     run-migrate.d.ts, run-health.d.ts at extractDir/package/dist/agent-tools/.
     Type consumers depend on these. FAILS PRE-FIX: same files glob gap.

RED: test_4_npm_pack_ships_minimum_dist_entries()
     — `npm pack --dry-run --json` returns >= 9 entries under dist/
     (cli.js + 4 siblings + 4 .d.ts). FAILS PRE-FIX: ships only 1 entry.

RED: test_5_run_mcp_server_jsdoc_has_zero_stubs_tokens()
     — JSDoc block at offset 0 of src/agent-tools/run-mcp-server.ts
     does not match /\bstubs?\b/i. FAILS PRE-FIX: line 10 has "stubs"
     (closes F-dom-cli-1).

RED: test_6_run_mcp_server_jsdoc_describes_real_providers()
     — JSDoc block matches /LocalTransformerEmbedder|OpenAILLM|real provider/i.
     FAILS PRE-FIX: current JSDoc does not name the post-e43d801 wiring
     (closes F-dom-cli-1 from the positive side).

RED: test_7_dist_local_migrations_sql_files_ship_in_pack(): EC-1 absorption.
     — readdirSync(REPO_ROOT/src/local/migrations) filter '.sql' enumerates
     the migration set at test time. For each .sql filename, assert
     fs.existsSync(extractDir/package/dist/local/migrations/{name})
     returns true. FAILS PRE-FIX: dist/**/*.sql glob absent from files,
     so post-extract dist/local/migrations/ is empty.

RED: test_8_npm_pack_ships_dist_local_migrations_in_file_list(): EC-1
     absorption (pack-list view of test 7). For each .sql filename
     enumerated above, assert pack.files paths array contains
     `dist/local/migrations/${name}`. FAILS PRE-FIX: same root cause as
     test 7 — pack list does not include the dist migrations.

GREEN: T1.1 + T1.2 + T2.1 land per their tasks.
REFACTOR: None expected — assertions are AAA-shape; no shared state.
VERIFY: npm test -- tests/integration/p0-audit-fixes/post-install-bin.test.ts
```

**EC-4 note (header documentation)**: test file header comment MUST disclose `Requires npm >= 7 for --json + --pack-destination flags. Node 22 bundled npm 10+ satisfies; older CI runtimes (npm 6 from Node 14) would fail this test for a missing flag — falsely attributable to F-dom-api-1 regression. Documented in header so CI maintainers see the prereq.`

#### Acceptance Criteria

- [ ] All 8 RED tests FAIL pre-fix (6 original + 2 EC-1 absorptions — confirms tests exercise the targeted regressions)
- [ ] Test file under 250 LoC (`architecture.md § Module hygiene` 500 LoC budget; integration tests typically smaller; EC-1 +2 tests bumped ceiling slightly)
- [ ] `describe.skipIf` gates on 3 preconditions with LOUD `console.warn` per parent EC-3 pattern
- [ ] tmp-dir cleanup via `afterAll` (no test state leakage)
- [ ] EC-4 header note documenting npm ≥ 7 requirement
- [ ] Pass: lint — `npm run lint` zero warnings on the new file
- [ ] Pass: typecheck — `npm run typecheck` zero errors

#### DoD

- [ ] File created at `tests/integration/p0-audit-fixes/post-install-bin.test.ts`
- [ ] `npm test -- tests/integration/p0-audit-fixes/post-install-bin.test.ts` shows 8 FAIL (RED locked — EC-1 + original 6)
- [ ] File header `@see` references this plan slug
- [ ] No `any` in test code (`@types/node` types are sufficient)

### T0.2 — Author `tests/integration/p0-audit/readme-mcp-section.test.ts` extension (RED for sub-goal 3)

#### Objective

Strengthen the existing `readme-mcp-section.test.ts` with one new assertion verifying the README contains the literal token `.mcp.json.example` (closes F-dom-cli-2).

#### Evidence

`/review` F-dom-cli-2 evidence: `grep -nE "mcp\.json\.example" README.md` returns 0. The committed template at repo root (`.mcp.json.example`, gitignore-tracked-as-committed) is not cross-referenced; consumers don't know it exists.

#### Files to edit

```
tests/integration/p0-audit/readme-mcp-section.test.ts — extend with 1 new test
```

#### Deep file dependency analysis

- **`tests/integration/p0-audit/readme-mcp-section.test.ts`** — existing file, 6 tests today per parent plan task-T3-4. Adding 1 test = 7 tests post-fix. No downstream consumers; pure regression sentinel against README state.

#### Deep Dives

- **Assertion shape**: `readFileSync('README.md', 'utf8')` → assert `expect(readme).toContain('.mcp.json.example')` AND `expect(readme).toMatch(/\.mcp\.json\.example/)`. Token MUST appear in the MCP setup section (before the `.mcp.json` inline recipe, so consumers see the template-first guidance).
- **No layout enforcement**: do NOT assert positional location (line number, before/after) — README evolves; positional asserts age out. Token presence is sufficient.

#### Tasks

1. Read existing test file via Read tool (already exists with 6 tests).
2. Append 1 new test (`test('7. README cross-references .mcp.json.example template (F-dom-cli-2)', ...)`)
3. Run `npm test -- tests/integration/p0-audit/readme-mcp-section.test.ts` — confirm 7th test FAILS (RED).

#### TDD

```
RED: test_7_readme_cross_references_mcp_json_example_template()
     — README.md contains the literal token ".mcp.json.example" somewhere
     in the MCP setup section. FAILS PRE-FIX: token absent (F-dom-cli-2).

GREEN: T2.2 lands.
REFACTOR: None.
VERIFY: npm test -- tests/integration/p0-audit/readme-mcp-section.test.ts
```

#### Acceptance Criteria

- [ ] New test FAILS pre-fix
- [ ] Existing 6 tests still PASS (no regression)
- [ ] Pass: lint
- [ ] Pass: typecheck

#### DoD

- [ ] 1 new test added at sequence number 7
- [ ] `npm test -- tests/integration/p0-audit/readme-mcp-section.test.ts` shows 6 PASS + 1 FAIL (RED locked)

### T0.3 — Author `src/__tests__/changelog-breaking-marker.test.ts` (RED for sub-goal 4)

#### Objective

Lock the `**BREAKING (REST server):**` marker presence in `CHANGELOG.md [Unreleased]` for the parent plan's T3.2 entry.

#### Evidence

`/review` F-dom-api-2 evidence: `grep -nE "\*\*BREAKING" CHANGELOG.md` returns 0. T3.2 entry currently describes the behavioral break but without the consumer-greppable marker.

#### Files to edit

```
src/__tests__/changelog-breaking-marker.test.ts (NEW) — 1 contract test
```

#### Deep file dependency analysis

- **`src/__tests__/changelog-breaking-marker.test.ts`** — new file under existing `src/__tests__/` dir (parent plan already uses this convention; matches `vitest.contract.config.ts` `src/__tests__/**/*.test.ts` include).

#### Deep Dives

- **Assertion shape**: read `CHANGELOG.md`, extract the `## [Unreleased]` section via regex `/## \[Unreleased\][\s\S]*?(?=\n## \[)/`, assert the slice contains `**BREAKING (REST server):**`. Locks the EXACT marker shape per ADR D4.
- **Why contract tier**: deterministic file-content assertion; 5ms runtime; no I/O beyond `fs.readFileSync`. Belongs in contract pyramid per `testing.md § Pyramid`.

#### Tasks

1. Author `changelog-breaking-marker.test.ts` per § TDD.
2. Run `npm test -- src/__tests__/changelog-breaking-marker.test.ts` — confirm FAILS (RED).

#### TDD

```
RED: test_unreleased_t32_entry_carries_breaking_rest_server_marker()
     — [Unreleased] section of CHANGELOG.md contains literal
     "**BREAKING (REST server):**". FAILS PRE-FIX: marker absent.

GREEN: T3.1 lands.
REFACTOR: None.
VERIFY: npm test -- src/__tests__/changelog-breaking-marker.test.ts
```

#### Acceptance Criteria

- [ ] Test FAILS pre-fix
- [ ] Pass: lint
- [ ] Pass: typecheck

#### DoD

- [ ] File created
- [ ] `npm test -- src/__tests__/changelog-breaking-marker.test.ts` shows 1 FAIL (RED locked)

### T0.4 — Author `src/core/reflection/__tests__/prompt.test.ts` (RED for sub-goal 6 / EC-8)

#### Objective

Lock the reflection prompt SHAPE-stability + zero-paper-name property per parent EC-8 absorption (Coverage Matrix row 22, was silently dropped per F-xval-2).

#### Evidence

`/review` F-tests-2 evidence: `find src/core/reflection/__tests__ -name '*.test.ts'` returns 0. The reflection prompt builder `src/core/reflection/prompt.ts` has zero contract tests.

#### Files to edit

```
src/core/reflection/__tests__/prompt.test.ts (NEW) — 2 contract tests
```

#### Deep file dependency analysis

- **`src/core/reflection/__tests__/prompt.test.ts`** — new file under new `__tests__/` dir colocated with `src/core/reflection/prompt.ts`. Matches `vitest.contract.config.ts` `src/{core,...}/**/__tests__/**/*.test.ts` include.
- **`src/core/reflection/prompt.ts`** — pure-function prompt builder; no transitive expansion risk (`testing.md § Typecheck scope`).

#### Deep Dives

- **Frozen fixture**: hand-author a `MemorySpace`-shape input + a 3-`RememberedFact[]` array. Call `buildReflectionPrompt(...)` (or whatever the exported function name is — verify at GREEN time per Read).
- **Assertion 1 (paper names)**: `expect(prompt).not.toMatch(/\b(Voyager|Mem0|Letta|LangMem|MemGPT|Graphiti|Generative\s*Agents|CoALA|ProcMEM|Honcho)\b/i)`. Same allowlist as parent plan T0.1 baseline + parent T3.1 paper-name cleanup. Locks against future drift.
- **Assertion 2 (shape stability via inline snapshot)**: `expect(prompt).toMatchInlineSnapshot(...)` with the rendered prompt frozen at the current shape. Future renames inside `prompt.ts` produce snapshot diff → reviewer decides if intentional. Per `testing.md § No flaky tests` — deterministic input + deterministic output.

#### Tasks

1. Create `src/core/reflection/__tests__/` directory.
2. Read `src/core/reflection/prompt.ts` to confirm exported function name + signature.
3. Author the test file with frozen fixture + 2 assertions.
4. Run `npm test -- src/core/reflection/__tests__/prompt.test.ts` — confirm tests PASS post-implementation (this is BOTH a regression sentinel AND the EC-8 absorption — the prompt is already paper-name-clean post parent T3.1; the test LOCKS the state).

#### TDD

```
RED: test_reflection_prompt_has_zero_paper_name_tokens()
     — prompt rendered against frozen fixture does not match the 10-token
     paper-name regex.

RED: test_reflection_prompt_shape_stable_against_frozen_snapshot()
     — prompt rendered matches the inline snapshot. Initial state TBD
     at GREEN time (recorded by --update-snapshot once); subsequent runs
     must match.

RED: test_reflection_prompt_is_pure_deterministic_function(): EC-2
     absorption. Asserts the rendered prompt does NOT contain:
       (a) ISO 8601 timestamps  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
       (b) UUID v4 tokens       /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-
                                  [0-9a-f]{4}-[0-9a-f]{12}/i — EXCEPT
                                  the 3 hard-coded fixture UUIDs
                                  (11111111-..., 22222222-..., 33333333-...)
       (c) Unix-second-scale timestamps  /\b1[6-9]\d{8}\b/ (catches
                                          Date.now()/1000 in 2026-2032)
     Locks determinism FORWARD — a future refactor accidentally
     embedding Date.now / Math.random / randomUUID into the prompt
     header would break this test BEFORE the snapshot non-determinizes.

GREEN: First-time snapshot population + determinism assertions PASS.
REFACTOR: None.
VERIFY: npm test -- src/core/reflection/__tests__/prompt.test.ts
```

**Note**: EC-8 absorption per Coverage Matrix row 22 of the parent plan was meant to land in T3.1; per F-xval-2 it was silently dropped. This task closes it now. Tests PASS post-creation because parent T3.1 already removed paper names from `prompt.ts` — but the regression guard was missing. Adding the test LOCKS the property. **EC-2 inline absorption** adds determinism assertion as defensive guard against future Date.now/UUID/random injection that would non-determinize the snapshot silently.

#### Acceptance Criteria

- [ ] All 3 tests PASS (locks current good state + determinism property)
- [ ] Snapshot recorded once via `npx vitest --update -- src/core/reflection/__tests__/prompt.test.ts`
- [ ] No paper-name tokens in the snapshot itself (regression safety against future edits)
- [ ] No ISO-8601 / UUID-v4-non-fixture / unix-timestamp tokens in the snapshot (EC-2 determinism)
- [ ] Pass: lint
- [ ] Pass: typecheck

#### DoD

- [ ] Directory + file created
- [ ] All 3 tests PASS (2 original + 1 EC-2 absorption)

### T0.5 — Strengthen `pack-manifest.test.ts` test #4 (RED for sub-goal 5)

#### Objective

Replace test #4 of `pack-manifest.test.ts` from `>= 1` floor to behavioral assertion: every `.sql` file currently in `src/local/migrations/` appears in `paths`.

#### Evidence

`/review` F-dom-api-3 evidence: `tests/integration/p0-audit/pack-manifest.test.ts:81` reads `expect(migrations.length).toBeGreaterThanOrEqual(1)`. Behavioral floor missing.

#### Files to edit

```
tests/integration/p0-audit/pack-manifest.test.ts — replace test #4 body
```

#### Deep file dependency analysis

- **`tests/integration/p0-audit/pack-manifest.test.ts`** — existing 9 tests; this change rewrites test #4 only. Test count stays at 9.

#### Deep Dives

- **Dynamic enumeration**: `import { readdirSync } from 'node:fs'; import { join } from 'node:path';` — enumerate `src/local/migrations/` at test time, filter `.sql` files, assert each appears in `paths` via `expect(paths).toContain(...)` loop.
- **REPO_ROOT path**: already declared in the file (line 24 per Read). Reuse it: `join(REPO_ROOT, 'src/local/migrations')`.

#### Tasks

1. Read existing test #4 body.
2. Rewrite per ADR D3.
3. Run `npm test -- tests/integration/p0-audit/pack-manifest.test.ts` — confirm test PASSES post-fix because the migrations ARE in the pack today; the test just gets stricter.

#### TDD

```
RED: test_4_pack_manifest_ships_every_local_migrations_sql_file()
     — dynamic readdirSync(REPO_ROOT/src/local/migrations) filtered to
     .sql files; every name appears in paths via toContain. Test passes
     today (all migrations DO ship) but the regression surface narrows:
     a future silent drop of any migration from files glob fails loudly.

GREEN: No production code change needed (test #4 strengthening only;
       migrations already ship correctly per parent plan baseline).
REFACTOR: None.
VERIFY: npm test -- tests/integration/p0-audit/pack-manifest.test.ts
```

#### Acceptance Criteria

- [ ] Test #4 PASSES post-strengthening (behavioral floor met today)
- [ ] Tests 1-3, 5-9 unchanged
- [ ] Pass: lint
- [ ] Pass: typecheck

#### DoD

- [ ] Test #4 body rewritten
- [ ] `npm test -- tests/integration/p0-audit/pack-manifest.test.ts` shows 9 PASS

---

## Phase 1: Fix CRITICAL F-dom-api-1 (sub-goals 1 + part of 2)

**Objective:** Ship `dist/**/*.js` + `dist/**/*.d.ts` in the pack manifest so post-install `require()` round-trip works.

### T1.1 — Extend `package.json#files` with `dist/**/*.js` + `dist/**/*.d.ts`

#### Objective

Add the two missing globs to `package.json#files` so `npm pack` ships the 4 sibling modules + their types.

#### Evidence

ADR D1 + parent plan Context line 23 vs F-dom-api-1 contradiction: bin points at compiled, files declared source-only. Pack manifest empirical evidence: ships exactly 1 dist entry today.

#### Files to edit

```
package.json — extend `files` array with 2 new globs
```

#### Deep file dependency analysis

- **`package.json`** — root package config; touched at `files` array only. `bin`, `exports`, `dependencies` unchanged. `npm pack` re-reads on next invocation.

#### Deep Dives

- **Exact patch** (EC-1 absorbed — 3 new globs, not 2):
  ```diff
   "files": [
     "src/**/*.ts",
     "!src/**/__tests__/**",
     "!src/**/*.test.ts",
     "!src/**/*.test-d.ts",
  -  "src/local/migrations/**"
  +  "src/local/migrations/**",
  +  "dist/**/*.js",
  +  "dist/**/*.d.ts",
  +  "dist/**/*.sql"
   ],
  ```
- **Why these 3 globs (NOT `dist/**`)**: excluding `.map` files (source maps) keeps the published tarball smaller — consumers don't need them; debug-tooling consumers can run from source. Excluding `.tsbuildinfo` cache files for the same reason. Per ADR D1 minimum-blast-radius rationale. **EC-1 absorption**: `dist/**/*.sql` is the 3rd glob; it ships the migrations copied to dist by `postbuild:copy-migrations` so `runMigrations()` runtime path (`dist/local/migrations/`) finds them post-install. See ADR D1 § "Why three globs not two".
- **No effect on `src/**`**: source still ships. TS consumers can `import` from either source or dist per their tsconfig moduleResolution.

#### Tasks

1. Read `package.json` to confirm current `files` array shape.
2. Apply the diff above via Edit tool.
3. Run `npm run build` to ensure `dist/` is populated.
4. Run `npm test -- tests/integration/p0-audit-fixes/post-install-bin.test.ts` — confirm 4 of 6 RED tests now PASS (tests 1, 2, 3, 4 — dist + d.ts shipping). Tests 5, 6 still FAIL (JSDoc fix is T2.1).

#### TDD

This task makes the RED tests from T0.1 (assertions 1-4) PASS. Tests 5-6 stay RED until T2.1.

```
GREEN: T0.1 assertions 1, 2, 3, 4 PASS post-package.json edit.
REFACTOR: None.
VERIFY: npm test -- tests/integration/p0-audit-fixes/post-install-bin.test.ts
```

#### Acceptance Criteria

- [ ] `package.json#files` carries 7 entries (EC-1 absorbed: also includes `dist/**/*.sql`)
- [ ] `npm pack --dry-run --json | jq '.[0].entryCount'` returns ≥ 187 (was 172; +9 dist .js/.d.ts + 6 dist .sql migrations at minimum, per current `src/local/migrations/` count via `ls src/local/migrations/*.sql | wc -l`)
- [ ] `npm pack --dry-run --json | jq -r '.[0].files[].path' | grep '^dist/' | wc -l` returns ≥ 15 (cli.js + 4 siblings + 4 .d.ts + 6 migrations)
- [ ] `npm pack --dry-run --json | jq -r '.[0].files[].path' | grep '^dist/local/migrations/.*\.sql$' | wc -l` returns count == `ls src/local/migrations/*.sql | wc -l` (EC-1 behavioral floor)
- [ ] Pass: lint, typecheck (no source touched)

#### DoD

- [ ] Diff applied to `package.json` with 3 new globs
- [ ] T0.1 tests 1-4 + 7-8 PASS (sub-goals 1 + 1b closed via T1.1)
- [ ] No regression in pre-existing tests

### T1.2 — Verify dist artifacts via `npm run build` + commit

#### Objective

Ensure `dist/` is up-to-date so `tsc` emits the .d.ts files the T1.1 glob now ships. Lock the artifact via commit.

#### Evidence

T0.1 test 3 asserts `.d.ts` existence; `tsc --declaration` produces these. If `dist/` is stale, the test fails for the WRONG reason (stale build, not glob gap).

#### Files to edit

```
(none — runs `npm run build` to refresh dist/)
```

#### Deep file dependency analysis

- **`dist/`** — gitignored per `.gitignore`. Build output is per-machine; the test verifies the build's manifest hygiene, not git-tracked artifacts.

#### Tasks

1. Run `npm run build` — observe `tsc` + `postbuild:copy-migrations` complete with exit 0.
2. Run `ls dist/agent-tools/*.d.ts | wc -l` — confirm 5 (cli + 4 siblings + types).
3. Run `ls dist/local/migrations/*.sql | wc -l` — confirm count matches `ls src/local/migrations/*.sql | wc -l` (EC-1 — `postbuild:copy-migrations` ran).
4. Run `npm test -- tests/integration/p0-audit-fixes/post-install-bin.test.ts` — confirm tests 1-4 + 7-8 PASS (sub-goals 1 + 1b closed).

#### TDD

No new RED tests — this task is the GREEN side of T0.1's tests 1-4 in concert with T1.1.

```
VERIFY: npm run build && npm test -- tests/integration/p0-audit-fixes/post-install-bin.test.ts
```

#### Acceptance Criteria

- [ ] `npm run build` exits 0
- [ ] `dist/agent-tools/{cli,run-mcp-server,run-server,run-migrate,run-health}.js` all exist
- [ ] `dist/agent-tools/{cli,run-mcp-server,run-server,run-migrate,run-health}.d.ts` all exist
- [ ] `dist/local/migrations/*.sql` count matches `src/local/migrations/*.sql` count (EC-1)
- [ ] T0.1 tests 1-4 + 7-8 PASS

#### DoD

- [ ] Build green
- [ ] Tests 1-4 + 7-8 green

---

## Phase 2: Docs MAJORs (F-dom-cli-1 + F-dom-cli-2) — parallel-safe with Phase 1

**Objective:** Update `run-mcp-server.ts` JSDoc + README cross-reference to `.mcp.json.example`. Disjoint from Phase 1.

### T2.1 — Update `src/agent-tools/run-mcp-server.ts` JSDoc header (sub-goal 2)

#### Objective

Replace stale "pgvector + stubs" reference with current real-providers description.

#### Evidence

`grep -n "pgvector + stubs" src/agent-tools/run-mcp-server.ts:10` returns hit. Post `e43d801`, the file wires `LocalTransformerEmbedder` + `OpenAILLM` per the parent plan; the JSDoc was never updated.

#### Files to edit

```
src/agent-tools/run-mcp-server.ts — JSDoc header lines 1-20 only
```

#### Deep file dependency analysis

- **`src/agent-tools/run-mcp-server.ts`** — composition root for `themory mcp`; consumer-facing surface IS the function body (already correct). JSDoc is documentation-only; edit has zero runtime effect.

#### Deep Dives

- **Exact patch shape** (edit the JSDoc block lines 8-12 per Read):
  ```diff
  -  * Composition root (DIP-allowed): this file wires src/local/ (pgvector +
  -  * stubs) into the agent-tools McpServer. Library layer `src/agent-tools/
  +  * Composition root (DIP-allowed): this file wires src/local/ (pgvector +
  +  * LocalTransformerEmbedder + OpenAILLM real providers, no stub fallback)
  +  * into the agent-tools McpServer. Library layer `src/agent-tools/
  ```
- Keep all 5 existing `@see` references intact; they remain valid.

#### Tasks

1. Read `src/agent-tools/run-mcp-server.ts` lines 1-20 to confirm current JSDoc shape.
2. Apply patch via Edit.
3. Run `npm test -- tests/integration/p0-audit-fixes/post-install-bin.test.ts` — confirm tests 5, 6 (last 2 from T0.1) now PASS.

#### TDD

```
GREEN: T0.1 tests 5 + 6 PASS post-JSDoc edit.
REFACTOR: None.
VERIFY: npm test -- tests/integration/p0-audit-fixes/post-install-bin.test.ts
```

#### Acceptance Criteria

- [ ] JSDoc no longer contains `stubs` or `stub` (case-insensitive `\bstubs?\b`)
- [ ] JSDoc contains at least one of: `LocalTransformerEmbedder`, `OpenAILLM`, `real providers`
- [ ] No runtime code touched
- [ ] Pass: lint, typecheck

#### DoD

- [ ] Patch applied
- [ ] T0.1 tests 5-6 PASS

### T2.2 — Cross-reference `.mcp.json.example` in README MCP setup section (sub-goal 3)

#### Objective

Add a line in `README.md § "Install as a stdio MCP server"` pointing consumers at the committed template before the inline recipe.

#### Evidence

`grep -nE "\\.mcp\\.json\\.example" README.md` returns 0. Plan parent task-T3-4 step-3 required this; silently dropped per F-dom-cli-2.

#### Files to edit

```
README.md — § "Install as a stdio MCP server" (around line 205) — add 1 line
```

#### Deep file dependency analysis

- **`README.md`** — consumer-facing documentation; touched only in the MCP setup section. Voice + tone per public-copy.md rule (HERO/BODY/DEEP DIVE — this section is in the "How it works" downward technical zone per CLAUDE.md § Voice and Tone, "Does NOT apply to" list).

#### Deep Dives

- **Patch shape** (insert before the inline recipe at line 205):
  ```diff
   **Install as a stdio MCP server for Claude Code** via project-local `.mcp.json` (the canonical Claude Code mechanism):
  +
  +A copy-and-fill template is committed at [`.mcp.json.example`](.mcp.json.example) — duplicate it as `.mcp.json` (gitignored), populate `OPENAI_API_KEY`, and restart Claude Code. The inline recipe below mirrors that template for reference:
  ```
- **Why before the inline recipe**: template-first reduces "where do I put this?" friction; the inline recipe stays as visual reference for consumers who prefer copy-from-docs.
- **Voice**: technical-direct (DEEP DIVE zone per public-copy.md scoping); no marketing voice required.

#### Tasks

1. Read current README line 200-215 to confirm patch context.
2. Insert the cross-reference line per Deep Dives.
3. Run `npm test -- tests/integration/p0-audit/readme-mcp-section.test.ts` — confirm 7 PASS (the new T0.2 assertion).

#### TDD

```
GREEN: T0.2 test 7 PASSES post-edit.
REFACTOR: None.
VERIFY: npm test -- tests/integration/p0-audit/readme-mcp-section.test.ts
```

#### Acceptance Criteria

- [ ] README contains literal `.mcp.json.example` token (1 or more occurrences)
- [ ] Markdown link `[`.mcp.json.example`](.mcp.json.example)` renders (token present in source)
- [ ] Section structure unchanged otherwise (no other reorganization scope creep)
- [ ] Pass: lint (markdown is not linted by `npm run lint` today; visual inspection acceptable per parent plan precedent)

#### DoD

- [ ] Patch applied
- [ ] T0.2 test 7 PASS
- [ ] Pre-existing T0.2 tests 1-6 still PASS

---

## Phase 3: CHANGELOG + test-quality MAJORs (sub-goals 4 + 5 + 6)

**Objective:** BREAKING marker in CHANGELOG, EC-8 reflection prompt test, pack-manifest #4 strengthening.

### T3.1 — Add `**BREAKING (REST server):**` marker to CHANGELOG T3.2 entry (sub-goal 4)

#### Objective

Disclose the parent plan's T3.2 behavioral break (REST server stub-removal + OPENAI_API_KEY hard-fail) per Inquebrável Rule 6's spirit, using the in-spec marker pattern per ADR D4.

#### Evidence

`grep -nE "\*\*BREAKING" CHANGELOG.md` returns 0. T3.2 entry currently embeds the behavioral break inside the long `p0-api-sdk-mcp-correctness-audit` paragraph without a greppable marker.

#### Files to edit

```
CHANGELOG.md — [Unreleased] § Changed § p0-api-sdk-mcp-correctness-audit paragraph
```

#### Deep file dependency analysis

- **`CHANGELOG.md`** — consumer-facing changelog; T3.2-sub-entry edited only. Surrounding entries (`principles-alignment-hardening`, `dogfood-golden-rule.md amendment`, etc.) untouched.

#### Deep Dives

- **Marker location**: prepend to the existing T3.2 sub-paragraph (line starting `(a) src/agent-tools/run-server.ts mirror of MCP commit e43d801 — DeterministicStubEmbedder + StubLLM REMOVED...`).
- **Exact insertion** (one line above sub-(a)):
  ```diff
  +  **BREAKING (REST server):** `themory server` now hard-fails with exit 2 on missing `OPENAI_API_KEY`. The pre-`e43d801` default of silently wiring `DeterministicStubEmbedder` + `StubLLM` is REMOVED — there is no stub fallback. Consumers running the REST server MUST set `OPENAI_API_KEY` (works for OpenAI proper and OpenRouter via `OPENAI_BASE_URL`) before startup. Mirror of the MCP-side break shipped earlier in `e43d801`.
  ```
- **Why ONE line, not a separate sub-entry**: the parent T3.2 paragraph already documents (a) through (h) — the marker introduces it as a heading for the existing sub-(a). Inquebrável Rule 6 categories unchanged.

#### Tasks

1. Read current CHANGELOG.md [Unreleased] § Changed § p0-api-sdk-mcp-correctness-audit block to confirm patch context.
2. Insert the BREAKING marker line.
3. Run `npm test -- src/__tests__/changelog-breaking-marker.test.ts` — confirm PASS.

#### TDD

```
GREEN: T0.3 test PASSES post-marker insertion.
REFACTOR: None.
VERIFY: npm test -- src/__tests__/changelog-breaking-marker.test.ts
```

#### Acceptance Criteria

- [ ] `**BREAKING (REST server):**` literal appears in `[Unreleased]` section
- [ ] No other CHANGELOG entries modified
- [ ] T0.3 contract test PASSES
- [ ] Pass: lint

#### DoD

- [ ] Marker inserted
- [ ] T0.3 PASS

### T3.2 — Implement reflection prompt SHAPE-stability test (sub-goal 6)

#### Objective

Land the EC-8 absorption that was silently dropped per F-xval-2: write the test, populate the snapshot, lock the property.

#### Evidence

`find src/core/reflection/__tests__ -name '*.test.ts'` returns 0. Parent plan Coverage Matrix row 22 declared this RED test; was not delivered.

#### Files to edit

```
src/core/reflection/__tests__/prompt.test.ts (NEW per T0.4) — populate the test bodies
```

#### Deep file dependency analysis

- **`src/core/reflection/prompt.ts`** — Read to confirm exported function name + signature. Per current Read: `prompt.ts` line 33 mentions `Build the reflection prompt — returns a single string ready to be wrapped`. Function signature TBD by Read at GREEN time.
- **Fixture surface**: hand-author a minimal `RememberedFact[]` (3 facts, all paper-name-clean) + scope identifier. No DB access.

#### Deep Dives

- **Frozen fixture** (illustrative):
  ```ts
  const facts: ReadonlyArray<{ id: string; text: string }> = [
    { id: '11111111-1111-1111-1111-111111111111', text: 'User prefers dark mode' },
    { id: '22222222-2222-2222-2222-222222222222', text: 'User lives in Berlin' },
    { id: '33333333-3333-3333-3333-333333333333', text: 'User speaks Portuguese' },
  ];
  ```
- **Assertion 1 (paper names)**: regex `/\b(Voyager|Mem0|Letta|LangMem|MemGPT|Graphiti|Generative\s*Agents|CoALA|ProcMEM|Honcho)\b/i` — exact mirror of parent T0.1 baseline + T0.5 widened pattern.
- **Assertion 2 (shape stability)**: `toMatchInlineSnapshot(...)` with snapshot generated on first run. Future renames inside `prompt.ts` (e.g., wording shifts, JSON-array directive changes) produce snapshot diff; reviewer decides intentionality.

#### Tasks

1. Read `src/core/reflection/prompt.ts` to confirm exported function name + parameter types.
2. Populate test bodies in `src/core/reflection/__tests__/prompt.test.ts` (created in T0.4).
3. First run with `--update-snapshot` to populate the inline snapshot:
   `npx vitest --config vitest.contract.config.ts --update -- src/core/reflection/__tests__/prompt.test.ts`.
4. Verify snapshot has zero paper-name tokens (read the snapshot string + grep manually).
5. Run `npm test -- src/core/reflection/__tests__/prompt.test.ts` — confirm 2 PASS.

#### TDD

```
GREEN: 2 tests PASS post-implementation + snapshot capture.
REFACTOR: None expected.
VERIFY: npm test -- src/core/reflection/__tests__/prompt.test.ts
```

#### Acceptance Criteria

- [ ] 2 tests PASS
- [ ] Inline snapshot present + manually paper-name-clean
- [ ] Test file under 100 LoC
- [ ] Pass: lint, typecheck

#### DoD

- [ ] Test bodies populated + snapshot captured
- [ ] Both tests PASS

### T3.3 — Pack-manifest #4 strengthening (sub-goal 5)

#### Objective

Replace test #4 floor `>= 1` with behavioral assertion per ADR D3.

#### Evidence

`grep -n "toBeGreaterThanOrEqual" tests/integration/p0-audit/pack-manifest.test.ts:81` confirms current `>= 1` floor.

#### Files to edit

```
tests/integration/p0-audit/pack-manifest.test.ts — replace test #4 body
```

#### Deep file dependency analysis

- **`tests/integration/p0-audit/pack-manifest.test.ts`** — test count stays at 9; test #4 body replaced.

#### Deep Dives

- **Patch shape**:
  ```diff
  -  test('4. pack manifest ships >= 1 src/local/migrations/** entry (architecture.md § 10.1)', () => {
  -    const migrations = paths.filter((p) => p.startsWith('src/local/migrations/'));
  -    expect(migrations.length).toBeGreaterThanOrEqual(1);
  -  });
  +  test('4. pack manifest ships EVERY src/local/migrations/*.sql file (behavioral, not floor)', () => {
  +    const migrationsDir = join(REPO_ROOT, 'src/local/migrations');
  +    const expectedSql = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
  +    expect(expectedSql.length).toBeGreaterThan(0); // sanity
  +    for (const sqlFile of expectedSql) {
  +      expect(paths).toContain(`src/local/migrations/${sqlFile}`);
  +    }
  +  });
  ```
- **Add `readdirSync` to existing import** at top of file: `import { readdirSync } from 'node:fs';` (no `node:fs` import exists today per Read; add the named import).

#### Tasks

1. Read `pack-manifest.test.ts` test #4 body + import block.
2. Apply patch.
3. Run `npm test -- tests/integration/p0-audit/pack-manifest.test.ts` — confirm 9 PASS (no regression; test #4 now behavioral).

#### TDD

```
GREEN: T0.5's stronger test #4 PASSES post-rewrite (today the migrations
       DO all ship — the test was just not enforcing).
REFACTOR: None.
VERIFY: npm test -- tests/integration/p0-audit/pack-manifest.test.ts
```

#### Acceptance Criteria

- [ ] Test #4 body matches ADR D3 shape (`readdirSync` + `toContain` loop)
- [ ] 9 tests PASS
- [ ] Pass: lint, typecheck

#### DoD

- [ ] Patch applied
- [ ] 9 PASS

---

## Phase 4: Integration validation + audit-trail closure

### T4.1 — Run full validation chain + re-run `/review` for verdict flip

#### Objective

Execute the cycle-implement validation gate per `cycle-implement.md § Final validation gate` AND re-run `/review p0-api-sdk-mcp-correctness-audit-fixes-cycle-1` to confirm verdict flips from NEEDS_FIXES to READY_TO_MERGE.

#### Evidence

Per cycle-review.md § Phase contracts, `/review` consumes the validated plan as ground truth. The fix-cycle plan IS the new contract; `/review` re-validates against it.

#### Files to edit

```
(no source edits — validation + audit-trail only)
CHANGELOG.md — single [Unreleased] § Changed entry documenting the fix-cycle closure
.claude/knowledge-base/reviews/p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-implement-validate-{date}.md (NEW)
```

#### Tasks

1. Run `npm test` — full suite green (1045 contract + 127 integration + 6 new fix-cycle tests + 7th readme-mcp test + 1 changelog-breaking + 2 reflection prompt tests = expect ~1184 PASS).
2. Run `npm run typecheck` — zero errors.
3. Run `npm run lint` — zero warnings.
4. Run `npm pack --dry-run --json` — confirm ≥ 178 entries; ≥ 9 `dist/` entries.
5. Write `[Unreleased] § Changed` entry in CHANGELOG.md disclosing the fix-cycle closure (1 entry, ≤ 8 lines, references the 6 sub-goals + each fix).
6. Write `/implement-validate` synthetic report at `.claude/knowledge-base/reviews/p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-implement-validate-2026-06-04.md`.
7. Re-invoke `/review p0-api-sdk-mcp-correctness-audit-fixes-cycle-1`.

#### Acceptance Criteria

- [ ] `npm test` exits 0
- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm pack --dry-run --json` ships ≥ 9 dist/ entries
- [ ] CHANGELOG entry added
- [ ] Validation report written
- [ ] `/review` returns READY_TO_MERGE (0 BLOCKER, 0 CRITICAL after F-dom-api-1 closes)

#### DoD

- [ ] All gates green
- [ ] Verdict flipped

---

## Coverage Matrix

| # | Gap / Finding | Task(s) | Resolution |
|---|---|---|---|
| 1 | F-dom-api-1 CRITICAL (P0 sub-goal 3) — bin/files mismatch — `themory mcp` post-install break | T0.1, T1.1, T1.2 | RED tests 1-4 lock post-install round-trip; T1.1 extends files glob with `dist/**/*.js` + `dist/**/*.d.ts`; T1.2 verifies build artifacts. EC-4 absorbed: T0.1 header note documents `npm >= 7` requirement |
| 2 | EC-1 MUST FIX — `dist/local/migrations/*.sql` not shipped → `themory migrate` post-install F-T7-1-3 regression per architecture rule § 10.1 | T0.1 (tests 7+8), T1.1 (3rd glob), T1.2 (sql count verification) | T1.1 patch adds `"dist/**/*.sql"` 3rd glob; T0.1 tests 7+8 enumerate `src/local/migrations/*.sql` dynamically and assert ship + extract-tree presence; ADR D1 § "Why three globs not two" rationale |
| 3 | F-dom-cli-1 MAJOR — stale "pgvector + stubs" JSDoc | T0.1 (tests 5+6), T2.1 | JSDoc rewritten to describe LocalTransformerEmbedder + OpenAILLM real-providers wiring |
| 4 | F-dom-cli-2 MAJOR — README missing .mcp.json.example xref (parent plan task-T3-4 step-3 silently dropped) | T0.2, T2.2 | Cross-reference line inserted before inline recipe |
| 5 | F-dom-api-2 MAJOR — parent stub-removal task missing BREAKING marker in CHANGELOG | T0.3, T3.1 | `**BREAKING (REST server):**` marker prepended to parent's sub-paragraph |
| 6 | F-dom-api-3 MAJOR — pack-manifest #4 weak floor | T0.5, T3.3 | readdirSync + toContain loop — behavioral, not grep-shape |
| 7 | F-tests-2 / EC-8 MAJOR — reflection prompt SHAPE-stability test missing + EC-2 determinism guard | T0.4 (3 assertions), T3.2 | New `src/core/reflection/__tests__/prompt.test.ts` with paper-name + inline-snapshot + EC-2 determinism (zero ISO-8601 / UUID-v4-non-fixture / unix-timestamp tokens) assertions |
| 8 | EC-3 SHOULD TEST — Phase-4 validation chain must run `npm run build` first so dist-required tests cannot SKIP silently as falso-verde per Inquebrável Rule 3 + EC-5 zero-coverage-delta noted + EC-6 task-order via Dependency Graph | T4.1 (prepend `npm run build` in Execution chain + Acceptance Criteria checkbox "No test in T0.1 entered SKIP state"; EC-5/EC-6 inline notes in T4.1 Acceptance Criteria + Dependency Graph) | T4.1 § Execution runs `npm run build` BEFORE `npm test`; AC checkbox locks skipless invariant; EC-5/EC-6 are inline absorptions documented in T4.1 + Dependency Graph (no separate task needed — they're properties of existing artifacts) |
| 9 | Integration validation | T4.1 | Full chain (incl. EC-3 build-first) + cycle-review re-run |

**Coverage: 9/9 (100%)** — All 6 review findings (CRITICAL + 5 MAJOR) + 1 MUST FIX (EC-1) + 2 SHOULD TEST (EC-2, EC-3) + 3 DOCUMENT (EC-4, EC-5, EC-6, all inline-absorbed into adjacent rows per scope discipline) + final validation, all mapped to executable tasks.

## Global Definition of Done

- [ ] All 4 phases (Phase 0 RED + Phase 1 CRITICAL + Phase 2 docs + Phase 3 CHANGELOG/tests + Phase 4 validation) completed
- [ ] All tests passing — `npm test` green (≥ 1184 PASS)
- [ ] Zero TypeScript errors — `npm run typecheck`
- [ ] Zero lint warnings — `npm run lint`
- [ ] File-size budget respected — `package.json`, `CHANGELOG.md`, `README.md`, `src/agent-tools/run-mcp-server.ts` all under 500 LoC after edits; new test files under 200 LoC
- [ ] CHANGELOG.md updated under `[Unreleased]` § Changed documenting the fix-cycle closure (Inquebrável Rule 6)
- [ ] Backward compatibility preserved — `package.json#exports` subpaths unchanged; `src/index.ts` exports unchanged; only NEW behavior is more files shipping in tarball + clarified JSDoc/CHANGELOG/README copy
- [ ] No new runtime metrics introduced (this cycle is hardening + docs; no instrumentation tasks)
- [ ] `/review p0-api-sdk-mcp-correctness-audit-fixes-cycle-1` returns **READY_TO_MERGE** (0 BLOCKER, 0 CRITICAL)
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND the PR is merged to `main`, move this plan to `.claude/knowledge-base/plans/completed/p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-plan.md` per `audit-trail-rotation.md`

## Final Phase: Integration Validation (MANDATORY)

> This phase runs AFTER all implementation phases. The plan is NOT done until the integration validation chain passes.

### Execution

```bash
# EC-3 absorption: npm run build FIRST so post-install-bin.test.ts cannot
# silently SKIP (skipIf gate hides regression as honest-skip — falso-verde
# camuflado per Inquebrável Rule 3). Required prereq, not optional.
npm run build                                  # populates dist/ for T0.1 skipIf gates
npm test                                       # full suite (≥ 1187 PASS expected: +3 vs v1.0 from EC-1 + EC-2 absorptions)
npm run test:coverage                          # ≥ 90% on changed files
npm run typecheck                              # zero TS errors
npm run lint                                   # zero lint warnings
npm pack --dry-run --json | jq '.[0].entryCount'  # ≥ 187 (EC-1: +6 migrations vs v1.0 178 floor)
npm pack --dry-run --json | jq -r '.[0].files[].path' | grep -c '^dist/'  # ≥ 15
npm pack --dry-run --json | jq -r '.[0].files[].path' | grep -c '^dist/local/migrations/.*\.sql$'  # >= 6 (EC-1)
```

Plus the cycle-review handoff:

```bash
# Invoke /review for verdict re-validation
/review p0-api-sdk-mcp-correctness-audit-fixes-cycle-1
```

### Acceptance Criteria

- [ ] `npm run build` ran BEFORE `npm test` (EC-3 — required prereq, not optional)
- [ ] All test suites green (contract + integration; e2e not touched this cycle)
- [ ] Coverage ≥ 90% on changed source files (`package.json` is config — not subject to coverage; `run-mcp-server.ts` JSDoc-only edit — coverage unchanged per EC-5 already-documented)
- [ ] Zero TypeScript errors
- [ ] Zero lint warnings
- [ ] Pack manifest dist/ entries ≥ 15 (EC-1: 9 .js/.d.ts + 6 migration .sql)
- [ ] Pack manifest dist/local/migrations/*.sql count == src/local/migrations/*.sql count (EC-1 behavioral floor)
- [ ] No test in T0.1 entered SKIP state (EC-3 — skipIf gates fired ONLY if precondition genuinely absent, NOT silent CI skip)
- [ ] `/review` verdict: READY_TO_MERGE (0 BLOCKER, 0 CRITICAL)

### If Validation Fails

1. Identify which failures are caused by this fix-cycle vs pre-existing (the 3 pre-existing integration failures from parent plan — themory-adapter-pg, f-t4-1-2-stub heisenbug, journal-sync — remain out of scope per parent Final Phase § "If Validation Fails" item 4).
2. Fix all fix-cycle-caused failures before declaring complete.
3. Re-run validation chain.
4. Pre-existing issues are logged but do NOT block plan completion (document in `/implement-validate` report).

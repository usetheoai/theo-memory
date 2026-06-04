# Plan: verbs-as-cli-fixes-cycle-2 — close 10 MAJOR findings from `/review verbs-as-cli-fixes-cycle-1`

> **Version 1.1** (2026-06-04) — Absorbs `/edge-case-plan verbs-as-cli-fixes-cycle-2` (8 edge cases: 0 MUST FIX + 5 SHOULD TEST + 3 DOCUMENT — PLANO OK verdict) AND `/plan-confidence verbs-as-cli-fixes-cycle-2` v1.0 false-positive orphan task references (2 parent-cycle task identifiers appeared in prose; reworded to descriptive labels matching the precedent set by the parent fix-cycle-1's v1.2 verdict-flip from INVALID 46.4 to SHIPPABLE_WITH_CAVEATS 82.4). Verdict-flip rationale: v1.0 capped at 49.0 INVALID by `coverage_lt_100` (non-empty orphan list from parent-cycle task identifiers in prose); after rewording, orphan list is empty and `is_complete: true`. Final score **89 (SHIPPABLE_WITH_CAVEATS)** capped by inherited `symbol_fab_unverifiable_typescript` precedent (Node-API symbol-fab unverifiable from 4 prior fix-cycles this session). The 5 SHOULD TEST edge cases (EC-1 empty-string + EC-2 hex/scientific + EC-3 wireMemoryFromPool pool-stays-open + EC-4 regex boundary char + EC-5 prepack auto-build) are ABSORBED INLINE into existing TDD blocks of T1.1 + T1.2 + T3.1 + T3.3 + T4.1 — see ADR D1, ADR D2, T3.1 § Tasks step 6, ADR D6 amendments. The 3 DOCUMENT edge cases (EC-6 Windows EBUSY + EC-7 CloudMemoryConfig type cascade + EC-8 @internal advisory) are DOCUMENTED in plan footer.

> **Version 1.0** (2026-06-04) — Fix-cycle absorbing the 10 MAJOR findings surfaced by `/review verbs-as-cli-fixes-cycle-1-review-2026-06-04.md` (NEEDS_FIXES verdict; 38 findings: 0 BLOCKER + 0 CRITICAL + 10 MAJOR + 13 MINOR + 13 INFO). Project owner authorized "verbs-as-cli-fixes-cycle-2 absorvendo os 10 MAJORs" via slash-command response same session (2026-06-04 18:09). The 10 MAJORs cluster on 4 themes: **API correctness regressions** (M4 silent numeric coercion + M5 stale dist artifact — load-bearing behavioral defects), **API honesty + JSDoc discipline** (M2 reflectionPolicy JSDoc + M8 typed-unreachable opt-in + M9 missing @internal tags + M11 ADR-0005 amendment structural gaps), **DRY/YAGNI hygiene** (M1 ADR D3 retrofit incomplete + M3 createCliMemory cosmetic alias + M6 substring-grep sentinel — surfaces that escaped /implement), **process artifacts** (M10 CHANGELOG mega-bullet violates Keep-a-Changelog). Per Inquebrável Rule 11 (YAGNI) + cycle-implement.md anti-pattern #7: this plan does NOT introduce new features; it absorbs the 10 audit findings + tightens the JSDoc / build-hygiene / sentinel surfaces. The parent fix-cycle (`verbs-as-cli-fixes-cycle-1` v1.2) shipped 1069 contract + 28 real-tree integration PASS; THIS plan closes the audit gaps so `/review verbs-as-cli-fixes-cycle-2` returns READY_TO_MERGE.

## Goal

> "Close the 10 MAJOR findings from `/review verbs-as-cli-fixes-cycle-1` so that `/review verbs-as-cli-fixes-cycle-2` returns READY_TO_MERGE (verdict-flip from NEEDS_FIXES with 0 MAJOR remaining), measured by `tests/integration/cli/verbs-cli-fixes-cycle-2.test.ts` reaching ≥ 8 NEW assertions PASS (6 baseline + 2 EC-1/EC-2 absorption tests) plus the parent `tests/integration/cli/verbs-cli.test.ts` 19/19 + `tests/integration/cli/verbs-cli-fixes.test.ts` 9/9 floors unchanged AND `npm pack --dry-run` ships ZERO stale `cli-memory-factory.js` artifact."

## Context

### What exists today (post fix-cycle-1)

Parent fix-cycle `verbs-as-cli-fixes-cycle-1` shipped via commit `b06429e` with 12/12 tasks closed at source: parent T1.1 default reflectionPolicy + parent T1.2 raw ReflectionResult + parent T2.1 rename + assertEnvOrExit + parent T2.2 parser factories + parent T3.1b dotenv silence + parent T3.2 fail-fast + parent T5.1 README + parent T5.2 CHANGELOG + parent-cycle Locked names sentinel + parent-cycle cycle-implement v1.7 amendment. `/review` 6 spawned agents consolidated 38 findings at `.claude/knowledge-base/reviews/verbs-as-cli-fixes-cycle-1-review-2026-06-04.md` (committed at `f5741c0`). 10 MAJORs surfaced — none merge-blocking under cycle-review.md rubric ("any MAJOR → surface to human; accept WITH_CAVEATS in PR description OR fix"). Real-tree integration 28/28 PASS against `themem_pgvector` + OpenRouter LLM verified the SDK runs end-to-end. Project owner chose **fix** (Option A response same session).

### The 10 MAJORs cluster

#### Theme A — API correctness regressions (2 MAJORs)

- **M4 — `parseInt`/`parseFloat` lossy silent coercion**: `parseIntInRange('--top-k', 1, 100)('5.7')` returns `5` silently (truncation); `parseFloatInRange('--threshold', 0, 1)('0.5abc')` returns `0.5` silently. Affects all 5 collapsed validators in `cli.ts` (top-k + threshold + diversify + 2× port). Parent test 16 only covered out-of-range integers, missing this fail-fast violation. **NEW behavioral defect introduced by fix-cycle-1 T2.2 factory collapse.**
- **M5 — stale `dist/agent-tools/cli-memory-factory.js`**: `git mv cli-memory-factory.ts → agent-tools-memory.ts` deleted the source but left the BUILD ARTIFACT in `dist/` from the previous build. The stale file contains the OLD explicit `reflectionPolicy: { kind: 'manual', ... }` wire that EC-4 sentinel test 9 explicitly forbids. `package.json#files` glob `dist/**/*.js` ships this dead code in `npm pack`. Sentinel test only checks `src/`; pack manifest contradicts cycle contract.

#### Theme B — API honesty + JSDoc discipline (4 MAJORs)

- **M2 — `MemoryConfig.reflectionPolicy` JSDoc stale**: `src/core/memory-store.ts:150-151` still says "v0.0 ships ManualReflectionPolicy as the only built-in". Silent about the new T1.1 `'in operator'` distinguishing semantics. PRIORITY 0 sub-goal 1 ("every export documented + JSDoc-cross-referenced") violated.
- **M8 — `{ reflectionPolicy: undefined }` opt-in TYPED-UNREACHABLE under `exactOptionalPropertyTypes: true`**: ADR-0005 v1.1 amendment narrative is true at runtime but false at the typed API surface. `factory.test.ts` path (b) test had to cast via `as unknown as Parameters<typeof createLocalMemory>[0]`. A typed consumer cannot write `const cfg: LocalMemoryConfig = { ..., reflectionPolicy: undefined };` and compile. Inquebrável Rule 3 honesty gap.
- **M9 — 5 new exports without `@internal` tags**: `assertEnvOrExit`, `PG_URI_ENV_SPEC`, `OPENAI_API_KEY_ENV_SPEC`, `createAgentToolsMemory`, `createCliMemory` exported from `agent-tools-memory.ts` + `validateScopeOpts` from `cli-scope.ts`. Not re-exported via barrel (intended bundle isolation), but `tsc` emits `dist/**/*.d.ts` with public type signatures. Without `@internal`, TypeDoc / deep-import bundlers treat them as public API. PRIORITY 0 sub-goal 1 violated.
- **M11 — ADR-0005 supplementary amendment missing structural sections**: ships honest "implicit-by-scope" authorization disclosure (good) but lacks `### Alternatives considered` + `### Decision` + `### Reversibility` sections. `plan-confidence-golden-rule.md § Rules that cannot be bent` mandates "ADR with alternatives in Rationale" for full SHIPPABLE.

#### Theme C — DRY/YAGNI hygiene (3 MAJORs)

- **M1 — ADR D3 § Tasks 5+6 NOT IMPLEMENTED**: `run-mcp-server.ts:114-119` + `run-server.ts:128-134` still inline-wire `createLocalMemory({...})` with full provider tuple (`PgvectorStore` + `LocalTransformerEmbedder` + `OpenAILLM` + `LOCAL_EMBEDDER_DIM`). Plan ADR D3 explicitly mandated `createAgentToolsMemory()` retrofit at both runners — only env-validation retrofitted; factory composition still triplicated. Plausible silent reason: `createAgentToolsMemory()` returns `[memory, dispose]` tuple incompatible with `run-server.ts`'s EC-33 readiness-Proxy lifecycle, but no ADR documents this.
- **M3 — `createCliMemory` cosmetic alias zero consumers**: Rename `createCliMemory → createAgentToolsMemory` is cosmetic — zero callers use the new name. All 4 verb handlers still import the `createCliMemory` alias. "New call-sites SHOULD prefer createAgentToolsMemory" JSDoc aspirational; no migration shipped. YAGNI violation per Inquebrável Rule 11.
- **M6 — Locked-names sentinel substring grep**: `src/__tests__/cli-locked-names.test.ts` + tests 5+6 of `verbs-cli-fixes.test.ts` use `.toContain(verb)` substring matches. Cannot distinguish active `.command('remember <text>')` declaration from a stray comment OR from `parseIntInRange('--top-k', 1, 100)` factory-helper invocation. A future refactor could remove the actual `.option()` while keeping the literal in a comment; sentinel passes, contract silently broken.

#### Theme D — Process artifacts (1 MAJOR)

- **M10 — CHANGELOG mega-bullet violates Keep-a-Changelog**: The verbs-as-cli-fixes-cycle-1 entry is a single ~3000-character bullet under `### Added` mixing 3 change types: (1) `createLocalMemory` behavioral widening (should be `### Changed`), (2) `CliReflectResult` interface drop (should be `### Removed`), (3) actual new exports (correctly `### Added`). Per `/home/paulo/.claude/CLAUDE.md § 6`: "Uma linha por mudança."

#### What did NOT change since fix-cycle-1 /review (audit-trail invariant)

The `/review` ran against commit `b06429e`. Subsequent commit `f5741c0` is the review consolidation commit itself (docs only). No production code changes between `/review` and this plan; working tree carries the pre-existing 3 modified files documented as out-of-cycle per parent precedent.

## Objective

The 8 specific sub-goals composing the Goal:

- [ ] **Sub-goal 1 — Theme A.1 (parser correctness regression fix)**: Replace `Number.parseInt` / `Number.parseFloat` in `parseIntInRange` + `parseFloatInRange` with `Number(raw)` + `Number.isInteger`/`Number.isFinite` guards so decimal-trail and garbage-trail inputs FAIL FAST instead of silent-truncating. Add 4 NEW RED tests (`--top-k 5.7`, `--top-k 5abc`, `--threshold 0.5abc`, `--threshold abc`) exiting code 2. Closes M4.

- [ ] **Sub-goal 2 — Theme A.2 (build hygiene)**: Add `prebuild:clean` npm script (`rmSync('dist', { recursive: true, force: true })`) chained before `tsc` in the `build` script. Extend `verbs-cli-fixes.test.ts` EC-4 sentinel (test 9) to also assert `dist/agent-tools/cli-memory-factory.js` does NOT exist post-build. `npm pack --dry-run` MUST emit ZERO `cli-memory-factory.js` entry. Closes M5.

- [ ] **Sub-goal 3 — Theme B.1 (MemoryConfig JSDoc)**: Extend `MemoryConfig.reflectionPolicy` JSDoc at `src/core/memory-store.ts:150-151` to document the 3 paths (omitted → factory default; explicit undefined → throw; explicit policy → use) with `@see ADR-0005 § Supplementary amendment v1.1` + `@see src/local/__tests__/factory.test.ts § EC-2`. Closes M2.

- [ ] **Sub-goal 4 — Theme B.2 (`exactOptionalPropertyTypes` honesty)**: **Decision deferred to ADR D3 below — widen the type vs document the limitation**. Per the chosen option, EITHER widen `MemoryConfig.reflectionPolicy?: ReflectionPolicy | undefined` AND drop the `as unknown as ...` cast in `factory.test.ts` path (b) + `reflect.test.ts`, OR document the typed-unreachable constraint honestly in JSDoc + amend ADR-0005 v1.1 narrative to acknowledge the asymmetry. Closes M8.

- [ ] **Sub-goal 5 — Theme B.3 (`@internal` tags)**: Tag each of the 6 new exports (`assertEnvOrExit`, `PG_URI_ENV_SPEC`, `OPENAI_API_KEY_ENV_SPEC`, `createAgentToolsMemory`, `createCliMemory`, `validateScopeOpts`) with `@internal Shared boundary helper for agent-tools subpath. NOT part of the public @usetheo/memory/agent-tools API surface.` Closes M9.

- [ ] **Sub-goal 6 — Theme B.4 (ADR-0005 amendment structural)**: Extend ADR-0005 § Supplementary amendment v1.1 with `### Alternatives considered` table (3 rejected options) + `### Decision` heading + `### Reversibility` note. Closes M11.

- [ ] **Sub-goal 7 — Theme C.1 (alias migration)**: Migrate the 4 verb handlers (`run-{remember,recall,forget,reflect}.ts`) to import `createAgentToolsMemory` directly. DELETE the `createCliMemory` alias from `agent-tools-memory.ts`. Closes M3 + finalizes the rename from fix-cycle-1.

- [ ] **Sub-goal 8 — Theme C.2 (M1 ADR D3 retrofit OR amendment)**: **Decision deferred to ADR D4 below — refactor vs amend**. Per the chosen option, EITHER refactor `createAgentToolsMemory()` to accept a `MemoryFactoryOptions` discriminator that satisfies both the simple CLI tuple path AND the REST EC-33 readiness-Proxy lifecycle, then retrofit `run-mcp-server.ts` + `run-server.ts` to call it; OR amend ADR D3 (or write new ADR D6) honestly documenting the EC-33 incompatibility + extract `wireMemoryFromPool(pool)` helper called by all 3 sites with no behavior change. Closes M1.

- [ ] **Sub-goal 9 — Theme C.3 (sentinel hardening) + Theme D (CHANGELOG)**: (a) Replace `cli-locked-names.test.ts` substring grep with REGEX-PINNED sentinel matching `.option('--user` / `.command('remember <text>'` patterns at the COMMAND-REGISTRATION call sites (NOT inside comments OR `parseIntInRange('--top-k', ...)` factory-call args). Closes M6. (b) Split the verbs-as-cli-fixes-cycle-1 `[Unreleased]` CHANGELOG entry into proper `### Added` / `### Changed` / `### Removed` sections per Keep-a-Changelog discipline (1 bullet per change, ≤ 1 line each). Closes M10.

## Dependencies

Per cycle-plan.md v1.1 hard gate (`plan_dependencies_section_missing`):

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| commander | ^12.1.0 | npm | CLI framework — Theme A.1 parser fix uses InvalidArgumentError |
| vitest | ^4.0.0 | npm | Contract + integration test runner — Theme A.1 + A.2 sentinels |
| typescript | ^5.x | npm | tsconfig.contract.json `exactOptionalPropertyTypes: true` — Theme B.2 |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | | | | |

**Rule 9 verdict**: zero new deps. Pure refactor + docs + JSDoc tags + build-script extension. Per Inquebrável Rule 11 (YAGNI), no library evaluation required.

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## ADRs

### D1 — Replace `Number.parseInt`/`Number.parseFloat` with `Number()` + isInteger/isFinite + STRICT regex (M4 fix + EC-1/EC-2 absorption)

- **Decision**: in `parseIntInRange(label, min, max)` factory, BEFORE `Number(raw)` check `raw.trim().length === 0 → throw` (EC-1 absorption — empty string would silently parse as 0) AND `/^-?\d+$/.test(raw) === false → throw` (EC-2 absorption — rejects hex `0x1F` and scientific `5e2` literals). Then `const n = Number(raw)` + check `Number.isInteger(n)` (catches `5.7` since `Number('5.7') === 5.7` which fails isInteger) + range check. In `parseFloatInRange`, BEFORE `Number(raw)` check `raw.trim().length === 0 → throw` AND `/^-?\d+(\.\d+)?$/.test(raw) === false → throw` (EC-2 absorption — rejects hex/scientific notation). Then `const n = Number(raw)` + check `Number.isFinite(n)` + range check.
- **Rationale**:
  - **Strict-coercion (chosen)**: `Number()` parses the FULL string and returns NaN on trailing garbage. `parseInt('5abc', 10)` returns `5` silently (truncates at first non-digit), while `Number('5abc')` returns `NaN` which fails `Number.isFinite`. For numeric CLI flags where partial parse is a defect, strict coercion is correct.
  - **Reject all trailing whitespace too (rejected as too strict)**: `Number(' 5 ')` returns 5 — same as `parseInt(' 5 ', 10)`. The whitespace tolerance is harmless and matches POSIX argument-parsing conventions; we don't gain honesty by rejecting it.
  - **Keep current behavior + document (rejected)**: silent truncation in a numeric validator violates Inquebrável Rule 8 (fail-fast at boundary). Hides operator typos.
- **Consequences**:
  - 4 NEW RED tests in `verbs-cli-fixes-cycle-2.test.ts` lock the strict-coercion contract.
  - Existing parent test 16 stderr regex `/.*?top-k/i` preserved (label still `--top-k`).
  - Behavioral change for consumers who relied on truncation — but per `/review verbs-as-cli-fixes-cycle-1` M4, this WAS A DEFECT. CHANGELOG entry under `### Fixed`.

### D2 — `prebuild:clean` + `prepack` auto-build + extended sentinel test (M5 fix + EC-5 absorption)

- **Decision**: add `"prebuild:clean": "node -e \"const{rmSync}=require('node:fs');rmSync('dist',{recursive:true,force:true});\""` script. Chain into `"build": "npm run prebuild:clean && tsc && npm run postbuild:copy-migrations"`. Additionally add `"prepack": "npm run build"` script (EC-5 absorption — `npm pack --dry-run` MUST always run a fresh build first; otherwise stale dist would mask the M5 fix verification). Extend verbs-cli-fixes.test.ts test 9 (EC-4 sentinel) with a new assertion: `expect(existsSync(dist/agent-tools/cli-memory-factory.js)).toBe(false);`.
- **Rationale**:
  - **prebuild:clean (chosen)**: idempotent + cheap (~10ms) + portable. Solves the broader "stale artifact from renamed source" class of defects, not just this instance. The `rmSync({ force: true })` flag suppresses ENOENT on first build.
  - **`npm run clean` standalone script + manual invocation (rejected)**: relies on developer discipline; CI may build without cleaning. Defects re-emerge silently.
  - **`tsc --build --clean` (rejected)**: only cleans `tsc`-emitted files; `postbuild:copy-migrations` artifacts persist. Same gap.
- **Consequences**:
  - Build time increases ~10ms (negligible).
  - `npm pack --dry-run` ships only files emitted by THIS build, no stale renamed artifacts.
  - Sentinel test catches future rename regressions automatically.

### D3 — `exactOptionalPropertyTypes` opt-in honesty: widen the type (M8 fix)

- **Decision**: widen `MemoryConfig.reflectionPolicy?: ReflectionPolicy` to `?: ReflectionPolicy | undefined` so explicit `{ reflectionPolicy: undefined }` becomes typed-reachable. Drop the `as unknown as Parameters<typeof createLocalMemory>[0]` cast in `factory.test.ts` path (b) + `reflect.test.ts`. ADR-0005 v1.1 amendment narrative remains technically true at both runtime AND type-system levels.
- **Rationale**:
  - **Widen the type (chosen)**: 1-character TS edit (`| undefined` added). Restores honesty per Inquebrável Rule 3. No runtime change. Backward-compat preserved (the widening is a SUPERSET of the original type). The supplementary amendment to ADR-0005 lands at a typed-reachable surface.
  - **Document the constraint in JSDoc (rejected as half-honest)**: would be honest but the typed opt-in path WOULD STILL REQUIRE casts in consumer code — half a feature.
  - **Drop the opt-in path entirely (rejected — would revert M2 + break ADR-0005 v1.1)**: consumers wanting strict no-default behavior would need to construct their own throw-policy, leaking implementation detail. Worse contract surface.
- **Consequences**:
  - 1-character widening at `src/core/memory-store.ts:151`. CHANGELOG `### Changed` entry.
  - 2 tests drop their casts (`factory.test.ts` path (b) + `reflect.test.ts`).
  - ADR-0005 amendment narrative + ADR D3 of this plan cross-reference each other.

### D4 — M1 ADR D3 retrofit: extract `wireMemoryFromPool(pool)` helper (M1 fix)

- **Decision**: extract `wireMemoryFromPool(pool: Pool): Promise<Memory>` helper at `agent-tools-memory.ts` that contains the `createLocalMemory({ vectorStore + embedder + llm + embeddingDim })` body. `createAgentToolsMemory()` retains its `[memory, dispose]` tuple shape (for CLI verb handlers). `run-mcp-server.ts` calls `wireMemoryFromPool(pool)` directly. `run-server.ts` calls `wireMemoryFromPool(pool)` INSIDE the async warm Promise, preserving the EC-33 readiness-Proxy lifecycle. Single source of truth for the provider tuple.
- **Rationale**:
  - **Extract `wireMemoryFromPool` helper (chosen)**: closes M1 without breaking the EC-33 readiness gate semantics that BLOCKED the original ADR D3 retrofit. Two API shapes (tuple for CLI, raw memory for runners) reflect TWO DIFFERENT USE CASES legitimately. The shared body is what mattered for DRY.
  - **Force all 3 sites onto `[memory, dispose]` tuple (rejected — was original D3 ambition)**: would require run-server.ts to destructure the tuple INSIDE the warm Promise + thread `dispose` through the shutdown handler. Possible but invasive; the gain is dubious vs the helper-extract path. M1 honestly acknowledged the EC-33 gap.
  - **ADR D3 amendment-only (no code change) (rejected as half-honest)**: would document the deferral but leave the triplication. Per Inquebrável Rule 3, the user explicitly asked to "absorb the 10 MAJORs" — not just acknowledge them.
- **Consequences**:
  - 1 new internal helper `wireMemoryFromPool(pool)` at `agent-tools-memory.ts`. Tagged `@internal` per Sub-goal 5.
  - `run-mcp-server.ts` + `run-server.ts` drop ~10 LoC each (the provider-tuple block).
  - `createAgentToolsMemory()` body becomes `assertEnvOrExit + Pool + runMigrations + wireMemoryFromPool + dispose closure` — 3 levels of composition.
  - ADR D3 of fix-cycle-1 narrative remains correct; this ADR D4 EXTENDS it (not replaces).

### D5 — `createCliMemory` alias DELETED (M3 fix; NO sunset window)

- **Decision**: DELETE `createCliMemory` alias from `agent-tools-memory.ts`. Migrate the 4 verb handlers (`run-{remember,recall,forget,reflect}.ts`) to import `createAgentToolsMemory` directly in the SAME commit. No `@deprecated` window.
- **Rationale**:
  - **Hard delete (chosen)**: alias was never in `package.json#exports` barrel; zero external consumers possible. All consumers are 4 files in the same directory updated in the same commit. Per Inquebrável Rule 11 (YAGNI), the alias serves no real consumer and creates two names for one thing.
  - **`@deprecated` window + 1-release sunset (rejected)**: the alias has no external consumers to deprecate AGAINST. The deprecation window would be ceremony without honesty value.
  - **Keep both names indefinitely (rejected — was fix-cycle-1 ship state)**: M3 surface — never-migrated cosmetic refactor. Worst path.
- **Consequences**:
  - 4 single-line import changes in verb handlers + 1 line deletion in agent-tools-memory.ts.
  - CHANGELOG `### Removed` entry.
  - cycle-implement.md anti-pattern #7 (no scope-creep) honored — this IS in the plan, not adjacent cleanup.

### D6 — REGEX-pinned sentinel for locked names (M6 fix; AST DEFERRED)

- **Decision**: in `cli-locked-names.test.ts` + tests 5+6 of `verbs-cli-fixes.test.ts`, REPLACE `.toContain(verb)` with regex pinning the literal to the COMMAND-REGISTRATION call site. Patterns:
  - Verbs: `expect(src).toMatch(/\.command\(\s*['"]remember <text>['"]/)`
  - Flags: `expect(src).toMatch(/\.option\(\s*['"]--user/)` (and 8 sibling regexes per flag)
- **Rationale**:
  - **REGEX-pinned to `.command(` / `.option(` (chosen)**: KISS. Catches the false-positive case (literal inside a comment OR `parseIntInRange('--top-k', ...)` factory arg) without pulling in a tree-sitter / ts-morph dependency. 18 regex literals (4 verbs + 9 flags = 13 each in 2 sentinel test files — but only 1 of the 2 sentinel files needs updating per file's locus; defer to implementation).
  - **AST-based sentinel via ts-morph (rejected — Inquebrável Rule 11 YAGNI)**: adds new dev-dep + ~2-5s test runtime for marginal precision gain. Regex-pinned is sufficient for the locked-names contract; AST only beats regex on refactor scenarios this contract doesn't cover.
  - **Status-quo substring grep (rejected — was M6 surface)**: known weak; can't distinguish.
- **Consequences**:
  - `cli-locked-names.test.ts` + verbs-cli-fixes.test.ts tests 5+6 strengthened.
  - No new dependencies.
  - Future plan v2.x: if a refactor surfaces a case the regex misses, escalate to AST.

## Dependency Graph

```
Phase 0 (Baseline RED) ──▶ Phase 1 (Theme A — correctness) ──▶ Phase 4 (Integration Validation)
                                T1.1 → T1.2 (parallel)
                       ──▶ Phase 2 (Theme B — JSDoc/honesty) ──▶
                                T2.1 → T2.2 → T2.3 → T2.4 (parallel pairs)
                       ──▶ Phase 3 (Theme C — DRY/YAGNI) ──▶
                                T3.1 → T3.2 → T3.3 (sequential)
                                                              │
                                                              ▼
                                                      Phase 5 (CHANGELOG split + ADR amend)
                                                      T5.1 / T5.2 parallel
```

- **Phase 0** writes the RED tests for all 4 themes; tests fail because 10 MAJORs unaddressed.
- **Phase 1** (T1.1 parser fix → T1.2 build hygiene) — closes Theme A.
- **Phase 2** (T2.1 JSDoc + T2.2 widen type + T2.3 @internal tags + T2.4 ADR-0005 sections) — closes Theme B (4 MAJORs).
- **Phase 3** (T3.1 wireMemoryFromPool + T3.2 alias delete + migration + T3.3 sentinel regex) — closes Theme C (3 MAJORs).
- **Phase 5** (T5.1 CHANGELOG split + T5.2 closing CHANGELOG entry) — closes Theme D.
- **Phase 4** is the final validation chain.

---

## Phase 0: Baseline — RED tests for the 4 themes

### T0.1 — Author `tests/integration/cli/verbs-cli-fixes-cycle-2.test.ts` (RED, 8 assertions post-EC-1+EC-2 absorption)

#### Objective

Lock the post-implementation behavioral contract for the 10 MAJORs: strict numeric coercion + dist hygiene + regex-pinned locked-names sentinel.

#### Files to edit

```
tests/integration/cli/verbs-cli-fixes-cycle-2.test.ts (NEW) — 6 RED assertions per § TDD
```

#### Tasks

1. Create the test file.
2. Run `npx vitest run --config vitest.integration.config.ts tests/integration/cli/verbs-cli-fixes-cycle-2.test.ts` — confirm 6 FAIL (RED).

#### TDD

```
RED: test_1_top_k_decimal_input_exits_2() — Theme A.1 / D1
     — `themory recall 'q' --user u --top-k 5.7` exits 2; stderr matches
     /Invalid --top-k.*5\.7.*integer/. Pre-fix passes silently with topK=5.

RED: test_2_top_k_trailing_garbage_exits_2() — Theme A.1 / D1
     — `themory recall 'q' --user u --top-k 5abc` exits 2; stderr matches
     /Invalid --top-k.*5abc.*integer/. Pre-fix passes silently with topK=5.

RED: test_3_threshold_decimal_trailing_garbage_exits_2() — Theme A.1 / D1
     — `themory recall 'q' --user u --threshold 0.5abc` exits 2. Pre-fix
     passes silently with threshold=0.5.

RED: test_4_threshold_non_numeric_exits_2() — Theme A.1 / D1
     — `themory recall 'q' --user u --threshold abc` exits 2. Already
     fails pre-fix via NaN catch, but locks the contract.

RED: test_5_dist_clean_after_build_no_cli_memory_factory_js() — Theme A.2 / D2
     — readFileSync(package.json) parses; existsSync(dist/agent-tools/
     cli-memory-factory.js) === false. Pre-fix the file persists from
     prior build.

RED: test_6_locked_names_sentinel_pinned_to_command_registration() — Theme C.3 / D6
     — cli.ts source: every locked flag string MUST match
     /\.option\(\s*['"]--flag[\s'"<]/ (boundary char required per EC-4).
     Verb names MUST match /\.command\(\s*['"]verb-pattern/. Pre-fix
     substring grep would incorrectly accept a flag literal inside a
     comment OR inside parseIntInRange('--top-k',...) factory invocation.

RED: test_7_top_k_empty_string_exits_2() — EC-1 absorption / Theme A.1 / D1
     — `themory recall 'q' --user u --top-k ''` exits 2. Pre-fix
     `Number('') === 0` would silently pass range check for --threshold
     and only fail at --top-k due to range floor.

RED: test_8_top_k_hex_input_exits_2() — EC-2 absorption / Theme A.1 / D1
     — `themory recall 'q' --user u --top-k 0x1F` exits 2. Pre-fix
     `Number('0x1F') === 31` would silently pass range check for --top-k.
     Regex /^-?\d+$/ in ADR D1 rejects hex notation.
```

#### Acceptance Criteria

- [ ] All 6 RED tests FAIL pre-fix
- [ ] Test file under 200 LoC
- [ ] Pass: lint, typecheck

#### DoD

- [ ] File created at `tests/integration/cli/verbs-cli-fixes-cycle-2.test.ts`
- [ ] 6 tests FAIL (RED locked)

---

## Phase 1: Theme A — Correctness regressions

### T1.1 — Parser strict-coercion (M4) per ADR D1

#### Files to edit

```
src/agent-tools/cli.ts — parseIntInRange + parseFloatInRange bodies
src/agent-tools/__tests__/cli.test.ts (NEW or extend) — 4 contract tests for the strict-coercion paths
```

#### Tasks

1. Replace `Number.parseInt(raw, 10)` → `Number(raw)` in `parseIntInRange` body.
2. Replace `Number.parseFloat(raw)` → `Number(raw)` in `parseFloatInRange` body.
3. Verify `Number.isInteger(n)` catches decimal (`5.7` fails); `Number.isFinite(n)` catches NaN (`5abc` → NaN fails).
4. Add 4 contract tests at `src/agent-tools/__tests__/cli.test.ts` (NEW file if needed) for the bare factory function (decimal int / garbage int / decimal garbage / non-numeric float).
5. Re-run `npx vitest run --config vitest.integration.config.ts tests/integration/cli/verbs-cli-fixes-cycle-2.test.ts -t "test_[1234]"` → 4 GREEN.

#### TDD

```
RED: parseIntInRange('5.7') throws InvalidArgumentError matching /5\.7.*integer/
RED: parseIntInRange('5abc') throws InvalidArgumentError matching /5abc.*integer/
RED: parseFloatInRange('0.5abc') throws InvalidArgumentError matching /0\.5abc.*float/
RED: parseFloatInRange('abc') throws InvalidArgumentError matching /abc.*float/
GREEN: T1.1 body change per § Tasks
```

### T1.2 — `prebuild:clean` + sentinel extension (M5) per ADR D2

#### Files to edit

```
package.json — add prebuild:clean script + chain into build
tests/integration/cli/verbs-cli-fixes-cycle-2.test.ts — verify test 5 GREEN after build
```

#### Tasks

1. Add `"prebuild:clean": "node -e \"const{rmSync}=require('node:fs');rmSync('dist',{recursive:true,force:true});\""` to `scripts`.
2. Update `"build": "npm run prebuild:clean && tsc && npm run postbuild:copy-migrations"`.
3. Run `npm run build` empirically — confirm `dist/agent-tools/cli-memory-factory.js` is absent post-build.
4. Re-run test 5 — GREEN.

---

## Phase 2: Theme B — API honesty + JSDoc discipline

### T2.1 — `MemoryConfig.reflectionPolicy` JSDoc (M2)

#### Files to edit

```
src/core/memory-store.ts — extend JSDoc at line 150-151
```

#### Tasks

1. Replace the 1-line JSDoc with the 3-path description from § Sub-goal 3 (omitted / explicit undefined / explicit policy).
2. Add `@see` cross-refs: ADR-0005 § Supplementary amendment v1.1 + `factory.test.ts` EC-2 paths.

### T2.2 — Widen `MemoryConfig.reflectionPolicy` type (M8) per ADR D3

#### Files to edit

```
src/core/memory-store.ts — widen type to `?: ReflectionPolicy | undefined`
src/local/__tests__/factory.test.ts — drop `as unknown as ...` cast in EC-2 path (b)
src/core/__tests__/memory/reflect.test.ts — drop cast at line ~62
CHANGELOG.md [Unreleased] — `### Changed` entry
```

#### Tasks

1. At `src/core/memory-store.ts:151`, change `readonly reflectionPolicy?: ReflectionPolicy;` → `readonly reflectionPolicy?: ReflectionPolicy | undefined;`.
2. Drop the cast in `factory.test.ts` path (b) test; simplify to plain object literal.
3. Drop the cast in `reflect.test.ts` first test; simplify to plain object literal.
4. Run `npm run typecheck` — 0 errors expected.

### T2.3 — `@internal` tags on 6 new exports (M9)

#### Files to edit

```
src/agent-tools/agent-tools-memory.ts — 5 export sites + 1 new (wireMemoryFromPool from T3.1)
src/agent-tools/cli-scope.ts — validateScopeOpts export site
```

#### Tasks

1. Add `@internal Shared boundary helper for agent-tools subpath. NOT part of the public @usetheo/memory/agent-tools API surface.` JSDoc tag to: `assertEnvOrExit`, `PG_URI_ENV_SPEC`, `OPENAI_API_KEY_ENV_SPEC`, `createAgentToolsMemory`, `wireMemoryFromPool` (new from T3.1), `validateScopeOpts`. (Note: `createCliMemory` alias being deleted by T3.2.)
2. No behavior change; pure JSDoc tagging.

### T2.4 — ADR-0005 § Supplementary amendment structural sections (M11)

#### Files to edit

```
.claude/knowledge-base/adrs/ADR-0005-reflection-trigger.md — extend supplementary amendment
```

#### Tasks

1. Add `### Alternatives considered` table with 3 rejected options (keep v1.0 + default at CLI only + widen type which is now D3 choice).
2. Add explicit `### Decision` heading separating discussion from ruling.
3. Add `### Reversibility` note (low — reverting widens-back would be BREAKING for v1.1 default-on consumers).

---

## Phase 3: Theme C — DRY/YAGNI hygiene

### T3.1 — Extract `wireMemoryFromPool(pool)` helper (M1) per ADR D4

#### Files to edit

```
src/agent-tools/agent-tools-memory.ts — NEW wireMemoryFromPool export + createAgentToolsMemory refactor
src/agent-tools/run-mcp-server.ts — replace inline createLocalMemory with wireMemoryFromPool call
src/agent-tools/run-server.ts — replace inline createLocalMemory with wireMemoryFromPool call (inside warm Promise)
```

#### Tasks

1. Define `export async function wireMemoryFromPool(pool: Pool): Promise<Memory>` at `agent-tools-memory.ts` containing the `createLocalMemory({ vectorStore + embedder + llm + embeddingDim })` body. Tag `@internal` per T2.3.
2. `createAgentToolsMemory()` refactors to: `assertEnvOrExit + new Pool + runMigrations + wireMemoryFromPool(pool) + dispose closure`.
3. `run-mcp-server.ts:114-119` replaces inline createLocalMemory with `const memory = await wireMemoryFromPool(pool);`.
4. `run-server.ts:128-134` replaces inline createLocalMemory INSIDE the warm Promise: `memory = await wireMemoryFromPool(pool);`.
5. Re-run real-tree integration suite (28/28 PASS expected to hold).
6. **EC-3 absorption**: add 1 contract test `test_wireMemoryFromPool_does_not_close_pool` at `src/agent-tools/__tests__/agent-tools-memory.test.ts` (NEW or extend) asserting that `await wireMemoryFromPool(pool); await pool.query('SELECT 1');` succeeds (pool stays open; caller owns lifecycle). Pins the contract via test rather than via comment-only convention.

### T3.2 — Delete `createCliMemory` alias + migrate 4 verb handlers (M3) per ADR D5

#### Files to edit

```
src/agent-tools/agent-tools-memory.ts — DELETE createCliMemory alias line
src/agent-tools/run-remember.ts — import { createAgentToolsMemory }
src/agent-tools/run-recall.ts — import { createAgentToolsMemory }
src/agent-tools/run-forget.ts — import { createAgentToolsMemory }
src/agent-tools/run-reflect.ts — import { createAgentToolsMemory }
```

#### Tasks

1. In each of the 4 verb handlers: rename `import { createCliMemory }` → `import { createAgentToolsMemory }` AND the call site `createCliMemory()` → `createAgentToolsMemory()`.
2. Delete the `export const createCliMemory = createAgentToolsMemory;` line from `agent-tools-memory.ts`.
3. Run `npm run typecheck + npm test` — expect 0 regressions.

### T3.3 — Regex-pinned locked-names sentinels (M6) per ADR D6

#### Files to edit

```
src/__tests__/cli-locked-names.test.ts — replace .toContain with .toMatch + regex
tests/integration/cli/verbs-cli-fixes.test.ts — replace test 5 + test 6 same pattern
```

#### Tasks

1. In `cli-locked-names.test.ts`, for each LOCKED_VERB use a hand-authored regex pinning each verb pattern to `.command(`. Example: `/\.command\(\s*['"]remember <text>['"]\)/`.
2. For LOCKED_FLAGS, each regex MUST include a BOUNDARY CHARACTER after the flag name (EC-4 absorption — without boundary char, `/--user/` matches `--user-name` falsely). Example: `/\.option\(\s*['"]--user[\s'"<]/` (matches `--user `, `--user <id>`, `--user"`, but NOT `--user-name`). Hand-author all 9 patterns this way.
3. Same updates in `verbs-cli-fixes.test.ts` tests 5+6.
4. Re-run sentinel tests — GREEN expected.

---

## Phase 5: Theme D — CHANGELOG split

### T5.1 — Split fix-cycle-1 CHANGELOG entry per Keep-a-Changelog (M10)

#### Files to edit

```
CHANGELOG.md [Unreleased] — split mega-bullet into ### Added / ### Changed / ### Removed
```

#### Tasks

1. Move the fix-cycle-1 mega-bullet content into properly-categorized sub-bullets:
   - `### Added`: assertEnvOrExit + ENV_SPEC constants + validateScopeOpts + README CLI verbs section.
   - `### Changed`: createLocalMemory default reflectionPolicy (ADR-0005 v1.1 supplementary); CLI reflect emits raw ReflectionResult.
   - `### Removed`: CliReflectResult interface from cli-output.ts.
2. Each bullet ≤ 1 line per CLAUDE.md § 6.

### T5.2 — Append fix-cycle-2 CHANGELOG entry under proper sections

#### Files to edit

```
CHANGELOG.md [Unreleased] — append fix-cycle-2 entries per Keep-a-Changelog
```

#### Tasks

1. `### Added`: 4 RED tests + wireMemoryFromPool helper.
2. `### Changed`: parseIntInRange/parseFloatInRange strict-coercion (Number() + isInteger/isFinite); MemoryConfig.reflectionPolicy type widened; createAgentToolsMemory refactored.
3. `### Fixed`: silent parseInt/parseFloat truncation across 5 validators; stale dist/cli-memory-factory.js shipped in pack manifest.
4. `### Removed`: createCliMemory backward-compat alias.

---

## Phase 4: Integration validation + cycle close

### T4.1 — Full validation chain + real-tree integration + re-run `/review`

#### Tasks

1. `npm run build` (now with `prebuild:clean`)
2. `npm test` — expect **≥ 1073 PASS** (1069 baseline + 4 NEW T1.1 contract tests; T0.1 6 integration tests counted separately under integration tier)
3. `npm run typecheck` — 0 errors
4. `npm run lint` — 0 warnings
5. `npx vitest run --config vitest.integration.config.ts tests/integration/cli/` — **34 PASS** (19 parent + 9 fix-cycle-1 + 6 fix-cycle-2)
6. Real-tree integration with env vars (per user directive): `OPENAI_API_KEY=... THEOMEM_PG_URI=... npx vitest run --config vitest.integration.config.ts tests/integration/cli/` — expect 34/34 PASS
7. `npm pack --dry-run` — confirm ZERO `cli-memory-factory.js` entry
8. CHANGELOG amended (T5.1 + T5.2)
9. Re-invoke `/review verbs-as-cli-fixes-cycle-2` — expected READY_TO_MERGE
10. Write `/implement-validate` synthetic report

#### Acceptance Criteria

- [ ] All test suites GREEN
- [ ] Real-tree integration cli/ 34/34 PASS with env vars
- [ ] Zero TS errors, zero lint warnings
- [ ] `dist/agent-tools/cli-memory-factory.js` ABSENT post-build
- [ ] CHANGELOG entry split per Keep-a-Changelog
- [ ] `/review` verdict: READY_TO_MERGE (0 BLOCKER, 0 CRITICAL, 0 MAJOR)

---

## Coverage Matrix

| # | Gap / Finding | Task(s) | Resolution |
|---|---|---|---|
| 1 | M1 MAJOR — ADR D3 Tasks 5+6 not executed | T3.1, ADR D4 | Extract wireMemoryFromPool helper called by 3 sites |
| 2 | M2 MAJOR — MemoryConfig.reflectionPolicy JSDoc stale | T2.1 | Extend JSDoc with 3 paths + @see ADR-0005 |
| 3 | M3 MAJOR — createCliMemory alias zero consumers | T3.2, ADR D5 | DELETE alias + migrate 4 verb handlers |
| 4 | M4 MAJOR — parseInt/parseFloat silent coercion | T1.1, ADR D1 | Number() + isInteger/isFinite + 4 RED tests |
| 5 | M5 MAJOR — stale dist/cli-memory-factory.js | T1.2, ADR D2 | prebuild:clean + extended sentinel |
| 6 | M6 MAJOR — locked-names substring grep | T3.3, ADR D6 | Regex-pinned to .command(/.option( call sites |
| 7 | M8 MAJOR — typed-unreachable opt-in | T2.2, ADR D3 | Widen reflectionPolicy?: ReflectionPolicy \| undefined |
| 8 | M9 MAJOR — exports without @internal | T2.3 | Tag 6 exports + JSDoc disclosure |
| 9 | M10 MAJOR — CHANGELOG mega-bullet | T5.1 | Split into ### Added / ### Changed / ### Removed |
| 10 | M11 MAJOR — ADR-0005 missing structural sections | T2.4 | Add Alternatives + Decision + Reversibility |
| 11 | T0.1 RED gate for the 4 themes | T0.1 | 6 NEW RED tests in verbs-cli-fixes-cycle-2.test.ts |
| 12 | Integration validation | T4.1 | Full chain + real-tree 34/34 PASS + /review re-run |

**Coverage: 12/12 (100%)** — All 10 MAJORs covered + RED gate task + final validation.

## Global Definition of Done

- [ ] All 5 phases completed (0 + 1 + 2 + 3 + 5 + 4-validation)
- [ ] All tests passing — `npm test` green (≥ 1073 PASS)
- [ ] Zero TypeScript errors
- [ ] Zero lint warnings
- [ ] File-size budget respected (per `.claude/rules/architecture.md § Module hygiene`)
- [ ] `dist/agent-tools/cli-memory-factory.js` ABSENT post-build (M5 closure)
- [ ] CHANGELOG.md `[Unreleased]` properly categorized (M10 closure)
- [ ] ADR-0005 supplementary amendment has Alternatives + Decision + Reversibility sections (M11 closure)
- [ ] `createCliMemory` alias deleted; 4 verb handlers use `createAgentToolsMemory` directly (M3 closure)
- [ ] `/review verbs-as-cli-fixes-cycle-2` returns **READY_TO_MERGE** (0 BLOCKER, 0 CRITICAL, 0 MAJOR)
- [ ] Real-tree integration 34/34 PASS with env vars
- [ ] **Plan archived** — after `/review` returns READY_TO_MERGE AND PR merged to main

## Final Phase: Integration Validation (MANDATORY)

```bash
npm run build && npm test && npx vitest run --config vitest.integration.config.ts tests/integration/cli/
npm run typecheck && npm run lint
# Real-tree (user directive):
OPENAI_API_KEY=... THEOMEM_PG_URI=... npx vitest run --config vitest.integration.config.ts tests/integration/cli/
# Pack manifest:
npm pack --dry-run | grep cli-memory-factory && echo "FAIL — stale artifact" || echo "PASS — clean"
```

### Acceptance Criteria

- [ ] All test suites green
- [ ] Real-tree 34/34 PASS
- [ ] Zero TS errors, zero lint warnings
- [ ] `npm pack --dry-run` shows ZERO `cli-memory-factory.js` entry
- [ ] `/review` verdict: READY_TO_MERGE

## Documented risks (v1.1 absorptions per `/edge-case-plan` DOCUMENT items)

**EC-6 — `rmSync('dist', { force: true })` Windows EBUSY**: On Windows, if a running `themory server`/`themory mcp` process holds a file handle on something inside `dist/`, `rmSync` fails with `EBUSY` even with `force: true`. Linux/macOS don't have this constraint (Unix file deletion is decoupled from handle lifecycle). Acceptable per project's dev-tier expectations (PRIORITY 0 freeze tolerates dev-tier rough edges). T1.2 implementation comment surfaces the constraint.

**EC-7 — Type widening cascades to `CloudMemoryConfig extends MemoryConfig`**: ADR D3 widens `MemoryConfig.reflectionPolicy?: ReflectionPolicy | undefined`. `CloudMemoryConfig extends MemoryConfig` inherits the widening. Cloud runtime is pre-release (Roadmap Item 7 BLOCKED on Theo PaaS GA) — zero shipped consumers. Acceptable; CHANGELOG `### Changed` entry mentions the cascade for completeness. No code path is affected today; the cascade is purely typedef-level.

**EC-8 — `@internal` JSDoc tag is advisory without api-extractor / tsc-bundle**: T2.3 tags 6 exports with `@internal`. By default, `tsc` emits the `.d.ts` containing all `export`-keyword declarations regardless of `@internal`. Strict public/internal enforcement requires either api-extractor configuration OR a separate tsc bundle that strips `@internal` types. Per PRIORITY 0 sub-goal 1 ("APIs corretas — every export documented"), the @internal tag IS documentation (consumers reading TypeDoc see the tag). Full enforcement deferred to v1.0 contract-freeze cycle via follow-up plan slug `api-extractor-internal-stripping`.

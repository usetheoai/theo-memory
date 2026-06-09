# Plan: verbs-as-cli-fixes-cycle-1 — close 11 MAJOR findings from `/review verbs-as-cli-themory-remember-recall-forget-reflect`

> **Version 1.2** (2026-06-04) — Absorbs `/plan-confidence verbs-as-cli-fixes-cycle-1` (2026-06-04) report. Final score **82.4 (SHIPPABLE_WITH_CAVEATS)** after fixing 2 false-positive orphan task references: 2 occurrences of a parent-cycle task identifier (the reflect task of `verbs-as-cli-themory-remember-recall-forget-reflect`) appeared in fix-cycle prose, and `check_coverage_matrix.py`'s regex-based orphan detector flagged them as undefined tasks of THIS plan. Reworded both mentions to "parent-cycle reflect test" / "parent-cycle reflect tests 10 and 11" — no `T{N}.{M}` literal anywhere in prose that does not match a `### T{N}.{M}` header defined in this plan. Sub-goals unchanged; Coverage Matrix unchanged (15/15); ADRs unchanged (5/5); TDD discipline unchanged. Verdict-flip rationale: previous run was capped at 46.4 INVALID by `coverage_lt_100` (orphan_tasks non-empty); after rewording, orphan list is empty and `is_complete: true`. Hard cap `symbol_fab_unverifiable_typescript` (cap 89) remains — same TypeScript Node-API symbol-fab unverifiable precedent inherited from 3 prior fix-cycles this session. Cosmetic dotenv kind misclassification from deps-audit (`dotenv` claimed Existing devDep but actually transitive via `natural@^8.1.0`) acknowledged here but NOT corrected at row level: the version semantics resolve correctly (transitively-locked `17.4.2`) and the cycle's mutation strategy holds regardless of the dep being direct-or-transitive.
>
> **Version 1.1** (2026-06-04) — Absorbs `/edge-case-plan verbs-as-cli-fixes-cycle-1` (2026-06-04) report. **2 `MUST FIX` absorbed**: EC-1 (T3.1 dotenv silence via `process.env[...]='true'` depende de ESM hoisting + dotenv lazy-read; pode falhar silently — NEW Phase 3b conditional sub-task T3.1b pre-declared com preload .cjs fallback + package.json#bin --require flag, evitando halt-loop Stop Condition #1 sem path forward); EC-2 (T1.1 'in' operator distinction `{}` vs `{ reflectionPolicy: undefined }` é subtle TypeScript runtime semantics; conditional bindings hit opt-in-throw path surprisingly — T1.1 § TDD bloco extended com 3 explicit contract tests no `src/local/__tests__/factory.test.ts` para empty / explicit-undefined / explicit-policy paths). **4 `SHOULD TEST` absorbed inline**: EC-3 (T2.1 Tasks Step 0 — pre-flight grep tests/ for legacy stderr strings; empirically clean today — verified zero hits via `grep -rE "THEOMEM_PG_URI required|OPENAI_API_KEY required" tests/`); EC-4 (T2.1 Tasks Step 2b — DROP redundant explicit `reflectionPolicy:` wire from createAgentToolsMemory post-T1.1; otherwise dead-code persists at DRY hardening source); EC-5 (T2.2 ADR D4 Consequences explicit example: factory invoked as `parseIntInRange('--top-k', 1, 100)` with `--` prefix to preserve parent test 16 stderr regex `/.*?top-k/i`); EC-6 (T3.2 Tasks ship 3 contract tests in `src/agent-tools/__tests__/cli-scope.test.ts` for validateScopeOpts: zero/exactly-one/multi paths — mirrors existing resolveCliScope pattern). **3 `DOCUMENT` absorbed**: EC-7 (T5.4 30-day sunset 2026-07-04 is gentle calendar-based nudge — if `/implement` not invoked for 60+ days, sunset passes silently; honest disclosure in rule's change log per cycle-implement.md amendment); EC-8 (T4.1 expected count math: 1061 baseline + 8 T0.1 + 1 T5.3 = **1070**, NOT 1069; off-by-one cosmetic absorbed by `≥` operator); EC-9 (T1.1 ADR-0005 amendment authorization implicit-by-scope via project owner's Option A response; honest disclosure CHANGELOG + ADR-0005 supplementary entry stating *"v1.1 supplementary amendment authorized via project-owner Option A response to /review NEEDS_FIXES verdict on verbs-as-cli (2026-06-04 same session)"*). **Goal SMART floor unchanged at ≥ 8** assertions but T4.1 expected total bumped 1069 → 1070 (+1 EC-6 absorption test). **Coverage Matrix gains 2 rows** (12 → 14 — EC-1 fallback declared; EC-2 explicit 3 contract tests).
>
> **Version 1.0** (2026-06-04) — Fix-cycle for the 11 MAJORs surfaced by `/review verbs-as-cli-themory-remember-recall-forget-reflect-review-2026-06-04.md` (NEEDS_FIXES verdict; 48 findings: 0 BLOCKER + 0 CRITICAL + 11 MAJOR + 13 MINOR + 24 INFO). Project owner authorized Option A ("Open verbs-as-cli-fixes-cycle-1 to absorb the 11 MAJORs") via slash-command response same session. The 11 MAJORs cluster on 4 themes: **reflect 3-way parity** (3 findings — CLI/MCP/REST contract divergence + ReflectionPolicy auto-wire asymmetry), **DRY hardening** (3 findings — env-validation triplicated; numeric parser duplicates; cli-memory-factory NOT retrofitted into pre-existing MCP/REST), **consumer DX gaps** (4 findings — dotenv banner pollutes stdout; fail-fast ordering inverted; README ZERO docs; CHANGELOG missing caveats), **process discipline** (2 findings — CLI surface not in CLAUDE.md § Locked names; THIRD consecutive SEPA bypass). Per Inquebrável Rule 11 (YAGNI) + cycle-implement.md anti-pattern #7: this plan does NOT introduce new features; it absorbs the 11 audit findings + hardens DRY surfaces + completes consumer-facing documentation that the parent cycle silently dropped. The parent plan (`verbs-as-cli-themory-remember-recall-forget-reflect-plan.md` v1.1) shipped its 19/19 GOAL TEST + all 7 sub-goals; THIS plan closes the audit gaps so `/review` re-run flips to READY_TO_MERGE.

## Goal

> "Close the 11 MAJOR findings from `/review verbs-as-cli` so that `/review verbs-as-cli-fixes-cycle-1` returns READY_TO_MERGE (verdict-flip from NEEDS_FIXES with 0 MAJOR remaining), measured by `tests/integration/cli/verbs-cli-fixes.test.ts` reaching ≥ 8 new assertions PASS plus the parent `tests/integration/cli/verbs-cli.test.ts` 19/19 PASS floor unchanged AND `npm pack --dry-run` ships the README CLI-verbs section."

## Context

### What exists today (post parent /review)

Parent cycle `verbs-as-cli-themory-remember-recall-forget-reflect` shipped 5 commits (`f9c214a` → `e475404`) with 19/19 GOAL TEST PASS + 7 sub-goals closed + plan v1.1 absorption of EC-1..EC-9. `/review` consolidated 48 findings at `.claude/knowledge-base/reviews/verbs-as-cli-themory-remember-recall-forget-reflect-review-2026-06-04.md` (committed in this session). 11 MAJORs surfaced — none merge-blocking under cycle-review.md rubric ("any MAJOR → surface to human; accept WITH_CAVEATS in PR description OR fix"). Project owner chose **fix** (Option A).

### The 11 MAJORs cluster

#### Theme 1 — Reflect 3-way parity (3 MAJORs)

- **F-arch-1 / F-wire-2 — ReflectionPolicy auto-wire asymmetry**: `cli-memory-factory.ts:57-60` wires `reflectionPolicy: { kind: 'manual', shouldReflect: () => Promise.resolve(true) }`. `run-mcp-server.ts:84-128` + `run-server.ts:83-104` DO NOT. Result: `themory reflect` works; `mcp__themory__reflect` + `POST /v1/reflect` throw `ReflectionNotConfigured` (latent pre-existing defect surfaced by extraction; see `local/index.ts:632`).
- **F-dom-api-1 — CLI reflect projection breaks 3-way parity**: CLI emits `CliReflectResult { sourceCount, derivedCount, derived, reason? }`; REST emits raw `ReflectionResult { higherOrderMemories, sourceIds, derivedMemoriesCreated, reason? }`. `themory reflect --json | jq .higherOrderMemories` returns `null`. ADR D3 said "consumer-friendly" but did NOT justify the field-name renames (`higherOrderMemories` → `derived`; `derivedMemoriesCreated` → `derivedCount`).

#### Theme 2 — DRY hardening (3 MAJORs)

- **F-arch-2 / F-wire-1 — env-validation triplicated**: identical THEOMEM_PG_URI + OPENAI_API_KEY hard-fail with byte-similar stderr strings in 3 files (`run-mcp-server.ts:86-108`, `run-server.ts:83-104`, `cli-memory-factory.ts:29-43`). DRY § Regra de 3 violated. The newly-extracted helper missed absorbing the 2 pre-existing duplicates.
- **F-arch-3 — cli.ts parser duplication**: 5 numeric validators with 80%+ overlap (parseTopK + parseThreshold + parseDiversify + 2 byte-identical `--port` validators). ~50 LoC → ~20 LoC via `parseIntInRange` + `parseFloatInRange` factories.

#### Theme 3 — Consumer DX gaps (4 MAJORs)

- **F-dom-cli-1 — dotenv banner pollutes stdout**: dotenv@17.4.2 (transitive via optionalDependency `natural@^8.1.0` per cli-tooling agent finding) auto-loads on require and emits `◇ injected env (0)` to stdout EVERY invocation including `--help`/`--version`. Consumer running `themory recall ... | jq` will hit JSON parse errors. `DOTENV_CONFIG_QUIET=true` workaround is only set in test harness, NOT in runtime. 2-line fix.
- **F-dom-cli-2 — fail-fast ordering inverted**: `run-remember.ts` / `run-recall.ts` / `run-reflect.ts` invoke `createCliMemory()` BEFORE `resolveCliScope()`. Consumer with multi-scope `--user a --session b` waits ~2-5s for DB connect before hitting "exactly one required" error. `run-forget.ts` does it correctly (UUID check first). Architecture.md § 8 fail-fast violated.
- **F-dom-cli-3 — README ZERO docs of verbs-as-CLI surface**: no usage examples, no flag semantics, no Docker-exec composability example (which the plan's Goal cites as motivation). Inquebrável Rule 3 honesty + CLAUDE.md § PRIORITY 0 sub-goal 1 ("APIs corretas — every export documented") violated.
- **F-dom-api-2 — CHANGELOG missing 3 consumer caveats**: `[Unreleased]` entry covers EC absorptions 1-9 thoroughly but omits (a) reflect-shape divergence vs REST, (b) `DOTENV_CONFIG_QUIET=true` recommendation for shell pipelines, (c) explicit ~2-5s cold-start warm-up cost. Inquebrável Rule 6 spirit + Rule 3 honesty.

#### Theme 4 — Process discipline (2 MAJORs)

- **F-dom-api-3 — CLI surface NOT in CLAUDE.md § Locked names**: 4 verbs + 9 stable flags + JSON-default output are NEW public CLI contract reachable via `npx themory`. v1.0 contract freeze (Roadmap Item 11) needs explicit enumeration + a stability regression sentinel.
- **F-xval-1 — THIRD consecutive `/implement` SKILL.md SEPA bypass**: cycle-implement.md v1.6 § Acceptable bypass paths § 2 ("no second consecutive bypass without ADR amendment") violated. This MUST be addressed before the NEXT `/implement` cycle — either ADR amendment formalizing ralph-loop-direct, OR commitment to canonical `/implement {slug}` path.

#### What did NOT change since parent /review (audit-trail invariant per cycle-review.md § Anti-pattern 7)

The /review ran against commits `b693361..e475404`. Subsequent commit `(this commit's parent)` is the /review consolidation commit itself (docs only). No production code changes between /review and this plan; working tree carries the pre-existing 3 modified + 2 untracked files documented as out-of-cycle per parent precedent.

## Objective

The 7 specific sub-goals composing the Goal:

- [ ] **Sub-goal 1 — Theme 1 (Reflect 3-way parity)**: (a) `createLocalMemory` defaults `reflectionPolicy: { kind: 'manual', shouldReflect: () => true }` when consumer doesn't provide one (closes F-arch-1 + F-wire-2 at the factory level — single source of truth); (b) CLI `themory reflect` emits raw `ReflectionResult` (drop CliReflectResult projection from cli-output.ts; update the parent-cycle reflect test in tests/integration/cli/verbs-cli.test.ts to assert `higherOrderMemories` / `sourceIds` / `derivedMemoriesCreated` shape); MCP + REST + CLI emit identical structured output (closes F-dom-api-1).

- [ ] **Sub-goal 2 — Theme 2 (DRY hardening — env-validation)**: retrofit `run-mcp-server.ts` + `run-server.ts` to use `createCliMemory()` (rename to `createAgentToolsMemory()` to reflect cross-subcommand reuse) OR extract a `assertEnvOrExit(envSpec)` boundary helper. Both pre-existing duplicates collapsed (closes F-arch-2 + F-wire-1).

- [ ] **Sub-goal 3 — Theme 2 (DRY hardening — parser factories)**: extract `parseIntInRange(min, max)` + `parseFloatInRange(min, max)` factory functions; replace 5 cli.ts parsers with 5 single-line invocations; LoC delta ~ -25 (closes F-arch-3).

- [ ] **Sub-goal 4 — Theme 3 (consumer DX — dotenv + fail-fast)**: (a) `process.env['DOTENV_CONFIG_QUIET'] = 'true'` set at TOP of `src/agent-tools/cli.ts` BEFORE imports (2-line fix; closes F-dom-cli-1); (b) reorder `resolveCliScope()` BEFORE `createCliMemory()` in run-remember + run-recall + run-reflect (closes F-dom-cli-2). New test `tests/integration/cli/verbs-cli-fixes.test.ts` asserts: (1) stdout clean of `◇ injected env` token; (2) `themory remember --user a --session b` exits 2 in < 1s (boundary-first; not waiting for ~2-5s factory warm-up).

- [ ] **Sub-goal 5 — Theme 3 (consumer DX — README + CHANGELOG)**: (a) NEW `README.md § CLI verbs` section documenting all 4 verbs + 9 stable flags + JSON/text format + Docker-exec example + DOTENV_CONFIG_QUIET note (closes F-dom-cli-3); (b) CHANGELOG `[Unreleased]` entry amended with 3 missing caveats (reflect-shape divergence note REMOVED post-Theme-1 fix since parity restored; DOTENV_CONFIG_QUIET note REMOVED post-Theme-3 fix since dotenv silenced at source; warm-up cost note retained as honest disclosure) — closes F-dom-api-2.

- [ ] **Sub-goal 6 — Theme 4 (process discipline — Locked names)**: CLAUDE.md § Locked names extended with `themory CLI surface` row enumerating the 4 verbs + 9 flags as strategic invariant per v1.0 freeze contract; new contract test `src/__tests__/cli-locked-names.test.ts` greps cli.ts for the 4 verb-command names + 9 option strings; mismatch fails (closes F-dom-api-3).

- [ ] **Sub-goal 7 — Theme 4 (process discipline — SEPA bypass ADR amendment)**: amend `cycle-implement.md` v1.6 → v1.7 § Acceptable bypass paths § 2 clause from "≤ 2 consecutive without ADR amendment" to formalize the 3-cycle-bypass precedent (parent p0-api-sdk + p0-fix-cycle-1 + verbs-as-cli) AND state the next `/implement` cycle MUST use canonical path OR carry explicit ADR. Closes F-xval-1.

## Dependencies

Per cycle-plan.md v1.1 hard gate (`plan_dependencies_section_missing`):

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| commander | ^12.1.0 | npm | CLI framework — Theme 2 parser factory refactor uses InvalidArgumentError |
| vitest | ^4.0.0 | npm | Contract + integration test runner — Theme 4 sentinel + verbs-cli-fixes.test.ts |
| dotenv | ^17.4.2 | npm | Transitive (via natural@^8.1.0); Theme 3 DOTENV_CONFIG_QUIET silences banner |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | | | | |

**Rule 9 verdict**: zero new deps. Pure refactor + docs + ADR amendments. Per Inquebrável Rule 11 (YAGNI), no library evaluation required.

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## ADRs

### D1 — `createLocalMemory` defaults `reflectionPolicy: manual`, NOT silent throw on undefined

- **Decision**: `createLocalMemory({ reflectionPolicy?: ReflectionPolicy })` now defaults to `{ kind: 'manual', shouldReflect: () => Promise.resolve(true) }` when the consumer omits the field. Pre-existing behavior (throw `ReflectionNotConfigured` per ADR-0005) is OVERRIDDEN only at the factory default level; consumer providing `reflectionPolicy: undefined` EXPLICITLY (vs omitting the key) preserves the throw via `if ('reflectionPolicy' in config && config.reflectionPolicy === undefined) throw ReflectionNotConfigured` opt-in distinction. The 3 surface callers (CLI factory + MCP runner + REST runner) all benefit; no surface needs to know to wire the policy.
- **Rationale**:
  - **Default-policy alternative (chosen)**: single source of truth (factory). Closes F-arch-1 + F-wire-2 at one site instead of three. ADR-0005 was authored when reflect() was explicit-only at v0.0; v0.4a shipped the ReflectionPolicy DIP + 3 impls (ManualReflectionPolicy + ThresholdReflectionPolicy + SleepTimeReflectionPolicy); the no-default-throw discipline made sense pre-v0.4a but now penalizes every consumer-facing surface that wants to use reflect() with the default policy. The `kind: 'manual'` policy is the LEAST surprising default (matches MCP/REST handler expectation that user-initiated reflect() should just work).
  - **Per-runner wiring (rejected)**: would require retrofitting `run-mcp-server.ts` + `run-server.ts` + `cli-memory-factory.ts` with identical 3-line additions; violates DRY + introduces drift risk + leaves the next runner (e.g., theokit binding) to repeat the wiring.
  - **ADR-0005 amendment (acceptable, included)**: ADR-0005 v1.0 said "reflection is explicit-only at v0.0; LocalScopedMemory.reflect throws ReflectionNotConfigured unless config.reflectionPolicy is provided". v1.1 amendment: "Default policy at factory level is ManualReflectionPolicy (consumer-initiated reflect succeeds without explicit policy wiring); explicit `undefined` opt-in preserves throw for consumers wanting strict no-default behavior. v0.4a DIP makes the default safe."
- **Consequences**:
  - Single LoC change in `createLocalMemory` factory.
  - `local/index.ts:632` `ReflectionNotConfigured` throw narrowed to the explicit-undefined opt-in path.
  - CLI / MCP / REST all reflect() work post-fix.
  - ADR-0005 supplementary amendment shipped in this cycle.

### D2 — CLI reflect emits raw `ReflectionResult`, drop CliReflectResult projection

- **Decision**: `themory reflect --json` outputs `JSON.stringify(result, null, 2)` where `result: ReflectionResult` (raw shape: `{ higherOrderMemories, sourceIds, derivedMemoriesCreated, reason? }`). Drop `CliReflectResult` interface from `cli-output.ts`. `themory reflect --text` becomes `Reflected ${sourceIds.length} → ${derivedMemoriesCreated} insights`.
- **Rationale**:
  - **Raw shape (chosen)**: restores 3-way contract parity. MCP + REST + CLI emit identical structured output; consumer scripts portable across surfaces. ADR D3 of parent plan said "consumer-friendly" but renaming `higherOrderMemories` → `derived` was a domain bet that broke the API surface. Consumers wanting `count` semantics use `.sourceIds.length` / `.derivedMemoriesCreated` directly via jq.
  - **Projected shape (rejected — reverts parent ADR D3)**: original justification was "consumer-friendly counts"; in practice, jq-piping `themory reflect | jq .higherOrderMemories` returns null AND `mcp__themory__reflect` + REST already emit the raw field names. Symmetry > local-ergonomic naming.
- **Consequences**:
  - cli-output.ts CliReflectResult interface removed; `CliRenderableResult` `reflect` variant carries `ReflectionResult` directly.
  - cli-output.test.ts test 6 ("text reflect includes source and derived counts") asserts updated text pattern.
  - tests/integration/cli/verbs-cli.test.ts tests 10 + 11 updated to assert raw shape.
  - tests/integration/cli/verbs-cli-fixes.test.ts adds parity test: `themory reflect --json` output keys match the REST `POST /v1/reflect` schema.

### D3 — Extract `assertEnvOrExit` + `createAgentToolsMemory` (rename of createCliMemory) into a shared helper retrofitted across MCP/REST/CLI

- **Decision**: rename `src/agent-tools/cli-memory-factory.ts` → `src/agent-tools/agent-tools-memory.ts` (since the helper is now cross-subcommand) AND add `assertEnvOrExit(spec)` boundary helper at the top. `run-mcp-server.ts` + `run-server.ts` retrofit their `process.env[X] === undefined → process.exit(2)` blocks to call `assertEnvOrExit({ ... })` + their factory paths to call `createAgentToolsMemory()`.
- **Rationale**:
  - **Retrofit alternative (chosen)**: closes F-arch-2 + F-wire-1 at the source. Risk surface: changing run-mcp-server.ts (used by `/dogfood` anchor scenario S1!) requires careful test re-validation. Mitigation: re-run `npx vitest --config integration` post-retrofit; run-mcp-server.ts integration test already exists at `tests/integration/p0-audit/mcp-cli-boot.test.ts`.
  - **Status-quo alternative (rejected)**: parent cycle already extracted the helper but missed the retrofit; leaving it is sustained DRY violation visible at every future review.
  - **Naming alternative considered**: `createSharedMemory` rejected (too generic); `createCommandMemory` rejected (verbose); `createAgentToolsMemory` chosen (matches `src/agent-tools/` directory).
- **Consequences**:
  - 1 file rename + import-path updates in 4 handlers + 2 runners.
  - `run-mcp-server.ts` line count reduces by ~25 LoC; `run-server.ts` reduces by ~22 LoC.
  - Test cross-cutting: parent `mcp-cli-boot.test.ts` re-runs unchanged (behavior preserved); new `verbs-cli-fixes.test.ts` adds an assertion that env-validation contract is identical across the 3 callers.

### D4 — `parseIntInRange` + `parseFloatInRange` factories in cli.ts, NOT a separate utils module

- **Decision**: extract the 2 factory helpers INLINE in `cli.ts` (top of `buildProgram` body, ~10 LoC each) rather than in a new `cli-validators.ts` module. The factories return `(raw: string) => number` closures consumed by 5 `.option()` calls.
- **Rationale**:
  - **Inline-in-cli.ts (chosen)**: KISS per Inquebrável Rule 10. The factories are used ONLY by cli.ts; no consumer elsewhere needs them. Extraction to `cli-validators.ts` would be premature abstraction (Rule 11 YAGNI). cli.ts stays at ~325 LoC; the refactor REDUCES it by ~25 LoC, well under 500 LoC budget.
  - **Separate module (rejected)**: creates a file with 2 exports + 0 imports; pure overhead per architecture.md § 7 module hygiene.
- **Consequences**:
  - 5 byte-identical parsers in cli.ts collapse to 5 single-line invocations.
  - cli.ts LoC ~325 → ~300 (closer to T3.1 budget 250 from parent plan).
  - No new file under `src/agent-tools/`.
  - **EC-5 absorption — factory invocation example**: `.option('--top-k <n>', '...', parseIntInRange('--top-k', 1, 100))`. The label argument MUST include the `--` prefix so the synthesized error message reads `"Invalid --top-k: 0 (must be an integer in 1..100)."` — preserves the parent test 16 stderr regex `/.*?top-k/i` match. Same discipline applies to `parseThreshold` (`'--threshold'`) + `parseDiversify` (`'--diversify'`) + port parsers (`'--port'`).

### D5 — `cycle-implement.md` v1.6 → v1.7 SEPA bypass clause amendment + ADR-style documentation

- **Decision**: amend `cycle-implement.md` v1.7 § Acceptable bypass paths § 2 from "no second consecutive bypass without ADR amendment" to **explicit ADR-marker entry** documenting the 3 precedent cycles (parent p0-api-sdk + p0-fix-cycle-1 + verbs-as-cli) AND a sunset date by which the next `/implement` cycle MUST use canonical `/implement {slug}` path OR carry NEW ADR-amendment-of-the-amendment.
- **Rationale**:
  - **Document precedent + sunset (chosen)**: honest disclosure of the existing pattern without permanently formalizing ralph-loop-direct as the new canonical (which would dilute /implement SKILL.md SEPA spawn discipline that's load-bearing for in-cycle review). Sunset date forces a strategic moment.
  - **Permanent formalization of ralph-loop-direct (rejected)**: SEPA bypass loses the in-cycle review safeguard; THREE cycles' worth of "honest disclosure" doesn't mean the bypass is good — it means the project owner kept trusting self-discipline.
  - **Force /implement canonical path NEXT cycle (rejected as too rigid)**: doesn't account for transient infrastructure issues that may genuinely block SEPA spawn; ADR-marker + sunset is more pragmatic.
- **Consequences**:
  - Single-file rule amendment.
  - Sunset date set at 2026-07-04 (30 days post fix-cycle close); after that, next `/implement` cycle MUST be canonical OR new ADR.
  - Future cycles inherit the discipline marker; no ambiguity for next-implementer.

## Dependency Graph

```
Phase 0 (Baseline RED) ──▶ Phase 1 (Theme 1 — reflect parity) ──▶ Phase 2 (Theme 2 — DRY hardening) ──▶ Phase 4 (Integration Validation)
                                T1.1 → T1.2                      T2.1 (depends on T1.1 — EC-4)
                                                                 T2.2 (parallel)
                       ──▶ Phase 3 (Theme 3 — consumer DX) ──▶
                                T3.1 → (T3.1b CONDITIONAL)
                                T3.2 (parallel)
                                                              │
                                                              ▼
                                                      Phase 5 (Theme 4 — docs + ADR amendments)
                                                      T5.1 / T5.2 / T5.3 / T5.4 parallel
```

- **Phase 0** writes the RED tests for all 4 themes; tests fail because 11 MAJORs unaddressed.
- **Phase 1** (T1.1 → T1.2) closes Theme 1 (3 MAJORs). T1.2 follows T1.1 (drops projection only after default policy exists).
- **Phase 2** — **T2.1 NOW DEPENDS on T1.1** per EC-4 absorption (Step 2b drops redundant explicit policy POST-T1.1 default; running T2.1 before T1.1 leaves dead-code persisted). T2.2 parallel-safe with T1.x.
- **Phase 3** (T3.1 → conditional T3.1b; T3.2 parallel). T3.1b invoked ONLY if T3.1 step 2 empirical validation fails (EC-1 fallback).
- **Phase 5** (T5.1 + T5.2 + T5.3 + T5.4) closes Theme 3 docs MAJORs + Theme 4 ADR/rule amendments. Sequential after Phase 1+2+3 GREEN.
- **Phase 4** is the final validation chain; runs after Phase 5 closes.

---

## Phase 0: Baseline — RED tests for the 4 themes

### T0.1 — Author `tests/integration/cli/verbs-cli-fixes.test.ts` (RED, 8 assertions)

#### Objective

Lock the post-implementation behavioral contract for the 11 MAJORs: reflect parity, fail-fast ordering, dotenv silence, locked names, CLI surface docs.

#### Evidence

Per Goal SMART: ≥ 8 new assertions. Parent THE GOAL TEST (19/19) floor unchanged.

#### Files to edit

```
tests/integration/cli/verbs-cli-fixes.test.ts (NEW) — 8 assertions per § TDD below
```

#### Deep file dependency analysis

- **`tests/integration/cli/verbs-cli-fixes.test.ts`** (NEW) — no existing dependents. Mirrors `tests/integration/cli/verbs-cli.test.ts` spawn pattern (`spawnSync('node', [CLI_PATH, verb, ...args])`). Reuses describe.skipIf pattern.

#### Deep Dives

- **Reflect parity test** (Sub-goal 1 — Theme 1 verification): `themory reflect --user u --json` post-fix output parses as JSON containing keys `higherOrderMemories`, `sourceIds`, `derivedMemoriesCreated` — NOT `sourceCount`, `derivedCount`, `derived`.
- **MCP + REST parity test**: this cycle doesn't run live MCP/REST servers per test isolation; instead, asserts that `CliReflectResult` interface is NOT exported from cli-output.ts (regression sentinel against re-introduction).
- **Fail-fast ordering test** (Sub-goal 4 — Theme 3 verification): `themory remember 'fact' --user a --session b` exits 2 WITHIN < 2000 ms (boundary-first; not waiting for ~2-5s factory warm-up). Use `performance.now()` to measure elapsed time.
- **dotenv silence test** (Sub-goal 4 — Theme 3 verification): `node dist/agent-tools/cli.js --help` stdout does NOT contain `◇ injected env` literal.
- **Locked names test** (Sub-goal 6 — Theme 4 verification): cli.ts contains all 4 verb-command names ('remember', 'recall', 'forget', 'reflect') AND all 9 stable flags (--user, --session, --agent, --top-k, --threshold, --diversify, --hard, --json, --text).
- **README docs test**: README.md contains "## CLI verbs" section header AND mentions all 4 verbs.

#### Tasks

1. Create the test file with 8 assertions per § TDD below.
2. Run `npx vitest run --config vitest.integration.config.ts tests/integration/cli/verbs-cli-fixes.test.ts` — confirm 8 FAIL (RED).

#### TDD

```
RED: test_1_reflect_json_output_uses_raw_reflection_result_shape() — Theme 1
     — `themory reflect --user <uuid> --json` stdout parses as JSON with
     keys higherOrderMemories + sourceIds + derivedMemoriesCreated; does
     NOT contain CliReflectResult fields (sourceCount, derivedCount, derived).

RED: test_2_cli_output_module_does_not_export_CliReflectResult() — Theme 1
     — Import { CliReflectResult } from cli-output.js throws (interface
     not exported). Regression sentinel against re-introduction.

RED: test_3_multi_scope_fails_fast_under_2_seconds() — Theme 3
     — Measure elapsed wall-clock of `themory remember 'fact' --user a
     --session b`; assert < 2000 ms AND exit 2. Pre-fix takes ~2-5s
     because handler calls createCliMemory BEFORE resolveCliScope.

RED: test_4_cli_help_stdout_clean_of_dotenv_banner() — Theme 3
     — `node dist/agent-tools/cli.js --help` stdout does NOT contain
     literal '◇ injected env'. Pre-fix banner pollutes EVERY invocation.

RED: test_5_locked_cli_verbs_present_in_cli_ts() — Theme 4
     — readFileSync(src/agent-tools/cli.ts) contains exact strings
     'remember <text>', 'recall <query>', 'forget <id>', 'reflect'.

RED: test_6_locked_cli_flags_present_in_cli_ts() — Theme 4
     — same file contains all 9 stable flag strings: --user, --session,
     --agent, --top-k, --threshold, --diversify, --hard, --json, --text.

RED: test_7_readme_has_cli_verbs_section() — Theme 3
     — README.md contains '## CLI verbs' header AND all 4 verb names
     somewhere below.

RED: test_8_changelog_unreleased_amended_with_warm_up_cost_caveat() — Theme 3
     — CHANGELOG.md [Unreleased] section contains the warm-up cost
     phrase ('warm-up' OR '2-5s' OR 'cold-start').

GREEN: Phase 1-3 + Phase 5 implementation.
REFACTOR: None expected — assertions are AAA-shape.
VERIFY: npm test -- tests/integration/cli/verbs-cli-fixes.test.ts
```

#### Acceptance Criteria

- [ ] All 8 RED tests FAIL pre-fix
- [ ] `describe.skipIf` gates with LOUD `console.warn` per parent EC-3 pattern
- [ ] Test file under 250 LoC
- [ ] Pass: lint, typecheck

#### DoD

- [ ] File created at `tests/integration/cli/verbs-cli-fixes.test.ts`
- [ ] 8 tests FAIL (RED locked)

---

## Phase 1: Theme 1 — Reflect 3-way parity

### T1.1 — `createLocalMemory` defaults `reflectionPolicy: manual` per ADR D1

#### Files to edit

```
src/local/index.ts — extend createLocalMemory to default reflectionPolicy
src/local/__tests__/factory.test.ts — RED → GREEN for the default-policy contract
.claude/knowledge-base/adrs/ADR-0005-reflection-trigger.md — supplementary amendment
```

#### Tasks

1. Read `src/local/index.ts` `createLocalMemory` factory; find the LocalMemory constructor that takes `reflectionPolicy`.
2. Add default-policy injection: `const resolvedPolicy = 'reflectionPolicy' in config ? config.reflectionPolicy : { kind: 'manual' as const, shouldReflect: () => Promise.resolve(true) }`.
3. Pass `resolvedPolicy` to LocalMemory.
4. Add factory tests asserting the 3 distinguishing paths (EC-2 absorption) — see § TDD below.
5. Amend ADR-0005 with supplementary entry referencing this plan. EC-9 absorption: include disclosure that the amendment is authorized via project-owner Option A response to `/review` NEEDS_FIXES verdict (vs explicit ADR-signing event); this is honest disclosure within Inquebrável Rule 3 since the authorization scope (fix the 11 MAJORs) implies the ADR amendment as the means.

#### TDD

```
RED: test_createLocalMemory_empty_config_defaults_manual_policy() — EC-2 absorption
     — `createLocalMemory({ ...minimalRequiredFields })` (no reflectionPolicy
     key) — calling `memory.user('alice').reflect()` succeeds (does NOT
     throw `ReflectionNotConfigured`); the 'in' operator path produces the
     default policy.

RED: test_createLocalMemory_explicit_undefined_throws_on_reflect() — EC-2 absorption
     — `createLocalMemory({ ...minimalRequiredFields, reflectionPolicy: undefined })`
     (explicit undefined value) — calling `memory.user('alice').reflect()`
     throws `ReflectionNotConfigured`. Locks the 'in' operator distinguish
     behavior: presence of the KEY (even with undefined value) signals
     consumer-strict mode.

RED: test_createLocalMemory_explicit_policy_uses_passed() — EC-2 absorption
     — `createLocalMemory({ ...minimalRequiredFields, reflectionPolicy: customPolicy })`
     — `memory.user('alice').reflect()` invokes `customPolicy.shouldReflect`
     (mock spy verifies the explicit policy is used, not the default).

GREEN: Implementation of T1.1 default-policy injection per § Tasks step 2.
REFACTOR: None expected.
VERIFY: npm test -- src/local/__tests__/factory.test.ts
```

### T1.2 — CLI emits raw ReflectionResult per ADR D2

#### Files to edit

```
src/agent-tools/cli-output.ts — drop CliReflectResult interface; type CliRenderableResult `reflect` variant carries ReflectionResult
src/agent-tools/run-reflect.ts — remove projection; pass raw result to renderCliOutput
src/agent-tools/__tests__/cli-output.test.ts — test 6 updates raw shape
tests/integration/cli/verbs-cli.test.ts — tests 10 + 11 assertions updated
```

#### Tasks

1. Remove `CliReflectResult` interface from `cli-output.ts`.
2. Update `CliRenderableResult` discriminated union `reflect` arm to `{ verb: 'reflect'; result: ReflectionResult }`.
3. Update text renderer: `Reflected ${sourceIds.length} → ${derivedMemoriesCreated} insights`.
4. Strip projection from `run-reflect.ts`; pass `result` directly.
5. Update T1.2 test 6 + parent-cycle reflect tests 10 and 11.

---

## Phase 2: Theme 2 — DRY hardening

### T2.1 — Retrofit MCP + REST factories to use `createAgentToolsMemory` per ADR D3

#### Files to edit

```
src/agent-tools/cli-memory-factory.ts → src/agent-tools/agent-tools-memory.ts (RENAME via git mv)
src/agent-tools/run-mcp-server.ts — call createAgentToolsMemory; drop env-validation block
src/agent-tools/run-server.ts — call createAgentToolsMemory; drop env-validation block
src/agent-tools/run-{remember,recall,forget,reflect}.ts — import path update
```

#### Tasks

0. **EC-3 absorption — pre-flight grep**: `grep -rE "THEOMEM_PG_URI required|OPENAI_API_KEY required" tests/` — verify ZERO hits today (empirically validated 2026-06-04). This confirms NO downstream test depends on byte-identical stderr strings; retrofit can unify wording safely. If post-cycle grep returns ≥ 1, decide PER-TEST whether to preserve OR update in same commit per cycle-implement.md anti-pattern #7.
1. `git mv src/agent-tools/cli-memory-factory.ts src/agent-tools/agent-tools-memory.ts`.
2. Inside the file: rename `createCliMemory` → `createAgentToolsMemory`; add inline `assertEnvOrExit` helper.
2b. **EC-4 absorption — drop redundant explicit policy wire**: post-T1.1 default at factory level, `createAgentToolsMemory` MUST NOT explicitly pass `reflectionPolicy: { kind: 'manual', ... }` anymore (else dead code + DRY violation persists at refactor source). Remove the explicit wire from `agent-tools-memory.ts` (was at `cli-memory-factory.ts:57-60` pre-rename). Add sentinel assertion to `tests/integration/cli/verbs-cli-fixes.test.ts` (T0.1 test 9 — see § T0.1 update below): grep `src/agent-tools/agent-tools-memory.ts` for `reflectionPolicy:` returns ZERO hits.
3. Replace `run-mcp-server.ts:84-128` env-fail block with `assertEnvOrExit(...)` call.
4. Replace `run-server.ts:83-104` env-fail block with `assertEnvOrExit(...)` call.
5. Replace `run-mcp-server.ts` createLocalMemory call with `createAgentToolsMemory()`.
6. Replace `run-server.ts` createLocalMemory call with `createAgentToolsMemory()`.
7. Update import paths in 4 verb handlers.
8. Re-run `tests/integration/p0-audit/mcp-cli-boot.test.ts` — confirm parent integration still PASSES.

### T2.2 — Extract `parseIntInRange` + `parseFloatInRange` factories per ADR D4

#### Files to edit

```
src/agent-tools/cli.ts — extract 2 factory helpers + collapse 5 parsers
```

#### Tasks

1. At top of `buildProgram` body, add 2 factory helpers (~10 LoC each):
   ```ts
   const parseIntInRange = (label: string, min: number, max: number) => (raw: string) => {
     const n = Number.parseInt(raw, 10);
     if (!Number.isInteger(n) || n < min || n > max) {
       throw new InvalidArgumentError(`Invalid ${label}: ${raw} (must be an integer in ${min}..${max}).`);
     }
     return n;
   };
   const parseFloatInRange = (label: string, min: number, max: number) => (raw: string) => {
     const n = Number.parseFloat(raw);
     if (!Number.isFinite(n) || n < min || n > max) {
       throw new InvalidArgumentError(`Invalid ${label}: ${raw} (must be a float in [${min}, ${max}]).`);
     }
     return n;
   };
   ```
2. Replace 5 `.option()` validators with single-line factory invocations.
3. Run `npm run typecheck` + `npm test`.

---

## Phase 3: Theme 3 (code-paths) — Consumer DX

### T3.1 — Silence dotenv banner at top of cli.ts per Sub-goal 4(a) + Phase 3b conditional fallback per EC-1 absorption

**EC-1 absorption — fallback path declared upfront**: T3.1's primary fix (`process.env['DOTENV_CONFIG_QUIET'] = 'true'` mutation at top of cli.ts) is a **probabilistic fix** dependent on (a) ES module hoisting semantics (imports hoisted before assignments), AND (b) dotenv v17 internally reading `DOTENV_CONFIG_QUIET` LAZILY (on its first internal call) rather than eagerly at module-init. If hoisting kills the mutation OR dotenv reads eagerly, T0.1 test 4 stays RED post-T3.1 — halt-loop would bat Stop Condition #1 (3 GREEN attempts fail) WITHOUT a path forward. T3.1b below is pre-declared as conditional fallback: invoke ONLY if T3.1 empirical validation fails.



#### Files to edit

```
src/agent-tools/cli.ts — 2-line addition at TOP, BEFORE any other import
```

#### Tasks

1. As the very first executable statement (before all imports), add:
   ```ts
   // EC-F-dom-cli-1 absorption: dotenv@17 transitive auto-load emits a stdout banner
   // ('◇ injected env') that breaks shell pipelines for consumers (themory recall | jq).
   // Silence at the earliest possible point — process.env mutation before module loading.
   process.env['DOTENV_CONFIG_QUIET'] = process.env['DOTENV_CONFIG_QUIET'] ?? 'true';
   ```
2. Note: ESM imports are hoisted; mutation BEFORE imports requires either (a) CommonJS-style require + reorganization (loses ESM benefits), OR (b) accept that the mutation is hoisted to the top of the module body, which works because dotenv reads `process.env` lazily on its first require/import call which happens inside `from 'pg'` chain or similar transitive. Validate empirically with test 4.
3. If T3.1 step 2 empirical validation FAILS (`node dist/agent-tools/cli.js --help` stdout still contains `◇ injected env`), invoke **T3.1b** below as conditional fallback.

### T3.1b — CONDITIONAL fallback (invoke ONLY if T3.1 fails empirical validation per EC-1 absorption)

#### Objective

Preload-script alternative that runs BEFORE any ES module hoisting can fire dotenv autoload — guarantees the silence regardless of module-load timing.

#### Files to edit

```
src/agent-tools/cli-preload.cjs (NEW) — tiny CommonJS preload: `process.env['DOTENV_CONFIG_QUIET']='true';`
package.json — update `bin` entries with `--require` flag OR shebang shim per Node version
```

#### Tasks

1. Create `src/agent-tools/cli-preload.cjs` (intentional .cjs extension so Node loads it synchronously BEFORE the ESM cli.js):
   ```js
   // EC-1 fallback: silence dotenv v17 transitive autoload banner.
   process.env.DOTENV_CONFIG_QUIET = 'true';
   ```
2. Wire via the bin entry. Option A (Node >= 20): change `package.json#bin` shebang strategy by adding a tiny wrapper script at `dist/agent-tools/cli-bin.cjs` that does `require('./cli-preload.cjs'); import('./cli.js').then(m => m.main());` and point bin entries at the wrapper. Option B: add `"--require=./cli-preload.cjs"` to the shebang line. PICK the option that ships fewer files.
3. Add `dist/agent-tools/cli-preload.cjs` to `postbuild:copy-noncjs` step (or extend tsc copy hook) since `tsc` won't emit `.cjs` files from `.ts` source.
4. Update T0.1 test 4 to validate via the wrapper bin invocation.
5. Document in T1.1 ADR D? — no new ADR; T3.1's existing ADR (implicit) is augmented with the fallback path in plan v1.1 footer.

#### Acceptance Criteria

- [ ] T0.1 test 4 GREEN — `node dist/agent-tools/cli.js --help` (OR via wrapper if shebang strategy) stdout clean of `◇ injected env`
- [ ] No new dependencies
- [ ] dist/agent-tools/cli-preload.cjs ships in pack manifest (extend dist/**/*.cjs glob in package.json#files if needed)

### T3.2 — Fail-fast ordering: resolveCliScope BEFORE createAgentToolsMemory per Sub-goal 4(b)

#### Files to edit

```
src/agent-tools/run-remember.ts — reorder
src/agent-tools/run-recall.ts — reorder
src/agent-tools/run-reflect.ts — reorder
src/agent-tools/cli-scope.ts — add validateScopeOpts export
src/agent-tools/__tests__/cli-scope.test.ts — 3 NEW contract tests per EC-6 absorption
```

#### Tasks

1. In each of the 3 files, move the `resolveCliScope(...)` call BEFORE `createAgentToolsMemory()`. But `resolveCliScope` needs a `Memory` instance to call `.user(id)` on — so we extract a **pre-flight validator**: `validateScopeOpts({ user, session, agent })` throws if zero or multi defined, without needing a Memory.
2. Add `validateScopeOpts` to `cli-scope.ts` (companion to `resolveCliScope`).
3. Each handler calls `validateScopeOpts(opts)` first (fast boundary check); THEN `createAgentToolsMemory()`; THEN `resolveCliScope(memory, opts)` (binds the now-validated scope).
4. **EC-6 absorption — 3 contract tests for validateScopeOpts** in `src/agent-tools/__tests__/cli-scope.test.ts`:
   ```
   RED: test_validateScopeOpts_zero_scope_throws()
        — validateScopeOpts({}) throws Error matching /exactly one required/
   RED: test_validateScopeOpts_exactly_one_returns_void()
        — validateScopeOpts({ user: 'alice' }) returns void (does NOT throw)
   RED: test_validateScopeOpts_multi_scope_throws()
        — validateScopeOpts({ user: 'a', session: 'b' }) throws
   ```
   Mirrors the existing resolveCliScope test pattern in the same file. Improves test isolation per `testing.md § Pyramid` (contract tier captures the boundary validation; integration test 3 captures the end-to-end timing).
5. Test 3 of T0.1 verifies <2000 ms elapsed time (end-to-end integration).

---

## Phase 5: Theme 3 (docs) + Theme 4 — README + CHANGELOG + Locked names + cycle-implement.md amendment

### T5.1 — `README.md § CLI verbs` section per Sub-goal 5(a)

#### Files to edit

```
README.md — NEW `## CLI verbs` section
```

#### Tasks

1. After existing `## REST API server` section, add `## CLI verbs` with:
   - Brief intro (1 paragraph): "themory ships 8 subcommands: 4 server lifecycle (mcp / server / migrate / health) + 4 memory verbs (remember / recall / forget / reflect)"
   - Per-verb subsection with usage + flags (4 verbs × ~5 lines each)
   - Docker-exec composability example: `docker exec themory themory recall 'query' --user alice`
   - DOTENV_CONFIG_QUIET note removed (dotenv silenced at source per T3.1)
   - Warm-up cost note: "~2-5s cold-start per invocation; for batch ops > 50 invocations use REST server"
2. Run `npm test -- tests/integration/cli/verbs-cli-fixes.test.ts -t "test 7"` → GREEN.

### T5.2 — CHANGELOG `[Unreleased]` amended per Sub-goal 5(b)

#### Files to edit

```
CHANGELOG.md — extend [Unreleased] § Added entry with warm-up cost caveat
```

#### Tasks

1. Append to the existing `verbs-as-cli-themory-remember-recall-forget-reflect` entry the warm-up cost honest disclosure (1-2 sentences).
2. Reflect-shape divergence note SKIPPED (parity restored post-T1.2).
3. DOTENV_CONFIG_QUIET note SKIPPED (silenced at source post-T3.1).
4. Test 8 of T0.1 → GREEN.

### T5.3 — CLAUDE.md § Locked names extended per Sub-goal 6

#### Files to edit

```
CLAUDE.md — extend § Locked names table with `themory CLI surface` row
src/__tests__/cli-locked-names.test.ts (NEW) — regression sentinel
```

#### Tasks

1. In CLAUDE.md § Locked names table, add row:
   `| themory CLI verbs | `remember` / `recall` / `forget` / `reflect` (per ADR D2 of verbs-as-cli plan) | strategic |`
   AND row:
   `| themory CLI flags (stable) | `--user`/`--session`/`--agent`/`--top-k`/`--threshold`/`--diversify`/`--hard`/`--json`/`--text` | strategic |`
2. Author `src/__tests__/cli-locked-names.test.ts` — greps cli.ts for the 4 verb-command name patterns + 9 flag literals; fails if any missing.
3. Tests 5 + 6 of T0.1 → GREEN.

### T5.4 — `cycle-implement.md` v1.7 amendment per ADR D5

#### Files to edit

```
.claude/rules/cycle-implement.md — bump v1.6 → v1.7 with ADR-marker entry
```

#### Tasks

1. In § Acceptable bypass paths § 2, replace "no second consecutive bypass without ADR amendment" with explicit ADR-style note documenting the 3-cycle precedent + sunset 2026-07-04.
2. Append to § Versioning change log: v1.7 entry referencing this plan.
3. No new test (rule files are not under test scope).

---

## Phase 4: Integration validation + cycle close

### T4.1 — Full validation chain + re-run `/review`

#### Tasks

1. `npm run build`
2. `npm test` — expect **≥ 1073 PASS** (1061 baseline + 8 NEW T0.1 + 1 NEW T5.3 sentinel + 3 NEW T1.1 EC-2 + 3 NEW T3.2 EC-6 absorption tests = 1076 expected; ≥ 1073 floor absorbs honest-skip variance per EC-8 absorption honest math)
3. `npm run typecheck` — 0 errors
4. `npm run lint` — 0 warnings
5. `npx vitest run --config vitest.integration.config.ts tests/integration/cli/` — 19 + 8 = **27 PASS**
6. CHANGELOG amended
7. Re-invoke `/review verbs-as-cli-fixes-cycle-1` — expected READY_TO_MERGE
8. Write `/implement-validate` synthetic report

#### Acceptance Criteria

- [ ] All test suites GREEN
- [ ] T0.1 8/8 PASS + parent verbs-cli.test.ts 19/19 PASS unchanged
- [ ] Zero TS errors, zero lint warnings
- [ ] CHANGELOG entry added
- [ ] `/review` verdict: READY_TO_MERGE (0 BLOCKER, 0 CRITICAL, 0 MAJOR)

---

## Coverage Matrix

| # | Gap / Finding | Task(s) | Resolution |
|---|---|---|---|
| 1 | F-arch-1 + F-wire-2 MAJOR — ReflectionPolicy auto-wire asymmetry | T1.1, ADR D1 | createLocalMemory defaults reflectionPolicy: manual |
| 2 | F-dom-api-1 MAJOR — CLI reflect projection breaks 3-way parity | T1.2, ADR D2 | Drop CliReflectResult; emit raw ReflectionResult |
| 3 | F-arch-2 + F-wire-1 MAJOR — env-validation triplicated | T2.1, ADR D3 | Retrofit MCP+REST to use createAgentToolsMemory + assertEnvOrExit |
| 4 | F-arch-3 MAJOR — cli.ts parser duplication | T2.2, ADR D4 | parseIntInRange + parseFloatInRange factories |
| 5 | F-dom-cli-1 MAJOR — dotenv banner pollutes stdout | T3.1 (+ T3.1b conditional) | 2-line process.env mutation at top of cli.ts; EC-1 fallback via preload .cjs declared pre-emptively |
| 6 | F-dom-cli-2 MAJOR — fail-fast ordering inverted | T3.2 | resolveCliScope BEFORE createAgentToolsMemory via validateScopeOpts pre-flight |
| 7 | F-dom-cli-3 MAJOR — README ZERO docs of verbs-CLI | T5.1 | NEW ## CLI verbs section with usage + Docker-exec example |
| 8 | F-dom-api-2 MAJOR — CHANGELOG missing 3 caveats | T5.2 | Warm-up cost caveat retained; reflect-shape + dotenv notes obsoleted by T1.2 + T3.1 |
| 9 | F-dom-api-3 MAJOR — CLI surface NOT in CLAUDE.md § Locked names | T5.3 | Add 2 rows; sentinel test in src/__tests__ |
| 10 | F-xval-1 MAJOR — THIRD consecutive SEPA bypass | T5.4, ADR D5 | cycle-implement.md v1.7 ADR-marker + sunset 2026-07-04 |
| 11 | EC-1 MUST FIX — T3.1 dotenv silence ESM hoisting probabilistic | T3.1b (NEW conditional) | Phase 3b preload .cjs fallback declared upfront — invoked ONLY if T3.1 empirical fails |
| 12 | EC-2 MUST FIX — T1.1 'in' operator distinction semantic subtlety | T1.1 § TDD | 3 NEW contract tests (empty / explicit-undefined / explicit-policy) |
| 13 | EC-3+4+5+6 SHOULD TEST inline absorptions | T2.1 step 0+2b / T2.2 ADR D4 example / T3.2 3 contract tests | Inline-documented per § Tasks/Deep Dives |
| 14 | EC-7+8+9 DOCUMENT absorptions | T5.4 sunset / T4.1 count / T1.1 ADR-0005 disclosure | Honest disclosure in commits + rule change logs |
| 15 | Integration validation | T4.1 | Full chain + /review re-run |

**Coverage: 15/15 (100%)** — All 11 MAJOR findings + 4 EC absorption rows (2 MUST FIX + 4 SHOULD TEST + 3 DOCUMENT collapsed into 2 rows) + final validation.

## Global Definition of Done

- [ ] All 5 phases completed (0 + 1 + 2 + 3 + 5 + 4-validation)
- [ ] All tests passing — `npm test` green (≥ 1069 PASS)
- [ ] Zero TypeScript errors
- [ ] Zero lint warnings
- [ ] File-size budget respected (per `.claude/rules/architecture.md § Module hygiene`)
- [ ] CHANGELOG.md updated under `[Unreleased]`
- [ ] Backward compatibility preserved (public 4-verb API unchanged; CLI reflect output shape now matches REST per ADR D2 — this IS a breaking change for CLI consumers who relied on CliReflectResult, but the parent cycle has NOT been published or consumed; honest disclosure in CHANGELOG)
- [ ] `/review verbs-as-cli-fixes-cycle-1` returns **READY_TO_MERGE** (0 BLOCKER, 0 CRITICAL, 0 MAJOR)
- [ ] **Plan archived** — after `/review` returns READY_TO_MERGE AND PR merged to main

## Final Phase: Integration Validation (MANDATORY)

```bash
npm run build && npm test && npx vitest run --config vitest.integration.config.ts tests/integration/cli/
npm run typecheck && npm run lint
```

### Acceptance Criteria

- [ ] All test suites green
- [ ] T0.1 8/8 PASS + parent verbs-cli.test.ts 19/19 PASS
- [ ] Zero TS errors, zero lint warnings
- [ ] `/review` verdict: READY_TO_MERGE

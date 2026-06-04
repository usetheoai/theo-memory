# Review: verbs-as-cli-fixes-cycle-1

**Date:** 2026-06-04
**Plan:** `.claude/knowledge-base/plans/verbs-as-cli-fixes-cycle-1-plan.md` v1.2 (SHIPPABLE_WITH_CAVEATS @ 82.4)
**Implementation commit:** `b06429e` on `develop`
**Reviewers (spawned agents):** 6 — architecture, tests, cross-validation, wiring, domain-cli-tooling, domain-api-design
**Findings:** 38 total — 0 BLOCKER, 0 CRITICAL, **10 MAJOR (unique after dedup; 17 raw before, 1 false positive discarded)**, 13 MINOR, 13 INFO
**Verdict:** **NEEDS_FIXES** (verdict-flip from parent NEEDS_FIXES to a NEW NEEDS_FIXES — the fix-cycle closed the 11 parent MAJORs at source but introduced 11 NEW MAJORs primarily around: incomplete ADR D3 retrofit + JSDoc discipline + Keep-a-Changelog format + ADR rigor + parser-factory correctness regression)

## Verdict band

`NEEDS_FIXES` — cycle-review.md § Hard gates fired on **F-dom-cli-1** (silent numeric-coercion regression introduced by T2.2 factory collapse — affects all 5 collapsed validators; consumer pipes `themory recall --top-k 5.7` would silently receive `5`); the other 10 MAJORs are quality/honesty gaps that warrant a 1-2 commit follow-up cycle before `READY_TO_MERGE`.

## MAJOR findings (consolidated — 11 unique)

### Convergent findings (flagged by multiple agents)

#### M1 — ADR D3 § Tasks 5+6 NOT IMPLEMENTED (architecture + cross-validation + cli-tooling)

- **Agents:** F-arch-1 + F-xval-1 + F-dom-cli-2
- **File:** `src/agent-tools/run-mcp-server.ts:114-119`, `src/agent-tools/run-server.ts:128-134`
- **Plan ref:** ADR D3 § Tasks step 5 + step 6, Sub-goal 2
- **Summary:** Only env-validation retrofit shipped; Memory factory wiring (`Pool` + `runMigrations` + `createLocalMemory` with `LocalTransformerEmbedder` + `OpenAILLM` + `LOCAL_EMBEDDER_DIM=384`) still triplicated across 3 sites (`agent-tools-memory.ts`, `run-mcp-server.ts`, `run-server.ts`). Plan ADR D3 § Tasks 5+6 explicitly mandated `createAgentToolsMemory()` retrofit at both runners — never executed.
- **Plausible silent reason:** `createAgentToolsMemory()` returns `[memory, dispose]` tuple incompatible with `run-server.ts`'s EC-33 readiness-Proxy lifecycle. But no ADR documents this — F-arch-2 partial closure.
- **Recommended action:** Either (a) refactor `createAgentToolsMemory` to support the EC-33 warm-Promise pattern + extract `wireMemoryFromPool(pool)` helper, OR (b) honest ADR D3 amendment documenting the runner-specific deferral.

#### M2 — `MemoryConfig.reflectionPolicy` JSDoc stale (architecture + api-design)

- **Agents:** F-arch-3 + F-dom-api-1
- **File:** `src/core/memory-store.ts:150-151`
- **Plan ref:** ADR D1 + ADR-0005 v1.1 supplementary + PRIORITY 0 sub-goal 1
- **Summary:** JSDoc still says "v0.0 ships ManualReflectionPolicy as the only built-in" — silent about the new `'in' operator` distinguishing semantics. Consumers reading the type cannot discover that key omission → default vs explicit-undefined → throw.
- **Recommended action:** Extend JSDoc to describe the 3 paths with `@see ADR-0005 § Supplementary amendment v1.1` + cross-ref to `factory.test.ts` EC-2 paths a/b/c.

#### M3 — `createCliMemory` cosmetic alias without consumers (architecture + api-design)

- **Agents:** F-arch-2 + F-dom-api-4
- **File:** `src/agent-tools/agent-tools-memory.ts:114`
- **Plan ref:** ADR D3 § Naming, Inquebrável Rule 11 YAGNI
- **Summary:** Rename `createCliMemory → createAgentToolsMemory` is cosmetic — zero callers use the new name. All 4 verb handlers (run-{remember,recall,forget,reflect}.ts) still import the `createCliMemory` alias. The "new call-sites SHOULD prefer createAgentToolsMemory" JSDoc is aspirational; no migration shipped.
- **Recommended action:** Either (a) migrate the 4 verb handlers to the new name + DELETE alias, OR (b) mark `@deprecated` with explicit sunset date.

### Unique findings

#### M4 — **parseInt/parseFloat silent coercion regression (cli-tooling)** — load-bearing

- **Agent:** F-dom-cli-1
- **File:** `src/agent-tools/cli.ts:75-94`
- **Plan ref:** T2.2 / ADR D4
- **Summary:** `parseIntInRange` + `parseFloatInRange` silently coerce decimal + trailing-garbage input via `Number.parseInt`/`Number.parseFloat`. `--top-k 5.7` → `5` (silent truncation), `--top-k 5abc` → `5` (silent truncation), `--threshold 0.5abc` → `0.5` (silent truncation). Parent test 16 only covered out-of-range integers, missing this fail-fast violation that NOW SHIPS ACROSS ALL 5 COLLAPSED VALIDATORS.
- **Recommended action:** Replace with `Number(raw)` + isInteger/isFinite guard. `Number('5.7')` returns `5.7` (fails isInteger); `Number('5abc')` returns `NaN` (fails isFinite). Add 4 RED tests for decimal/garbage input.

#### M5 — Stale `dist/agent-tools/cli-memory-factory.js` ships dead code (cli-tooling)

- **Agent:** F-dom-cli-3
- **File:** `dist/agent-tools/cli-memory-factory.js` (build artifact)
- **Plan ref:** ADR D3 git mv + EC-4 sentinel
- **Summary:** `git mv cli-memory-factory.ts → agent-tools-memory.ts` deleted source but left STALE `dist/agent-tools/cli-memory-factory.js` containing the OLD explicit `reflectionPolicy: { kind: 'manual', ... }` wire that EC-4 sentinel test 9 explicitly forbids. `package.json#files` glob `dist/**/*.js` ships this dead code in `npm pack`. Sentinel checks src .ts only; pack manifest contradicts cycle contract.
- **Recommended action:** Add `prebuild:clean` rmSync('dist') step + extend EC-4 sentinel to assert `dist/agent-tools/cli-memory-factory.js` does NOT exist post-build.

#### M6 — Locked-names sentinel uses substring grep (cli-tooling)

- **Agent:** F-dom-cli-4
- **File:** `src/__tests__/cli-locked-names.test.ts:44-63`, `tests/integration/cli/verbs-cli-fixes.test.ts:180-206`
- **Plan ref:** Sub-goal 6 / T5.3
- **Summary:** Substring grep cannot distinguish active `.command('remember <text>')` declaration from a stray comment OR from `parseIntInRange('--top-k', 1, 100)` factory-helper invocation. A future refactor could remove the actual `.command()` / `.option()` while keeping the literal in a comment OR factory call; sentinel passes, CLI contract silently broken.
- **Recommended action:** Strengthen via AST traversal (ts-morph) OR regex pinning the literal inside `.command(`/`.option(` call site (e.g., `/\.option\(\s*['"]--user/`).

#### ~~M7~~ — **FALSE POSITIVE — DISCARDED**

- **Original agent finding:** F-dom-cli-5 — README scope-creep `## Foundational principles` section
- **Post-verification:** `git log -- README.md` shows the `## Foundational principles` section was added by commit `82b1b87` (`docs(principles): rewrite CLAUDE.md § IMPORTANTE + add Foundational principles section to README`), NOT by this fix-cycle. `git show b06429e -- README.md` confirms THIS cycle only added the `## CLI verbs` section as plan T5.1 declared.
- **Status:** Discarded. No scope-creep violation. Reviewer's grep returned a true match against pre-existing content, but the cycle-attribution claim was wrong.
- **Lesson for future reviewers:** When flagging "in-cycle scope-creep", verify via `git show <commit> -- <file>` that the suspect content was actually added by this commit, not by a prior commit on the branch.

#### M8 — `{ reflectionPolicy: undefined }` opt-in is typed-unreachable under `exactOptionalPropertyTypes: true` (api-design)

- **Agent:** F-dom-api-2 — **most subtle MAJOR**
- **File:** `src/local/index.ts:1082-1085`
- **Plan ref:** ADR-0005 v1.1 supplementary + tsconfig.contract.json `exactOptionalPropertyTypes: true`
- **Summary:** The "explicit `{ reflectionPolicy: undefined }` opts into ADR-0005 throw" contract is typed-unreachable to idiomatic TypeScript consumers under `exactOptionalPropertyTypes: true`. The strict-no-default path requires either type cast OR spread+inference widening. The plan's load-bearing claim is true at RUNTIME but false at the TYPED API surface — direct Inquebrável Rule 3 honesty gap.
- **Evidence:** `factory.test.ts` path (b) had to cast via `as unknown as Parameters<typeof createLocalMemory>[0]`. A typed consumer cannot pass type-check with `const cfg: LocalMemoryConfig = { ..., reflectionPolicy: undefined };`.
- **Recommended action:** Either (a) widen `MemoryConfig.reflectionPolicy?: ReflectionPolicy | undefined` so explicit undefined becomes typed-reachable (add `### Changed` CHANGELOG entry), OR (b) drop the opt-in path entirely (consumers construct throw-policy themselves), OR (c) document the typed-unreachable constraint honestly in JSDoc.

#### M9 — 5 new exports without `@internal` tags (api-design)

- **Agent:** F-dom-api-3
- **File:** `src/agent-tools/agent-tools-memory.ts` (`assertEnvOrExit`, `PG_URI_ENV_SPEC`, `OPENAI_API_KEY_ENV_SPEC`, `createAgentToolsMemory`, `createCliMemory`) + `src/agent-tools/cli-scope.ts` (`validateScopeOpts`)
- **Plan ref:** PRIORITY 0 sub-goal 1 + Inquebrável Rule 11
- **Summary:** Five (six with `validateScopeOpts`) new module-level exports without `@internal` JSDoc tags. They are NOT re-exported via `src/agent-tools/index.ts` barrel (intended bundle isolation), but `tsc` will emit `dist/.../*.d.ts` containing public type signatures consumed by TypeDoc / deep-import bundlers. Without `@internal`, public/internal status is ambiguous.
- **Recommended action:** Tag each new export with `@internal Shared boundary helper for agent-tools subpath (CLI/MCP/REST). NOT part of the public @usetheo/memory/agent-tools API surface.`

#### M10 — CHANGELOG entry violates Keep-a-Changelog format (api-design)

- **Agent:** F-dom-api-5
- **File:** `CHANGELOG.md:9` (the verbs-as-cli-fixes-cycle-1 entry)
- **Plan ref:** Inquebrável Rule 6 (Changelogs)
- **Summary:** ~3000-character single bullet under `### Added` mixes 3 categories: (1) behavioral widening of `createLocalMemory` defaults (should be `### Changed`), (2) `CliReflectResult` interface drop (should be `### Removed`), (3) actual new exports (correctly `### Added`). Per `/home/paulo/.claude/CLAUDE.md § 6`: "Uma linha por mudança. Se precisar de mais, a mudança é grande demais para uma linha".
- **Recommended action:** Split into 3 sub-sections (`### Added` / `### Changed` / `### Removed`) per Keep-a-Changelog discipline.

#### M11 — ADR-0005 supplementary amendment missing structural sections (api-design)

- **Agent:** F-dom-api-6
- **File:** `.claude/knowledge-base/adrs/ADR-0005-reflection-trigger.md:86-111`
- **Plan ref:** `plan-confidence-golden-rule.md § Rules that cannot be bent` ("ADR without alternatives caps at 70")
- **Summary:** Supplementary amendment ships honest "implicit-by-scope" authorization disclosure (good) but lacks structural `### Alternatives` + `### Decision` + `### Reversibility` sections that the golden rule mandates for `ADR with alternatives` to count toward full SHIPPABLE.
- **Recommended action:** Extend amendment with explicit `### Alternatives considered` table (3 rejected: keep v1.0 + default at CLI only + widen type) + `### Reversibility` note (low — reverting = BREAKING change).

## MINOR findings (13 total)

Aggregated without per-finding detail; all surface in agents' YAML files at `.claude/agents/review-verbs-as-cli-fixes-cycle-1-2026-06-04/findings/`.

Highlights:
- **F-dom-cli-6:** `exitOverride` only maps `invalidArgument` + `invalidOptionArgument` to exit 2; `missingArgument` / `unknownCommand` / `unknownOption` fall through with exit 1.
- **F-dom-cli-7:** Plan T3.1b specified `.cjs` extension; implementation shipped `.ts → cli-preload.js` (ESM). Works empirically but plan-impl deviation lacks ADR coverage.
- **F-dom-cli-8:** `package.json#bin` maps `themory`/`themory-mcp` to `dist/agent-tools/cli.js` which has NO shebang — `npx @usetheo/memory` on Unix would fail without explicit `node` prefix.
- **F-dom-cli-9:** Renderer edge cases unhandled (embedded `\n` in `m.text`; `result.reason?` discarded in reflect text format).
- **F-tests-1:** Per-test `skipIf` gates missing `console.warn` per T0.1 DoD.
- **F-tests-2:** Test 3 over-gated on `HAS_PG_URI` though it should be DB-independent (boundary-first proves DB never reached).
- **F-tests-3:** `validateScopeOpts` covers 3 of 6 permutations.
- **F-xval-2:** Goal SMART "≥ 1073 PASS" floor not met by contract alone (1069 + 2 SKIP); only reached via 7 integration = 1076.
- **F-xval-3:** Implement-validate report claims "MCP + REST retrofitted" without disclosing M1 partial implementation.
- **F-arch-4:** `validateScopeOpts` + `resolveCliScope` coupling (acceptable per plan EC-6).
- **F-arch-5:** Side-effect `cli-preload.ts` lacks mechanical import-order enforcement.
- **F-wire-fix-1:** `createAgentToolsMemory` 0 non-alias callers (mirror of M3).
- **F-dom-api-7:** `CliRenderableResult` asymmetry between `forget` (still projection) and `reflect` (raw) undocumented.

## INFO findings (13 total)

Documented as: F-arch-6/7/8 (clean), F-tests-4/5/6, F-xval-4/5/6 (FOURTH-bypass honest, ADR-0005 implicit-auth honest, BC alias retained), F-wire-fix-2/3, F-dom-cli-10, F-dom-api-8.

## Edge-case coverage report

| Edge case from plan | Status |
|---|---|
| EC-1 T3.1b fallback (dotenv silence) | **COVERED** (test 4 empirical 0 banner hits) |
| EC-2 'in' operator distinguishing | **COVERED** (3 factory contract tests) |
| EC-3 pre-flight grep | **COVERED via byte-identical preservation** (4 hits found, per-test PRESERVE applied) |
| EC-4 redundant explicit policy wire | **COVERED** (sentinel test 9 with JSDoc strip) |
| EC-5 `--` prefix in label | **COVERED** (parent test 16 regex preserved) |
| EC-6 3 validateScopeOpts tests | **COVERED** (zero/one/multi paths; 3 of 6 permutations) |
| EC-7 30-day sunset 2026-07-04 | **COVERED** (cycle-implement.md v1.7 ADR-marker) |
| EC-8 expected ≥ 1073 PASS | **PARTIAL** (1069 contract + 7 integration = 1076 visible; floor satisfied via `≥`) |
| EC-9 ADR-0005 implicit authorization | **COVERED** (honest disclosure in 3 places) |

## Cross-validation summary

- Plan tasks: 12 substantive
- Fully implemented: 11
- Partial: 1 (T2.1 Steps 5+6 — see M1)
- Missing: 0
- Diverged: 0 (no scope creep beyond the README investigation flagged as M7)
- ADRs respected: 4 of 5 (D3 partially executed)
- Plan drift: NONE (plan v1.2 frozen at `efe05d3`)
- Deps added: ZERO (clean `package.json` + `package-lock.json` diff verified)

## Quality gates summary (from implement-validate)

- `npm test`: PASS (1069 PASS + 2 SKIP)
- `npm run typecheck`: PASS (0 errors)
- `npm run lint`: PASS (0 warnings; 1 inline fix `ReadonlyArray<T>` → `readonly T[]`)
- Build: PASS (`dist/agent-tools/cli-preload.js` shipped via ESM)
- Empirical dotenv silence: PASS (0 banner hits)
- Integration cli/ in dev session: 7 PASS + 21 SKIP
- **Integration cli/ with real env vars** (post-review verification 2026-06-04 18:08): **28/28 PASS** against `themem_pgvector` (ankane/pgvector:v0.5.1) + OpenRouter LLM (`OPENAI_BASE_URL=https://openrouter.ai/api/v1` + dogfood S1 OpenRouter key) — parent verbs-cli.test.ts (19) + fix-cycle verbs-cli-fixes.test.ts (9). Duration 50.93s. Real-tree empirical validation closes the SDK-functional gate.
- Wiring triad: 7/7 PASS at all new symbols

## Spawned agents (audit trail)

- `.claude/agents/review-verbs-as-cli-fixes-cycle-1-2026-06-04/architecture.md`
- `.claude/agents/review-verbs-as-cli-fixes-cycle-1-2026-06-04/tests.md`
- `.claude/agents/review-verbs-as-cli-fixes-cycle-1-2026-06-04/wiring.md`
- `.claude/agents/review-verbs-as-cli-fixes-cycle-1-2026-06-04/cross-validation.md`
- `.claude/agents/review-verbs-as-cli-fixes-cycle-1-2026-06-04/domain-cli-tooling.md`
- `.claude/agents/review-verbs-as-cli-fixes-cycle-1-2026-06-04/domain-api-design.md`

## Handoff decision

**NEEDS_FIXES** — `verbs-as-cli-fixes-cycle-2` (or inline patch commits) MUST address at minimum:

**P0 blockers (must fix before merge):**
- M4 `parseInt`/`parseFloat` lossy coercion (BEHAVIORAL REGRESSION across 5 sites)
- M5 stale `dist/agent-tools/cli-memory-factory.js` (PACK MANIFEST defect)
- ~~M7 README scope-creep~~ — discarded as false positive (see § M7)

**P1 honesty gaps (should fix before merge):**
- M2 `MemoryConfig.reflectionPolicy` JSDoc update
- M8 `exactOptionalPropertyTypes` opt-in honesty gap
- M10 CHANGELOG Keep-a-Changelog split
- M11 ADR-0005 amendment structural sections

**P2 follow-up acceptable as deferred-debt with sunset:**
- M1 ADR D3 Steps 5+6 retrofit (or D3 amendment)
- M3 `createCliMemory` alias migration or `@deprecated`
- M6 locked-names AST sentinel
- M9 `@internal` tags

The integration tests with real env vars (per user directive) MUST run BEFORE merge regardless of the MAJOR fix path chosen — only that confirms the SDK actually runs end-to-end against pgvector with the new defaults.

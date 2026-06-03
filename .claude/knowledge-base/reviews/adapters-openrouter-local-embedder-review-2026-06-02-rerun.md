# Review: adapters-openrouter-local-embedder-2026-06-02-rerun

**Date:** 2026-06-02
**Verdict:** READY_TO_MERGE
**Reviewers (spawned agents):** 7 (architecture, cross-validation, domain-db-migrations, review-adapters-openrouter-local-embedder-domain-memory-layer, domain-pgvector-schema, review-adapters-openrouter-local-embedder-tests, review-adapters-openrouter-local-embedder-wiring)
**Total findings (raw YAML):** 29

## Re-review fix-up summary (closed BEFORE final consolidation)

The agents originally flagged 1 MAJOR + 6 MINOR new residuals in the delta. All were absorbed via 2 follow-up commits BEFORE this consolidated report was generated:

| Finding | Severity | Closure commit | Action |
|---|---|---|---|
| F-arch-R13 | MAJOR | `5a6cf3d` | `InvalidEmbeddingDim` re-exported from `src/core/index.ts` barrel per architecture.md § 9 |
| F-dom-pgvector-rerun-1 | MINOR | `5a6cf3d` | Cascade test extended to seed `memories.superseded_by` 3rd FK arm + `pg_constraint.confdeltype = 'n'` regression assertion |
| F-arch-R3 | MINOR | (audit commit) | Plan ADR D3 body now carries inline amendment block pointing to header + README |
| F-Mi7 | MAJOR (pgvector) / SCOPE_OUT (cross-val) | (audit commit) | Plan T0.3 § Files to edit line corrected to `tests/integration/migrations/dim-change.test.ts` |
| F-M3 narrative | MAJOR (cross-val) | (audit commit) | Plan v1.2 header + CHANGELOG amended to "document-only defense-in-depth" (matches what 5089a9a actually shipped) |
| F-dom-pgvector-rerun-2 | MINOR | DEFERRED | Belt-and-suspenders value-based atttypmod canary; F-Mi8 extversion canary covers main risk |
| F-dom-db-rerun-residual-M1+M2 | MINOR | DEFERRED | `extversion.startsWith('0.5.')` would misfire on hypothetical v0.50.x (low prior); single-column atttypmod sufficient per BEGIN/COMMIT invariant |

**Net state after re-review fix-up:** 0 BLOCKER, 0 CRITICAL, 0 MAJOR, 0 actionable MINOR (3 MINOR explicitly deferred with rationale). The INFO-only count below reflects post-fix-up state.

## Findings summary by severity

| Severity | Count |
|---|---|
| BLOCKER | 0 |
| CRITICAL | 0 |
| MAJOR | 0 |
| MINOR | 0 |
| INFO | 29 |

## INFO findings (29)

### F-dom-rerun-1: F-M4 closed correctly. Both `runMigrations` paths now invoke
`applyDimChange(pool, options.embeddingDim)` whenever the caller
supplies an explicit `embeddingDim`, with NO MAX_EMBEDDING_DIM
short-circuit. The inner `atttypmod` probe in `applyDimChange`
(lines 905-913) handles idempotency cleanly — the 384→1536 revert
path (operator switches local-openrouter → openai) now works.


- **Found by:** review-adapters-openrouter-local-embedder-domain-memory-layer
- **File:** `src/local/index.ts`
- **Plan reference:** plan v1.2 header amendment (F-M4 closure)
- **Domain anchor:** architecture.md § 10.2 (drizzle-kit push vs runMigrations conflict)
- **Evidence:**

  Orphan-schema branch (line 1017): `if (options?.embeddingDim !== undefined) { await applyDimChange(...) }`
  Journal-tracked branch (line 1035): same idiom.
  Verified by direct read; no asymmetric guard remains.


### F-dom-rerun-2: F-M15 closed via a shared `assertEmbeddingDim(vector, methodLabel)`
helper that throws typed `EmbeddingMismatch(expectedDim, actualDim,
{ cause: new Error('PgvectorStore.${methodLabel}') })`. Helper is
invoked at every public write/search boundary:
  - `insert` (line 209) loops `for (const vec of vectors)` before
    delegating to `insertBatch` — so the batch and per-row fallback
    paths are both guarded by the SAME loop at the public entry.
  - `search` (line 293), `update` (line 391), `insertDerivedMemory`
    (line 471) each call the helper at the top of the method body.
Private `insertBatch` + `insertSingle` are reachable ONLY via public
`insert`, so guarding once at the entry is correct (not dead-code).
The `methodLabel` rides in `EmbeddingMismatch.cause` for diagnosability.


- **Found by:** review-adapters-openrouter-local-embedder-domain-memory-layer
- **File:** `src/local/pgvector-store.ts`
- **Plan reference:** plan v1.2 header (F-M15 + F-Mi6 closure)
- **Domain anchor:** architecture.md § 8 (typed domain errors at boundaries — EmbeddingMismatch)

### F-dom-rerun-3: F-M2 closed by bumping the plan to v1.2 with an explicit "ADR D3
AMENDMENT (closes F-C1 + F-M2)" paragraph in the header. The
amendment names the empirical pgvector NOT NULL constraint collision
(PG error 23502) as the rationale for switching from `ALTER COLUMN
TYPE vector(N) USING NULL` to `DELETE FROM memories; DELETE FROM
entities; ALTER COLUMN TYPE vector(N);` inside the same BEGIN/COMMIT.
The EC-B cascade collateral disclosure was also widened in the same
amendment block (history audit trail, consolidation_history.kept_memory_id,
memories.superseded_by chains). The original ADR D3 body at line 115
retains the historical `USING NULL` recipe (correctly — it documents
the original decision that the amendment then supersedes). Honest
version-control of architectural intent.


- **Found by:** review-adapters-openrouter-local-embedder-domain-memory-layer
- **File:** `.claude/knowledge-base/plans/adapters-openrouter-local-embedder-plan.md`
- **Plan reference:** plan v1.2 header
- **Domain anchor:** cycle-implement.md anti-pattern

### F-dom-rerun-4: F-Mi10 deliberately scoped out per the original /review report
(`reviews/adapters-openrouter-local-embedder-review-2026-06-02.md`
line 162: "pre-existing for OpenAI; reaffirmed"). The barrel still
re-exports `DeterministicStubEmbedder`, `OpenAIEmbedder`, and
`LocalTransformerEmbedder`. The proper fix (delete this file OR
gate re-exports behind a build-time flag) would BREAK every
in-tree consumer of `import { ... } from '@usetheo/memory/embedders'`
simultaneously and belongs to a sibling Cycle (not this fix-up).
Confirming as REAFFIRMED, NOT CLOSED — honest scope-out.


- **Found by:** review-adapters-openrouter-local-embedder-domain-memory-layer
- **File:** `src/embedders/index.ts`
- **Plan reference:** ADR D7 (subpath-only embedder exports — Cycle 2 precedent for OpenAIEmbedder + this cycle for LocalTransformerEmbedder)
- **Domain anchor:** architecture.md § 9 (Public API surface — subpath exports)

### F-dom-rerun-5: F-M5 closed with a correctly-shaped reset. `getPipeline` captures
the created Promise in a local `created` binding, assigns
`_pipelinePromise = created` synchronously, then schedules a
`.catch(() => { if (_pipelinePromise === created) _pipelinePromise = null; })`
microtask. The identity check correctly handles the concurrent-
overwrite case: if a later attempt has already swapped
`_pipelinePromise` to a fresh (succeeding) Promise, the catch on
the original rejected instance is a NO-OP (the slot already holds
the new winner). The JSDoc above the singleton also corrects the
original misleading reference to "OpenAI precedent" — it now
explains that OpenAIEmbedder is sync (constructor cannot reject)
and is qualitatively different.

JS single-thread invariant analysis: microtask ordering guarantees
that any caller observing the rejected `_pipelinePromise` between
its rejection and the catch handler running will await it, see
the rejection, and bail. The NEXT caller after the catch runs will
see `_pipelinePromise === null` and retry. There is no window where
a second caller can start a fresh attempt WHILE the catch is still
pending (no thread/preemption in V8 main-thread). The identity
check covers the edge case where Caller A's rejection lands AFTER
Caller A's own continuation has explicitly assigned a new Promise
to the slot (unusual but possible if A handles the rejection by
re-invoking getPipeline before the catch fires — which itself is
a no-op because B's invocation would have seen `_pipelinePromise`
already non-null at the time it ran).


- **Found by:** review-adapters-openrouter-local-embedder-domain-memory-layer
- **File:** `src/embedders/local.ts`
- **Plan reference:** plan v1.2 header (F-M5 closure)
- **Domain anchor:** architecture.md § 8 (Retry only for transient errors)

### F-dom-rerun-6: F-Mi4 closure shape is correct. New `InvalidEmbeddingDim` class:
  - `extends Error` ✓
  - `override readonly name = 'InvalidEmbeddingDim' as const` ✓
    (matches the rest of the taxonomy — single literal type lets
    consumers narrow via `e.name === 'InvalidEmbeddingDim'` in
    addition to `instanceof`)
  - Constructor accepts `(received: unknown, maxDim: number,
    options?: ErrorOptions)` — `received: unknown` is the correct
    ergonomic since the boundary check is the place where the
    caller's unverified input lands; forcing them to `as number`
    first would defeat the diag pipeline.
  - Calls `super(...)` with full diagnostic message including
    BOTH the verbatim received value (via `String(received)`)
    AND the locked upper cap. This matches the operator-
    diagnosability rule absorbed at EC-1.
  - Calls `Object.setPrototypeOf(this, InvalidEmbeddingDim.prototype)`
    per the pattern locked at the top of `errors.ts` (EC-2
    ESM/CJS/dynamic-import/worker_threads compatibility).
  - Receives `options` and propagates to `super(..., options)` —
    chains cause cleanly.
The class is wired via `validateEmbeddingDim` (src/local/index.ts
line 712) which now throws `new InvalidEmbeddingDim(received,
MAX_EMBEDDING_DIM)`. The error class is re-exported via the
`src/local/index.ts` import line 39 (alongside other taxonomy
classes) so consumers `import { InvalidEmbeddingDim } from '@usetheo/memory'`
directly.


- **Found by:** review-adapters-openrouter-local-embedder-domain-memory-layer
- **File:** `src/core/errors.ts`
- **Plan reference:** plan v1.2 header (F-Mi4 closure — error taxonomy split)
- **Domain anchor:** architecture.md § 8 (Domain errors are typed classes — exported from src/core/errors.ts)
- **Evidence:**

  src/core/errors.ts:48-59 class definition matches the pattern at
  lines 19-26 (InvalidScope) and 28-36 (EmbeddingMismatch).


### F-dom-rerun-7: Tests migrated from InvalidScope to InvalidEmbeddingDim correctly.
All 5 EC-1 guard variants (NaN, 384.5, Infinity, 0, >MAX) now
assert `rejects.toThrow(InvalidEmbeddingDim)` + a literal-value
regex. Verified that the new error message
`embeddingDim must be a positive integer ≤ 1536; got ${String(received)}`
still satisfies every literal-value regex in the test:
  - `/NaN/`        → matches "got NaN" ✓
  - `/384\.5/`     → matches "got 384.5" ✓
  - `/Infinity/`   → matches "got Infinity" ✓
  - `/0/`          → matches "got 0" ✓
  - `/MAX_EMBEDDING_DIM+512/` → matches the literal received ✓
  - `/MAX_EMBEDDING_DIM/`     → matches "≤ 1536" ✓
Also the probe-result mismatch test at line 230 still asserts
`/expected 384/` + `/got 768/` (which targets EmbeddingMismatch's
DIFFERENT message — taxonomy split is honored end-to-end:
InvalidEmbeddingDim for config-shape errors, EmbeddingMismatch
for probe-result mismatches).


- **Found by:** review-adapters-openrouter-local-embedder-domain-memory-layer
- **File:** `src/local/__tests__/factory.test.ts`
- **Plan reference:** plan v1.2 header (F-Mi4 closure — test migration)
- **Domain anchor:** testing.md § What to test (typed errors at boundaries)

### F-dom-rerun-8: F-Mi2 deep-readonly enforcement verified correct at both type AND
runtime layers.
  - Type layer: return-type annotated `readonly (readonly number[])[]`
    on the inner-arrow signature `(_, i): readonly number[]`.
  - Runtime layer: each inner array is constructed via
    `Object.freeze(Array.from(flat.slice(start, end)))` — the
    `Array.from` materializes the typed-array slice into a
    regular mutable `number[]`, then `Object.freeze` prevents
    mutation of indexed slots, length, and proto.
  - Outer array is a readonly array of frozen inner arrays. ES2015+
    modules run in strict mode by default, so mutation attempts
    throw `TypeError` at runtime — not silently dropped.
The freeze is shallow (does not recursively freeze the numbers,
which is fine — primitives are immutable). The performance cost
is O(N_inner) per row's Object.freeze internal flag set — trivial.


- **Found by:** review-adapters-openrouter-local-embedder-domain-memory-layer
- **File:** `src/embedders/local.ts`
- **Plan reference:** plan v1.2 header (F-Mi2 closure — deep-readonly enforcement)
- **Domain anchor:** architecture.md § 7 (TypeScript strict mode; no `any`)

### F-dom-rerun-9: F-Mi1 JSDoc rationale block added. The rationale is correctly
shaped — explains that the model id + dim are fixed at
module-level constants, that exposing them via constructor would
imply interchangeability (NOT true given the schema/runMigrations
coupling), and cites Inquebrável Rule 11 (YAGNI) as the discipline.
Good operator-facing prose; future contributor reading this will
not silently add a constructor parameter.


- **Found by:** review-adapters-openrouter-local-embedder-domain-memory-layer
- **File:** `src/embedders/local.ts`
- **Plan reference:** plan v1.2 header (F-Mi1 closure)
- **Domain anchor:** KISS / YAGNI (Inquebrável Rule 10 + 11)

### F-dom-rerun-10: F-M5 retry test exercises the rejection-reset contract end-to-end
using `vi.doMock('@xenova/transformers', ...)` to simulate a
transient HF CDN failure on the first call and a successful
pipeline on the second. The test asserts that:
  (a) first `embed('first')` rejects with the simulated error ✓
  (b) second `embed('second')` returns a 384-dim vector ✓
  (c) `pipeline()` was called TWICE — proving the singleton reset
      cleared the rejected cache instead of returning it forever ✓
Test uses `vi.resetModules()` to isolate from the previous
describe block's real-module state, then dynamically imports
LocalTransformerEmbedder so the module-level `_pipelinePromise`
starts fresh at null. EC-5 (empty-string embed) is also covered
with a 384-dim length assertion + finite-number assertion (no
NaN/Inf from a divide-by-zero in mean-pooling).


- **Found by:** review-adapters-openrouter-local-embedder-domain-memory-layer
- **File:** `src/embedders/__tests__/local.test.ts`
- **Plan reference:** plan v1.2 header (F-M12 EC-5 + EC-7 closure)
- **Domain anchor:** testing.md § Determinism (LLM stubs in unit tests)

### F-tests-1: INFO: closed by commit f75e980 — F-M1 EC-3 atomic ROLLBACK regression test added.

- **Found by:** review-adapters-openrouter-local-embedder-tests
- **File:** `tests/integration/migrations/dim-change.test.ts:178-210`
- **Plan reference:** T0.3 § TDD `test_runMigrations_atomic_rollback_on_mid_sequence_failure` + EC-3
- **Evidence:**

  New `it('EC-3 atomic rollback: ...')` case at line 178 injects a VIEW
  dependency on memories.embedding, which causes ALTER COLUMN TYPE to
  fail mid-BEGIN. Post-rollback assertions verify (a) dim still 1536,
  (b) both HNSW indexes intact (proving the DROP INDEX inside the same
  BEGIN was rolled back). The test exercises the actual BEGIN/COMMIT/
  ROLLBACK wrapper at src/local/index.ts:929/950/956 — not just the
  structural code. AAA structure clean; single behavior; finally{} ends
  pool so beforeEach can DROP DATABASE on next iter.


### F-tests-2: INFO: closed by commit f75e980 — F-M8 SELECT consolidation_history post-distill added.

- **Found by:** review-adapters-openrouter-local-embedder-tests
- **File:** `tests/integration/examples/chat-with-memory-local-openrouter.test.ts:166-177`
- **Plan reference:** T4.1 § AC line 918 "non-zero consolidation_history row count"
- **Evidence:**

  The pre-existing distill 200 + invocationId test (lines 126-165) was
  augmented with a SELECT COUNT(*) on consolidation_history filtered by
  policy_name='last-write-wins'. Asserts `c >= 1` proving the audit row
  actually landed. The beforeEach at line 83-84 DELETEs all rows for the
  three known policies (last-write-wins, noop, llm-judged-merge) so
  cross-test pollution cannot fool this assertion. Catches the
  silent-no-op factory regression mode the original F-M8 flagged.


### F-tests-3: INFO: closed by commit f75e980 — F-M9 /api/chat E2E test added.

- **Found by:** review-adapters-openrouter-local-embedder-tests
- **File:** `tests/integration/examples/chat-with-memory-local-openrouter.test.ts:185-222`
- **Plan reference:** T4.1 § TDD
- **Evidence:**

  New `it('POST /api/chat seeds a memory row with embedding length 384 + scope user_id matching')`
  posts an actual chat message and polls the memories table for up to
  5s for the async embed+INSERT to land. Asserts (a) status 200, (b)
  row count >= 1 scoped to TEST_USER, (c) embedding text-cast has
  exactly 384 comma-separated values (i.e., commaCount + 1 === 384).
  Exercises the full chat → LLM → embed → INSERT path, not just the
  structural atttypmod proxy from the existing test at line 101-114.
  Polling is bounded (5s deadline) — acceptable for an HTTP integration
  test where the embed pipeline runs out of band.


### F-tests-4: INFO: closed by commit f75e980 — F-M12 EC-5 empty-string embed test added.

- **Found by:** review-adapters-openrouter-local-embedder-tests
- **File:** `src/embedders/__tests__/local.test.ts:108-116`
- **Plan reference:** edge-case review § EC-5 (empty string embed)
- **Evidence:**

  `test('EC-5: embed(\"\") returns a 384-dim vector (no crash on empty input)')`
  asserts both length === 384 AND that every component is finite via
  Number.isFinite — defends against silent NaN/Inf from mean-pool
  divide-by-zero on BOS+EOS-only token sequence. Strong assertions
  (length + finiteness), no .toBeDefined cop-out.


### F-tests-5: INFO: closed by commit f75e980 — F-M12 EC-7 + F-M5 retry test added.

- **Found by:** review-adapters-openrouter-local-embedder-tests
- **File:** `src/embedders/__tests__/local.test.ts:129-169`
- **Plan reference:** edge-case review § EC-7 (warmup network failure) + /review F-M5
- **Evidence:**

  New `describe('LocalTransformerEmbedder — F-M5 / EC-7 retry on transient
  pipeline failure')` block uses `vi.doMock('@xenova/transformers')` to
  simulate HF CDN rejection on the FIRST pipeline() call and success on
  the SECOND. Test asserts:
    - 1st embed() rejects with `/simulated HF CDN failure/`
    - 2nd embed() returns a 384-length vector
    - `callCount === 2` (proving retry path was taken)
  The third assertion is load-bearing — it proves the F-M5 fix at
  src/embedders/local.ts:78-79 (`_pipelinePromise = null` on rejection)
  is actually wired. Mock setup is tight (one module, two behaviors);
  vi.resetModules at boundaries; vi.doUnmock in cleanup. Clean AAA.


### F-tests-6: INFO: closed by commit f75e980 — F-M12 EC-10 warnIfLocalOpenrouterMissingBaseUrl tests added.

- **Found by:** review-adapters-openrouter-local-embedder-tests
- **File:** `tests/unit/examples/chat-with-memory-memory.test.ts:135-168`
- **Plan reference:** edge-case review § EC-10 + /review F-M12 EC-10
- **Evidence:**

  New `describe('warnIfLocalOpenrouterMissingBaseUrl (T2.1 / EC-10)')`
  block contains 3 tests covering:
    1. OPENAI_BASE_URL missing → console.warn called once with msg
       matching both /OPENAI_BASE_URL/ AND /local-openrouter/
    2. OPENAI_BASE_URL=='' → still warns
    3. OPENAI_BASE_URL set to OpenRouter URL → silent
  Uses vi.spyOn(console, 'warn').mockImplementation; cleanup in afterEach.
  env-var snapshot pattern matches the precedence-ladder describe block
  above (DRY via shared snapshot/restore helpers). Each test isolates
  ONE behavior; AAA discipline preserved.


### F-tests-7: INFO: closed by commit 544f88e — F-Mi11 split 'and' test names.

- **Found by:** review-adapters-openrouter-local-embedder-tests
- **File:** `src/embedders/__tests__/local.test.ts:69-83, 96-101`
- **Plan reference:** testing.md § Anti-patterns "no 'and' in test names" + /review F-Mi11
- **Evidence:**

  Originally a single `test('embedBatch returns 3 vectors AND per-row dim is 384 AND L2-normalized')`
  now split into 3 atomic tests at lines 69-75 / 77-83 / 85-92 (each
  asserts ONE invariant). Likewise the singleton/batch-of-one
  comparison renamed from "embed and embedBatch agree on identical
  input" to "batch-of-one matches singleton output for the same text".
  Each new test obeys the AAA structure and tests exactly one behavior.


### F-tests-9: INFO: closed by commit 544f88e — F-Mi12 per-suite UUID TEST_USER added.

- **Found by:** review-adapters-openrouter-local-embedder-tests
- **File:** `tests/integration/examples/chat-with-memory-local-openrouter.test.ts:69`
- **Plan reference:** /review F-Mi12 non-unique TEST_USER
- **Evidence:**

  Was `const TEST_USER = 't4-1-local-openrouter-user';` (static string).
  Now `const TEST_USER = \`t4-1-${randomUUID()}\`;` via `randomUUID()`
  from `node:crypto`. Each suite invocation now uses a fresh user_id,
  eliminating cross-run pollution in shared dev DB scenarios.


### F-tests-M6: INFO: closed by commit f75e980 — F-M6 destructive cascade fires-as-documented test added.

- **Found by:** review-adapters-openrouter-local-embedder-tests
- **File:** `tests/integration/migrations/dim-change.test.ts:215-284`
- **Plan reference:** /review F-M6 destructive DELETE cascade verification
- **Evidence:**

  New `it('destructive cascade: seeded rows wiped + FK cascades fire as documented')`
  seeds 1 memory + 1 history row + 1 consolidation_history row, then
  runs `runMigrations(pool, { embeddingDim: 384 })`. Asserts the THREE
  distinct cascade arms documented at F-C1:
    (a) memories COUNT == 0 (DELETE FROM memories ran)
    (b) history empty per ON DELETE CASCADE
    (c) consolidation_history row survives but kept_memory_id IS NULL
        per ON DELETE SET NULL
  Each assertion targets a different FK semantic — verifies the
  cascade graph documented in CHANGELOG/README/JSDoc is empirically
  accurate. Strong empirical anchor for F-C1's honesty alignment.


### F-tests-M7: INFO: closed by commit f75e980 — F-M7 push-flow regression test added.

- **Found by:** review-adapters-openrouter-local-embedder-tests
- **File:** `tests/integration/migrations/dim-change.test.ts:290-311`
- **Plan reference:** /review F-M7 push-flow dim-change RED test
- **Evidence:**

  New `it('push-flow: orphan-schema branch still applies parametric dim change')`
  bootstraps the schema via runMigrations() then DROPs the
  drizzle.__drizzle_migrations + drizzle schema to mimic the
  `drizzle-kit push` state. Re-invokes with embeddingDim=384 and
  asserts both columns are now vector(384). Closes the Inquebrável
  Rule 5 (TDD-first) gap that the T4.1 hotfix opened — push-flow path
  is now under regression coverage. Test is self-contained
  (manages its own pool lifecycle in finally{}).


### F-tests-Mi4: INFO: closed by commit 544f88e — F-Mi4 5 tests rewired to InvalidEmbeddingDim.

- **Found by:** review-adapters-openrouter-local-embedder-tests
- **File:** `src/local/__tests__/factory.test.ts:163-216`
- **Plan reference:** /review F-Mi4 InvalidEmbeddingDim conflation with InvalidScope
- **Evidence:**

  Tests at lines 163, 174, 185, 196, 207 now import `InvalidEmbeddingDim`
  from `../../core/errors.js` (verified present at src/core/errors.ts:48)
  and assert via `.rejects.toThrow(InvalidEmbeddingDim)` instead of the
  previously-conflated InvalidScope. Each test also asserts the literal
  received value appears in the error message (NaN / 384.5 / Infinity /
  0 / received-too-large) — strong operator-diagnosability assertions.
  Pre-test the file also asserts the upper-bound MAX_EMBEDDING_DIM is
  named in the rejection message (line 227). Plan deferred naming, the
  /review caught it, and the fix closes the deferral cleanly.


### F-tests-Mi6: INFO: closed by commit 3c7ada0 — F-Mi6 typed EmbeddingMismatch in PgvectorStore.search guard.

- **Found by:** review-adapters-openrouter-local-embedder-tests
- **File:** `src/local/__tests__/pgvector-store.test.ts:92-106`
- **Plan reference:** /review F-Mi6 PgvectorStore.search guard bare Error → typed EmbeddingMismatch
- **Evidence:**

  Test at line 92 now asserts `rejects.toBeInstanceOf(EmbeddingMismatch)`
  instead of the prior bare Error. Symmetry with the createLocalMemory
  boot-time probe — both paths now throw the typed EmbeddingMismatch
  class from src/core/errors.ts:28. Diff body at line 100-101 confirms
  the assertion. The test also still asserts the message names /384/
  (configured dim, not the constant) preserving F-M15 operator-
  diagnosability.


### F-tests-Q1: INFO: AAA discipline holds across all 11 added/modified tests.

- **Found by:** review-adapters-openrouter-local-embedder-tests
- **File:** `src/embedders/__tests__/local.test.ts:34-167`
- **Evidence:**

  Scanned all 19 new test() blocks (git diff 4b5b0e7^..HEAD -- '**/*.test.ts'
  shows 19 added test/it definitions and 36 added expect() calls — ~1.9
  assertions per test, healthy). No test asserts only side-effects
  (.toBeDefined() cop-outs) when an explicit value is testable:
    - F-M5 retry test asserts callCount === 2 (load-bearing)
    - EC-5 empty embed asserts length === 384 AND Number.isFinite per
      component (not just .toBeDefined)
    - F-M9 chat test asserts row count >= 1 AND embedding has exactly
      384 commas+1 entries (not just .toBeDefined on response)
    - F-M6 cascade asserts row counts == 0 AND kept_memory_id IS NULL
      (3 distinct empirical anchors)
    - F-M1 rollback asserts dim still 1536 AND both indexes still exist
  No "and" in any newly-added test name (`git diff | grep new test
  names | grep -i \band\b` returns empty). F-Mi11 closures confirmed
  via grep on the local.test.ts file — old "and" names are gone, split
  into atomic tests.


### F-tests-Q2: INFO: F-M5 retry test uses vi.doMock + vi.resetModules correctly.

- **Found by:** review-adapters-openrouter-local-embedder-tests
- **File:** `src/embedders/__tests__/local.test.ts:131`
- **Evidence:**

  The mock setup is the tightest pattern available — `vi.doMock` is
  called BEFORE the dynamic `await import('../local.js')` so the
  module-level singleton is fresh, with the mocked transformers in
  place. `vi.resetModules()` brackets both ends; `vi.doUnmock` cleans
  up after. The mock implementation closes over `callCount` which is
  read after both embed() calls — no race; serial assertions. Mirrors
  the testing.md rule "mocks must be precise" (one module, two
  behaviors keyed off a counter). 60_000 ms timeout is appropriate
  for the dynamic import + mock teardown.


### F-tests-Q3: INFO: F-M9 /api/chat polling is bounded + deterministic-ish.

- **Found by:** review-adapters-openrouter-local-embedder-tests
- **File:** `tests/integration/examples/chat-with-memory-local-openrouter.test.ts:185-222`
- **Evidence:**

  The 5-second polling window with 250ms inter-poll sleep is acceptable
  for an HTTP integration test gated by `describe.skipIf(!reachable)`.
  The deadline-based loop terminates on first non-zero rowCount —
  bounded worst-case is 5s + one HTTP round-trip. Risk of flakiness is
  low because: (a) the dev server runs synchronously locally, (b) PG
  INSERT is single-row, (c) the assertion is `>= 1` (not exact count)
  so a late second INSERT doesn't matter. The comma-counting check at
  line 220-221 is robust against bracket placement and whitespace.


### F-tests-Q4: INFO: F-M1 rollback test exploits VIEW dependency cleanly — no synthetic mock needed.

- **Found by:** review-adapters-openrouter-local-embedder-tests
- **File:** `tests/integration/migrations/dim-change.test.ts:178-210`
- **Evidence:**

  Using `CREATE VIEW v_embed_dep AS SELECT id, embedding FROM memories`
  to trigger ALTER COLUMN TYPE failure is the canonical PostgreSQL
  pattern (PG blocks `ALTER TYPE` on columns referenced by views with
  error "cannot alter type of a column used by a view or rule"). The
  test correctly anchors the rollback path inside the SAME BEGIN that
  DROPped both HNSW indexes — when ROLLBACK fires, the DROP is undone,
  and the post-rollback `indexExists` assertions on both indexes prove
  the atomicity contract. Cleaner than monkey-patching pg.Pool to
  throw mid-sequence; uses pure SQL semantics.


### F-tests-EC2: INFO: EC-2 remains explicitly deferred in plan T0.2 § Out-of-scope; not in scope for this fix-up cycle.

- **Found by:** review-adapters-openrouter-local-embedder-tests
- **File:** `docs only`
- **Plan reference:** plan T0.2 § Out-of-scope (EC-2 constructor-dim vs schema-dim mismatch)
- **Evidence:**

  Per src/local/__tests__/pgvector-store.test.ts:19-22 + plan T0.2,
  "EC-2 SHOULD TEST checkpoint; defer to T0.3 follow-up". This is an
  honest deferral documented in the plan and the test file header.
  Not a regression introduced by this cycle — surface to follow-up
  cycle if the operator-diagnosability path requires hardening.


### F-rerun-wire-1: Cascade-enumeration log text is emitted but never asserted by an integration test

- **Found by:** review-adapters-openrouter-local-embedder-wiring
- **File:** `src/local/index.ts:916`
- **Plan reference:** /review 2026-06-02 F-C1 + plan v1.2 ADR D3 amendment
- **Evidence:**

  The applyDimChange console.error line at 916 enumerates the full FK cascade
  (history ON DELETE CASCADE + consolidation_history ON DELETE SET NULL +
  memories.superseded_by ON DELETE SET NULL). The BEHAVIOR is asserted via
  the F-M6 destructive-cascade test (post-DELETE rowcounts on memories /
  history / consolidation_history). The LOG TEXT itself is verified only by
  manual code review — no spyOn(console, 'error') guards a future log-text
  regression (e.g., someone trimming the cascade enumeration accidentally).

- **Recommended action:** OPTIONAL — add console.error spy assertion in the F-M6 destructive-cascade
test (~5 lines) to lock the log-text contract. NOT blocking re-run verdict.


### F-rerun-wire-2: getPipeline rejected-promise lost-race guard has no dedicated test (defensive no-op)

- **Found by:** review-adapters-openrouter-local-embedder-wiring
- **File:** `src/embedders/local.ts:73-81`
- **Plan reference:** /review 2026-06-02 F-M5 + EC-7 absorption
- **Evidence:**

  The catch handler at lines 73-81 includes a "lost the race against another
  caller" branch: only nulls `_pipelinePromise` if it still holds the THIS-call
  rejected instance. This guard prevents nulling a successful Promise that a
  concurrent caller stored after the rejection. The lost-race path is a
  defensive no-op (the alternative is also safe — just a wasted reset) and is
  JS-single-thread-protected: only one synchronous block runs at a time, so
  the only path where `_pipelinePromise !== created` is when another caller's
  retry already replaced the slot. Not a behavior worth asserting empirically.



## Handoff decision

Implementation passes all gates. Ready for merge.

## Audit trail

Spawned agents (their findings files live alongside this report):

- `.claude/agents/review-adapters-openrouter-local-embedder-2026-06-02-rerun-2026-06-02/architecture.md`
- `.claude/agents/review-adapters-openrouter-local-embedder-2026-06-02-rerun-2026-06-02/cross-validation.md`
- `.claude/agents/review-adapters-openrouter-local-embedder-2026-06-02-rerun-2026-06-02/domain-db-migrations.md`
- `.claude/agents/review-adapters-openrouter-local-embedder-2026-06-02-rerun-2026-06-02/review-adapters-openrouter-local-embedder-domain-memory-layer.md`
- `.claude/agents/review-adapters-openrouter-local-embedder-2026-06-02-rerun-2026-06-02/domain-pgvector-schema.md`
- `.claude/agents/review-adapters-openrouter-local-embedder-2026-06-02-rerun-2026-06-02/review-adapters-openrouter-local-embedder-tests.md`
- `.claude/agents/review-adapters-openrouter-local-embedder-2026-06-02-rerun-2026-06-02/review-adapters-openrouter-local-embedder-wiring.md`

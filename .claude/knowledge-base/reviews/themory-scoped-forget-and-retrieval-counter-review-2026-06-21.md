# Review: themory-scoped-forget-and-retrieval-counter

**Date:** 2026-06-21
**Verdict:** READY_TO_MERGE
**Reviewers (spawned agents):** 7 (architecture, review-themory-scoped-forget-and-retrieval-counter-cross-validation, review-themory-scoped-forget-and-retrieval-counter-domain-api-design, review-themory-scoped-forget-and-retrieval-counter-domain-memory-layer, review-themory-scoped-forget-and-retrieval-counter-domain-pgvector-schema, review-themory-scoped-forget-and-retrieval-counter-tests, review-themory-scoped-forget-and-retrieval-counter-wiring)
**Total findings:** 24

## Findings summary by severity

| Severity | Count |
|---|---|
| BLOCKER | 0 |
| HIGH | 0 |
| MEDIUM | 2 |
| LOW | 7 |
| INFO | 15 |

## MEDIUM findings (2)

### F-tests-1: The plan T2.3 explicitly specifies an END-TO-END concurrency test (20 concurrent recall() calls through the core recall path -> count == 20) to prove the fail-soft increment inside LocalScopedMemory.recall() does not lose updates under contention. Only the store-level test exists (T2.2: 50 concurrent store.increment()). The end-to-end recall path (which adds the gate + try/catch + result-then-increment ordering) is never raced. The atomicity guarantee is at the SQL layer so the risk is low, but the plan-named test is absent — a regression in the recall wiring (e.g. increment moved outside a guard, or awaited serially) would not be caught.


- **Found by:** review-themory-scoped-forget-and-retrieval-counter-tests
- **File:** `tests/integration/scope-usage-counter.test.ts` line 99
- **Plan reference:** T2.3 #### Concurrency tests — 'Atomic-counter invariant (end-to-end) — 20 concurrent recall() on user(alice) via Promise.all -> getRecallCount == 20'
- **Evidence:**

  grep 'Promise.all' tests/integration/scope-usage-counter.test.ts -> only line 101,
  inside "T2.2 ... 50 concurrent increments" calling store.increment directly.
  No test issues N concurrent memory.user(x).recall(...) and asserts count == N.

- **Recommended action:** Add the plan-specified test: remember once, fire ~20 concurrent memory.user('x').recall(...) via Promise.all, assert reader.getRecallCount == 20. Closes the end-to-end atomicity gap.


### F-tests-2: The EC-1 test ('hard forget of an entity-linked memory succeeds via CASCADE') seeds a memory_entities link only. The plan's EC-1 deep-dive explicitly calls out that a post-slice1/2 memory may ALSO be an entity_edges.source_memory_id, and that the hard DELETE must not throw an FK violation on that reference. The 0019 migration confirms entity_edges.source_memory_id IS ON DELETE cascade (so the prod path is correct), but the test never seeds an entity_edges row pointing at the deleted memory, so the source_memory_id CASCADE branch is asserted by reasoning, not by the test. If a future migration changed that FK to RESTRICT/NO ACTION, this test would stay green while prod hard-delete started 500-ing.


- **Found by:** review-themory-scoped-forget-and-retrieval-counter-tests
- **File:** `tests/integration/scoped-forget.test.ts` line 98
- **Plan reference:** T1.1 Deep Dives EC-1 + RED test_hard_forget_of_entity_linked_memory_succeeds — names BOTH memory_entities AND entity_edges.source_memory_id
- **Evidence:**

  tests/integration/scoped-forget.test.ts:99-108 inserts into entities + memory_entities only.
  grep 'entity_edges' in the file -> only TRUNCATE lines (42/135/173), no INSERT.
  Migration 0019:17 — entity_edges_source_memory_id_memories_id_fk ... ON DELETE cascade.

- **Recommended action:** Extend the EC-1 test (or add a sibling) to also INSERT an entity_edges row with source_memory_id = the target memory, then assert hard forget succeeds and the edge row is gone — exercising the source_memory_id CASCADE the plan named.



## LOW findings (7)

### F-xval-1: Test-file location diverged from plan: plan declared co-located unit test paths (e.g. scoped-memory.test.ts, pg-usage-counter-store.test.ts, metrics.test.ts) but all RED tests landed under tests/integration/ (scoped-forget.test.ts, scope-usage-counter.test.ts) + the API contract test extended metrics-entities.test.ts. The plan's single named GOAL file tests/integration/scoped-forget-and-counter.test.ts does NOT exist — it was split into scoped-forget.test.ts (Goal a) + scope-usage-counter.test.ts (Goal b).

- **Found by:** review-themory-scoped-forget-and-retrieval-counter-cross-validation
- **File:** `tests/integration/scoped-forget.test.ts, tests/integration/scope-usage-counter.test.ts`
- **Plan reference:** T1.1 Files-to-edit (line 188: packages/core/src/infrastructure/db/scoped-memory.test.ts), T1.2 (line 272: scoped-forget.test.ts co-located), T2.1/T2.2/T2.3 (co-located *.test.ts), Final Phase (line 609: tests/integration/scoped-forget-and-counter.test.ts)
- **Evidence:**

  Plan T1.1 line 188: "packages/core/src/infrastructure/db/scoped-memory.test.ts — RED tests first" — file not created; tests in tests/integration/scoped-forget.test.ts.
  Plan Final Phase lines 48,609: "tests/integration/scoped-forget-and-counter.test.ts (NEW) — GOAL test" — file absent; two files cover (a)+(b).
  `ls tests/integration/scoped-forget-and-counter.test.ts` -> not found.

- **Recommended action:** Accept the divergence; optionally add an explicit line in the implementation contract that the plan-named scoped-forget-and-counter.test.ts was realized as two integration files. No code change required.

### F-xval-2: Coverage Acceptance Criteria are structurally unverifiable: the plan repeatedly demands `npm run test:coverage` 100% on critical paths, but no `test:coverage` script exists in package.json. The post-implementation validation report SKIP'd the coverage check for exactly this reason ('no test:coverage script in package.json').

- **Found by:** review-themory-scoped-forget-and-retrieval-counter-cross-validation
- **File:** `packages/core/src/infrastructure/db/scoped-memory.ts; multiple task Acceptance Criteria`
- **Plan reference:** T1.1 AC line 247, T2.2 AC line 439, T2.3 AC line 505 ('npm run test:coverage 100% on the new ... critical path'); Global DoD line 612; Final Phase Execution line 611
- **Evidence:**

  package.json scripts: only "test" (vitest.contract) + "test:integration" (vitest.integration). No "test:coverage".
  Validation report .../implement-validate-2026-06-21.md: "coverage — SKIP — Reason: no 'test:coverage' script in package.json".
  Plan T1.1 AC: "- [ ] Pass: coverage — `npm run test:coverage` 100% on the new deleteInScope + forget (critical path)."

- **Recommended action:** Either (a) add a `test:coverage` script (vitest --coverage) and run it on the changed files, or (b) amend future plan templates to stop asserting a non-existent script. Do not block merge — behavioral coverage is demonstrably strong.

### F-xval-4: InMemoryVectorStore.deleteInScope is implemented with 2 params (vectorId, filters) — it silently drops the `hard` param the interface declares. TS structural typing allows the narrower impl (method param bivariance), so typecheck passes, but the in-memory adapter ignores `hard` entirely.

- **Found by:** review-themory-scoped-forget-and-retrieval-counter-cross-validation
- **File:** `packages/core/src/infrastructure/db/in-memory-store.ts:208`
- **Plan reference:** T1.1 Pseudo-code (line 209) declares deleteInScope(id, filters, hard); VectorStore interface (vector-store.ts:139) requires 3 params
- **Evidence:**

  interface: deleteInScope(vectorId: string, filters: Filters, hard: boolean): Promise<boolean>  (vector-store.ts:139)
  in-memory impl: async deleteInScope(vectorId: string, filters: Filters): Promise<boolean>  (in-memory-store.ts:208)
  JSDoc explains: "In-memory has no t_invalid, so soft and hard both physically remove" — intentional.

- **Recommended action:** Optional: accept `_hard: boolean` in the in-memory signature to make interface conformance explicit (matches the synthetic stub in vector-store.test-d.ts which also returns false). No functional impact; do not block.

### F-tests-3: Cross-workspace 404 is proven at the deleteInScope primitive layer (line 84) but never through the DELETE /v1/scopes/... route. The REST suite proves cross-SUBJECT 404 only. Because workspace is resolved from the credential (Principal) and not the path, the REST path that derives the workspace filter is a distinct concern from subject narrowing; the AC pairs the two checks at every layer. Risk is low (primitive coverage exists and the handler forwards both MemoryNotFound and WorkspaceMismatch -> 404), but the handler-level cross-workspace path is untested.


- **Found by:** review-themory-scoped-forget-and-retrieval-counter-tests
- **File:** `tests/integration/scoped-forget.test.ts` line 156
- **Plan reference:** T1.1 Acceptance Criteria — 'cross-subject AND cross-workspace both -> MemoryNotFound (404 upstream)'; T1.2 surfaces it over REST
- **Evidence:**

  REST cross-workspace test absent: grep 'cross-workspace' shows only the primitive test
  (line 84). T1.2 describe block (line 156+) has cross-subject (192) but no workspace variant.

- **Recommended action:** Add a REST test seeding under workspace w1 and issuing the DELETE under a credential resolving to w2 (or 'default'), asserting 404 + victim intact — mirroring the cross-subject REST test through the auth-resolved workspace filter.


### F-tests-4: The MEMORY_EVENTS test asserts an exact magic count ('has 24 values'). This is a brittle structural assertion (every new event literal forces a hand-edit of the number), and the test name encodes the count rather than the behavior. It is paired with a behavior assertion (`includes retrieval_counted_failed`) which is the load-bearing one. Pre-existing pattern in the file, but the T2.3 edit propagates it (23->24). Minor.


- **Found by:** review-themory-scoped-forget-and-retrieval-counter-tests
- **File:** `packages/core/src/domain/memory-event.test.ts` line 11
- **Plan reference:** testing.md Anti-patterns — 'describe behavior, not method/count'; T2.3 appends retrieval_counted_failed
- **Evidence:**

  memory-event.test.ts:11 — test('has 24 values (23 prior + retrieval_counted_failed ...)')
  expect(MEMORY_EVENTS).toHaveLength(24)

- **Recommended action:** Keep the `toContain('retrieval_counted_failed')` behavior test (line 15, good); consider relaxing the exact-length assertion to `>= N` or dropping it — it adds maintenance cost without catching a behavior bug the toContain tests miss. Non-blocking.


### F-wire-1: The fail-soft test asserts recall() resolves (does not reject) when the counter throws, but does NOT assert the retrieval_counted_failed OTel event is actually emitted. The event emission is present in production code (scoped-memory.ts recall catch) and the auditability requirement (Princípio 3) is met in code, but the observability signal itself is unverified by a test.


- **Found by:** review-themory-scoped-forget-and-retrieval-counter-wiring
- **File:** `tests/integration/scope-usage-counter.test.ts` line 178
- **Plan reference:** T2.3 — retrieval_counted_failed OTel event on fail-soft path
- **Evidence:**

  scope-usage-counter.test.ts:178-196 mocks a throwing counter and asserts
  `resolves.toBeDefined()` + increment called once — no spy/assert on emitEvent
  / the 'retrieval_counted_failed' literal. Pillar (c) for THIS symbol relies on
  code inspection, not an observed metric.

- **Recommended action:** Add an assertion on the tracer/emitEvent spy that 'retrieval_counted_failed' fired in the throwing-counter case. Non-blocking.


### F-wire-2: The plan named an end-to-end "20 concurrent recall() -> count == 20" concurrency test (recall-counter-concurrency). Only the store-level "50 concurrent increment -> 50" test was added. The atomicity guarantee is the SAME single ON CONFLICT SQL statement that recall() invokes, so the recall path inherits the proven atomicity; the missing end-to-end variant is redundant rather than a real gap.


- **Found by:** review-themory-scoped-forget-and-retrieval-counter-wiring
- **File:** `tests/integration/scope-usage-counter.test.ts` line 99
- **Plan reference:** T2.3 § Concurrency tests — 20 concurrent recall() -> count == 20
- **Evidence:**

  scope-usage-counter.test.ts:99-107 proves atomicity at the increment() SQL level
  (the only mutating op). No separate Promise.all-of-recalls concurrency test exists.

- **Recommended action:** Optionally add the end-to-end concurrent-recall test for completeness against the plan's wording, OR note in the implementation log that the store-level atomicity test subsumes it (the SQL is identical). Non-blocking.



## INFO findings (15)

### F-xval-3: T2.3 edited 3 p0-audit baseline tests (export-count 9->13 root, 43->47 contract) that are NOT in any task's declared Files-to-edit. The implementer disclosed this in the commit body as a fix for sentinels that were ALREADY RED on develop.

- **Found by:** review-themory-scoped-forget-and-retrieval-counter-cross-validation
- **File:** `tests/integration/p0-audit/exports-root.test.ts, exports-contract.test.ts, full-public-surface.test.ts`
- **Plan reference:** T2.3 (d19117c) — NOT in T2.3 Files-to-edit (lines 458-461 declare only memory-event.ts + scoped-memory.ts + scoped-memory.test.ts)
- **Evidence:**

  git show 1068f77^:packages/core/src/index.ts | grep -c '^export ' -> 12, but exports-root.test.ts asserted 9 at the branch base => test was RED on develop BEFORE this plan (caused by entity-extraction slices a80a4e6/dbbf564, 2026-06-20, which grew the barrels without updating baselines).
  This plan's T2.2 added +1 export each (->13 root / ->47 contract). T2.3 reconciles the count (9->13, 43->47) AND backfills per-export JSDoc+@see for the entity/graph/usage-counter block.
  Commit d19117c body: "Also (honest disclosure, Inquebravel Rule 3): fixes the p0-audit public-surface sentinels that were ALREADY RED on develop ... Pure docs + test-baseline; no behavior change to those slices."

- **Recommended action:** Accept. The disclosure satisfies Rule 3. Note for /review: confirm the per-export JSDoc backfill (sentinel test 2 'every export has a JSDoc block') actually passes for the new entity/graph exports — validation reports npm test PASS, so it does.

### F-xval-5: Two minor declared-files / refactor gaps, both benign: (1) config.ts (LocalMemoryConfig) was edited in T2.2 to thread usageCounterStore but was not in the task's Files-to-edit; (2) the optional REFACTOR to extract pathParamsToScoped into a shared _scope-params.ts was NOT done — scoped-forget.ts re-declares its own copy, duplicating metrics.ts.

- **Found by:** review-themory-scoped-forget-and-retrieval-counter-cross-validation
- **File:** `packages/core/src/infrastructure/db/config.ts; packages/api/src/server/handlers/scoped-forget.ts`
- **Plan reference:** T2.2 Files-to-edit (lines 393-397 — config.ts NOT listed); T1.2 REFACTOR (line 306 — extract pathParamsToScoped to _scope-params.ts 'if duplicated')
- **Evidence:**

  config.ts diff (6a2c335): adds `readonly usageCounterStore?: UsageCounterStore` to LocalMemoryConfig — necessary because LocalScopedMemory reads this.config.usageCounterStore in T2.3. Plan listed factory.ts + barrels but omitted the config type that carries the dep.
  scoped-forget.ts:24-33 declares its own pathParamsToScoped + SCOPE_TYPES; metrics.ts:42 has the same. Plan REFACTOR step was conditional ('if duplicated ... extract').

- **Recommended action:** Accept both. Optionally extract the shared pathParamsToScoped + ScopeType enum into packages/api/src/server/handlers/_scope-params.ts in a follow-up (the architecture reviewer may also flag the DRY).

### F-dom-api-1: Read/write fail-soft asymmetry on the SAME counter. The recall() WRITE side is fail-soft (a counter increment failure NEVER fails the user's recall, per D3, with a retrieval_counted_failed OTel event). The metrics READ side is NOT fail-soft: usageCounterStore.getRecallCount is awaited without try/catch, so a transient counter-DB blip turns the WHOLE metrics endpoint into a 500 — even though total_memories / entity_count / add_events are computed independently from getAll() and would still be servable. This is CONSISTENT with the accepted entities-handler precedent (entities.ts deliberately propagates a port rejection to app.onError→500 rather than masking it as []), so it is acceptable as shipped and NOT a blocker. Flagging only so the asymmetry is a conscious choice on record.


- **Found by:** review-themory-scoped-forget-and-retrieval-counter-domain-api-design
- **File:** `packages/api/src/server/handlers/metrics.ts` line 92
- **Plan reference:** ADR D3 (recall increment fail-soft) + ADR D4 (0-fallback when store absent)
- **Domain anchor:** rules/architecture.md § 8 (error handling) + Princípio 3 (auditable); entities.ts:76-89 precedent
- **Evidence:**

  ```ts
  // metrics.ts:91-99 — no try/catch; a throw escapes to app.onError → 500
  let retrievalApiUsage = 0;
  if (usageCounterStore !== undefined) {
    const principal = c.get('principal') as Principal | undefined;
    const workspaceId = principal?.workspaceId ?? DEFAULT_WORKSPACE_ID;
    retrievalApiUsage = await usageCounterStore.getRecallCount({
      workspace_id: workspaceId,
      ...filtersFor(typeParse.data, id),
    });
  }
  ```

- **Recommended action:** No change required (matches entities precedent + the plan's honest-error stance). OPTIONAL future hardening if the metrics endpoint must degrade gracefully: wrap getRecallCount in try/catch and fall back to retrieval_api_usage:0 with a WARN/OTel event, so a counter outage does not blank the other 3 KPIs the gateway still needs. Defer to a follow-up; document the choice in the metrics JSDoc.


### F-dom-api-2: OpenAPI DELETE registration documents 204/404/422 but omits the 429 (rate-limit) response, even though app.delete('/v1/scopes/*', rateLimitMiddleware('write')) gates this path. The sibling GET scope paths in the same registry also omit 429, so this is CONSISTENT with the existing registry convention (not a regression and not specific to this change). Param schema (type:ScopeTypeEnum, id:min(1), memId:uuid) and query (hard:enum['true','false'].optional) are accurate and match the handler's validation exactly. Status-code documentation is otherwise correct and complete for the handler's own returns.


- **Found by:** review-themory-scoped-forget-and-retrieval-counter-domain-api-design
- **File:** `packages/api/src/server/openapi-registration.ts` line 207
- **Plan reference:** T1.2 — OpenAPI registers the DELETE path; D5 backward-compat
- **Domain anchor:** rules/architecture.md § 9 (public API surface) — documented + typed
- **Evidence:**

  ```ts
  // openapi-registration.ts:198-213 — responses document 204/404/422; no 429.
  responses: {
    204: { description: 'Deleted (or already absent in scope).' },
    404: { description: 'Not found in this scope / workspace (no existence leak).' },
    422: { description: 'memId is not a UUID.' },
  },
  ```

- **Recommended action:** Optional/cosmetic: add a 429 response to the DELETE (and, for parity, the GET scope paths) in a documentation-only follow-up. Not blocking — matches the established registry convention.


### F-dom-1: VERIFIED (not a defect). LocalScopedMemory.forget emits the `forget` history event best-effort (addHistory(memoryId,'',null,'forget',Date)) and invalidates the recall cache for the scope. The history write is wrapped try/catch so a history blip does not undo the delete — correct fail-soft posture. Princípio 3 auditability honored: the forget decision is recorded in the `history` table.


- **Found by:** review-themory-scoped-forget-and-retrieval-counter-domain-memory-layer
- **File:** `packages/core/src/infrastructure/db/scoped-memory.ts` line 360
- **Plan reference:** ADR D1 — subject-scoped forget; Princípio 3 audit trail
- **Domain anchor:** CLAUDE.md § IMPORTANTE Princípio 3 (memory is auditable; forget emits history)
- **Evidence:**

  ```ts
  if (this.config.historyManager !== undefined) {
    try {
      await this.config.historyManager.addHistory(memoryId, '', null, 'forget', new Date());
    } catch { /* history persistence failure must not block forget */ }
  }
  ```

- **Recommended action:** None — correct.

### F-dom-2: VERIFIED. The counter increment is fail-soft AND observable: on error it emits the typed MEMORY_EVENTS literal `retrieval_counted_failed` (appended to memory-event.ts, 24th literal) with {scope_tier, error} via emitEvent — never rethrows, so recall() always returns results. Mirrors the entity-edge-linking fail-soft precedent. IGNORE is NOT silent: the dropped count is auditable.


- **Found by:** review-themory-scoped-forget-and-retrieval-counter-domain-memory-layer
- **File:** `packages/core/src/infrastructure/db/scoped-memory.ts` line 274
- **Plan reference:** ADR D3 — fail-soft recall counter; Princípio 3 (IGNORE never silent)
- **Domain anchor:** CLAUDE.md § IMPORTANTE Princípio 3 (every IGNORE decision is OBSERVABLE)
- **Evidence:**

  ```ts
  try { await counter.increment(this.filters); }
  catch (err) {
    emitEvent(this.config.tracer, 'retrieval_counted_failed', {
      scope_tier: this.scope.kind,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  ```

- **Recommended action:** None — matches Princípio 3 + ADR D3.

### F-dom-3: VERIFIED. recall() now delegates the 3 cache paths to a private retrieveResults() (bypass / cache-hit / cache-miss) and bumps the counter ONCE AFTER retrieveResults returns, regardless of which path served. This correctly implements the "recall() calls tracked per scope" semantic — a cache HIT still counts as API usage (it would otherwise under-report exactly the cheap path). The cache-path bodies were moved verbatim into retrieveResults; recall() behavior for all 3 paths is unchanged (the asOf NaN guard still precedes the counted region, so a rejected recall does NOT count — correct).


- **Found by:** review-themory-scoped-forget-and-retrieval-counter-domain-memory-layer
- **File:** `packages/core/src/infrastructure/db/scoped-memory.ts` line 265
- **Plan reference:** ADR D3 — counter semantic: count ALL recall() calls per scope (HIT included)
- **Domain anchor:** Plan Q3 / Coverage Matrix #7 — count every recall() call (a call IS API usage)
- **Evidence:**

  ```ts
  const results = await this.retrieveResults(query, options);
  // counter bumped here, after retrieveResults, for ALL cache paths
  if (counter !== undefined) { try { await counter.increment(this.filters); } ... }
  return results;
  ```

- **Recommended action:** None — semantic matches the plan + Princípio 1 (recall is a tracked signal).

### F-dom-4: VERIFIED. deleteInScope is a single SQL with WHERE id AND workspace_id AND every bound scope-tier column — a cross-subject / cross-workspace id matches 0 rows (→ MemoryNotFound → 404, no existence leak, other row untouched). Soft path preserves bi-temporal semantics (SET t_invalid = NOW() ... AND t_invalid IS NULL → double-soft yields 0 rows = idempotent 404, EC-4). Hard path relies on ON DELETE CASCADE confirmed present in 0018 (memory_entities) + 0019 (entity_edges.source_memory_id) — EC-1 closed; no FK violation on hard delete of an entity-linked memory.


- **Found by:** review-themory-scoped-forget-and-retrieval-counter-domain-memory-layer
- **File:** `packages/core/src/infrastructure/db/pgvector-store.ts` line 658
- **Plan reference:** ADR D1 — scope+workspace-checked delete; 404-not-403; EC-1 FK cascade; EC-4 idempotent soft
- **Domain anchor:** Plan Baseline 'soft delete' + '404-not-403 discipline'; bi-temporal t_invalid
- **Evidence:**

  ```sql
  -- soft (default): bi-temporal preserved
  UPDATE memories SET t_invalid = NOW() WHERE id=$1 AND workspace_id=$2 AND <tier>=$n AND t_invalid IS NULL
  -- hard: children cascade (0018/0019 ON DELETE cascade verified)
  DELETE FROM memories WHERE id=$1 AND workspace_id=$2 AND <tier>=$n
  ```

- **Recommended action:** None — scope isolation + bi-temporal soft-delete + EC-1 all correct.

### F-dom-5: VERIFIED — no key-split defect on the REST/gateway path. The metrics read key = {workspace_id (from principal), single-tier filtersFor(type,id)} and the recall increment key = LocalScopedMemory.filters. Because Memory.session/ .user/.agent each take a SINGLE id (memory-store.ts:104-107) and the REST recall handler resolves scope via resolveScope (single-tier, schemas.ts:118), the REST recall always produces a single-tier filter — byte-identical to the metrics single-tier read after COALESCE(col,''). PgUsageCounterStore normalizes workspace_id to 'default' on both increment and getRecallCount, and the ON CONFLICT arbiter is column-for-column equal to the UNIQUE index (schema.ts scope_usage_counters_scope_uq). EC-3 holds for the consumer path.


- **Found by:** review-themory-scoped-forget-and-retrieval-counter-domain-memory-layer
- **File:** `packages/api/src/server/handlers/metrics.ts` line 91
- **Plan reference:** EC-3 — identical workspace+scope key on increment / read / UNIQUE
- **Domain anchor:** Plan EC-3; pg-usage-counter-store EC-3 note (write/read key must agree)
- **Evidence:**

  ```ts
  // metrics read (single-tier):
  retrievalApiUsage = await usageCounterStore.getRecallCount({ workspace_id, ...filtersFor(type,id) });
  // REST recall scope (single-tier): resolveScope -> memory.session(id) -> filters {session_id}
  ```

- **Recommended action:** None required for this plan. NOTE (out of scope, no change requested): a direct SDK caller could bind a two-tier scope (a hypothetical memory.session(userId, sessionId)) whose increment row would carry user_id, which a single-tier metrics read would not match. The plan's consumer is the REST/gateway single-tier path, so the metric is correct where it is consumed; flagging only for awareness, not as a defect of this diff.


### F-dom-6: VERIFIED. The increment lives only in LocalScopedMemory.recall (user/session/ agent). ScopedSkillMemory is a separate class and the metrics endpoint enum is user/session/agent-only (SCOPE_TYPES). Skill recalls are intentionally out of this counter's scope, documented inline + in the metrics JSDoc. No leakage of skill recalls into retrieval_api_usage.


- **Found by:** review-themory-scoped-forget-and-retrieval-counter-domain-memory-layer
- **File:** `packages/core/src/infrastructure/db/scoped-memory.ts` line 273
- **Plan reference:** EC-6 — skill (repo) scope NOT counted (served by LocalScopedSkillMemory)
- **Domain anchor:** Plan EC-6; ADR-0010 RepoScope 4th tier
- **Evidence:**

  ```ts
  // EC-6: skill (repo) scope is served by LocalScopedSkillMemory, which is
  // intentionally NOT wired to the counter — this class only counts user/session/agent.
  ```

- **Recommended action:** None — correct per EC-6.

### F-dom-7: VERIFIED. Adding forget() to the ScopedMemory contract does NOT violate the locked-verb set (forget is one of the 4 locked verbs) nor ADD-only (forget is explicitly the non-update mutation path; update remains excluded). The JSDoc correctly differentiates the subject-scoped variant from the workspace-only Memory.forget. The in-memory adapter implements deleteInScope (ignoring `hard` since it has no t_invalid) so the contract is compile-satisfied across both adapters — consistent LSP behavior (returns matched? boolean both places).


- **Found by:** review-themory-scoped-forget-and-retrieval-counter-domain-memory-layer
- **File:** `packages/core/src/domain/memory-store.ts` line 88
- **Plan reference:** ADR D1 — forget added to ScopedMemory (additive; ADD-only/locked verbs not violated)
- **Domain anchor:** CLAUDE.md § Locked names (verbs remember/recall/forget/reflect); ADR-0003 ADD-only
- **Evidence:**

  ```ts
  // ScopedMemory now declares: forget(memoryId, options?: ForgetOptions): Promise<void>
  // JSDoc: "Excludes `update` (ADR-0003 ADD-only). `forget` IS available here as a SUBJECT-SCOPED delete"
  ```

- **Recommended action:** None — additive, locked-verb-consistent, ADD-only preserved.

### F-dom-pgv-1: JSDoc on scopeUsageCounters claims `recall_count` is `mode:'number'` so "getRecallCount() returns a JS number". This is slightly misleading: the drizzle `bigint(..., { mode:'number' })` declaration is NOT what coerces the value — getRecallCount lives in PgUsageCounterStore which issues a RAW pool.query (not drizzle) and does the int8->Number coercion itself via `Number(rows[0].recall_count)`. The drizzle table is exported only for schema/migration parity; nothing reads the counter through drizzle. The coercion is correct; only the comment's causality is imprecise. No runtime impact.


- **Found by:** review-themory-scoped-forget-and-retrieval-counter-domain-pgvector-schema
- **File:** `packages/core/src/infrastructure/db/schema.ts` line 659
- **Plan reference:** T2.1 / ADR D2
- **Domain anchor:** drizzle schema mode:'number' vs raw-SQL store
- **Evidence:**

  ```ts
  // schema.ts JSDoc: "`recall_count` is `mode:'number'` so getRecallCount() returns a JS number"
  // pg-usage-counter-store.ts actually does:
  const { rows } = await this.pool.query<{ recall_count: string }>(...);
  return rows[0] === undefined ? 0 : Number(rows[0].recall_count);
  ```

- **Recommended action:** Optional doc tweak: clarify that the JS-number coercion happens in PgUsageCounterStore.getRecallCount (raw SQL + Number()), and mode:'number' keeps the drizzle type in parity. No code change required.


### F-dom-pgv-2: InMemoryVectorStore.deleteInScope physically removes the row on BOTH soft and hard (no t_invalid model) — documented in its JSDoc. A second soft-forget of an already-removed in-memory row returns false (-> 404), which happens to MATCH the pg behavior (pg's `t_invalid IS NULL` guard also yields 0 rows on the second soft call -> 404). So the idempotent-404 EC-4 contract holds on both stores for the double-soft case, but for a DIFFERENT mechanism (in-memory: row gone; pg: t_invalid already set). Worth noting the in-memory store cannot exercise the "row still exists but hidden" soft-delete semantics, so unit tests of EC-4 against in-memory do not actually prove the pg `t_invalid IS NULL` guard — that requires the integration test. Verified tests/integration/scoped-forget.test.ts exists to cover the real pg path.


- **Found by:** review-themory-scoped-forget-and-retrieval-counter-domain-pgvector-schema
- **File:** `packages/core/src/infrastructure/db/in-memory-store.ts` line 204
- **Plan reference:** T1.1 / EC-4
- **Domain anchor:** soft-delete idempotency parity in-memory vs pg
- **Evidence:**

  ```ts
  // in-memory: soft == hard (no t_invalid)
  async deleteInScope(vectorId, filters) {
    const row = this.rows.get(vectorId);
    if (row === undefined) return false; // 2nd call -> false -> 404 (parity by coincidence)
    ...
    this.rows.delete(vectorId);
    return true;
  }
  ```

- **Recommended action:** None required — integration test (real pgvector) is the authoritative EC-4 oracle and is present. Parity is acceptable.


### F-tests-5: The 'ScopedMemory.forget (scoped wrapper)' describe block tests owned + cross-subject MemoryNotFound, but not the cross-workspace MemoryNotFound at the wrapper level (the plan RED list for T1.1 includes test_forget_cross_workspace_throws_MemoryNotFound). It is covered at the primitive deleteInScope layer (line 84), so this is informational duplication-of-concern, not a true gap. Recording for completeness.


- **Found by:** review-themory-scoped-forget-and-retrieval-counter-tests
- **File:** `tests/integration/scoped-forget.test.ts` line 119
- **Plan reference:** T1.1 RED test_forget_cross_workspace_throws_MemoryNotFound (at the ScopedMemory wrapper)
- **Evidence:**

  describe 'T1.1 ScopedMemory.forget' (line 119) has 2 tests (owned, cross-subject);
  no cross-workspace wrapper test. Primitive layer covers it at line 84.

- **Recommended action:** Optional: add a wrapper-level cross-workspace MemoryNotFound assertion for parity with the plan's RED list, or rely on the primitive coverage (acceptable).


### F-wire-3: InMemoryVectorStore.deleteInScope(vectorId, filters) omits the `hard` parameter present on the VectorStore interface (deleteInScope(vectorId, filters, hard)). TypeScript permits an implementation with fewer params, so this compiles and is contract-valid; the in-memory store has no t_invalid so soft==hard intentionally. Documented in the JSDoc. No defect — recorded for transparency.


- **Found by:** review-themory-scoped-forget-and-retrieval-counter-wiring
- **File:** `packages/core/src/infrastructure/db/in-memory-store.ts` line 208
- **Plan reference:** T1.1 — deleteInScope signature parity
- **Evidence:**

  vector-store.ts:139 declares 3 params; in-memory-store.ts:208 implements 2.
  JSDoc explains soft/hard collapse for the no-t_invalid in-memory store.

- **Recommended action:** none (informational)


## Handoff decision

Implementation passes all gates. Ready for merge.

## Audit trail

Spawned agents (their findings files live alongside this report):

- `.claude/agents/review-themory-scoped-forget-and-retrieval-counter-2026-06-21/architecture.md`
- `.claude/agents/review-themory-scoped-forget-and-retrieval-counter-2026-06-21/review-themory-scoped-forget-and-retrieval-counter-cross-validation.md`
- `.claude/agents/review-themory-scoped-forget-and-retrieval-counter-2026-06-21/review-themory-scoped-forget-and-retrieval-counter-domain-api-design.md`
- `.claude/agents/review-themory-scoped-forget-and-retrieval-counter-2026-06-21/review-themory-scoped-forget-and-retrieval-counter-domain-memory-layer.md`
- `.claude/agents/review-themory-scoped-forget-and-retrieval-counter-2026-06-21/review-themory-scoped-forget-and-retrieval-counter-domain-pgvector-schema.md`
- `.claude/agents/review-themory-scoped-forget-and-retrieval-counter-2026-06-21/review-themory-scoped-forget-and-retrieval-counter-tests.md`
- `.claude/agents/review-themory-scoped-forget-and-retrieval-counter-2026-06-21/review-themory-scoped-forget-and-retrieval-counter-wiring.md`

---

## Post-review resolution (2026-06-21)

**Verdict: READY_TO_MERGE.** 0 BLOCKER, 0 HIGH.

The 2 MEDIUM findings (both plan-named-but-missing tests) were CLOSED inline in commit `aece5b7`:
- **F-tests-1** — added the end-to-end 20-concurrent-`recall()` race test (proves the recall-path wiring atomicity, not just the store UPSERT).
- **F-tests-2** — extended the EC-1 hard-forget test to seed an `entity_edges.source_memory_id` row + assert the edge cascades (the second FK the plan's EC-1 named).
Both GREEN vs real `ankane/pgvector:v0.5.1` (28/28 in the two files).

### LOW findings accepted as caveats / followups (non-blocking)
- **F-arch-1 (DRY)** — `SCOPE_TYPES`/`ScopeTypeSchema`/`pathParamsToScoped`/`filtersFor` duplicated across `scoped-forget.ts` + `metrics.ts` (+ `entities.ts`/`graph` siblings). The plan's REFACTOR step prescribed extracting `_scope-params.ts`; deferred to followup F1 (cross-handler, touches files beyond this plan's scope).
- **F-arch-2 (counter coupled to `entityBoost` gate)** — `usageCounterStore` is wired only when `entityBoost !== false` (per plan ADR D4 "gate the SAME way" as entity/graph). A pg consumer with `entityBoost:false` gets `retrieval_api_usage` stuck at 0 (honest 0-fallback, documented). Follows the locked ADR; decoupling the counter gate is an ADR-amendment-level change → followup, not a mid-cycle deviation.
- Other LOW/INFO (OpenAPI 204 description wording, 429 not documented, in-memory `deleteInScope` arity, read/write fail-soft asymmetry) — cosmetic / consistent-with-precedent; logged.

All Goal halves proven against real pgvector; full integration suite green (594 passed / 0 failed); contract 1031 passed; code-quality PASS (100). Ready for `/release`.

# Edge Case Review — examples-chat-with-memory-v0-7-distillation

Data: 2026-06-01
Plan analisado: `.claude/knowledge-base/plans/examples-chat-with-memory-v0-7-distillation-plan.md` v1.0
Tasks analisadas: 7 (T0.1, T1.1, T1.2, T2.1, T2.2, T3.1, T4.1)
Edge cases encontrados: 8 (MUST FIX: 3, SHOULD TEST: 3, DOCUMENT: 2)

## MUST FIX

### EC-1: `llm-judged-merge` silent-abstain when `THEOMEM_USE_STUB_ADAPTERS=1` (StubLLM in singleton)

- **Task afetada:** T0.1 + T1.1
- **Família:** Integration / Permission
- **Cenário:** Demo singleton accepts `THEOMEM_USE_STUB_ADAPTERS=1` env var to swap `OpenAILLM` for `DeterministicStubLLM` (verified at `examples/chat-with-memory/lib/memory.ts`). The factory in T0.1 closes over the singleton's `llm` field per ADR D5. If stub mode is active AND the user POSTs `policy: 'llm-judged-merge'`, the stub returns an empty `{}` from `generateResponse({type:'json'})` (not the `kept_id` / `rejected_ids` / `reason` shape) → `parseConsolidationResponse` returns `null` → policy abstains → response shows 0 consolidations. User sees "LLM-judged-merge ran and found nothing to consolidate" — actually the stub was used and silently produced no decision.
- **Impacto:** Violates Inquebrável Rule 3 (extreme honesty) + EC-B's "NO silent fallback" promise from ADR D3. Operator misled about which policy actually executed.
- **Fix sugerido (≤3 linhas):** in T0.1 factory, when constructing `LlmJudgedMergeConflictPolicy`, check `llm.constructor.name === 'DeterministicStubLLM'` (OR add a sentinel `kind` field on the stub) and throw a typed error `StubLlmNotUsableForLjmError`. T1.1 route catches this + returns `422 { code: 'STUB_LLM_NOT_USABLE_FOR_LJM' }`. Document in README.

### EC-2: Integration test bootstrap underspecified (running dev server vs in-process spawn)

- **Task afetada:** T4.1
- **Família:** Resource / Integration
- **Cenário:** Plan T4.1 Deep file dependency analysis says: "spawns the dev server inline (or assumes it's running via `npm run dev` in another terminal — precedent from existing examples/ integration tests)." This is two incompatible strategies presented as alternatives. CI cannot have a manual `npm run dev` running; in-process spawn requires plumbing Next.js's programmatic API + port allocation. Without a clear decision the test will either be hand-flaky or silently skipped.
- **Impacto:** T4.1 acceptance criterion #5 (`npm run test:integration -- tests/integration/examples/` PASS) is undefined; `/implement` halt-loop at Stop Condition #4 (plan defect — Files to edit unreachable).
- **Fix sugerido (≤1 frase):** T4.1 picks ONE strategy explicitly: `describe.skipIf(!(await isReachable('localhost:3000/api/health')))` + integration test header documents the `npm run dev` pre-condition (mirrors EC-11 pattern from v0.7 cycle T3.2 + `docs/distillation-evaluation/README.md`). Add as sub-step to T4.1 Files to edit.

### EC-3: Unknown `policy` value in POST body → 500 (not 400)

- **Task afetada:** T1.1
- **Família:** Input
- **Cenário:** Plan T0.1 factory throws on unknown name. T1.1 plan TDD section only tests valid policies + the LJM-missing-key case. If a client POSTs `{userId: 'alice', policy: 'random-garbage'}`, the factory throw propagates uncaught through Next.js → 500 internal server error.
- **Impacto:** Bad client requests look like server bugs in logs / monitoring; obscures real 5xx.
- **Fix sugerido (≤3 linhas):** in T1.1 route, validate policy against the literal union BEFORE calling the factory: `if (!['noop','last-write-wins','llm-judged-merge'].includes(body.policy)) return NextResponse.json({error: 'invalid policy'}, {status: 400})`. Add RED test asserting 400 on invalid policy name.

## SHOULD TEST

### EC-4: Concurrent POST `/api/memory/distill` for same userId

- **Task afetada:** T1.1
- **Teste sugerido:** `test_distill_concurrent_double_post_does_not_corrupt_audit` — fire 2 parallel POSTs against the same `userId` seeded with 2 contradictory memories; assert (a) both responses 200; (b) `consolidation_history` may have 1 OR 2 rows (each call is independent; current LWW pipeline is not deduped — that is acceptable); (c) NO row has NULL `kept_memory_id` from a half-applied tx (EC-8 absorption from v0.7 cycle T2.1 already guarantees this via `withTransaction`). The test documents the actual current behavior so downstream consumers know what to expect.

### EC-5: UI race condition on `userId` change mid-fetch (`DistillationTab`)

- **Task afetada:** T2.1
- **Teste sugerido:** manual / Chrome-MCP-deferred per EC-A. When Chrome MCP unlocks, add scenario to `/test-chat-with-memory`: type userId A → click "Distill now" → before response lands type userId B → assert the result panel for B is empty (NOT showing A's stale consolidations). Mitigation in code: use `AbortController` in the fetch hook to cancel the inflight call on dep change (mirrors EvictionTab `useEffect` cleanup pattern). The mitigation IS the test (verified via `AbortController` race).

### EC-6: "Distill now" rapid double-click fires duplicate POSTs

- **Task afetada:** T2.1
- **Teste sugerido:** UI assertion deferred per EC-A. Mitigation in code: `disabled={loading}` on the button. Add explicit DoD checkbox to T2.1: "Distill button is `disabled` while a request is in-flight". This mitigates EC-4's user-triggered case without requiring server-side dedup logic.

## DOCUMENT

### EC-7: Repeated "Distill now" creates new `consolidation_history` rows on every click

- **Risco aceito:** Pipeline is intentionally NOT idempotent — each `reflect({conflictResolution})` invocation that finds candidates writes a new audit row. This matches the SDK's contract (v0.7 cycle T2.1 plan). README documents: "Each Distill click adds rows; existing audit rows are preserved per the bi-temporal contract. Use the audit-history limit + offset for pagination."

### EC-8: `kept_memory_id IS NULL` rows (post-GDPR hard-delete) excluded from the audit list view

- **Risco aceito:** T1.2 query uses `JOIN memories ON ch.kept_memory_id = m.id` which is an INNER JOIN — null FK rows are excluded. This is acceptable for v0.7 demo because: (1) the GDPR contract intentionally preserved those rows in the DB (not lost — still queryable via raw SQL); (2) UI-level visibility of orphaned-audit rows would muddy the demo's main narrative ("kept this, rejected that"). Document in README + T3.1: "Audit rows whose kept_memory was hard-deleted via `forget({hard:true})` are preserved in the `consolidation_history` table (per EC-3 ON DELETE SET NULL) but excluded from the Distillation tab view; query raw SQL for full audit." Future cycle can add a separate `/api/memory/consolidation-history/orphans` view if requested.

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 (factory) | 1 | 1 (EC-1) | 0 | 0 |
| T1.1 (distill route) | 3 | 2 (EC-1 share, EC-3) | 1 (EC-4) | 1 (EC-7) |
| T1.2 (history route) | 1 | 0 | 0 | 1 (EC-8) |
| T2.1 (tab component) | 2 | 0 | 2 (EC-5, EC-6) | 0 |
| T2.2 (sidebar wire) | 0 | 0 | 0 | 0 |
| T3.1 (README) | 0 | 0 | 0 | 0 |
| T4.1 (validation) | 1 | 1 (EC-2) | 0 | 0 |
| **Total** | **8** | **3** | **3** | **2** |

EC-1 cuts across T0.1 + T1.1; counted once.

**Veredicto:** PLANO PRECISA DE AJUSTE — bump v1.0 → v1.1 absorbing 3 MUST FIX (EC-1 stub-LLM detection + 422 contract, EC-2 explicit integration-test bootstrap strategy, EC-3 400 on invalid policy name). 3 SHOULD TEST viram sub-bullets dos tasks TDD existentes (EC-4 concurrent POST audit, EC-5/EC-6 deferred to Chrome MCP unlock with code-level mitigation). 2 DOCUMENT viram notas no README + plan acceptance.

### Honest acknowledgment

- Os 3 MUST FIX são bugs de fronteira (HTTP boundary + dev-server boundary + stub-vs-real LLM detection); cada um tem fix em ≤3 linhas.
- EC-1 é especialmente importante — silent-stub mode contradiz EC-B's "NO silent fallback" promise. Plan author missed because the demo's stub mode is a v0.6.1 addition documented separately from the v0.7 work.
- EC-2 é gap de Inquebrável Rule 1 (95% confidence) — plan presented 2 alternatives without picking one. Implementação would block at first sign of CI/local divergence.
- EC-3 é trivial mas frequent operator error in REST APIs; 5xx logs masking 4xx bugs is a real diagnostic pain.
- EC-4/5/6 mitigations are mostly in component code already (AbortController, disabled-while-loading); tests serve as discipline checks.
- EC-7/8 são honest disclosure — both are correct current behavior that operators need to know.

### Próximos passos (chain inquebrável)

1. **Usuário absorve 3 MUST FIX + 2 DOCUMENT em plan v1.1** (3 SHOULD TEST viram halt-loop checkpoints no TDD)
2. **`/deps-audit examples-chat-with-memory-v0-7-distillation`** — expected PASS (zero new deps confirmed; consumer-side only)
3. **`/plan-confidence examples-chat-with-memory-v0-7-distillation`** — target ≥ SHIPPABLE_WITH_CAVEATS (post-absorption)
4. **`/implement examples-chat-with-memory-v0-7-distillation`** (sessão dedicada, ~130-360k tokens per token-budget.md)

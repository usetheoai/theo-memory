# Edge Case Review — f-t4-1-2-eviction-race-debug

Data: 2026-06-01
Tasks analisadas: 8 (T0.1, T1.1, T1.2, T2.1-sdk, T2.1-demo, T2.2, T3.1, T3.2, T4.1)
Edge cases encontrados: 7 (MUST FIX: 1, SHOULD TEST: 3, DOCUMENT: 3)

## MUST FIX

### EC-1: Stub determinism + `Promise.all` race may have HEISENBUG character

- **Task afetada:** T1.1
- **Família:** Timing
- **Cenário:** O teste de reprodução roda `Promise.all([userScoped.remember, sessionScoped.remember])` 5 vezes em loop. Cada `Promise.all` é não-determinístico em ORDEM de resolução (V8 event loop scheduling pode favorecer uma sobre outra). Mesmo com stubs determinísticos para embedding+LLM, a ORDEM das duas SQL INSERTs em pgvector via mesma `pg.Pool` pode variar entre runs. Se o bug depende de timing EXATO (ex: ambas as INSERTs hit o mesmo NOW() truncated to ms), o teste pode passar 99/100 runs e falhar 1/100 — flaky.
- **Impacto:** Test flakiness invalidates the regression guard. Future CI runs could pass while the bug remains; cycle ships "fixed" but isn't.
- **Fix sugerido:** Adicionar LOOP de N=20 iterações no test (`for (let trial = 0; trial < 20; trial++) { ... assert ... }`). Se o bug é race-condition, mais iterations = maior chance de reprodução. Documentar no JSDoc do teste: "non-deterministic race; loop 20x to maximize reproduction probability". Absorver como sub-step de T1.1 RED.

---

## SHOULD TEST

### EC-2: pgvector container teardown between trials

- **Task afetada:** T1.1
- **Teste sugerido:** `beforeEach` truncates `memories` + `entities` + `history` tables. Each trial in the 20-iteration loop runs against fresh DB state. Asserts at end of each trial; if any trial fails, log the trial number + DB state for post-mortem.

### EC-3: `t_invalid IS NULL` guard on all assertions

- **Task afetada:** T1.1, T2.2
- **Teste sugerido:** Per EC-E of plan + v0.4b T7.1 BREAKING semantics — every assertion querying `memories` table MUST include `WHERE t_invalid IS NULL` to count "live" rows. If the bug is masked because soft-deleted rows are counted, the test gives false confidence. Assert explicitly: `expect(activeUserRows).toEqual(5)` AND `expect(softDeletedUserRows).toEqual(0)` (soft-deletes are NOT expected at maxMemoriesPerScope=10 with 5 writes).

### EC-4: Concurrent advisory-lock acquisition

- **Task afetada:** T1.1, T1.2
- **Teste sugerido:** Add an assertion that the advisory locks ARE acquired/released cleanly during the parallel writes. Query `pg_locks` mid-test (test-helper) OR rely on the test PASSING via SQL UPDATE evidence. Alternative: capture pg log output for `LOCK` lines. If the bug is "two concurrent fires deadlock and one falls through silently", this surfaces it.

---

## DOCUMENT

### EC-5: Hot-fix `b2909ff` lifted mid-cycle could cause demo regression visible to users

- **Risco aceito:** T3.1 lifts the hotfix AFTER T2.2 GREEN. If someone pulls `develop` between T2.1 and T3.1, they see the hotfix STILL in place + the SDK fix landed but not consumed by demo. This is intentional: SDK fix lands first; demo wiring follows in atomic commit. Documented in plan ADR D4. No mitigation needed.

### EC-6: T1.1 may PASS (no SDK reproduction); T1.2 mandatory then

- **Risco aceito:** Per ADR D2, this is the bisection design — if T1.1 PASSES the bug is demo-only and T1.2 is the actual reproduction. The plan accounts for both paths. Documented; no mitigation needed.

### EC-7: Chrome MCP lock (F-T4.1-1) may block T3.2 — surface honestly

- **Risco aceito:** Per ADR D5 + F-T4.1-1 known issue. If `/test-chat-with-memory` cannot run due to Chrome MCP SingletonLock, T3.2 surfaces BLOCKED with reason "F-T4.1-1 — Chrome MCP unavailable". The integration test (T1.1/T1.2) remains the load-bearing functional evidence. Documented; no mitigation needed.

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T1.1 | 4 | 1 | 3 | 0 |
| T1.2 | 1 | 0 | 1 | 0 |
| T2.1-sdk/demo | 0 | 0 | 0 | 0 |
| T2.2 | 0 | 0 | 0 | 0 |
| T3.1 | 1 | 0 | 0 | 1 |
| T3.2 | 1 | 0 | 0 | 1 |
| T4.1 | 0 | 0 | 0 | 0 |
| Cross-cutting | 1 | 0 | 0 | 1 |
| **Total** | **7** | **1** | **3** | **3** |

**Veredicto:** PLANO PRECISA DE AJUSTE — 1 MUST FIX (EC-1 heisenbug character). Absorver em T1.1 RED como 20-iteration loop. SHOULD TEST itens absorvidos como sub-steps de T1.1+T2.2 (truncate beforeEach + t_invalid guard + pg_locks check). DOCUMENT itens já cobertos pelo plan inline. Após absorção: re-rodar /plan-confidence.

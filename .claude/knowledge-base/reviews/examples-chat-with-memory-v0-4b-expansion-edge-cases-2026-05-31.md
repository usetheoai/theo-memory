# Edge Case Review — examples-chat-with-memory-v0-4b-expansion

Data: 2026-05-31
Tasks analisadas: 7 (T0.1 + T1.1 + T1.2 + T1.3 + T2.1 + T3.1 + T4.1 + T5.1 + T6.1)
Edge cases encontrados: 8 (MUST FIX: 1, SHOULD TEST: 4, DOCUMENT: 3)

## MUST FIX

### EC-1: EvictionTab fetch sem userId → 400 silencioso

- **Task afetada:** T1.3
- **Família:** Input / Integration
- **Cenário:** O plano descreve `useEffect` fetchando `/api/memory/eviction-status` na montagem do componente, mas NÃO especifica QUAL `userId` é passado na query string. T1.2 define explicitamente que o endpoint retorna 400 quando `userId` está ausente. Os outros tabs (`UserTab`, `SessionTab`) consomem `userId` via prop ou via contexto do `MemorySidebar`. Sem decisão explícita no plano, T1.3 pode montar uma chamada sem `userId` e o scenario H1 falha porque o endpoint retorna 400 antes de qualquer render condicional.
- **Impacto:** H1 scenario (EvictionTab visible when env var set) FAIL no T4.1; verdict não atinge READY 33/33; T6.1 bloqueia.
- **Fix sugerido:** Adicionar uma linha no T1.3 § Deep file dependency analysis: "`EvictionTab` recebe `userId` via prop do `MemorySidebar` (padrão idêntico ao `UserTab.userId`); fetch só dispara quando `userId` truthy."

---

## SHOULD TEST

### EC-2: `InMemoryVectorStore.forget({ hard })` não documentado

- **Task afetada:** T2.1
- **Teste sugerido:** `test_inmemory_backend_forget_hard_does_not_crash` — quando demo está com backend `in-memory` (`THEOMEM_PG_URI` ausente) e endpoint recebe `{ hard: true }`, a chamada `memory.forget(id, { hard: true })` deve completar sem throw. Se `InMemoryVectorStore` não suportar a opção, o plano deve adicionar uma nota: "hard-delete só implementado para pgvector backend; in-memory ignora a flag silenciosamente."

### EC-3: Cenários A-G podem regredir por adição da 5a tab

- **Task afetada:** T4.1
- **Teste sugerido:** Antes do T4.1, verificar que nenhum scenario A1-G5 depende do número exato de tabs renderizadas (e.g., G5 `take_snapshot` post-reload). EvictionTab é renderizado SEMPRE (mesmo desabilitado, vira o hint card) — se algum cenário usa "tab list count" ou índice posicional, vai regredir. Mitigação: confirmar que os snapshots dos 30 cenários existentes usam labels acessíveis ("User", "Session", "Skills", "History") em vez de índice.

### EC-4: Demo `tsconfig` / `lint` escopo no T6.1

- **Task afetada:** T6.1
- **Teste sugerido:** Confirmar antes do T6.1 que `tsconfig.contract.json` + `tsconfig.lint.json` raiz NÃO incluem `examples/chat-with-memory/**`. Se incluírem, os novos arquivos T1.1-T1.3 entram no main typecheck e qualquer ruído no demo (peer-dep do Next, JSX, etc.) bloqueia o gate. Se incluírem, demo precisa de exclude path explícito.

### EC-5: `/api/memory/eviction-status` sem error handling explícito

- **Task afetada:** T1.2
- **Teste sugerido:** `curl -X GET /api/memory/eviction-status?userId=alice` com pgPool desconectada deve retornar 500 com `{ error: "..." }` JSON, não crash do Next.js dev server. Patch: `try { const count = await pool.query(...) } catch (e) { return NextResponse.json({ error: 'eviction-status query failed', detail: String(e) }, { status: 500 }) }`.

---

## DOCUMENT

### EC-6: `THEOMEM_EVICTION_DEMO` strict equality com `'1'`

- **Risco aceito:** Plano D1 escolhe `process.env.THEOMEM_EVICTION_DEMO === '1'`. Valores como `'true'`, `'yes'`, `'on'`, `1` (number, se algum loader converter) são silently ignorados → eviction stays OFF. É convenção POSIX-ish (12-factor). Risco baixo; mitigado pelo `console.log` que loga `eviction=disabled (reason: env unset)` para tornar a configuração visível. Não precisa de fix, mas o README callout do T1.1 deve usar EXATAMENTE `THEOMEM_EVICTION_DEMO=1` sem variações.

### EC-7: Filename data hardcoded em T5.1

- **Risco aceito:** Plano T5.1 cita filename `2026-05-31-process-v0-4b-fixes-cycle-validation.md`. Se T4.1 demorar (Chrome MCP é volátil — ~80-150k tokens) e T5.1 escorregar para 2026-06-01, o filename ficaria incorreto. Acceptable: o implementador deve usar `date -u +%Y-%m-%d` no momento da escrita. O plano serve de referência; data efetiva = data de execução. Sem mudança no plano.

### EC-8: Hard-delete UI affordance ausente

- **Risco aceito:** T2.1 expõe `{ hard }` no API mas T1.3 NÃO adiciona um botão "delete permanently" na UI. H3 scenario usa `evaluate_script` direto. Consumers que leem o demo veem soft-delete via trash icon; descobrem hard-delete só lendo a documentação do endpoint OU o test catalog. Plano D2 já reconhece isso ("logged as follow-up"). Acceptable.

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T1.1 | 1 | 0 | 0 | 1 |
| T1.2 | 1 | 0 | 1 | 0 |
| T1.3 | 1 | 1 | 0 | 0 |
| T2.1 | 2 | 0 | 1 | 1 |
| T3.1 | 0 | 0 | 0 | 0 |
| T4.1 | 1 | 0 | 1 | 0 |
| T5.1 | 1 | 0 | 0 | 1 |
| T6.1 | 1 | 0 | 1 | 0 |
| **Total** | **8** | **1** | **4** | **3** |

**Veredicto:** PLANO PRECISA DE AJUSTE (1 MUST FIX: EC-1, especificação do `userId` source no EvictionTab antes do T1.3 começar).

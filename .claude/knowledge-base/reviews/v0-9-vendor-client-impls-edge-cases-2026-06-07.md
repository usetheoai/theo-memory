# Edge Case Review — v0-9-vendor-client-impls

Data: 2026-06-07
Plano analisado: `.claude/knowledge-base/plans/v0-9-vendor-client-impls-plan.md` (v1.0)
Tasks analisadas: 5 phases × 2 (RED/GREEN) + T5.1 = 11 sub-tasks
Edge cases encontrados: 14 (MUST FIX: 3, SHOULD TEST: 8, DOCUMENT: 3)

---

## MUST FIX

### EC-1: ADR D1 descreve estado pré-existente INCORRETO — interfaces NÃO usam `userId` em todas

- **Task afetada:** T0.1 + T0.2 + ADR D1
- **Família:** State (premissa do plano)
- **Cenário:** Plano diz "rename `userId` → `scopeKey` across all 3 interfaces". Verificação empírica em `src/benchmarks/{mem0,zep,letta}/adapter.ts`:
  - `Mem0VendorClient.add(userId: string, text: string)` — usa `userId` ✓
  - `ZepVendorClient.add(sessionId: string, text: string)` — usa `sessionId` (NÃO `userId`)
  - `LettaVendorClient.add(agentId: string, text: string)` — usa `agentId` (NÃO `userId`)

  O plano sub-descreve o escopo de T0.2: o rename real é 3 nomes diferentes → `scopeKey`, não 1 nome → 1 nome. Ralph-loop pode interpretar literalmente (grep + replace `userId` somente) e deixar Zep/Letta com nomes inconsistentes.
- **Impacto:** Inconsistência ADR vs realidade quebra Inquebrável Rule 3 (Honestidade Extrema). Implementação literal-grep deixa Zep+Letta sem o rename, defeating ADR D1's stated rationale (type-level honesty). `/review` cross-validation reporta divergência.
- **Fix sugerido:** Editar ADR D1 § Decision para: "All 3 vendor interfaces rename the first `add()` + `search()` parameter — `userId` (Mem0) / `sessionId` (Zep) / `agentId` (Letta) → uniform `scopeKey`. Each OfficialClient maps scopeKey internally per its vendor scope model."

### EC-2: `synthesize()` throw genérico `Error` viola Inquebrável Rule 8 — usar tipo de domínio

- **Task afetada:** T1.2 + T2.2 + T3.2 (per ADR D2)
- **Família:** Format (error contract)
- **Cenário:** Plan ADR D2 § Decision: "throw `Error("synthesize NOT supported by vendor SDK; caller delegates to LLM DIP")`". Inquebrável Rule 8 (Error Handling) mandates: "Erros devem ser explícitos e tipados. Use exceções de domínio com mensagens claras." `src/core/errors.ts` exporta 18+ typed classes — nenhuma fits semantically, mas plain `Error` quebra Rule 8 + impede `catch (e: VendorSynthesizeUnsupportedError)` no caller.
- **Impacto:** Caller que tenta tratar fallback (e.g., "if vendor doesn't support synthesize, fall back to LLM DIP") tem que parsear `error.message` string — frágil. Quando msg muda em refactor, caller silently breaks. `/code-quality` audit pode sinalizar.
- **Fix sugerido:** Adicionar em `src/core/errors.ts`: `export class VendorSynthesizeUnsupportedError extends Error { constructor(vendor: string) { super(`synthesize not supported by ${vendor} SDK; caller must delegate to LLM DIP`); this.name = 'VendorSynthesizeUnsupportedError'; } }`. Throw `new VendorSynthesizeUnsupportedError('mem0')` etc. nos 3 OfficialClients. Inquebrável Rule 8 plain.

### EC-3: Mem0 v3 response field é `memory` (NÃO `text`) — Sub-goal 1 mapping incorreto

- **Task afetada:** Sub-goal 1 (Mem0)
- **Família:** Format (vendor API contract)
- **Cenário:** Plan Sub-goal 1: "`.search(scopeKey, query, topK)` ... maps result to `{ text, score }[]`". Verificação empírica em `.claude/knowledge-base/references/mem0/mem0-ts/src/client/mem0.types.ts:89`:
  ```ts
  memory: string;
  ```
  E `tests/helpers.ts:67`: `data?: { memory: string } | null;` + `tests/helpers.ts:87`: `memory: "Test memory content"`.

  mem0-ts v3.0.6 retorna `{ id, memory, score, ... }` — campo de conteúdo é `memory`, não `text`. Mapping literal do plano (`r.text`) retornaria `undefined` em runtime.
- **Impacto:** `Mem0OfficialClient.search()` retorna `[{ text: undefined, score: 0.X }]`. `BenchmarkAdapter.search()` propaga undefined. Integration test T4.2 passa por acidente (search retorna não-vazio, mas conteúdo é lixo). Bugs silenciosos nos benchmark scores reportados — comparação Mem0 vs TheMemory invalida.
- **Fix sugerido:** Editar Sub-goal 1 para: "maps result to `{ text: r.memory, score: r.score }[]` (Mem0 v3 SDK returns `memory` field; remap to TheMemory's `text` semantic)". Adicionar teste em T1.1 RED: `expect(results[0].text).toBe('hello world')` quando stub SDK retorna `{ memory: 'hello world', score: 0.9 }`.

---

## SHOULD TEST

### EC-4: Zep session lifecycle "idempotent" — comportamento em 409 Conflict não especificado

- **Task afetada:** T2.2 (Zep)
- **Teste sugerido:** `test_zep_official_client_add_handles_existing_session` — assert que 2 chamadas sequenciais `add('session-1', 'msg-1')` + `add('session-1', 'msg-2')` ambas succeed sem throw, mesmo quando `client.memory.addSession` retorna 409 Conflict na 2ª invocação. Pre-check via `client.memory.getSession(sessionId)` OR try/catch + ignore 409 — plano precisa especificar qual.

### EC-5: Letta `archivalMemory.searchArchivalMemory` return shape — campo `score` pode estar ausente

- **Task afetada:** T3.2 (Letta) + T3.1 RED
- **Teste sugerido:** `test_letta_official_client_search_maps_passage_to_score` — assert que `search()` retorna `[{ text, score }]` mesmo quando o `Passage` retornado pelo SDK não tem campo `score` (Letta archival memory ranking pode retornar passages sem score numérico — fallback para `1.0 / (rank + 1)` ou `0.5` constant). Verify against blueprint Q5's actual return shape.

### EC-6: Empty results from `.search()` — adapter precisa lidar com array vazio

- **Task afetada:** T1.2 + T2.2 + T3.2
- **Teste sugerido:** `test_<vendor>_official_client_search_returns_empty_array_when_no_matches` — assert que search() em scope vazio retorna `[]` (não `null`, não `undefined`, não throw). Cada SDK lida diferente; explícito é melhor que implícito.

### EC-7: Bundle isolation — `tests/integration/public-paths.test.ts` pode quebrar com 3 vendor SDKs em `dependencies`

- **Task afetada:** Phase 1-3 + Dependencies modification (per ADR D5)
- **Teste sugerido:** Atualizar `tests/integration/public-paths.test.ts` para adicionar `test('default barrel does NOT export Mem0OfficialClient | ZepOfficialClient | LettaOfficialClient (bundle isolation per ADR D5)')` — assert que `import * as Mem from '@usetheo/memory'` não pulls `mem0ai` / `@getzep/zep-cloud` / `@letta-ai/letta-client` (~5-15MB transitive). Mirror do pattern existente para `cache-pg` (EC-26 precedent).

### EC-8: Vitest 4 `describe.skipIf` API — confirmar antes de T4.1 RED

- **Task afetada:** T4.1 RED (per ADR D4)
- **Teste sugerido:** Antes de T4.1 RED, rodar `npx vitest --version` + verificar docs vitest 4 (`package.json` mostra `^4.0.0`, plano cita "vitest 0.34+" — major bump pode ter mudado API). `describe.skipIf` é estável desde 0.34 mas vitest 4 introduziu breaking changes em outras APIs (e.g., `vi.mock` hoisting). 30 segundos de validation evita gambiarra retro-ativa.

### EC-9: Letta `agentId` existência — 404 do SDK propaga como qual tipo de erro?

- **Task afetada:** T3.2 (Letta)
- **Teste sugerido:** `test_letta_official_client_add_propagates_404_when_agent_missing` — assert que `add('nonexistent-agent-id', 'text')` throws com message identificável (NOT silent failure). Letta archival API pode retornar 404 (agent not found) — caller (BenchmarkAdapter) precisa distinguir "vendor error" vs "scope-key invalid" para reportar corretamente nos benchmark logs.

### EC-10: SDK constructor injection — plano não especifica api-key vs pre-constructed client

- **Task afetada:** T1.2 + T2.2 + T3.2
- **Teste sugerido:** Decidir + documentar em T1.1/T2.1/T3.1 RED: OfficialClient constructor recebe `apiKey: string` (constrói SDK internamente) OR recebe `sdk: MemoryClient | ZepClient | LettaClient` (DI puro)? Pattern de `LocalTransformerEmbedder` (DI da `pipeline`) sugere DI; mas factory pattern do `createOauth4webapiIntrospect` sugere o oposto. Escolha consistente entre 3 OfficialClients evita drift.

### EC-11: Concurrent `add()` race em mesmo scopeKey

- **Task afetada:** T2.2 (Zep especialmente)
- **Teste sugerido:** `test_zep_official_client_concurrent_add_same_session_no_data_loss` — `Promise.all([add('s', 'm1'), add('s', 'm2')])` deve resultar em 2 messages persistidas (não 1 com race). Especial para Zep porque session lifecycle (user.add + memory.addSession) tem janela de race. Mem0/Letta menos crítico (não criam recursos lateral).

---

## DOCUMENT

### EC-12: API quota burn — cron diário × 3 vendors × N tests

- **Risco aceito:** Cron `0 6 * * *` × 30 dias × 3 vendors × ~5 calls cada = ~450 SaaS API calls/mês. Mem0/Zep/Letta cloud free tiers podem estourar silenciosamente (workflow falha como `429 Too Many Requests` invariavelmente após dia ~15). Plan ADR D4 § Consequences já documenta "API quota burn" disclosure; suficiente. Operador é responsável por monitorar billing. Risco real mas operacional, não técnico.

### EC-13: CHANGELOG `[Unreleased]` — categoria correta para semver bump

- **Risco aceito:** Plan diz "CHANGELOG `[Unreleased]` updated" mas NÃO especifica categoria. ADR D1 explicitly é **breaking change** para os 3 vendor interfaces. Per `cycle-release.md § Bump-level derivation`: entrada `Changed` com prefix `BREAKING:` → triggers `major` bump (v0.x → v1.0). Pre-release pode aceitar `minor` se documentado, mas mecanismo deterministic depende do prefix. Plano deve adicionar entrada em `Changed` com prefix `BREAKING: rename Vendor*Client interface scope param from {userId,sessionId,agentId} → scopeKey (no production consumers per Drift-T6.x-1)`. Sem isso `/release` pode mis-bump.

### EC-14: CI workflow em fork PRs — secrets não expostos por design

- **Risco aceito:** Plan T5.1 usa apenas `schedule + workflow_dispatch` (NÃO `pull_request`) per design. Em fork PRs, vendor-benchmarks.yml não executa — secrets ficariam vazios e tests ficariam `SKIPPED` infinitos (mascarando regressões). Pattern correto per blueprint Q6 (Letta `pull_request_target` + `safe to test` label) está OUT-of-scope para v0.9; aceitar como follow-up cycle. README/CONTRIBUTING.md deve mencionar: "vendor benchmark tests run apenas em main branch via schedule; fork PRs não validam vendor cells".

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 / T0.2 + ADR D1 | 1 | 1 (EC-1) | 0 | 0 |
| T1.2 (Mem0) + ADR D2 | 2 | 2 (EC-2, EC-3) | 2 (EC-6, EC-10) | 0 |
| T2.2 (Zep) | 4 | 0 | 4 (EC-4, EC-6, EC-10, EC-11) | 0 |
| T3.2 (Letta) | 3 | 0 | 3 (EC-5, EC-9, EC-10) | 0 |
| T4.1 / T4.2 | 1 | 0 | 1 (EC-8) | 0 |
| T5.1 (CI workflow) | 1 | 0 | 0 | 1 (EC-14) |
| Phase 1-3 (deps + bundle) | 1 | 0 | 1 (EC-7) | 0 |
| Cross-cutting (release, ops) | 2 | 0 | 0 | 2 (EC-12, EC-13) |

**Veredicto:** PLANO PRECISA DE AJUSTE — 3 MUST FIX (1 ADR misdescription, 1 typed-error violation, 1 vendor SDK contract mismatch) que vão causar bugs silenciosos em runtime ou inconsistência no audit trail.

---

## Sugestão de absorção para v1.1 do plano

1. **EC-1** — Editar ADR D1 § Decision para explicitar 3 nomes pré-existentes (`userId` / `sessionId` / `agentId`) → uniform `scopeKey`. Atualizar T0.1 RED + T0.2 GREEN escopo correspondentemente.
2. **EC-2** — Adicionar T0.3 (novo) — "NEW `VendorSynthesizeUnsupportedError` em `src/core/errors.ts`" antes de Phase 1. Editar ADR D2 § Decision para usar typed error.
3. **EC-3** — Editar Sub-goal 1 (Mem0) para `{ text: r.memory, score: r.score }`. Adicionar teste em T1.1 RED para validar mapping field-by-field.
4. **EC-7** — Adicionar item em Coverage Matrix: "Bundle isolation regression check — `public-paths.test.ts` extended".
5. **EC-13** — Adicionar nota em "Final Phase: Integration Validation" sobre formato CHANGELOG `BREAKING:` prefix.
6. **EC-4, EC-5, EC-6, EC-8, EC-9, EC-10, EC-11** — Adicionar à seção TDD de cada T<V>.1 RED correspondente como casos de teste explícitos.
7. **EC-12, EC-14** — Adicionar à seção "Accepted Risks" do plano.

Após absorção em v1.1, `/deps-audit v0-9-vendor-client-impls` pode rodar — 3 NEW deps já têm Rule 9 evaluation column preenchida (canonical SDKs), CVE audit é trabalho desta próxima skill.

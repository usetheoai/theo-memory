# Edge Case Review — v0-2-theokit-binding-plan v1.0

Data: 2026-05-23
Plano analisado: `.claude/knowledge-base/plans/v0-2-theokit-binding-plan.md` (v1.0, 1072 LoC, 7 phases, 12 tasks, 6 ADRs)
Tasks analisadas: 12 (T0.1, T0.2, T1.1, T2.1, T2.2, T3.1, T4.1, T4.2, T4.3, T4.4, T5.1, T6.1)
Edge cases encontrados: 13 (MUST FIX: 5, SHOULD TEST: 5, DOCUMENT: 3)

## MUST FIX

### EC-1: Version constraint `^0.1.0` em templates não casa com `0.0.0-rc.2` atual

- **Task afetada:** T4.1
- **Família:** State / Packaging
- **Cenário:** Templates declaram `"@usetheo/memory": "^0.1.0"` em `package.json.tmpl`. `package.json` atual da TheMemory tem `"version": "0.0.0-rc.2"`. Quando consumidor rodar `npx create-theokit my-app --template=saas` e em seguida `npm install`, o npm tentará resolver `^0.1.0` no registry — falhará com 404 (pacote nem publicado ainda OU publicado como `0.0.x` pre-release que `^0.1.0` rejeita por semver).
- **Impacto:** Scaffolded app NÃO instala. T5.1 (E2E test) falha sem opção de fix dentro do plano. Toda a "default-on" promise da v0.2 quebra na primeira invocação real.
- **Fix sugerido:** Adicionar ADR D7 ao plano explicitando: enquanto package estiver pré-publish, templates declaram `"@usetheo/memory": "workspace:*"` (pnpm/yarn protocol) OU o plano absorve uma sub-task de publish no npm (com tag `next`) antes do merge. Sem a fix, EC-5 + EC-1 compostos = scaffolded app inoperável.

### EC-2: Singleton scaffoldado requer LLM + Embedder wiring sem fallback funcional

- **Task afetada:** T4.3
- **Família:** Input / State
- **Cenário:** O snippet do plano para `templates/{saas,postgres}/server/memory.ts` tem:
  ```ts
  embedder: /* consumer wires */,
  llm:      /* consumer wires */,
  ```
  Consumidor que roda `npm install && npm run dev` SEM editar `server/memory.ts` recebe `EmbeddingMismatch` no boot (createLocalMemory faz probe call no embedder no construtor, per `src/local/index.ts:242-247`). Plan diz "stub adapter throws on first call" mas (a) probe roda no construtor, ANTES da primeira call do handler; (b) stub não está documentado/especificado.
- **Impacto:** Demo `npm run dev` no scaffolded app crasha imediatamente. Lock-in narrative ("default-on memory que funciona no first handler") quebrada. Consumer não consegue nem ver o erro chegar até o handler.
- **Fix sugerido:** Adicionar sub-task ao T4.3: shipear `StubEmbedder` + `StubLLM` em `src/local/stubs.ts` (NEW) exportados via `@usetheo/memory` que retornam vetor determinístico de `MAX_EMBEDDING_DIM` dimensions zerado + um único fato fixo. Demo singleton instancia esses stubs por padrão; doc no header diz "REPLACE WITH YOUR PROVIDER". Probe passa; consumer vê demo funcionar antes de wirear OpenAI/etc.

### EC-3: T1.1 não valida em runtime que `ctx.session.userId` é string

- **Task afetada:** T1.1
- **Família:** Input / Boundary
- **Cenário:** ScopedContext declara `userId?: string`. Mas TypeScript permite consumer fazer `ctx.session.userId = 123 as any` (escape do type system). `memoryFromCtx` passa direto para `memory.user(123 as any as string)`. v0.1's `memory.user(userId)` cria scope `{kind:'user', userId: 123}` sem validar — vai escrever filtro `user_id: 123` (number) no pgvector, gerando dados sob escopo "fantasma" não-recuperável via consumer com string `'123'`.
- **Impacto:** Silencioso. Memórias salvas sob userId não-string ficam órfãs — `recall()` com string `'123'` retorna vazio. Em produção, qualquer `any`-escape OU dynamic source (parsed JSON sem type guard) introduz este bug. Per `architecture.md § 8`: "Validate at boundaries" — binding É a fronteira entre framework e core.
- **Fix sugerido:** No corpo de `memoryFromCtx`, antes de chamar `memory.user(userId)`:
  ```ts
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new MissingScopeError('binding requires session-bearing TheoKit context — wire createSessionManager first')
  }
  ```
  (substitui o atual check de empty string com check combinado de type + emptiness. ≤3 lines.)

### EC-4: Coordenação cross-repo (theo-memory + theokit) não está no plano

- **Task afetada:** Phase 4 (T4.1-T4.4 inteira)
- **Família:** State / Permission
- **Cenário:** Phase 4 edita `../theokit/packages/create-theo/templates/` e `bare-transform.ts`. Esses arquivos vivem no repositório `theokit` (sibling project), NÃO no `theo-memory`. PR de v0.2 em `theo-memory` não pode mergeear edits no theokit. Sem ordem definida: (a) PR theokit merge primeiro → templates referenciam `@usetheo/memory/theokit` que não existe ainda → CI da theokit falha; (b) PR theo-memory merge primeiro → consumidores que rodem `npx create-theokit` da release atual NÃO recebem memory; ambos quebrados.
- **Impacto:** Plano não-mergeable até cross-repo coordination ser explicitada. /review provavelmente flagará isso como CRITICAL.
- **Fix sugerido:** Adicionar ADR D7 ao plano explicitando ordem: (1) theokit PR landa primeiro com templates ATUALIZADOS + `bare-transform.ts` extension MAS comentada com TODO "uncomment when @usetheo/memory v0.2 published"; (2) theo-memory PR landa com binding + publish step; (3) theokit follow-up PR (ou release-please bot) uncomenta. Alternativa: feature flag `THEMEMORY_DEFAULT_ON=1` no scaffold CLI. Phase 4 tasks renomeiam para "Author PR description for sibling theokit PR" + "Block on theokit PR merge".

### EC-5: `package.json` ainda tem `"private": true` — bloqueia npm publish + scaffolded install

- **Task afetada:** Phase 2 (T2.1) + indiretamente T4.1 + T5.1
- **Família:** State / Permission
- **Cenário:** `package.json:5` declara `"private": true`. Mesmo com `^0.1.0` resolvido (EC-1 corrigido) ou `workspace:*` (alternativa), `npm publish` é refused enquanto `private: true`. T5.1 (E2E test) precisa do package instalável. T4.1 (template dep) precisa do package publicado para consumidores fora do monorepo.
- **Impacto:** Plano não atinge o Goal (consumidor faz `npx create-theokit ...` e tudo funciona) enquanto private flag estiver presente. Nenhuma task atual do plano remove a flag.
- **Fix sugerido:** Adicionar sub-task em Phase 2 (T2.3, NEW): "Remove `"private": true` from package.json + verify publish-dry-run succeeds." Acceptance criterion: `npm publish --dry-run` retorna sem erros. Marcar como blocking gate antes de Phase 5.

## SHOULD TEST

### EC-6: userId com whitespace-only (`"   "` / `"\n\t"`)

- **Task afetada:** T1.1
- **Teste sugerido:** `test_userId_whitespace_only_treated_as_state_c` — invocar `memoryFromCtx({session:{userId:'   '}}, mockMemory)` deve throw `MissingScopeError`. Atualmente o plano só checa `userId === ''`. Whitespace-only escapa o check e cria um scope com chave de espaço — quase impossível de recall corretamente depois.

### EC-7: Binding não muta `ctx` consumidor

- **Task afetada:** T1.1
- **Teste sugerido:** `test_memory_from_ctx_does_not_mutate_session` — clonar `ctx` antes da call; após call, assert `ctx.session.userId === ctxClone.session.userId`. Binding declarado puro mas regressão silenciosa é fácil em refactor futuro. Cheap test, alto valor.

### EC-8: ScopedContext declara `sessionId` + `agentId` mas T1.1 só resolve `userId`

- **Task afetada:** T0.2 + T1.1
- **Teste sugerido:** `test_session_id_in_ctx_ignored_at_v02_resolves_user_scope` — ctx com `{userId:'alice', sessionId:'s1'}` produz scope tier "user" (não session). Plus: documentar via JSDoc na interface ScopedContext que `sessionId` / `agentId` são reservados para futuras versões e atualmente NÃO afetam o resolver (consumer chama `memory.session()` / `memory.agent()` diretamente para esses tiers).

### EC-9: Subpath resolução sob `moduleResolution: "node16" | "bundler" | "nodenext"`

- **Task afetada:** T2.1
- **Teste sugerido:** `test_subpath_theokit_resolves_under_modern_resolution` — tsconfig fixture com `"moduleResolution": "node16"` (ou `"bundler"`); compila um snippet `import { memoryFromCtx } from '@usetheo/memory/theokit'`; tsc exit code 0. Modern resolution é estrita sobre `package.json#exports` shape; sem este teste, scaffolded apps com Vite/tsup (que defaultam para `bundler`) podem quebrar silenciosamente.

### EC-10: T5.1 E2E test — ordem de npm install vs symlink

- **Task afetada:** T5.1
- **Teste sugerido:** `test_temp_scaffold_install_order_correct` — no helper `temp-scaffold.ts`, a sequência deve ser: (1) scaffold via `create-theokit --skip-install`, (2) symlink `node_modules/@usetheo/memory` ANTES de `npm install`, (3) `npm install` que então pula re-resolution do já-symlinked package. Sem essa ordem, npm sobrescreve o symlink. Test verifica que após install, `node_modules/@usetheo/memory/src/theokit/index.ts` existe (não a versão registry).

## DOCUMENT

### EC-11: Future tier expansion (sessionId/agentId) deferida explicitamente

- **Risco aceito:** Plano resolve apenas `userId` em v0.2 mesmo com ScopedContext declarando 3 tiers. Documentar em JSDoc na função `memoryFromCtx`: "v0.2 only resolves userId tier. Use `memory.session(id)` / `memory.agent(id)` directly for other tiers. Multi-tier auto-resolution may land in v0.3+." Consumer fica honestamente avisado sem inflar o escopo da v0.2.

### EC-12: Runtime no-check em `memory` parameter

- **Risco aceito:** Plano explicitamente decide "TypeScript catches null/undefined at compile time; runtime no-check needed". Documentar essa decisão como uma linha no header do `src/theokit/index.ts`: "This binding does NOT runtime-validate the `memory` parameter — TypeScript's `Memory` type guard is the contract. If you escape the type system, you own the resulting NPE." Inquebrável Rule 8 (fail-clear) atendido via comentário.

### EC-13: T5.1 E2E test — Windows skip

- **Risco aceito:** Symlink behavior em Windows requer admin privileges OU developer-mode flag. Scaffolded-app E2E test sob Windows runners CI = flaky. Documentar: T5.1 test marcado com `it.skipIf(process.platform === 'win32')(...)` + nota em README ou test header. Justificativa: TheoKit + TheMemory targetam Linux/macOS dev primariamente; Windows é suportado em runtime mas não obrigatório para test infra.

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T0.2 | 2 | 0 | 2 (EC-7, EC-8) | 0 |
| T1.1 | 5 | 1 (EC-3) | 3 (EC-6, EC-7, EC-8) | 2 (EC-11, EC-12) |
| T2.1 | 2 | 1 (EC-5 partial) | 1 (EC-9) | 0 |
| T2.2 | 0 | 0 | 0 | 0 |
| T3.1 | 0 | 0 | 0 | 0 |
| T4.1 | 2 | 2 (EC-1, EC-4 partial) | 0 | 0 |
| T4.2 | 0 | 0 | 0 | 0 |
| T4.3 | 1 | 1 (EC-2) | 0 | 0 |
| T4.4 | 0 | 0 | 0 | 0 |
| T5.1 | 3 | 1 (EC-5 partial) | 1 (EC-10) | 1 (EC-13) |
| T6.1 | 0 | 0 | 0 | 0 |
| **Cross** | 1 | 1 (EC-4 cross-repo) | 0 | 0 |

**Veredicto:** **PLANO PRECISA DE AJUSTE**

5 MUST FIX items bloqueiam o atingimento do Goal (especialmente EC-1 + EC-5 que tornam scaffolded apps incapazes de `npm install`, e EC-4 que torna o PR não-mergeable cross-repo). Recomendação: humano absorve os 5 MUST FIX em plan v1.1 — provavelmente como (a) ADR D7 cross-repo coordination + (b) ADR D8 stub adapter + private flag removal + (c) sub-tasks T2.3 (remove private), T4.5 (stub adapters em `src/local/stubs.ts`), e revisar T1.1 com type-guard runtime. Re-rodar `/edge-case-plan` em v1.1 para confirmar absorção. SHOULD TEST e DOCUMENT items podem ser adicionados como sub-tasks de testes nos tasks existentes (T1.1 ganha 4 testes adicionais; T2.1 ganha 1; T5.1 ganha 1 + 1 skipIf).

# Edge Case Review — v0-3-agent-tools-mcp

Data: 2026-05-24
Plano analisado: `.claude/knowledge-base/plans/v0-3-agent-tools-mcp-plan.md` (v1.0, ~1112 LoC)
Tasks analisadas: 11 (T0.1, T0.2, T1.1, T2.1, T2.2, T3.1, T4.1, T5.1, T6.1, T6.2, T7.1, T7.2)
Edge cases encontrados: 20 (MUST FIX: 8, SHOULD TEST: 9, DOCUMENT: 3)

## MUST FIX

### EC-1: bin entry requires `dist/agent-tools/cli.js` but T0.2 doesn't verify build pipeline
- **Task afetada:** T0.2 (e dependência implícita em T7.1)
- **Família:** Boundary (package surface) / Build ordering
- **Cenário:** T0.2 adiciona `bin: { "themory-mcp": "./dist/agent-tools/cli.js" }` no `package.json`, mas a verificação do build pipeline está em T6.1 (Phase 6). Entre Phase 0 e Phase 6, qualquer `npm install` ou `npm pack` em ambiente local pode falhar tentando resolver o bin inexistente. CI/CD que rode `npm prepublishOnly` quebra silenciosamente.
- **Impacto:** PR pode mergear sem CLI invocável; downstream T7.1 (E2E) falha porque dist/cli.js não existe.
- **Fix sugerido:** Mover a verificação "v0.1 build pipeline emits dist/" de T6.1 § Tasks step 1 para T0.2 § Tasks novo step 0 (verificar/adicionar `tsconfig.json outDir` ANTES de declarar bin). Ou adicionar stub `dist/agent-tools/cli.js` (re-exports `src/agent-tools/cli.ts` via tsx fallback) até T6.1 emitir real dist.

### EC-2: payload size cap missing at zod boundary — embedder OOM risk
- **Task afetada:** T2.1 (schemas)
- **Família:** Input (boundary)
- **Cenário:** `remember.content` é `z.string()` sem `.max()`. Agent loop malicioso ou bug pode enviar 100MB string. Sem fail-fast no zod parse, dispatch chama Memory.remember → extraction pipeline → LLM call com texto enorme (custo $$$) OU embedder OOM.
- **Impacto:** Custo descontrolado de LLM/embedder. Possível DoS via single payload.
- **Fix sugerido:** Adicionar `.max(MAX_CONTENT_BYTES)` (definir como 50_000 chars ≈ ~12k tokens, alinhado ao MAX_EMBEDDING_DIM cap de v0.1) em rememberSchema. Equivalente em `recall.query.max(2000)`. Zod rejeita no boundary com `-32602`.

### EC-3: `zod-to-json-schema` dialect target não explícito — risco de emit não-2020-12
- **Task afetada:** T2.2 (tools/list emitter)
- **Família:** Format (schema dialect)
- **Cenário:** Plano menciona em pseudocode `zodToJsonSchema(schema, { target: 'jsonSchema2019-09' })` — comentário "or '2020-12' per emitter version" sugere indecisão. `zod-to-json-schema` default é draft-7 em algumas versões. Q7 mandates 2020-12 default; clientes spec-compliant podem rejeitar draft-7 schemas.
- **Impacto:** SDK clients pode falhar ao validar tools/list response → MCP `tools/list` retorna erro → agent loop sem ferramentas.
- **Fix sugerido:** Lock `target: 'jsonSchema7'` se zod-to-json-schema não suportar 2020-12 nativamente, OU `target: 'openApi3'` com pós-processamento. Adicionar ADR D9 "JSON Schema dialect lock + emitter version pin" antes de T2.2 implementar.

### EC-4: ScopedContext move (theokit/types.ts → core/scope.ts) pode quebrar v0.2 PR-A
- **Task afetada:** T3.1 (scope binding + sibling refactor)
- **Família:** State (cross-package refactor)
- **Cenário:** Plano move tipo de `src/theokit/types.ts` para `src/core/scope.ts` + re-export em theokit. Se import path em `src/theokit/index.ts` ou em `tests/integration/theokit-binding.test.ts` (v0.2 PR-A) usar import diferente do re-export shape, typecheck falha.
- **Impacto:** v0.2 PR-A 304 testes (258 contract + 46 integration) podem quebrar. Backward compat declarada na DoD do plano mas não verificada em T3.1.
- **Fix sugerido:** Adicionar checkpoint explícito em T3.1 § DoD: `npm test -- tests/integration/theokit-binding.test.ts` (v0.2 PR-A suite) MUST green ANTES de commit T3.1. Já mencionado mas dever passa pra MUST FIX (sub-task explícita).

### EC-5: error classifier não trata erros de pg/network (ECONNREFUSED, ETIMEDOUT)
- **Task afetada:** T4.1 (error classifier)
- **Família:** Boundary (third-party error propagation)
- **Cenário:** Quando pgvector container cai OU Postgres restart durante request, `pg` driver throws `Error` com `code: 'ECONNREFUSED'` ou `'ETIMEDOUT'`. Não é instância de domain error (MemoryStoreError, EmbedderError, etc.). Classifier cai no fallback `-32603 Internal error` em vez de Tool Execution Error com texto actionable. Mem0's graceful-degradation pattern (Q5) perde-se.
- **Impacto:** Agent loop recebe Protocol Error em vez de Tool Execution Error → não consegue self-correct → falha fatal em vez de retry.
- **Fix sugerido:** Adicionar caso explícito em `classifyError`: `if (err instanceof Error && typeof err.code === 'string' && PG_TRANSIENT_CODES.has(err.code)) return executionError('Memory store unavailable. Retry in a moment.')`. PG_TRANSIENT_CODES = `['ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EPIPE']`.

### EC-6: empty recall result shape ambíguo — Q7 spec não cobre
- **Task afetada:** T5.1 (recall dispatch handler)
- **Família:** Format (response shape contract)
- **Cenário:** `memory.recall(query)` retorna `[]` (zero matches). Handler retorna `{content: [], isError: false}` OR `{content: [{type:'text', text:'[]'}], structuredContent: {results:[]}, isError: false}`? Q7 § Calling Tools example sempre mostra content não-vazio. SDK clients podem interpretar content vazio como bug.
- **Impacto:** Agent loop pode crashar ao iterar content vazio. Ambiguidade no contrato API.
- **Fix sugerido:** Lock shape: empty result returns `{content: [{type:'text', text: 'No memories matched the query.'}], structuredContent: {results: []}, isError: false}`. Texto humano-legível para LLM auto-correct ("nothing recalled, try different query"). Documentar em T5.1 Deep Dives.

### EC-7: stdio CLI não trata SIGINT (Ctrl-C) nem hard-fail em env var ausente
- **Task afetada:** T6.1 (stdio transport + CLI)
- **Família:** Boundary (process lifecycle) + Input (env var validation)
- **Cenário (a):** Plano § T6.1 § Deep Dives menciona `SIGTERM` apenas. Ctrl-C envia SIGINT. Operador rodando manualmente `node dist/agent-tools/cli.js` interrompe com Ctrl-C — sem handler, processo termina abruptamente sem `server.stop()` cleanup. **Cenário (b):** Se `THEOMEM_PG_URI` ausente, plano não diz o que acontece — Memory factory provavelmente crasha com erro genérico em vez de "missing required env var: THEOMEM_PG_URI".
- **Impacto:** (a) zombie connections ao Postgres. (b) operator confusion; UX ruim no primeiro install.
- **Fix sugerido:** Em T6.1 cli.ts main(): `process.on('SIGINT', shutdownHandler); process.on('SIGTERM', shutdownHandler);`. Antes de createLocalMemory: `if (!process.env.THEOMEM_PG_URI) { console.error('Error: THEOMEM_PG_URI required. Set it to a postgres connection string.'); process.exit(2); }`.

### EC-8: E2E test depende de dist/cli.js mas CI ordering não está no plano
- **Task afetada:** T7.1 (E2E round-trip)
- **Família:** Timing (build vs test ordering)
- **Cenário:** T7.1 spawns subprocess via `node dist/agent-tools/cli.js`. Se CI roda `npm test` SEM `npm run build` antes, dist/ não existe → spawn ENOENT → E2E falha. Plano menciona `npm run build` em Final Phase Execution mas não em T7.1 Tasks.
- **Impacto:** CI primeiro run após PR open quebra inexplicavelmente — não fica claro se é teste defeituoso ou bug real.
- **Fix sugerido:** Adicionar em T7.1 § Tasks step 0: "Add `pretest` npm script that runs `npm run build` if dist/agent-tools/cli.js is missing" OR explicit `beforeAll(() => { execSync('npm run build', {stdio:'inherit'}) })` no E2E suite. Acceptance criterion: "T7.1 funciona em fresh clone após `npm ci && npm test`".

## SHOULD TEST

### EC-9: subpath `./agent-tools` resolution sob moduleResolution=node16/bundler/nodenext (mirror v0.2 EC-9)
- **Task afetada:** T0.2
- **Teste sugerido:** `test_agent_tools_subpath_resolves_under_modern_module_resolution_variants()` — spawn `tsc --noEmit` em fixtures com tsconfig.json variando moduleResolution (node16, bundler, nodenext); fixture importa `import { createMcpServer } from '@usetheo/memory/agent-tools'`. Mirror exato do pattern em `tests/integration/public-paths.test.ts` da v0.2 PR-A.

### EC-10: `recall.threshold` aceito fora de [0, 1]
- **Task afetada:** T2.1
- **Teste sugerido:** `test_recall_schema_rejects_threshold_outside_zero_to_one()` — assert `recallSchema.safeParse({query:'foo', threshold: 1.5})` retorna `.success: false`. zod fix: `z.number().min(0).max(1).default(0)`.

### EC-11: `reflect` schema strict empty object vs passthrough — decisão pendente
- **Task afetada:** T2.1
- **Teste sugerido:** `test_reflect_schema_rejects_extra_keys_to_avoid_silent_drift()` — assert `reflectSchema.safeParse({foo: 'bar'})` retorna `.success: false`. Decisão sugerida: STRICT (rejeita extras) para forçar agent a usar shape correto; futuro `reflect({since: timestamp})` adicionado explicitamente.

### EC-12: nested withScope com inner ctx undefined — comportamento indefinido
- **Task afetada:** T3.1
- **Teste sugerido:** `test_nested_withScope_with_undefined_inner_throws_or_inherits()` — exercer `withScope(outer, () => withScope(undefined, () => getScope()))`. Define comportamento: inner=undefined deve THROW (não inherit silentemente) para evitar bug latente. Implementação: `getScope()` checa `als.getStore() === undefined → throw MissingScopeError`.

### EC-13: Error.cause chain pode vazar em -32603 data
- **Task afetada:** T4.1
- **Teste sugerido:** `test_classify_unexpected_error_strips_cause_chain()` — crie `new Error('outer', { cause: new Error('inner with secret') })`; assert `data.cause` AND `data.stack` AND mensagens nested NOT presentes em classifyError output. Apenas top-level `err.message` sanitizado.

### EC-14: forget(id) com id inexistente — comportamento não definido
- **Task afetada:** T5.1
- **Teste sugerido:** `test_forget_unknown_id_returns_success_or_typed_error()` — v0.1 Memory.forget(id) com id absent: investigar comportamento ATUAL (throw NotFound? silent? returns boolean?). Definir contrato: dispatch handler returns `{content:[{type:'text', text:'No memory found with id {id}.'}], isError: false}` (idempotent forget) — alinhado com REST DELETE semantics.

### EC-15: streamable-HTTP port collision (EADDRINUSE)
- **Task afetada:** T6.2
- **Teste sugerido:** `test_streamable_http_port_in_use_exits_with_clear_message()` — pre-bind port 8080 via dummy net.createServer; spawn cli; assert exit code 1 + stderr contains "Port 8080 already in use".

### EC-16: X-Agent-Id header sanitization (log injection / control chars)
- **Task afetada:** T6.2
- **Teste sugerido:** `test_streamable_http_rejects_x_agent_id_with_control_chars()` — POST com `X-Agent-Id: alice\r\nFakeHeader: x`; assert request rejeita com `400 Bad Request`. Regex sanitizer: `/^[A-Za-z0-9._-]{1,128}$/` aplicado em middleware.

### EC-17: subprocess teardown — zombie PIDs após vitest crash
- **Task afetada:** T7.1
- **Teste sugerido:** `test_e2e_no_zombie_processes_after_suite()` — captura `process.pid` filhos no `beforeAll`, valida em `afterAll` que todos morreram via `ps -p PID`. Disciplina: every MockMcpClient instance MUST `try/finally close()`; suite-level cleanup mata por SIGKILL como último recurso.

## DOCUMENT

### EC-18: tools/list response não-memoizado (regenera schema cada call)
- **Risco aceito:** v0.3 ships 4 tools STATIC; `tools/list` é raramente chamado (uma vez no initialize handshake per agent session). Custo regenerar JSON Schema 4× é desprezível (<1ms). Memoization é otimização prematura. Reconsiderar se SDK começar a chamar `tools/list` em loop (não deveria — `listChanged: false` declarado).

### EC-19: metadata reserved keys (`user_id`, `session_id`, `agent_id`) podem conflitar
- **Risco aceito:** `remember.metadata: Record<string, unknown>` é opaco — TheMemory v0.1 não usa nomes de scope dentro de metadata. Se um caller injetar `metadata: {user_id: 'spoofed'}`, o scope real (de AsyncLocalStorage) vence — metadata é só payload. Risco real é zero; documentar em README "metadata is opaque user-controlled JSON; scope sempre vence" para clareza.

### EC-20: TLS para streamable-HTTP deferido a reverse proxy
- **Risco aceito:** v0.3 streamable-HTTP é HTTP plaintext por design. Produção com TheoCloud (v0.5) terá nginx/caddy/Cloudflare na frente — TheoCloud já provê TLS termination per `architecture.md § 5`. Configurar TLS no Node server é redundante. Documentar em README "TheMemory MCP HTTP server expects to run behind a reverse proxy in production; do not expose port 8080 directly to public internet without TLS".

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T0.2 | 2 | 1 (EC-1) | 1 (EC-9) | 0 |
| T1.1 | 0 | 0 | 0 | 0 |
| T2.1 | 3 | 1 (EC-2) | 2 (EC-10, EC-11) | 0 |
| T2.2 | 2 | 1 (EC-3) | 0 | 1 (EC-18) |
| T3.1 | 2 | 1 (EC-4) | 1 (EC-12) | 0 |
| T4.1 | 2 | 1 (EC-5) | 1 (EC-13) | 0 |
| T5.1 | 3 | 1 (EC-6) | 1 (EC-14) | 1 (EC-19) |
| T6.1 | 1 | 1 (EC-7) | 0 | 0 |
| T6.2 | 3 | 0 | 2 (EC-15, EC-16) | 1 (EC-20) |
| T7.1 | 2 | 1 (EC-8) | 1 (EC-17) | 0 |
| T7.2 | 0 | 0 | 0 | 0 |
| **Total** | **20** | **8** | **9** | **3** |

**Veredicto:** PLANO PRECISA DE AJUSTE — 8 MUST FIX a absorver para v1.1.

## Sugestão de absorção em v1.1

Mudanças mínimas no plano (não criar fases novas):

- **EC-1 + EC-8:** mover build-pipeline-verify de T6.1 para T0.2 + adicionar `pretest`/`beforeAll` build hook em T7.1.
- **EC-2:** adicionar `.max(MAX_CONTENT_BYTES)` + `.max(MAX_QUERY_BYTES)` constants em T2.1 § Deep Dives.
- **EC-3:** adicionar ADR D9 "JSON Schema dialect lock" OR explicit zod-to-json-schema config no T2.2 § Deep Dives.
- **EC-4:** elevar v0.2 PR-A suite-green check a Acceptance Criterion item em T3.1.
- **EC-5:** adicionar caso pg-transient em T4.1 § Deep Dives (com PG_TRANSIENT_CODES constant).
- **EC-6:** definir empty-recall content shape em T5.1 § Deep Dives.
- **EC-7:** SIGINT + env-var-validation em T6.1 § Tasks.

Total de edits no plano: ~15-20 linhas. Sem nova fase, sem nova ADR (D9 é one-liner em T2.2 — opcional).

## Próximos passos

1. **Absorver os 8 MUST FIX** no plano: bump v1.0 → v1.1 com as 7 mudanças acima (EC-1 + EC-8 são editáveis em uma só sub-task).
2. **Re-rodar `/edge-case-plan v0-3-agent-tools-mcp`** OU avançar para `/deps-audit v0-3-agent-tools-mcp` (per cycle-plan v1.1 § Chain).
3. SHOULD TEST entries viram testes no TDD section das tasks correspondentes em v1.1.
4. DOCUMENT entries viram notas em README ou nas Deep Dives das tasks correspondentes.

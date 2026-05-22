# Edge Case Review — memory-contract-v0-0

Data: 2026-05-22
Tasks analisadas: 14 (T0.1-T0.3, T1.1-T1.2, T2.1-T2.5, T3.1-T3.4, T4.1) + Phase 5
Edge cases encontrados: 11 (MUST FIX: 4, SHOULD TEST: 3, DOCUMENT: 4)

> **Filosofia aplicada.** Plano é types-only (v0.0). Não há I/O, rede, concorrência, ou estado persistente — fronteiras reais resumem-se a (a) ferramenta de tooling (npm/tsc/eslint/vitest), (b) o pacote distribuído (`package.json#exports`), (c) o filesystem (criação de arquivos `.ts`/`.md`). Edge cases viver nessas três fronteiras + nas decisões de design que travam shape contra v0.1+.

## MUST FIX

### EC-1: `MemoryConfig` type referenciado na Coverage Matrix mas não definido em nenhuma task

- **Task afetada:** T2.5 (memory-store.ts)
- **Família:** State / Format — gap entre Coverage Matrix e conteúdo do task
- **Cenário:** Coverage Matrix linhas 7 e 8 dizem "Q5 — `entityBoost: false` → T2.5 (Memory constructor config — declarado como `MemoryConfig` type em T2.5's deep dive)" e "Q6 — `apiKey?: string` → T2.5". Mas o Deep Dive de T2.5 NÃO define `MemoryConfig` — só define `MemoryStore`, `Memory`, `ScopedMemory`, `ReflectionResult`, `HistoryEntry`. Coverage Matrix 100% mente: Q5 e Q6 não têm task content correspondente. `/plan-confidence` deve flag isso via `coverage_lt_100`.
- **Impacto:** Cap em 49 (INVALID) no `/plan-confidence` quando o `check_coverage_matrix.py` reconciliar matriz vs task content. Hard gate inquebrável (`plan-confidence-golden-rule.md`).
- **Fix sugerido:** Em T2.5, adicionar ao Deep Dive a definição:
  ```ts
  export interface MemoryConfig {
    readonly embedder: Embedder
    readonly llm: LLM
    readonly vectorStore: VectorStore
    readonly historyManager?: HistoryManager   // optional; DummyHistoryManager default at v0.1
    readonly reflectionPolicy?: ReflectionPolicy // optional; ManualReflectionPolicy default
    readonly entityBoost?: boolean              // default true (D7)
    readonly customInstructions?: string
  }
  export interface CloudMemoryConfig extends MemoryConfig {
    readonly apiKey?: string                    // overrides THEOKIT_API_KEY env var (D9)
    readonly baseUrl?: string                   // overrides production endpoint
  }
  ```
  Adicionar ao barrel T4.1: `export type { MemoryConfig, CloudMemoryConfig }`.

---

### EC-2: Error subclasses sem `Object.setPrototypeOf` quebram `instanceof` ao serem reempacotadas

- **Task afetada:** T2.4 (errors.ts)
- **Família:** Boundary — TypeScript-to-Node prototype chain
- **Cenário:** Subclasses de `Error` em TypeScript precisam de `Object.setPrototypeOf(this, X.prototype)` no construtor para que `instanceof` funcione corretamente quando o erro atravessa fronteiras de módulo (ESM ↔ CJS, dynamic import, worker_threads). Sem isso, `catch (e) { if (e instanceof MemoryNotFound) ... }` retorna `false` mesmo para a instância correta — bug clássico de `extends Error` em TS targeting ES2022 (TypeScript handbook § "Extending built-ins"). Crítico para D6: o adapter local v0.1 vai lançar `BiTemporalNotSupportedLocally`; consumidores vão testar `instanceof BiTemporalNotSupportedLocally` para distinguir do erro genérico.
- **Impacto:** Erros tipados parecem corretos mas falham em runtime. Manifest do problema só aparece quando o adapter v0.1 atravessa a fronteira de módulo — debugging tardio.
- **Fix sugerido:** Em T2.4, padronizar o template do construtor:
  ```ts
  export class MemoryNotFound extends Error {
    readonly name = 'MemoryNotFound' as const
    constructor(memoryId: string, options?: ErrorOptions) {
      super(`Memory not found: ${memoryId}`, options)
      Object.setPrototypeOf(this, MemoryNotFound.prototype)
    }
  }
  ```
  Aplicar a cada uma das 5 classes. Adicionar test-d que assert `new MemoryNotFound('x') instanceof MemoryNotFound === true` (verificação runtime, não só compile).

---

### EC-3: `"default": null` em `package.json#exports` pode quebrar resolução de tipos no consumidor

- **Task afetada:** T4.1 (package.json exports map)
- **Família:** Boundary — Node ESM resolution
- **Cenário:** O plano usa `{ "./contract": { "types": "./docs/contract/index.ts", "default": null } }` para bloquear runtime imports do path preview. Mas Node 20+ resolution treats `null` como "package path is not exported" — runtime falha com `ERR_PACKAGE_PATH_NOT_EXPORTED` (esperado), MAS TypeScript's `moduleResolution: "node20"` aplica a mesma resolução em compile time, então `import type { Memory } from '@usetheo/memory/contract'` pode falhar a resolução de tipos também, mesmo com a chave `types` declarada. Documentação Node.js (https://nodejs.org/api/packages.html#exports-sugar) confirma null = unexported; comportamento de TypeScript com `types + default: null` não é amplamente testado.
- **Impacto:** Sub-goal 6 do plano ("Memory.user('alice').remember('text')` compile-checks via `@usetheo/memory/contract`") pode falhar — testes T2.5 importam via path relativo (`./index`) e passam, mas qualquer teste externo via package path quebra.
- **Fix sugerido:** Trocar `default: null` por DOIS approaches válidos:
  - **Opção A (recomendada):** apontar `default` para o mesmo arquivo, aceitando que `npm install @usetheo/memory` ainda não está publicado e portanto runtime import é hipotético:
    ```json
    "./contract": { "types": "./docs/contract/index.ts", "default": "./docs/contract/index.ts" }
    ```
    O runtime tentaria carregar `.ts` (falharia sem loader) — mas isso só importa em consumer-land, que ainda não existe. Em compile time, TypeScript apenas usa a chave `types`.
  - **Opção B (paranoia):** manter `"private": true` no package.json (já fizemos) e adicionar comentário sibling `"_v0_0_exports_preview_only": true` documentando que esse exports map é apenas para inspeção interna até v0.1.

  Preferir Opção A — testar com `npx tsc -p tsconfig.contract.json` apontando um stub consumidor sob `docs/contract/__tests__/external-import.test-d.ts` que importa via `@usetheo/memory/contract` (resolve via `paths` no tsconfig se necessário até v0.1).

---

### EC-4: Grep gate de Phase 5 ("production-ready" / emoji) escopa demais e pode false-positive

- **Task afetada:** Phase 5 (Integration Validation acceptance criteria)
- **Família:** Format / Permission — escopo do grep
- **Cenário:** A acceptance diz `grep -r "production-ready\|production grade" docs/ package.json` returns nothing. Mas (a) o próprio plano sob `.claude/knowledge-base/plans/` NÃO está em `docs/` (escopo OK), MAS (b) `docs/adrs/` vai conter ADR-0001 que CITA "production-ready" em consequence sections ("cannot claim production-ready until v1.0 + benchmarks") porque a regra dogfood é parte explícita do design. Grep simples falha. Mesmo problema com emoji se um ADR mencionar "no emoji" (palavra) — `[\u{1F300}-\u{1FAFF}]` é regex correto, mas precisa rodar com `grep -P` (perl regex) ou ferramenta equivalente.
- **Impacto:** Phase 5 acceptance criteria pode false-positive ou false-negative. Falsa segurança ou bloqueio injusto.
- **Fix sugerido:** Refinar duas acceptance criteria:
  - "No `production-ready` token added by this plan":
    ```bash
    # Grep só fala de production-ready como CLAIM, não como token isolado:
    grep -rn "production-ready\|production grade" docs/contract/ package.json README.md CHANGELOG.md | grep -v "CANNOT\|MUST NOT\|forbidden\|gate"
    # Exit 0 com saída vazia = OK
    ```
  - "No emoji":
    ```bash
    grep -rnP "[\x{1F300}-\x{1FAFF}]|[\x{2600}-\x{27BF}]" docs/ package.json CHANGELOG.md
    # Exit 0 com saída vazia = OK
    ```
  ADRs sob `docs/adrs/` PODEM mencionar "production-ready" como TERMO PROIBIDO (parte da decisão); o grep precisa excluir esses contextos. Adicionar ao plano DoD do Phase 5: "Grep gate runs the EXACT command above; saída vazia é o critério."

---

## SHOULD TEST

### EC-5: `RecallOptions.asOf` é type-permissivo mas runtime-divergente entre local v0.1 e cloud v0.5+

- **Task afetada:** T2.3 (options.ts) + T2.5 (memory-store.test-d.ts)
- **Família:** State / Boundary — runtime contract divergence within shared type
- **Cenário:** D6 trava `asOf?: Date` como opt na `RecallOptions` para ambos runtimes; local v0.1 vai lançar `BiTemporalNotSupportedLocally` em runtime quando recebido. Consumidor TypeScript escreve `await memory.user('x').recall('q', { asOf: new Date('2025-01-01') })` — compila perfeitamente, crasha em runtime no local. Type system não pode detectar (a opção É tipável para o cloud).
- **Teste sugerido:** Em `memory-store.test-d.ts`, adicionar:
  ```ts
  test_recall_asOf_type_accepts — expectTypeOf<RecallOptions>().toHaveProperty('asOf').toMatchTypeOf<Date | undefined>()
  test_recall_asOf_documented_as_runtime_divergent — assert a JSDoc comment "@throws BiTemporalNotSupportedLocally on local runtime until v0.5+" is present in options.ts ABOVE the asOf field (regex match)
  ```
  E em v0.1 (próximo plano), adicionar test runtime: `await expect(localMemory.user('x').recall('q', { asOf: new Date() })).rejects.toBeInstanceOf(BiTemporalNotSupportedLocally)`.

---

### EC-6: `VectorStore.getUserId() / setUserId()` colide semanticamente com o sistema Scope

- **Task afetada:** T3.3 (vector-store.ts)
- **Família:** Integration — DIP contract vs domain shape
- **Cenário:** D8 mantém VectorStore.getUserId/setUserId verbatim do Mem0 (Mem0 usa para tenant isolation single-user-per-client). MAS nosso domínio expressa tenant via `Scope` discriminated union (D2). Adapter no v0.1 vai ter dois caminhos para "qual user?": (a) o `scope` parameter passado em cada call, (b) o `setUserId(...)` global. Caminho (b) pode ser usado erroneamente pelo adapter para hardcodar um user, quebrando isolamento multi-tenant que o `Scope` deveria garantir.
- **Teste sugerido:** Em `vector-store.test-d.ts`, adicionar comentário-contrato + test:
  ```ts
  test_vector_store_userId_is_session_metadata_not_isolation_key
    // O contrato `getUserId/setUserId` em VectorStore é METADADO de sessão
    // de cliente (telemetry/Mem0 parity), NÃO chave de isolamento tenant.
    // Isolamento tenant SEMPRE usa Filters via search/insert.
    // Adapter v0.1 deve documentar que `setUserId` é call-site-fixed,
    // não scope-fixed.
  ```
  Adicionar nota no ADR-0008 (D8) ou no JSDoc do método em vector-store.ts: "/** @see ADR-0002 — tenant isolation uses Filters, not this method. */"

---

### EC-7: ESLint v9 flat config + typescript-eslint v7 + ESLint plugins têm matriz de compatibilidade real

- **Task afetada:** T0.3 (eslint.config.ts)
- **Família:** Input / Resource — runtime dependency compatibility
- **Cenário:** ESLint 9 dropou suporte a `.eslintrc.*` (legacy) e força flat config. typescript-eslint 7+ tem o helper `tseslint.config([...])`. Mas plugins como `eslint-plugin-import` historicamente atrasaram suporte ao flat config — em 2025 vários ainda exigem workarounds. Se um plugin requerido (e.g., `eslint-plugin-import` para sort) não estiver listado nas devDeps, ESLint v9 vai crashar com mensagem opaca em `eslint --print-config`.
- **Teste sugerido:** Em T0.3 acceptance, adicionar comando explícito de smoke:
  ```bash
  npx eslint --print-config docs/contract/index.ts > /dev/null
  # exit 0 = configuração resolve; exit ≠ 0 = plugin missing ou config inválido
  ```
  Se o plano requer `import/no-namespace` (que requer `eslint-plugin-import`), adicionar `eslint-plugin-import ^2.30.0` à lista de NEW deps em `## Dependencies` com Rule 9: "ADOPT — única lib mainstream para regras de import; alternative oxlint built-in mas escopo menor."

---

## DOCUMENT

### EC-8: T1.2 edita CLAUDE.md — § Open questions não está em "locked items" mas merece nota

- **Task afetada:** T1.2 (atualiza CLAUDE.md § Open questions com RESOLVED + ADR links)
- **Risco aceito:** CLAUDE.md tem "Locked items" que requerem strategic review (Locked names, Voice and tone, 3 root overrides). § Open questions NÃO está nessa lista — editar para marcar Q2-Q6 como RESOLVED é parte do contrato normal do plano. Mas a edição deve ser PURELY ADITIVA (acrescenta "RESOLVED 2026-05-22 → ADR-000N", não remove a pergunta). Manter as perguntas no documento como audit trail.

Documentação: adicionar nota no T1.2 Deep Dive: "CLAUDE.md edits MUST be additive — never remove the question text, only append the RESOLVED annotation. Audit trail is the point."

---

### EC-9: `MemoryItem.metadata` exclui `Date`, `bigint`, e nested objects — limitação consciente

- **Task afetada:** T2.2 (memory-item.ts)
- **Risco aceito:** Tipo `Readonly<Record<string, string | number | boolean | null>>` é mais estrito que `Record<string, any>` do Mem0. Consumidores acostumados a metadata aninhada (`{ user: { age: 30 } }`) precisarão flatten para `{ 'user.age': 30 }`. Date timestamps serializam como ISO string. bigint como string. Limitação consciente — facilita JSON-serialization no postgres, evita ambiguidade de Date timezone, alinha com Mem0's pgvector payload shape.

Documentação: adicionar JSDoc em `memory-item.ts` acima do campo `metadata`:
```ts
/**
 * Flat key-value payload. Primitives only (string/number/boolean/null).
 * Nested objects, Date, and bigint MUST be flattened / serialized
 * by the caller. v1.4 typed-domain-ontologies may relax this.
 */
readonly metadata: Readonly<Record<string, string | number | boolean | null>>
```

---

### EC-10: `LLM.tools?: ReadonlyArray<unknown>` é opaco — v0.3 vai precisar de generic

- **Task afetada:** T3.1 (llm.ts)
- **Risco aceito:** D8 declara `tools: ReadonlyArray<unknown>` deliberadamente opaco para v0.0 — locked em v0.3 quando agent-tools layer ship. Mas isso significa que o LLM DIP NÃO type-checks tool shape no v0.0 — adapters podem passar literalmente qualquer coisa. v0.3 vai precisar adicionar generic: `interface LLM<TToolShape = unknown> { generateResponse(..., tools?: ReadonlyArray<TToolShape>) }` que É breaking se adapters do v0.1 não usarem generic default.

Documentação: adicionar nota no ADR-0008 e em llm.ts:
```ts
/**
 * @see ADR-0008 + ADR-0004
 * `tools` is intentionally opaque (`unknown`) at v0.0.
 * v0.3 (agent-tools layer) locks a typed schema; expect generic
 * parameter `LLM<TToolSchema>` at that point. Implementations
 * targeting v0.0 ↔ v0.3 SHOULD type their own tool shape locally.
 */
```

---

### EC-11: Nome npm `@usetheo/memory` reservado mas não publicado — risco de squatting

- **Task afetada:** T0.1 (package.json)
- **Risco aceito:** `CLAUDE.md § Locked names` diz "Canonical install command: `npm install @usetheo/memory` (reserved; not yet published)". Mas "reserved" em npm scope (`@usetheo/*`) só vale se o scope foi registrado por @usetheo org. Verificar antes do v0.1 publish que (a) `@usetheo` scope está criado e owned pela conta correta, (b) ninguém squatou `@usetheo/memory` específico, (c) auth-token de publish está disponível. Pre-v0.1 (este plano), com `"private": true`, não há risco de publish acidental — só validação a fazer antes do próximo plano.

Documentação: adicionar nota ao Global DoD do plano:
> "Before v0.1 plan opens: verify `npm view @usetheo/memory` returns 404 (or owned by @usetheo org) and that npm auth token for publish exists. NOT a v0.0 task; flagged for v0.1 readiness check."

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 1 | 0 | 0 | 1 (EC-11) |
| T0.2 | 0 | 0 | 0 | 0 |
| T0.3 | 1 | 0 | 1 (EC-7) | 0 |
| T1.1 | 0 | 0 | 0 | 0 |
| T1.2 | 1 | 0 | 0 | 1 (EC-8) |
| T2.1 | 0 | 0 | 0 | 0 |
| T2.2 | 1 | 0 | 0 | 1 (EC-9) |
| T2.3 | 1 | 0 | 1 (EC-5) | 0 |
| T2.4 | 1 | 1 (EC-2) | 0 | 0 |
| T2.5 | 2 | 1 (EC-1) | 1 (EC-5 shared) | 0 |
| T3.1 | 1 | 0 | 0 | 1 (EC-10) |
| T3.2 | 0 | 0 | 0 | 0 |
| T3.3 | 1 | 0 | 1 (EC-6) | 0 |
| T3.4 | 0 | 0 | 0 | 0 |
| T4.1 | 1 | 1 (EC-3) | 0 | 0 |
| Phase 5 | 1 | 1 (EC-4) | 0 | 0 |

**Veredito:** PLANO PRECISA DE AJUSTE

**Bloqueadores duros (4 MUST FIX):**
- EC-1 falha Coverage Matrix 100% (hard cap `coverage_lt_100` no `/plan-confidence` — INVALID, score ≤ 49)
- EC-2 introduz bug runtime previsível em v0.1
- EC-3 pode quebrar Sub-goal 6 do plano (resolução de tipos via package path)
- EC-4 deixa Phase 5 gate falso-positivo / falso-negativo

**Recomendação:** absorver EC-1 a EC-4 em revisão v1.0 → v1.1 do plano antes de `/deps-audit`. EC-5 a EC-7 podem ir como TDD adicional em v1.1; EC-8 a EC-11 podem ficar como notas inline.

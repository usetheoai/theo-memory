# Edge Case Review — theo-memory-standalone-p0

**Data:** 2026-06-03
**Plano analisado:** `.claude/knowledge-base/plans/theo-memory-standalone-p0-plan.md` v1.0
**Tasks analisadas:** 18 (T0.1 + T1.1-T1.7 + T2.1-T2.5 + T3.1-T3.5 + Final Phase)
**Edge cases encontrados:** **49 total — MUST FIX: 12 | SHOULD TEST: 25 | DOCUMENT: 12**

**Veredicto: PLANO PRECISA DE AJUSTE** — EC-47 (distroless sem shell) é blocker de arquitetura que impede T3.4 conforme escrito. EC-1, EC-4, EC-9, EC-26, EC-32, EC-47, EC-52 mudam contrato público; precisam absorção pré-`/implement`.

## MUST FIX (12)

### EC-1: `THEMEMORY_API_KEY=""` ambíguo (fail-open vs fail-closed)
- **Task afetada:** T1.1
- **Família:** Permission
- **Cenário:** operador escreve `THEMEMORY_API_KEY=` no `.env` esperando "desabilitar auth"; alternativamente operador escreve `THEMEMORY_API_KEY="  "` por copy-paste com espaço. Atual plano só distingue `undefined` (auth disabled) vs valor (auth enabled).
- **Impacto:** comportamento de segurança não-determinístico — algumas instâncias rodam sem auth pensando que rodam com auth.
- **Fix sugerido:** ADR D3 amend: empty string OR whitespace-only string ⇒ **fail-closed (auth required mas nenhum token válido aceito)**. Documentar no JSDoc da `BearerAuthVerifier`. Add RED test: `THEMEMORY_API_KEY=""` → 401 em qualquer request.

### EC-4: `crypto.timingSafeEqual` joga `RangeError` em comprimentos diferentes
- **Task afetada:** T1.1
- **Família:** State / Crash
- **Cenário:** consumer envia `Authorization: Bearer x` quando token configurado é `Authorization: Bearer sk-very-long-token`. `timingSafeEqual(Buffer('x'), Buffer('sk-...'))` → throws RangeError → middleware 500 (NOT 401).
- **Impacto:** auth crash gera 500 em produção; token discovery via stack trace (se debug enabled); UX confusa.
- **Fix sugerido:** em `BearerAuthVerifier.verify()`: `if (token.length !== expectedToken.length) return false;` ANTES do `timingSafeEqual`. Add RED test.

### EC-9: Multi-scope-tier no body — qual ganha?
- **Task afetada:** T1.2
- **Família:** Input / Boundary
- **Cenário:** `POST /v1/remember { "userId": "alice", "sessionId": "s1", "text": "..." }` — três cenários: (a) somente userId, (b) somente sessionId, (c) ambos. Plan diz "at least one scope tier required" mas NÃO especifica como resolver caso (c). Memory SDK shape (`memory.user(id)` vs `memory.session(id)`) força escolha — não é aditivo.
- **Impacto:** silent semantic ambiguity. Consumer pode achar que memória vai em BOTH tiers; só vai em UM. Behavior depende da ordem do código.
- **Fix sugerido:** ADR D2 amend OR new D12: exatamente UMA scope tier por request; múltiplas → 422 `InvalidScope`. Add zod refine + RED test.

### EC-14: Pagination `limit` ilimitado é DOS vector
- **Task afetada:** T1.3
- **Família:** Input / Resource
- **Cenário:** `GET /v1/scopes/user/alice/memories?limit=999999` — sem cap servidor lê 999999 rows do pgvector → memória explode + latência.
- **Impacto:** DOS trivial.
- **Fix sugerido:** zod schema `limit: z.number().int().min(1).max(100).default(20)`. Add RED test.

### EC-17: `/v1/health/db` sem timeout — probe zombie
- **Task afetada:** T1.3
- **Família:** Timing / I/O
- **Cenário:** pgvector deadlocked OR network hangs; `pool.query('SELECT 1')` never resolves. Health probe trava indefinidamente; load balancer não consegue declarar instance unhealthy → tráfego continua roteado.
- **Impacto:** silent unhealthy state.
- **Fix sugerido:** `Promise.race([pool.query('SELECT 1'), setTimeout(2000).then(() => { throw new Error('db_probe_timeout') })])`. Add RED test.

### EC-19: Endpoint `/v1/openapi.json` deve ser auth-exempt
- **Task afetada:** T1.4
- **Família:** Permission / Integration
- **Cenário:** OpenAPI codegen tools (`openapi-generator`, Postman, Swagger UI) consomem o spec ANTES de obter credentials. Se spec é bearer-gated, tools quebram.
- **Impacto:** consumer DX fracassa silently — eles veem 401 em SDK codegen sem entender por quê.
- **Fix sugerido:** Hono middleware order — bearer middleware `app.use('/v1/*', bearerAuth(...))` mas explicit exclusion via `app.use('/v1/openapi.json', skipAuth)` OR `bearerAuth` checks request path. Mem0 ref P1 (test_server_auth.py:451) confirma OpenAPI sempre exempt. Add RED test.

### EC-26: Tree-shaking — default import NÃO pode puxar Hono
- **Task afetada:** T1.7
- **Família:** Boundary / Integration
- **Cenário:** consumer importa `import { createMemory } from '@usetheo/memory'` esperando bundle SDK-only. Se `src/index.ts` (default) acidentalmente importa de `src/server/`, Hono (+12KB) entra no bundle do consumer.
- **Impacto:** bundle bloat para 100% dos consumers SDK-only (a maioria).
- **Fix sugerido:** explicit assertion em test — `tests/integration/subpath-isolation.test.ts` (NEW) que checks `import '@usetheo/memory'` resolve graph não contém `hono`. Add RED test.

### EC-32: SIGTERM sem graceful drain — data loss
- **Task afetada:** T2.3 + T3.4
- **Família:** Timing / State
- **Cenário:** Docker para o container com SIGTERM (then SIGKILL 10s depois). Se `themory server` não tem signal handler, em-flight requests morrem mid-write — `Memory.remember()` PODE ter persistido a row mas response nunca volta ao client; OR pode ter NÃO persistido e o cliente acha que persistiu.
- **Impacto:** data loss visível pelo consumer (ACK sem persist OR persist sem ACK).
- **Fix sugerido:** T2.3 deve adicionar `process.on('SIGTERM', async () => { await server.close(); await pool.end(); process.exit(0); })`. Hono via `@hono/node-server` exposes `serve(...).close()`. Add RED test: kill -TERM em-flight → exit 0 + DB consistent.

### EC-37: `themory health` DI graph check vago
- **Task afetada:** T2.5
- **Família:** Boundary
- **Cenário:** plan diz "DI graph composable" mas não enumera checks concretos. Implementador pode interpretar como (a) pool.query OK, (b) Memory factory invocável, (c) embedder pingable, (d) llm pingable. Cada um tem latência + custo diferente.
- **Impacto:** spec vago → implementação inconsistente; CI false positives/negatives.
- **Fix sugerido:** plan amend T2.5: define checks explicitos — `pool.query('SELECT 1')` (mandatory) + `Memory factory composes without throw` (mandatory) + embedder/llm pings (OPTIONAL behind `--deep` flag). Update RED test.

### EC-43: Trivy severity gate precisa allowlist mechanism
- **Task afetada:** T3.3
- **Família:** Permission / Resource
- **Cenário:** Trivy scan encontra HIGH CVE em distroless base image (recorrente — base images têm CVEs transitórias). Plan diz "exit 1 on hit" SEM allowlist. Resultado: 1 CVE transitivo bloqueia release.
- **Impacto:** release pipeline congelado por externalities.
- **Fix sugerido:** workflow usa `trivy --severity CRITICAL,HIGH --ignorefile .trivyignore --exit-code 1` + `.trivyignore` file (NEW) com mesmo formato de sunset que `deps-audit-allowlist.txt`. Align com `deps-audit-golden-rule.md § Severity rubric`.

### EC-47: Distroless `nonroot` NÃO tem shell — `docker-entrypoint.sh` é IMPOSSÍVEL
- **Task afetada:** T3.4 (+ ADR D6 + ADR D8)
- **Família:** Boundary / **BLOCKER ARQUITETURAL**
- **Cenário:** ADR D6 escolhe `gcr.io/distroless/nodejs22-debian12:nonroot` runtime. Distroless **não inclui `/bin/sh`, `bash`, ou qualquer shell**. T3.4 plan: `docker-entrypoint.sh` com `#!/bin/sh ... themory migrate; exec themory server`. Esta script NÃO PODE rodar — entrypoint shell missing → container exits imediatamente com `exec format error`.
- **Impacto:** **T3.4 + T3.5 não podem completar**. Plan halt at /implement.
- **Fix sugerido:** 3 opções, escolher 1 via AskUserQuestion absorção:
  - **Opção A** (recommended): mover migrate-then-server logic para dentro do binário `themory server` (subcomando faz `runMigrations()` antes de bind port). Remove `docker-entrypoint.sh`. ENTRYPOINT vira `["node", "/app/dist/agent-tools/cli.js", "server"]`. Honors D8 (migrations on startup) sem precisar de shell.
  - **Opção B**: trocar runtime de `nonroot` para `gcr.io/distroless/nodejs22-debian12:debug` que tem busybox shell. Sacrifica security minimalism por conveniência. NOT recommended.
  - **Opção C**: trocar runtime para `node:22-bullseye-slim` (~140MB com shell). Sacrifica distroless benefit completamente. NOT recommended.

### EC-52: `package.json#files` precisa incluir `src/server/**` E `src/agent-tools/cli.ts`
- **Task afetada:** T1.7 (+ T2.1)
- **Família:** Boundary / Integration
- **Cenário:** `package.json#files` atualmente whitelist `src/**/*.ts` (incl. server) mas plan T1.7 não verifica explicit. Se T2.1 mover entry point OR T1.7 adicionar novo arquivo fora de glob, `npm publish` ship sem o file → install pulls broken package.
- **Impacto:** consumer `npm install @usetheo/memory@0.1.0-alpha` → import `@usetheo/memory/server` ENOENT.
- **Fix sugerido:** T1.7 acceptance criterion adicional: `npm pack --dry-run` listing contains `src/server/index.ts` AND `src/server/handlers/*.ts`. Same for T2.1 com `src/agent-tools/cli.ts`.

---

## SHOULD TEST (25)

### EC-2: Header case insensitive parsing
- **Task:** T1.1
- **Teste sugerido:** `test_bearer_lowercase_prefix_accepted` — `Authorization: bearer xyz` (lowercase) ainda é aceito. Hono normaliza headers para lowercase mas o "Bearer" prefix vem do body do header value.

### EC-3: Token leading/trailing whitespace
- **Task:** T1.1
- **Teste sugerido:** `test_bearer_token_whitespace_rejected` — `Authorization: Bearer   xyz   ` → 401 OR aceito com trim (decidir). Mem0 ref pattern P1 lines 194-206 testa isso explicitamente.

### EC-5: Env var isolation entre testes
- **Task:** T1.1
- **Teste sugerido:** `beforeEach` saves `process.env['THEMEMORY_API_KEY']`; `afterEach` restores. Otherwise test order flakiness.

### EC-6: Malformed JSON body → 400
- **Task:** T1.2
- **Teste sugerido:** `test_remember_malformed_json_returns_400` — POST com body `{not valid` + Content-Type: application/json → 400 (Hono default).

### EC-7: Empty body (`Content-Length: 0`) → 422
- **Task:** T1.2
- **Teste sugerido:** `test_remember_empty_body_returns_422` — empty body deve ser validation error (zod), não JSON parse error.

### EC-10: Memory.remember throws unmapped error → 500 envelope
- **Task:** T1.6
- **Teste sugerido:** `test_unknown_error_returns_500_with_envelope` — mock Memory.remember to throw `new Error('whatever')`; response shape `{ code: "INTERNAL_ERROR", message: "Internal server error" }` (NOT raw stack).

### EC-11: Recall com zero resultados → 200 com `{ results: [] }`
- **Task:** T1.2
- **Teste sugerido:** `test_recall_empty_returns_200_not_404` — empty array é success, not error.

### EC-13: Scope `:type` case-sensitive
- **Task:** T1.3
- **Teste sugerido:** `test_scopes_type_user_capital_returns_404` — `GET /v1/scopes/User/alice/memories` → 404.

### EC-15: Pagination cursor inválido → 400
- **Task:** T1.3
- **Teste sugerido:** `test_scopes_invalid_cursor_returns_400` — `?cursor=garbage` (não base64 válido) → 400 antes de query DB.

### EC-18: `hono` + `@hono/zod-openapi` version alignment
- **Task:** T0.1
- **Teste sugerido:** `test_dep_versions_aligned` — package.json hono ^4.x AND @hono/zod-openapi ^0.18 sao mutuamente compatíveis per docs.

### EC-22: OTel exporter failure não crash handler
- **Task:** T1.5
- **Teste sugerido:** `test_otel_export_failure_swallowed` — mock exporter throws sync; handler ainda retorna 201 (span dropped silently).

### EC-23: pg lib error não-domain → 500 sanitized
- **Task:** T1.6
- **Teste sugerido:** `test_pg_error_returns_500_without_sql_leak` — mock pool throws `error: relation "memories" does not exist`; response body NÃO contém substring "memories" OR connection string.

### EC-24: Error message sanitization (PII/secrets)
- **Task:** T1.6
- **Teste sugerido:** `test_error_envelope_no_secret_leak` — error com `.message` contendo string que parece secret (e.g., `Bearer sk-...`) é redacted.

### EC-25: ESM vs CJS interop para `@usetheo/memory/server`
- **Task:** T1.7
- **Teste sugerido:** `test_subpath_resolves_via_esm` — `import { createServer } from '@usetheo/memory/server'` em ESM test file. CJS interop documented como NOT supported (package.json `"type": "module"`).

### EC-27: `process.argv[1]` basename detection multi-pattern
- **Task:** T2.1
- **Teste sugerido:** `test_alias_detection_via_basename` — simulate `process.argv[1]` valores: `/path/to/themory-mcp`, `/path/to/themory`, `npm-symlinked-themory-mcp`. Alias detection robusto.

### EC-28: npm install cria ambos os bins
- **Task:** T2.1
- **Teste sugerido:** `test_npm_pack_includes_both_bins` — `npm pack --dry-run` output lista bin paths para `themory` AND `themory-mcp`.

### EC-31: `EADDRINUSE` na T2.3 com stderr claro
- **Task:** T2.3
- **Teste sugerido:** `test_server_eaddrinuse_exits_with_stderr` — start server on port held by another process → exit 1 + stderr `port 9999 already in use`.

### EC-33: Server readiness gate (Memory factory wait)
- **Task:** T2.3
- **Teste sugerido:** `test_health_returns_503_until_memory_factory_ready` — invoke `themory server`; `GET /v1/health` durante factory-warmup window → 503; após warmup → 200.

### EC-36: `themory migrate` concorrente
- **Task:** T2.4
- **Teste sugerido:** `test_concurrent_migrate_safe` — spawn dois `themory migrate` paralelos; um aplica, outro no-op; drizzle journal não corrompe.

### EC-38: Distroless + native deps (glibc)
- **Task:** T3.1
- **Teste sugerido:** `test_distroless_loads_optional_deps` — docker run sobre image; require `@xenova/transformers` succeeds (distroless é glibc, deve funcionar). Smoke-check.

### EC-40: Docker build com tsc strict-mode
- **Task:** T3.1
- **Teste sugerido:** `test_docker_build_completes` — CI workflow inclui `docker build` step que falha se tsc encontra erros.

### EC-42: Compose `${VERSION:-latest}` fallback safe
- **Task:** T3.2
- **Teste sugerido:** `test_compose_config_validates_without_env` — `docker compose config` (sem `VERSION` env) → succeeds + image resolve to `:latest`.

### EC-44: Workflow `permissions: packages: write`
- **Task:** T3.3
- **Teste sugerido:** static YAML check — workflow file declares `permissions: { contents: read, packages: write }` per GHCR push requirement.

### EC-48: Docker test cleanup via unique project name
- **Task:** T3.5
- **Teste sugerido:** `test_compose_uses_unique_project_name` — `docker compose -p themory-test-${rand}-up`; afterAll usa same project name; sem leak entre runs.

### EC-51: Docker test 60s timeout configurável
- **Task:** T3.5
- **Teste sugerido:** test honors `DOCKER_HEALTH_TIMEOUT_MS` env var; default 60s. CI matrix pode aumentar para 120s em runner lento.

---

## DOCUMENT (12)

### EC-8: Body size limit
- **Risco aceito:** Hono default body size limit (~5MB) é suficiente para v0.1; configurabilidade fica para P1.

### EC-12: `infer: false` propagation
- **Risco aceito:** handler simplesmente repassa option ao Memory; v0.0 contract já valida.

### EC-16: `/v1/health/db` no caching
- **Risco aceito:** probe é low-frequency; query-each-time aceitável para alpha.

### EC-20: Circular zod schema
- **Risco aceito:** v0.0 contract não usa schemas circulares; @hono/zod-openapi tem error message claro se acontecer.

### EC-21: Production OTel TracerProvider wiring
- **Risco aceito:** consumer wires próprio TracerProvider; default no-op é correto (fail-quiet).

### EC-29: Argv mutation sequence
- **Risco aceito:** `process.argv.splice(2, 0, 'mcp')` documented na alias detection; subsequent code lê argv mutated.

### EC-30: Windows stdio support
- **Risco aceito:** Windows não é P0 target; Linux/macOS testados.

### EC-35: Drizzle tx per migration
- **Risco aceito:** drizzle-orm wraps migrations em tx por default; partial failure é unlikely.

### EC-39: Production image includes optional deps
- **Risco aceito:** ~30MB bloat por @xenova/transformers aceitável para alpha; consumer pode set `OPTIONAL=false` em P1.

### EC-41: Docker compose `--wait-timeout`
- **Risco aceito:** consumer usa flag se quiser timeout custom; documentar no compose comment.

### EC-45/46: `exec` signal forwarding + `set -euo`
- **Risco aceito:** após resolver EC-47, signal forwarding via Node binary é nativo.

### EC-49: localhost:8080 dev conflicts
- **Risco aceito:** developer responsibility usar `--port 0` para ephemeral.

---

## Resumo por task

| Task | Edges totais | MUST FIX | SHOULD TEST | DOCUMENT |
|---|---|---|---|---|
| T0.1 | 1 | 0 | 1 | 0 |
| T1.1 | 5 | 2 | 3 | 0 |
| T1.2 | 7 | 1 | 3 | 1 |
| T1.3 | 5 | 2 | 2 | 1 |
| T1.4 | 3 | 1 | 1 | 1 |
| T1.5 | 2 | 0 | 1 | 1 |
| T1.6 | 4 | 0 | 3 | 0 |
| T1.7 | 3 | 2 | 1 | 0 |
| T2.1 | 3 | 0 | 2 | 1 |
| T2.2 | 1 | 0 | 0 | 1 |
| T2.3 | 3 | 1 | 2 | 0 |
| T2.4 | 3 | 0 | 1 | 1 |
| T2.5 | 1 | 1 | 0 | 0 |
| T3.1 | 3 | 0 | 2 | 1 |
| T3.2 | 2 | 0 | 1 | 1 |
| T3.3 | 2 | 1 | 1 | 0 |
| T3.4 | 3 | 1 | 0 | 2 |
| T3.5 | 4 | 0 | 3 | 1 |
| **Total** | **49** | **12** | **25** | **12** |

## Veredicto

**PLANO PRECISA DE AJUSTE**

Razões:

1. **EC-47 é BLOCKER arquitetural** (distroless sem shell incompatível com `docker-entrypoint.sh`). T3.4 conforme escrita não pode rodar.
2. **EC-1, EC-4, EC-9, EC-26, EC-32** introduzem ambiguidades de contrato público (auth fail-mode, crash em auth, scope semantics, bundle isolation, data-loss em shutdown) que precisam ser locked em ADRs ANTES de /implement.
3. **EC-14, EC-17, EC-19, EC-37, EC-43, EC-52** são fixes mecânicos pequenos mas importantes para alpha-quality (DOS prevention, probe timeout, OpenAPI consumability, health check spec, CVE allowlist, npm pack integrity).

### Próxima ação recomendada

Antes de `/deps-audit` + `/plan-confidence`:

1. **Resolver EC-47 via AskUserQuestion** — escolher Opção A/B/C (Opção A recommended: migrate-on-startup dentro do binário `themory server`, ENTRYPOINT direto sem shell).
2. **Bump plano v1.0 → v1.1** absorvendo as 12 MUST FIX como sub-tasks ou ADR amendments:
   - ADR D3 amend: EC-1 fail-closed semantic + EC-2/EC-3 header normalization
   - ADR D6 + D8 amend: EC-47 entrypoint redesign + ADR D13 NEW para entrypoint shape
   - ADR D2 amend OR new D12: EC-9 single-scope-tier enforcement
   - T1.1 task: EC-4 length-check before timingSafeEqual
   - T1.3 task: EC-14 pagination cap + EC-17 probe timeout
   - T1.4 task: EC-19 OpenAPI auth-exempt
   - T1.7 task: EC-26 subpath isolation test + EC-52 npm pack assertion
   - T2.3 task: EC-32 SIGTERM graceful drain
   - T2.5 task: EC-37 DI graph concrete checks
   - T3.3 task: EC-43 Trivy allowlist mechanism + `.trivyignore` file
3. **SHOULD TEST 25** absorvidas inline nos TDD blocks das tasks correspondentes.
4. **DOCUMENT 12** absorvidas como ADR Consequences ou Acceptance Criteria notes.
5. Re-rodar `/edge-case-plan` opcional após v1.1 para validar absorção (não obrigatório se diff é pequeno).
6. Seguir para `/deps-audit theo-memory-standalone-p0` + `/plan-confidence`.

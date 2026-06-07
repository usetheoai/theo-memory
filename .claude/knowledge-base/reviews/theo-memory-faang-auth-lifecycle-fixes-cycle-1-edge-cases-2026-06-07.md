# Edge Case Review — theo-memory-faang-auth-lifecycle-fixes-cycle-1

Data: 2026-06-07
Tasks analisadas: 7 (T1.1, T1.2, T2.1, T2.2, T3.1, T3.2, T4.1)
Edge cases encontrados: 12 (MUST FIX: 6, SHOULD TEST: 4, DOCUMENT: 2)

## MUST FIX

### EC-1: `adminApi.pool` pode chegar undefined em runtime via consumer mal-tipado

- **Task afetada:** T1.2
- **Família:** Input / Boundary
- **Cenário:** TS aceita `adminApi: { pool: undefined as any, bootstrapToken: 'x' }` (cast escape) ou consumer JS sem tipos passa `{ adminApi: {} }`. Plano declara `adminApi: { pool, bootstrapToken? }` sem guarda runtime. Primeira chamada a `pool.query(...)` crasha o processo com `Cannot read properties of undefined (reading 'query')`.
- **Impacto:** Crash em runtime sem mensagem útil; pior, pode acontecer só no primeiro POST `/v1/admin/keys` em produção (depois de o server estar UP horas).
- **Fix sugerido:** No início de `createApp` quando `adminApi` é fornecido, validar `if (!adminApi.pool || typeof adminApi.pool.query !== 'function') throw new Error('createServer: adminApi.pool is required when adminApi is supplied')`. Falha-loud no boot.

### EC-2: `THEMORY_ADMIN_BOOTSTRAP_TOKEN` empty-string deve ser tratado como "no bootstrap"

- **Task afetada:** T3.2 (e cross-cut com T1.2 que recebe via `adminApi.bootstrapToken`)
- **Família:** Input / Boundary
- **Cenário:** Operador faz `export THEMORY_ADMIN_BOOTSTRAP_TOKEN=""` (typo ou intencional pra "desabilitar"). `process.env['THEMORY_ADMIN_BOOTSTRAP_TOKEN']` retorna `""` (não `undefined`). Se CLI passa string vazia adiante, `requireScope` middleware vai aceitar requests com Bearer string vazia como bootstrap (via `constantTimeEqual('', '')` retorna true).
- **Impacto:** Bypass total da auth admin sem credencial. Security hole crítica.
- **Fix sugerido:** No `runServer.ts` (e `runMcpServer.ts`), normalizar: `const bootstrapToken = process.env['THEMORY_ADMIN_BOOTSTRAP_TOKEN']; if (!bootstrapToken || bootstrapToken.trim().length === 0) bootstrapToken = undefined;`. Sentinela em `scope-verifier.ts` também (defense in depth): `if (opts.bootstrapToken && opts.bootstrapToken.length > 0)` já existe mas pode aceitar `'   '` whitespace — endurecer pra `.trim().length > 0`.

### EC-3: `introspection_endpoint` ausente da OIDC discovery doc

- **Task afetada:** T2.2
- **Família:** Input / Boundary
- **Cenário:** Nem todos os IdPs anunciam `introspection_endpoint` no `/.well-known/openid-configuration` (Auth0 free tier não anuncia; alguns Keycloak realms desabilitam). Adapter chama `discoveryRequest` na construção, parseia, mas só descobre que `as.introspection_endpoint === undefined` quando a primeira `introspectionRequest()` falha.
- **Impacto:** CLI inicia OK, primeiro request OIDC crasha com erro críptico do oauth4webapi (`Required parameter "introspection_endpoint" is missing`). Operator não sabe por quê.
- **Fix sugerido:** Após `processDiscoveryResponse` no adapter, checar `if (!as.introspection_endpoint) throw new Error('OIDC issuer ' + issuer + ' does not advertise introspection_endpoint in discovery doc; this IdP does not support RFC 7662 introspection — use a JWKS-based verifier instead (deferred follow-up)')`. Falha-loud no construtor.

### EC-4: `--client-secret` flag visível em `ps` — espelhar ADR D4 (env-only)

- **Task afetada:** T3.2
- **Família:** Permission / Format
- **Cenário:** Plano sugere flag `--client-secret` no T3.2. `themory server --issuer X --client-id Y --client-secret SUPER_SECRET` deixa o secret visível em `ps aux | grep themory` e em shell history. Mesma classe de risco que o bootstrap token (ADR D4 documenta env-only).
- **Impacto:** Secret leak via `ps`/history; viola o precedente Cal.com/PostHog já citado em ADR D4.
- **Fix sugerido:** Remover `--client-secret` flag. Sourcing env-only via `THEMORY_OIDC_CLIENT_SECRET`. Espelhar exatamente o tratamento do bootstrap token (ADR D4 estendida). Documentar em help do `--issuer`.

### EC-5: `--issuer` URL malformada crasha com TypeError sem mensagem útil

- **Task afetada:** T3.2
- **Família:** Input / Format
- **Cenário:** Operator digita `themory server --issuer not-a-url` ou `--issuer http://` (incompleto). `new URL('not-a-url')` lança `TypeError: Invalid URL`. CLI propaga o stack trace cru pra stderr; operator não associa ao flag dele.
- **Impacto:** UX ruim; operator perde tempo debugando. Não é security mas viola Inquebrável Rule 3 (mensagens claras).
- **Fix sugerido:** Validar no parser do commander: `.option('--issuer <url>', 'OIDC issuer URL', (v) => { try { new URL(v); return v; } catch { throw new InvalidArgumentError('--issuer must be a valid URL (e.g., https://auth.example.com)'); } })`.

### EC-6: `--client-id` sem `THEMORY_OIDC_CLIENT_SECRET` (após EC-4 absorbida)

- **Task afetada:** T3.2
- **Família:** Input / State
- **Cenário:** Operator passa `--client-id Y` mas esquece de exportar `THEMORY_OIDC_CLIENT_SECRET`. Adapter recebe `{ clientId: 'Y', clientSecret: undefined }` e oauth4webapi usa `ClientAuth.none` (anônimo), que falha no IdP com 401 silently (Hydra retorna `invalid_client`).
- **Impacto:** Erro confuso; OIDC nunca funciona mas operator vê 401 vindo do IdP em vez do próprio CLI.
- **Fix sugerido:** No `runServer.ts` após resolver issuer/clientId/clientSecret do CLI+env, validar cross-field: `if (clientId !== undefined && !clientSecret) throw new Error('--client-id requires THEMORY_OIDC_CLIENT_SECRET env var to be set (per ADR D4 env-only secret sourcing)')`. Falha-loud no boot.

## SHOULD TEST

### EC-7: Ordem de montagem das rotas — admin DEVE hit requireScope ANTES do generic `/v1/*` bearerAuth

- **Task afetada:** T1.2
- **Teste sugerido:** `test_admin_route_uses_requireScope_not_bearerAuth_when_both_middlewares_active` — boot com adminApi + authVerifier (env BearerAuthVerifier); POST `/v1/admin/keys` com `theo_live_*` admin key deve retornar 200 (requireScope path), NÃO 401 (generic bearerAuth com THEMEMORY_API_KEY mismatch). Asserta sequência de middleware-fire via spy.

### EC-8: AbortSignal não propagado pelo `oauth4webapi.introspectionRequest`

- **Task afetada:** T2.1
- **Teste sugerido:** `test_introspect_aborts_when_signal_fires_mid_request` — adapter constrói IntrospectFn → invoca com AbortController → controller.abort() após 1ms → assert promise rejeita com AbortError em ≤ 10ms (não espera timeout do EC-4 5000ms). Cobre o caso onde oauth4webapi ignora signal silently.

### EC-9: `resource` URL derivada quando `--host=0.0.0.0`

- **Task afetada:** T3.2 (derivação de `oidcDiscovery.resource`)
- **Teste sugerido:** `test_oidc_discovery_resource_uses_canonical_host_when_bind_is_0_0_0_0` — boot `runServer({ host: '0.0.0.0', port: 8080, issuer: 'X' })` → assert `oidcDiscovery.resource === 'http://0.0.0.0:8080'` é REJEITADO ou substituído por hostname canonical (e.g., default `'http://localhost:8080'` + warning). `0.0.0.0` não é resource URL válida pra RFC 8707/9728.

### EC-10: Port cleanup entre cenários integration test (6 listeners em sequência)

- **Task afetada:** T4.1
- **Teste sugerido:** `afterEach` global no `fixes-cycle-1-e2e.test.ts` que faz `await Promise.all([handle.close(), stubIssuer.close()])` defensivo + assert sem leaks via `process._getActiveHandles().length` antes/depois (Node API; pode ser flaky — usar como sanity check, não hard assert). Evita `EADDRINUSE` se um cenário crashar.

## DOCUMENT

### EC-11: Discovery fail-loud no boot → CLI crash + K8s restart loop

- **Risco aceito:** Se issuer está temporariamente unreachable durante boot do `themory server`, o CLI crasha com erro de discovery. K8s/Docker reinicia → eventualmente issuer volta → server fica UP. Esse é o comportamento desejado (fail-fast vs hot-reload). Documentar em ADR D3 § Consequences expandida + nota no README admin-keys quickstart.

### EC-12: Bootstrap token com caracteres especiais (operator-controlled)

- **Risco aceito:** `THEMORY_ADMIN_BOOTSTRAP_TOKEN` é env-controlado pelo operator. Se ele põe `"a;b'c"` (caracteres SQL/shell), o `constantTimeEqual` ainda funciona (compara byte a byte). SQL injection impossível porque o token nunca toca SQL (só comparação em memória). Documentar em ADR D4 § Consequences que o token é tratado como bytes opacos; recomenda-se ≥32 chars [A-Za-z0-9_-] gerados via `openssl rand -base64 32`.

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 |
| T1.2 | 2 | 1 (EC-1) | 1 (EC-7) | 0 |
| T2.1 | 1 | 0 | 1 (EC-8) | 0 |
| T2.2 | 2 | 1 (EC-3) | 0 | 1 (EC-11) |
| T3.1 | 0 | 0 | 0 | 0 |
| T3.2 | 5 | 3 (EC-2, EC-4, EC-5, EC-6) | 1 (EC-9) | 1 (EC-12) |
| T4.1 | 1 | 0 | 1 (EC-10) | 0 |

**Veredicto:** PLANO PRECISA DE AJUSTE

**Razão:** 6 MUST FIX (1 security-crítico EC-2 + 1 security-importante EC-4 + 4 fail-loud-honesty), recomenda-se absorver TODOS antes de `/plan-confidence`. EC-2 e EC-4 são as mais importantes (security holes); EC-3, EC-5, EC-6 são fail-fast hygiene; EC-1 é defesa em profundidade. SHOULD TEST e DOCUMENT podem ser absorvidos inline nas tasks existentes sem ajuste estrutural do plano.

**Sugestão de absorção (próxima iter):**
- Plan v1.1: estender ADR D4 cobrindo client-secret (EC-4); adicionar sub-task T1.2.1 (EC-1 pool guard); adicionar T3.2.1 (EC-2 env normalize + EC-5 URL validate + EC-6 cross-field validate); adicionar EC-3 ao Deep Dives do T2.2.
- SHOULD TEST inline nos tasks existentes (sem nova sub-task).
- DOCUMENT como notas explícitas nos ADRs D3 e D4.

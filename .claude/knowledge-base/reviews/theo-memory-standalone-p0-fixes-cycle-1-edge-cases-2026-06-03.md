# Edge Case Review — theo-memory-standalone-p0-fixes-cycle-1

Data: 2026-06-03
Tasks analisadas: 6 (T1.1, T1.2, T2.1, T2.2, T2.3, T3.1)
Edge cases encontrados: **9** (MUST FIX: **2**, SHOULD TEST: **5**, DOCUMENT: **2**)

## MUST FIX

### EC-1: T2.1 — Sub-goal 4 vs ADR D3 contradition on 413 response envelope shape

- **Task afetada:** T2.1
- **Família:** Boundary / Contract
- **Cenário:** Plan Sub-goal 4 states "`ContentTooLargeError` mapper wired so the 413 envelope fires for oversized POST bodies"; ADR D3 Rationale states "the middleware responds 413 directly (no `ContentTooLargeError` is thrown — `hono/body-limit` writes the response itself)". These contradict on whether the 413 response carries the structured `{code, message}` envelope shape (existing T1.6 contract) or a plain hono default 413.
- **Impacto:** Without clarification, the implementer might ship the plain hono 413 (no `{code, message}` body) — breaking the consumer contract that EVERY 4xx/5xx response from `/v1/*` carries `{code: string, message: string, field?: string}` per T1.6. Consumers relying on the envelope shape get an unparseable 413 → they treat it as `INTERNAL_ERROR` → their retry logic fires against a DOS guard → amplification.
- **Verified library shape:** `hono/body-limit`'s `BodyLimitOptions` type accepts `onError?: (c: Context) => Response | Promise<Response>` (confirmed at `node_modules/hono/dist/types/middleware/body-limit/index.d.ts`). The `onError` callback returns a Response directly — it does NOT throw to `app.onError`, so the `ContentTooLargeError` → `mapDomainErrorToResponse` 413 envelope path doesn't fire by default. To honor Sub-goal 4, `onError` must explicitly construct the envelope.
- **Fix sugerido (1 paragraph plan edit):** Update T2.1 ADR D3 to: "`onError: (c) => { const { status, body } = mapDomainErrorToResponse(new ContentTooLargeError(1_000_000, -1)); return c.json(body, status as ContentfulStatusCode); }`. The `-1` actualSize sentinel signals the actual size is unknown at limit-hit (hono doesn't surface it). `mapDomainErrorToResponse` returns the structured `{code: 'CONTENT_TOO_LARGE', message: 'Payload exceeds maximum allowed size.', status: 413}` envelope, preserving the T1.6 consumer contract." Add a corresponding test asserting the 413 body parses as JSON with `code: 'CONTENT_TOO_LARGE'`.

### EC-2: T1.1 — Plan ground truth missing `scopeOrValidationError` body-error code disambiguation post-T1.2 refactor

- **Task afetada:** T1.1 (interacts with T1.2 refactor order)
- **Família:** Format / Boundary
- **Cenário:** After T1.1 drops `skillRepoId` from `ScopeFields`, a request `POST /v1/remember` with body `{"userId":"alice","skillRepoId":"r","text":"x"}` triggers zod `.strict()` schema rejection on the unknown `skillRepoId` key (code `unrecognized_keys`) — NOT the `superRefine` 0-tier-scope error. The existing `scopeOrValidationError` helper at `remember.ts:47-50` only branches on `i.message.startsWith('INVALID_SCOPE')`. Unknown-key issues fall through to the generic VALIDATION_ERROR branch (likely returning a 422 with a non-INVALID_SCOPE code).
- **Impacto:** The T1.1 RED test "POST /v1/remember with skillRepoId returns 422 INVALID_SCOPE" (plan T1.1 TDD line 1) will FAIL because the actual response code will be the generic VALIDATION_ERROR, not INVALID_SCOPE. The plan's expected test assertion is wrong vs the production path. Implementer hits Stop Condition #4 (plan defect).
- **Fix sugerido (1 paragraph plan edit):** Update T1.1 TDD RED test 1 to: "`test('POST /v1/remember with skillRepoId in body returns 422 (zod strict unknown-key rejection)')` — assert `res.status === 422` AND the body contains either `code: 'VALIDATION_ERROR'` OR `field: 'skillRepoId'` (whichever the existing `scopeOrValidationError` surfaces). Document that the `skillRepoId` key is rejected at the zod-strict layer, NOT the superRefine layer." Alternatively, extend `scopeOrValidationError` in T1.2 to surface `INVALID_SCOPE` for unknown-key issues whose key is in a known set of removed tier names — but that's scope creep; the simpler fix is updating the test assertion to match the actual code path.

## SHOULD TEST

### EC-3: T1.2 — Test file imports from `'./remember.js'` directly

- **Task afetada:** T1.2
- **Teste sugerido:** Before applying T1.2, run `grep -rn "from.*'\\./remember\\.js'" src/server/__tests__ tests/` and `grep -rn "from.*'\\./_body-parsing\\.js'" src/server/__tests__ tests/`. If any test file imports `safeJson`/`scopeOrValidationError`/`EMPTY_BODY`/`MALFORMED_BODY` directly (not via `rememberHandler`), update the import paths in the SAME commit as T1.2 to avoid a 2-commit split where the test suite is red mid-refactor. Add an explicit DoD checkbox in T1.2: "All sibling-handler + test-file imports of `safeJson`/`scopeOrValidationError`/`EMPTY_BODY`/`MALFORMED_BODY` updated to `./_body-parsing.js`".

### EC-4: T1.1 — `pathParamsToScoped` switch case `'skill'` cleanup after handler short-circuit

- **Task afetada:** T1.1
- **Teste sugerido:** `test('scopesHandler short-circuits skill before pathParamsToScoped')` — assert that the 501 response is returned BEFORE any call to `memory.skills(repoId)`. Use `vi.spyOn(memory, 'skills').mockImplementation(() => { throw new Error('should not be called'); })` and confirm the test passes (the 501 branch returns first; `memory.skills` is never called). Prevents dead code from lingering in the switch + prevents a subtle bug where someone later adds skill-handling code to `pathParamsToScoped` thinking it's reachable.

### EC-5: T1.1 — OpenAPI spec re-validation after `skillRepoId` removal

- **Task afetada:** T1.1
- **Teste sugerido:** `test('OpenAPI spec no longer documents skillRepoId on remember/recall/reflect/forget request bodies')` — fetch `GET /v1/openapi.json`, walk the `paths['/v1/remember'].post.requestBody.content['application/json'].schema.properties`, assert `skillRepoId` is not a key. Repeat for recall/reflect/forget. Existing `openapi.test.ts` test #1 (`SwaggerParser.validate`) doesn't check this property — it only validates well-formedness, not field membership.

### EC-6: T2.2 — Warning emitted in `run-server.test.ts` test mocks pollutes test output

- **Task afetada:** T2.2
- **Teste sugerido:** Mock `process.stderr.write` in the existing 8 `run-server.test.ts` tests via `vi.spyOn(process.stderr, 'write').mockImplementation(() => true)` in `beforeEach`, so the new warning doesn't appear in CI log noise. The dedicated RED test for "writes stub-embedder warning to stderr" un-mocks via `spy.mockRestore()` scoped to that test, OR uses the spy's `.mock.calls` to assert without needing to un-mock. Keeps the test suite output clean.

### EC-7: T2.1 — Middleware order regression test

- **Task afetada:** T2.1
- **Teste sugerido:** `test('bodyLimit fires BEFORE bearer when both apply')` — when `THEMEMORY_API_KEY` is set AND the body is 2MB, send the request with NO Authorization header. Assert response status is 413 (body-limit), NOT 401 (bearer). This pins the load-bearing middleware order from ADR D3 (`OTel → bodyLimit → bearer`) and prevents a future refactor from silently flipping the order (which would leak the auth status before the DOS guard fires).

## DOCUMENT

### EC-8: T2.2 — Warning conditional must become true when real-provider wiring lands (future cycle)

- **Risco aceito:** Plan T2.2 explicitly notes the warning is unconditional at P0 because there's no `--embedder openai|local` flag yet. Risk: a future cycle adds env-based provider override (e.g., `THEMORY_EMBEDDER=openai`) and the developer forgets to gate the warning. Surface: operators wired OpenAI continue seeing "Stub embedder active" warning forever. Cosmetic but undermines the warning's signal value. Mitigation: add a `// FOLLOW-UP: gate this warning when src/agent-tools/run-server.ts gains real-provider config` comment near the warning emit site in T2.2 commit. NOT a P0 blocker.

### EC-9: T2.1 — gzip-compressed bodies bypass the size limit

- **Risco aceito:** `hono/body-limit` measures the raw body bytes BEFORE decompression. A consumer sending `Content-Encoding: gzip` with a compressed payload < 1MB that decompresses to > 1MB bypasses the DOS guard. Hono itself does not auto-decompress request bodies (consumers must opt in), so the attack surface today is narrow. At P0 alpha this is acceptable; production deployments behind a reverse proxy (nginx, Caddy) typically enforce body limits at the proxy layer before reaching the app. Add a one-line note to the README under "REST API server § Body limits" acknowledging the gap + recommending reverse-proxy enforcement for production.

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T1.1 | 3 | 1 (EC-2) | 2 (EC-4, EC-5) | 0 |
| T1.2 | 1 | 0 | 1 (EC-3) | 0 |
| T2.1 | 3 | 1 (EC-1) | 1 (EC-7) | 1 (EC-9) |
| T2.2 | 2 | 0 | 1 (EC-6) | 1 (EC-8) |
| T2.3 | 0 | 0 | 0 | 0 |
| T3.1 | 0 | 0 | 0 | 0 |

**Veredicto: PLANO PRECISA DE AJUSTE**

**Rationale:** 2 MUST FIX edges — both are real plan defects that will cause `/implement` to halt at Stop Condition #4 (plan defect) if absorbed as-is.

1. **EC-1** is the more strategic of the two: ADR D3 and Sub-goal 4 contradict on the 413 envelope shape. Without clarification, the implementer ships the plain hono 413, breaking the T1.6 consumer envelope contract. Fix: ADR D3 amendment specifying `onError: (c) => { const { status, body } = mapDomainErrorToResponse(new ContentTooLargeError(1_000_000, -1)); return c.json(body, status as ContentfulStatusCode); }`.

2. **EC-2** is tactical: the T1.1 RED test 1 asserts `code: 'INVALID_SCOPE'` but the actual zod `.strict()` path returns a different code (unknown-key). Fix: amend the test assertion to match the production code path OR extend `scopeOrValidationError` (more surface change — not recommended at P0).

**Recommended workflow:** patch plan v1.0 → v1.1 absorbing EC-1 + EC-2 inline in ADR D3 and T1.1 TDD section, then proceed to `/deps-audit` → `/plan-confidence`. The 5 SHOULD TEST + 2 DOCUMENT can land inline in the implementing task commits (no plan version bump needed).

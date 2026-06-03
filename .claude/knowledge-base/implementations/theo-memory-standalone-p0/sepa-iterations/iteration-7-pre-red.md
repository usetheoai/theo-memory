# SEPA — Iteration 7 / Task T1.6 / Phase Pre-RED

## Plan recap
- T1.6 ships `src/server/errors.ts::mapDomainErrorToResponse` + 6 RED tests; expands `app.onError` placeholder; absorbs EC-23 (pg msg sanitization) + EC-24 (bearer redaction).

## Findings

- [INFO] Q1 mapping table APPROVED with refinements: InvalidScope/EmptyScopeError/MissingScopeError → 422 INVALID_SCOPE; MemoryNotFound → 404 MEMORY_NOT_FOUND; ContentTooLargeError → 413 CONTENT_TOO_LARGE; BiTemporalNotSupportedLocally → 501 NOT_IMPLEMENTED; InvalidSkillError → 422 INVALID_SKILL; MemoryStoreError + EmbedderError → 503 SERVICE_UNAVAILABLE (transient persistence boundary); InvalidEmbeddingDim/InvalidScoringWeightsError/InvalidCronExpressionError → 500 (config-shape, fires at boot — never HTTP in practice).

- [MAJOR] Q2 sanitization: KISS bearer-only, BUT case-insensitive `/bearer\s+\S+/gi`. RFC 9110 §5.1 + OWASP — both `Bearer` and `bearer` appear. AWS keys / Authorization: / password=… are YAGNI at P0 and risk false positives on legitimate memory content.

- [CRITICAL] Q3 wiring: PURE-FUNCTION MAPPER `mapDomainErrorToResponse(err: unknown): { status; body }`. Hono wrapper: `app.onError((err, c) => { const { status, body } = mapDomainErrorToResponse(err); return c.json(body, status); })`. Pure mapper = testable without Hono Context; DIP — core logic not framework-coupled; reusable for MCP transport.

- [MAJOR] Q4 pg detection: DEFAULT-TO-500 is correct + sufficient. Default branch already returns `{ code: "INTERNAL_ERROR", message: "Database error" }` without echoing `err.message`. EC-23 invariant satisfied by default branch. Pg-specific test (#4) becomes: given duck-typed Error with `code: '42P01'` + `severity: 'ERROR'` + `message: 'relation X does not exist'`, body does NOT contain `'relation X does not exist'`. Passes via default branch without importing `pg`. ADR D11 preserved.

- [MAJOR] Pre-RED scope drift guard: T1.6 = NEW `src/server/errors.ts` + NEW `src/server/__tests__/errors.test.ts` + EXPAND `app.ts::onError`. Do NOT modify `src/core/errors.ts` (DIP). Do NOT modify T1.2 `scopeOrValidationError` envelope-return path — mapper handles ONLY EXCEPTIONS propagated to onError.

- [MAJOR] Test 6 (bearer redaction) asserts redaction BEFORE LOGGING via `vi.spyOn(console, 'error')` capturing arg does NOT contain `Bearer <token>`. Distinct from response body sanitization (tests 3+4). Two invariants kept separate.

- [MAJOR] Envelope shape locked: `{ code: string; message: string; field?: string }`. `field?` for 422 zod context (single string, first field per @hono/zod-openapi convention).

- [INFO] no-paper-names check: 6 RED descriptors clean.

## Recommended action

Proceed with RED. Test inventory (locked):
1. `mapDomainErrorToResponse(new InvalidScope('foo')).status === 422 && body.code === 'INVALID_SCOPE'`
2. `mapDomainErrorToResponse(new MemoryNotFound('mem_123')).status === 404 && body.code === 'MEMORY_NOT_FOUND'`
3. unknown Error → 500, body has no `boom`/stack
4. duck-typed pg error → 500, body excludes raw message
5. envelope shape parity across all mapped errors
6. console.error spy: bearer token redacted in log

Expected diff ≤ 100 LoC core + ≤ 80 LoC tests.

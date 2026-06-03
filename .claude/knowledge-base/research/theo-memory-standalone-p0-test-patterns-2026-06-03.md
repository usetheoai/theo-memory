# Integration test patterns extracted from `.claude/knowledge-base/references/` for TheMemory P0

**Date:** 2026-06-03
**Scope:** Items 16/17/18 of CLAUDE.md § Phase III bis (REST API server + Docker stack + CLI consolidado)
**Method:** Explore agent traversal of Mem0 + Letta integration tests (LangMem clone not present in references/). Read-only.
**Purpose:** Feed `/to-plan theo-memory-standalone-p0` with concrete RED test inventory + canonical patterns to lift. Honors Inquebrável Rule 5 (TDD-first) + Rule 9 (não reinventar — adotar padrões de referências maduras).

## Canonical patterns to lift verbatim

### Pattern P1 — In-process REST testing (Mem0 origin)

**File:** `.claude/knowledge-base/references/mem0/tests/test_server_auth.py`

- **Lines 1-60**: Use FastAPI `TestClient` (in-process ASGI), NOT subprocess + curl. Fixture `_mock_memory` patches the underlying `Memory.from_config` with `MagicMock`; app reloaded via `importlib.reload(server.main)` with env overrides (`ADMIN_API_KEY`).
- **Lines 62-127**: Fixture class `TestAuthDisabled` — all endpoints return 200 when no API key configured.
- **Lines 150-244**: Fixture class `TestAuthEnabled` — unauthenticated requests return 401 with `www-authenticate: ApiKey` header; edge cases include case sensitivity, whitespace, prefix rejection (lines 194-206).
- **Lines 169-180**: Error response shape — assert `resp.json()["detail"]` text + `resp.headers.get("www-authenticate")`.

**For TheMemory:** equivalent in Hono is `app.fetch(new Request(url, init))` — in-process, no subprocess. Lift the SHAPE (mocked memory + env-overrides + auth/no-auth fixture classes) verbatim; translate to Vitest + Hono.

### Pattern P2 — MCP-over-HTTP test scaffolding (Mem0 OpenMemory origin)

**File:** `.claude/knowledge-base/references/mem0/openmemory/api/tests/test_mcp_server.py`

- **Lines 28-43**: `httpx AsyncClient` + `ASGITransport` for in-process async HTTP testing.
- **Lines 76-96**: `POST /initialize` returning JSON-RPC stable schema — assert response keys.
- **Lines 115-120**: Malformed JSON → 400 with `Invalid request` in error envelope.

**For TheMemory:** v0.3 `agent-tools` already ships MCP via stdio + streamable-HTTP. P0 Item 18 (`themory mcp`) must regress-test against this. Pattern P2 informs the format of MCP tests but is NOT directly a P0 RED test — it's a regression scaffold.

### Pattern P3 — Subprocess-based CLI testing with env isolation (Mem0 origin)

**File:** `.claude/knowledge-base/references/mem0/cli/python/tests/test_cli_integration.py` (+ `conftest.py`)

- **Lines 25-67** (helper `_run()`): `subprocess.run([sys.executable, "-m", "mem0_cli", *args], capture_output=True, text=True)`. Strips ANSI escape codes via `_ANSI_RE.sub('', stdout)` before assertions.
- **Lines 79-89**: Exit code assertion `result.returncode in (0, 2)` (Typer convention for "no command" → exit 2).
- **Lines 144-149**: Test `test_add_no_key_errors` exercises missing-config path — invokes CLI with `HOME=tmp_path` clean → subprocess sees empty `~/.mem0` → fails gracefully.
- **conftest.py lines 14-27**: Fixture `isolate_config(tmp_path, monkeypatch)` redirects `CONFIG_DIR` to temp + clears all `MEM0_*` env vars.

**For TheMemory:** translate to Node — `node:child_process.spawnSync('themory', args, { env: { ...clean_env, THEOMEM_PG_URI, ... } })`. Use Vitest fixture pattern (`beforeEach` cleanup). ANSI strip via `strip-ansi` pkg (Rule 9 — battle-tested).

### Pattern P4 — Health-poll loop for docker stack readiness (Letta origin)

**File:** `.claude/knowledge-base/references/letta/tests/test_server.py`

- **Lines 15-49** (`test_sleeptime_group_chat`): server starts in background thread (daemon); polling loop `requests.get(url + "/v1/health")` checks `status_code < 500` within **60s timeout, 0.1s retry**. No `pg_isready` — health is HTTP-centric.

**For TheMemory:** Item 17 Docker stack acceptance gate. Translate to `fetch()` polling in Vitest. 60s timeout matches letta; can tighten to 30s in CI matrix once empirical baseline known.

### Pattern P5 — Multi-stage Docker image + GHCR publish workflow (Letta origin)

**Files:** `.claude/knowledge-base/references/letta/.github/workflows/docker-image.yml` (+ `reusable-test-workflow.yml`)

- **Lines 8-41 (docker-image.yml)**: Multi-stage build → push to registry on release. QEMU setup for amd64 + arm64. Version extracted from `pyproject.toml`.

**For TheMemory:** lift the SHAPE — multi-stage Node 22 → distroless. Push to GHCR instead of Docker Hub (user decision 2026-06-03). ARM64 DEFERRED to P1 (Mem0/Letta both ship amd64 only initially; arm64 is a nice-to-have).

## Honest gaps (Inquebrável Rule 3)

1. **Letta has NO bearer-token auth test pattern visible** in `test_server.py` 2026-05 snapshot. Their auth lives in cloud middleware (out-of-scope for the OSS we cloned). TheMemory must invent the bearer-token test pattern (lift Mem0 P1 + adapt `X-API-Key` → `Authorization: Bearer`).
2. **Letta uses `pexpect` for interactive CLI tests** (line 39 of `test_cli.py`). TheMemory's `themory` subcommands (mcp, server, migrate, health) are NON-interactive — `pexpect` is overkill. Subprocess pattern from Mem0 P3 is the right choice.
3. **Mem0 OpenMemory `docker-compose.yml`** boots pgvector + FastAPI + Next.js UI in a single stack. Our P0 Item 17 explicitly scoped this NARROWER (no Nginx, no UI, no OTel collector by default per envelope). Don't blindly copy Mem0's compose — adapt for our scope.
4. **Trivy CVE scan**: visible in Letta CI but no canonical test pattern (CI gate, not unit test). For TheMemory P0 the acceptance is a CI workflow assertion, not a `tests/integration/` file.
5. **No Mem0 nor Letta tests `runMigrations` at boot of Docker image** — they assume manual or one-off migration commands. TheMemory's Item 17 acceptance "image runs migrations on startup → first remember() works without manual psql" is STRICTER than the references. We're inventing this discipline (justified per CLAUDE.md § 10.2 architecture rule about drizzle-kit push vs runMigrations).

## RED test inventory for `/to-plan theo-memory-standalone-p0`

### Item 16 — REST API server

```
File: tests/integration/rest-api.test.ts

T16-RED-1  test('POST /v1/remember returns 201 with memoryId',
                — uses Hono app.fetch (in-process, P1 pattern) + StubMemory mock)
T16-RED-2  test('POST /v1/recall returns results array shape { results: [...] }',
                — assert array + each row has { id, text, score, scope })
T16-RED-3  test('POST /v1/forget returns 204 No Content; subsequent recall excludes id')
T16-RED-4  test('POST /v1/reflect returns 202 Accepted; consolidation job queued')
T16-RED-5  test('GET /v1/health returns 200 with { status: "ok", db: "ready" }')
T16-RED-6  test('GET /v1/scopes/user/alice/memories paginates via ?cursor=&limit= per JSON:API')
T16-RED-7  test('Bearer token: missing Authorization when THEMEMORY_API_KEY set → 401',
                — assert resp.headers.get('www-authenticate') === 'Bearer'  (P1 line 187 pattern))
T16-RED-8  test('Bearer token: invalid token → 401 with detail field non-empty')
T16-RED-9  test('Bearer token: valid token → 201 (positive path)')
T16-RED-10 test('No auth: when THEMEMORY_API_KEY unset, all endpoints return 2xx without header')
T16-RED-11 test('GET /v1/openapi.json validates against OpenAPI 3.1 schema',
                — uses @apidevtools/swagger-parser dep)
T16-RED-12 test('Error response shape: invalid scope JSON → 422 with { code, message, field } envelope',
                — domain error → HTTP mapping; cite src/core/errors.ts InvalidScope)
T16-RED-13 test('OTel span emitted per handler call',
                — uses in-memory span exporter, asserts span name === 'rest.v1.remember')
```

13 RED tests cover Item 16 acceptance (per CLAUDE.md Phase III bis row 16).

### Item 17 — Docker stack

```
File: tests/integration/docker-stack.test.ts (gated on CI=true OR DOCKER_INTEGRATION=true)

T17-RED-1  test('docker compose up brings app + pgvector healthy within 60s',
                — Pattern P4: fetch(/v1/health) poll with 60s timeout, 100ms retry)
T17-RED-2  test('Image runs migrations on startup',
                — POST /v1/remember succeeds without prior manual psql -c CREATE EXTENSION;
                  stricter than P5 references per CLAUDE.md § 10.2)
T17-RED-3  test('curl POST /v1/remember + curl POST /v1/recall round-trip',
                — full E2E via shell, no SDK)
T17-RED-4  test('GET /v1/health/db (liveness) pings pgvector via pool.query SELECT 1')
T17-RED-5  test('Image built from multi-stage Dockerfile reports distroless runtime',
                — assert docker inspect base layer)

File: .github/workflows/docker-image.yml (CI gate, not test)

T17-WORK-1 GitHub Action publishes ghcr.io/usetheo/themory:0.1.0-alpha on tag release
T17-WORK-2 Trivy scan step: warn on MODERATE; FAIL on CRITICAL/HIGH (matches deps-audit golden rule severity table)
```

### Item 18 — CLI consolidado `themory`

```
File: tests/integration/cli-consolidated.test.ts

T18-RED-1  test('themory --help lists exactly 4 subcommands: mcp, server, migrate, health',
                — Pattern P3 subprocess + strip-ansi)
T18-RED-2  test('themory mcp reproduces existing MCP server bootstrap',
                — regression: existing tests/e2e/agent-tools/round-trip.test.ts still passes
                  when invoked via the new entry point)
T18-RED-3  test('themory server --port 9999 starts REST server',
                — spawn subprocess; fetch(http://localhost:9999/v1/health) within 5s; exit code 0 on SIGTERM)
T18-RED-4  test('themory migrate applies pending Drizzle migrations',
                — subprocess.spawnSync; exits 0; subsequent query sees new columns from pending migrations)
T18-RED-5  test('themory health: valid DB URI → exit 0',
                — env: THEOMEM_PG_URI set + pgvector running)
T18-RED-6  test('themory health: invalid DB URI → exit 1 with stderr mentioning the failure',
                — Mem0 P3 pattern lines 144-149 — fail-graceful)
T18-RED-7  test('themory-mcp legacy alias still works + emits deprecation warning to stderr',
                — backward-compat for one release per CLAUDE.md Item 18 description)
T18-RED-8  test('CLI inherits env isolation per Vitest fixture (clean THEOMEM_* + HOME=tmp_path)',
                — Mem0 conftest.py isolate_config pattern)
```

## Summary for `/to-plan` consumption

- **Total RED tests proposed:** 13 (Item 16) + 5+2 (Item 17) + 8 (Item 18) = **28 integration tests** + 2 CI workflow gates
- **Test files to create:** 3 (`rest-api.test.ts`, `docker-stack.test.ts`, `cli-consolidated.test.ts`)
- **New deps required (Rule 9 evaluated):**
  - `hono ^4.x` (Mem0/Letta = FastAPI; Hono is the TS-native equivalent; smallest viable runtime)
  - `commander ^12.x` OR `citty ^0.1.x` (TBD — commander more conservative)
  - `strip-ansi ^7.x` (used by Mem0 P3 pattern; battle-tested)
  - `@apidevtools/swagger-parser ^10.x` (OpenAPI validation; T16-RED-11)
  - dev: `testcontainers ^10.x` (T17-RED-1 docker stack tests; OR use already-running `themem_pgvector` per existing convention)
- **Existing deps reused:** `pg`, `drizzle-orm`, `zod`, `@modelcontextprotocol/sdk`, `@dqbd/tiktoken` (none affected)
- **Subpath exports new:** `@usetheo/memory/server` + (no separate path for CLI — uses `bin` field)
- **12th DIP introduced:** `AuthVerifier` at `src/core/dip/auth-verifier.ts` — single method `verify(token: string): Promise<boolean>`; bearer-impl for v1.1 of P0; OAuth/JWT impl deferred to P1+

## Honest caveats for the plan author

1. **`testcontainers` adoption** would simplify Docker stack tests but adds a heavy dev dep (~80MB). Alternative: rely on the existing `docker-compose.yaml` + `themem_pgvector` already-running convention (avoids the dep). Trade-off question for the plan ADRs.
2. **`commander` vs `citty`** trade-off: commander is 5x more downloads/week but citty is 6x smaller. ADR-worthy decision.
3. **OpenAPI 3.1 spec generation** can come from zod via `@hono/zod-openapi` (Rule 9). Don't hand-write OpenAPI.
4. **Mem0 uses `X-API-Key` header**; we chose `Authorization: Bearer <token>`. Different convention. Test names should reflect Bearer not X-API-Key.
5. **Mem0 does NOT test backward-compat aliases**; we have one (`themory-mcp` → `themory mcp`). T18-RED-7 is TheMemory-specific honesty discipline (no silent breaking changes).
6. **No Python SDK in P0** — Mem0 ships both; Letta is Python-only. P0 is TS/Node-first. Python SDK explicitly deferred to a future Phase V if demand surfaces.

## Files referenced (audit trail)

```
.claude/knowledge-base/references/mem0/tests/test_server_auth.py                 (P1)
.claude/knowledge-base/references/mem0/openmemory/api/tests/test_mcp_server.py   (P2)
.claude/knowledge-base/references/mem0/cli/python/tests/test_cli_integration.py  (P3)
.claude/knowledge-base/references/mem0/cli/python/tests/conftest.py              (P3 fixture)
.claude/knowledge-base/references/letta/tests/test_server.py                     (P4)
.claude/knowledge-base/references/letta/tests/test_cli.py                        (alt CLI path — pexpect, NOT adopted)
.claude/knowledge-base/references/letta/.github/workflows/docker-image.yml       (P5)
.claude/knowledge-base/references/letta/.github/workflows/core-integration-tests.yml (CI shape)
.claude/knowledge-base/references/letta/.github/workflows/reusable-test-workflow.yml (matrix shape)
```

All paths verified to exist via Explore agent — zero fabricated citations.

## Handoff to `/to-plan theo-memory-standalone-p0`

The plan should:

1. **Anchor on this research file** as the source of RED test inventory (cite via `@see .claude/knowledge-base/research/theo-memory-standalone-p0-test-patterns-2026-06-03.md`)
2. **Generate one task per RED test cluster** (T16-RED-1..3 → one task; T16-RED-7..10 → one task; etc.) — group by semantic locus, not 1:1
3. **Each task's TDD section** explicitly lists which RED tests it owns, citing the test ID from this file
4. **Declare ADRs** for: framework choice (Hono vs alternatives), CLI lib choice (commander vs citty), Docker test approach (testcontainers vs already-running pgvector), Auth shape (Bearer vs X-API-Key vs both), OpenAPI generation (hand vs zod-openapi vs decorators)
5. **Honor cycle-plan ADR D1.7 budgeting**: declare time-shape per task; do NOT use vague TBD
6. **Honor 95% confidence gate**: any task that requires WebFetch for spec-language docs (e.g. OpenAPI 3.1 spec, JSON-RPC 2.0 spec) declares the URL explicitly so `/deps-audit` can snapshot it.

## Next step

User invokes `/to-plan theo-memory-standalone-p0`. Cycle-plan reads CLAUDE.md Phase III bis Items 16/17/18 + this research file → produces `.claude/knowledge-base/plans/theo-memory-standalone-p0-plan.md`.

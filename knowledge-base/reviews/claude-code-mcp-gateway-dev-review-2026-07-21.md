# Review: claude-code-mcp-gateway-dev (M7)

**Date:** 2026-07-21
**Reviewers:** 3 specialist agents (architecture, tests+security, cross-validation) + 2 independent verification passes
**Verdict:** READY_TO_MERGE

The first round returned **NEEDS_FIXES**. The findings were correct, including one BLOCKER
introduced by this milestone itself. Two verification passes followed; the second confirmed the
fixes and its residual MEDIUM was closed before this report.

## Findings and disposition

| Sev | Finding | Disposition |
|---|---|---|
| BLOCKER | Tenant isolation: `withScope` replaces the ambient context, so binding the user tier dropped the Principal's `workspaceId` on every tools/call. With `THEOMEM_MCP_DEFAULT_USER_ID` set (the deployed config) that branch always ran — all tenants collapsed onto shared rows | CLOSED — merge via `tryGetScope()`; regression test verified RED before / GREEN after; **reproduced live on dev and re-probed green after redeploy** |
| BLOCKER | T2.1 never done — kit hardcoded theo-memory REST paths and the old IP | CLOSED — `THEOMEM_MEMORY_PATH_PREFIX`, after a first attempt that was a silent no-op (see below) |
| BLOCKER | Edge suite passed by skipping, the anti-pattern its own task forbade | CLOSED — `KEY_B` required once an edge is configured; guard test fails loudly |
| HIGH | SIGTERM was a no-op over HTTP: the listener handle was discarded and a detached server was stopped | CLOSED — `installShutdown` per transport, after the transport is known |
| HIGH | Unbounded `McpServer` leak: sessionless requests allocated a server the SDK never closed | CLOSED — evicted when the response ends (`close`, covering aborts) without a session |
| HIGH | Kit path prefix read only from `process.env` while `loadEnv()` parsed the env file and dropped it — the documented gateway setup did nothing and kept sending the client credential to the service | CLOSED — `loadEnv()` returns `pathPrefix` with env-over-file precedence; 4 regression cases, verified RED against the prior implementation |
| HIGH | Cross-tenant test sent `text` where the schema requires `content`; the write was rejected so the isolation assertion held vacuously | CLOSED — corrected, write asserted, positive control added |
| HIGH | Body-claimed-tenant test asserted an id `recall` never echoes either way | CLOSED — seeds a marker, proves the read stayed on the credential's workspace |
| HIGH | Inverted assertion whose replacement coverage claim was false | CLOSED — registry teardown now genuinely asserted |
| MEDIUM | `close()` closed the listener before its sessions (hangs on a live SSE stream) | CLOSED — sessions first |
| MEDIUM | Reentrancy guard armed on only one of two stop paths | CLOSED — flag on the Session, both paths, at-most-once test |
| MEDIUM | `themory_mcp` had no healthcheck; the deploy gate ignored it | CLOSED — TLS-connect healthcheck + deploy gate |
| MEDIUM | Concurrency tests ran sequentially despite their name | CLOSED — `Promise.all` + ten-client fan-out |
| MEDIUM | Abort-path eviction gap (`finish` misses aborted connections) | CLOSED — `close` is a strict superset; abort case tested |
| MEDIUM | CHANGELOG lacked a Security entry for #101 | CLOSED — added; a stale line describing the admin API as unmounted was corrected |
| MEDIUM | `McpSessionRegistry` writes HTTP responses (SRP/placement) | **NOT CLOSED** — accepted; a placement refactor, not a defect. The 404 + `-32001` it emits is spec-correct |
| LOW | No test asserts the join inside `post()`; prefix without a leading slash is not normalized; the handshake-survival test is a guard, not a regression test | Accepted, documented |

## Quality gates

| Gate | Result |
|---|---|
| `npm run typecheck` | PASS, 0 errors |
| `npx vitest run packages/mcp/src` | 18 files, 150 tests, 150 passed |
| `/code-quality` | PASS (100), zero hard and zero soft caps |
| Integration (Postgres) on CI | success |
| Security SAST | success |

`npm test` (contract suite) has 28 pre-existing failures tracked in **#104** — CI never ran that
suite, and 10 of them depend on a fixture never committed. The M7 diff touches none of those
paths; passing count rose 1206 → 1214 with this milestone's new tests.

## Evidence

Two Claude Code instances concurrently through the public edge, distinct sessions; memory
written by one read by the other; a fresh instance sees all 8 tools and recalls across sessions.
Workspace isolation on the MCP path: `VAZAMENTO` before the fix, `isolado` after, with the
positive control valid in both runs.

## Honest caveats carried into the release

1. **Cross-tenant isolation is NOT proven at the edge.** The gateway validates customer
   credentials against theo-cloud's store; both `theo_live_*` keys available here resolve to the
   same tenant, and minting a second one is a theo-cloud dashboard operation. Isolation is proven
   at the data plane and on the MCP path — the layer this milestone changed — not at the gateway.
2. Three opt-in edge probes were logic-verified but executed by the author, not by the reviewer.
3. Credentials that transited this work need rotation: a Cloudflare token readable via `ps` on
   the dev host, the OpenAI key, and the `theo_live_*` keys used for probing.

---
name: implement-theo-memory-standalone-p0-sepa-knowledge
description: |
  Domain knowledge skill paired with the SEPA agent for plan theo-memory-standalone-p0. Consult ALWAYS during /implement halt-loop when SEPA needs to (a) recap plan-specific context (14 ADRs D1-D14 + 49 EC absorptions), (b) refresh community knowledge via WebSearch (Hono middleware order, commander multi-subcommand patterns, crypto.timingSafeEqual security idiom, distroless ENTRYPOINT array syntax, Trivy allowlist mechanism, OpenAPI 3.1 spec via @hono/zod-openapi, RFC 6750 Bearer scheme parsing), or (c) cross-reference plan sections via grep. Frozen plan-specific context + dynamic WebSearch + grep refresh. Triggering phrases — "review this against community standards", "what's the canonical pattern for Hono / commander / OTel / distroless / Trivy", "is this idiomatic", "best practice for bearer token comparison / SIGTERM graceful shutdown / OpenAPI auto-gen / pagination cap / readiness gate / single-scope-tier zod refine / npm pack manifest / subpath isolation tree-shake".
allowed-tools: Read Glob Grep WebSearch WebFetch
model: opus
disable-model-invocation: false
---

# SEPA knowledge skill — theo-memory-standalone-p0

You are loaded as the knowledge layer for the SEPA (Staff Engineer Pair-Program Agent) auditing the `/implement` halt-loop on plan `theo-memory-standalone-p0`. SEPA is your consumer — give SEPA accurate, current, plan-specific community knowledge so its findings cite canonical sources, not training-data recall.

## Plan context (frozen at generation 2026-06-03)

**Goal:** Ship a standalone REST + Docker + CLI distribution surface for TheMemory so that `docker compose up` exposes the 4 verbs over HTTP with bearer auth + OpenAPI 3.1 spec + multi-subcommand CLI, measured by the integration test `tests/integration/docker-stack.test.ts` round-tripping `POST /v1/remember` + `POST /v1/recall` end-to-end against `ghcr.io/usetheo/themory:0.1.0-alpha` with ZERO manual setup steps.

**ADRs locked (D1-D14):**

| ID | Decision |
|---|---|
| D1 | Hono ^4.6 over Fastify/Express (TS-first, edge-ready, 12KB) |
| D2 | RPC-mirror endpoints (POST /v1/remember etc.) NOT REST-resource |
| D3 (amended) | Bearer auth via `THEMEMORY_API_KEY`; empty/whitespace = fail-closed (EC-1); case-insensitive prefix per RFC 6750 (EC-2); verbatim token compare (EC-3) |
| D4 | commander ^12.1 over citty (conservative; 100M+ weekly) |
| D5 | Reuse `themem_pgvector` (no testcontainers); unique compose project per test run (EC-48) |
| D6 (amended) | Distroless `nodejs22-debian12:nonroot` runtime — no shell |
| D7 | GHCR over Docker Hub; `permissions: packages: write` (EC-44) |
| D8 (amended) | `themory server` invokes `runMigrations()` inside binary BEFORE bind port; no shell entrypoint (EC-47 absorbed) |
| D9 | `themory-mcp` alias one-release backward-compat with deprecation stderr |
| D10 | 500 LoC budget per file (per-handler split) |
| D11 | `createServer({ memory, authVerifier? })` DI; NO `createServerWithMemory` shortcut |
| D12 (NEW) | Single scope tier per request (`userId` XOR `sessionId` XOR `agentId` XOR `skillRepoId`); zod `.union().strict()` (EC-9) |
| D13 (NEW) | ENTRYPOINT `["node", "/app/dist/agent-tools/cli.js", "server"]` (direct Node, no shell, no docker-entrypoint.sh); SIGTERM reaches Node-as-PID-1 (EC-32 absorbed) |
| D14 (NEW) | 4 NEW deps pinned with sunset 2026-09-01: `@hono/node-server ^1.13`, `@hono/zod-openapi ^0.18`, `commander ^12.1`, `@apidevtools/swagger-parser ^10.1` (deps-audit Path B) |

**Edge-case absorptions (49 ECs: 12 must-fix + 25 test-recommended + 12 document):**

12 MUST FIX (critical, mapped to specific tasks):
- EC-1 (T1.1, D3): Empty `THEMEMORY_API_KEY` fail-closed via `readApiKey()` sentinel
- EC-4 (T1.1): `crypto.timingSafeEqual` RangeError prevention via length-check first
- EC-9 (T1.2, D12): Multi-scope-tier rejection via zod `.union().strict()`
- EC-14 (T1.3): Pagination `limit` DOS cap at 100 via zod `.max(100)`
- EC-17 (T1.3): `/v1/health/db` 2s timeout via `Promise.race` (probe-zombie prevention)
- EC-19 (T1.4): `GET /v1/openapi.json` auth-exempt via middleware order
- EC-26 (T1.7): Default import does NOT pull Hono (bundle isolation test)
- EC-32 (T2.3, D13): SIGTERM graceful shutdown closes server + pool
- EC-37 (T2.5): `themory health` concrete checks (pool.query + Memory factory + optional --deep embedder/llm)
- EC-43 (T3.3): Trivy gate aligned with `deps-audit-golden-rule.md` + `.trivyignore` allowlist
- EC-47 (T3.4, D6+D8+D13): Distroless no-shell → ENTRYPOINT direct Node
- EC-52 (T1.7): `package.json#files` manifest includes `src/server/**`

**Project rules cited by ADRs:**
- `architecture.md` (§ 1 three-tier scope, § 3 DIP, § 4 Mem0-shape, § 8 boundary validation, § 10.2 drizzle-kit vs runMigrations, § Module hygiene 500 LoC)
- `testing.md` (TDD-first; integration tests against real boundary)
- `no-paper-names-in-code.md` (no Mem0/Letta/Honcho/Voyager in src/** test descriptors)
- `deps-audit-golden-rule.md` (Trivy severity rubric + allowlist sunset discipline)

## Knowledge refresh protocol (when SEPA invokes you)

### Mode A — Plan-context recap (cheap, no WebSearch)

SEPA asks: "what does ADR D9 say about themory-mcp alias?" OR "which EC governs the OpenAPI spec auth-exempt?"

Answer from frozen context above. Cost ~0 tokens. No WebSearch.

### Mode B — Community knowledge refresh (WebSearch authoritative sources)

SEPA asks: "is `Authorization: bearer xyz` case-handling correct per RFC 6750?" OR "what's the canonical Hono middleware order pattern?"

Procedure:
1. Identify the canonical source (RFC editor, hono.dev docs, Node docs, npm package docs)
2. WebSearch with focused query (e.g., `site:datatracker.ietf.org RFC 6750 Bearer scheme case sensitivity`)
3. WebFetch the canonical URL
4. Return verbatim quote + URL + access date
5. NEVER cite from training-data recall — always WebSearch first per Inquebrável Rule 3 + cycle-discover anti-pattern #10

### Mode C — Cross-reference grep (verify plan claim against repo state)

SEPA asks: "does `src/local/index.ts:1026` actually export `runMigrations`?"

Procedure: `Grep` the cited symbol. Report hit + line context. Confirm or refute the plan claim.

## Canonical sources for this plan (allowlist for WebFetch)

For Mode B WebSearch, prefer these domains (subset of `discover-web-allowlist.txt`):

- `hono.dev` (Hono framework docs) — middleware, routing, OpenAPI integration
- `developer.mozilla.org` (MDN) — Web APIs (Request, Response, Headers, fetch)
- `datatracker.ietf.org` (IETF RFCs) — RFC 6750 (Bearer), RFC 7807 (Problem Details), JSON-RPC 2.0
- `spec.openapis.org` (OpenAPI 3.1 spec) — schema validation, operation IDs
- `nodejs.org/docs` — `process.on('SIGTERM')`, `crypto.timingSafeEqual`, child_process, http
- `github.com/tj/commander.js` — commander multi-subcommand patterns
- `cheatsheetseries.owasp.org` (OWASP) — REST API security, bearer-token best practice
- `aquasecurity.github.io/trivy` — Trivy ignore mechanism, severity gating
- `docs.github.com` — GitHub Actions GHCR push workflow
- `gcr.io/distroless` (Google Distroless images) — runtime characteristics, no-shell verification

## Output discipline

When SEPA invokes you, return:

```markdown
## Knowledge refresh — {SEPA question}

### Mode: {A | B | C}

### Source(s) cited
- {URL or grep path:line}

### Verbatim quote / repo evidence
> "..."

### Interpretation for SEPA's finding
- ...
```

NEVER fabricate quotes. NEVER mix training-recall with WebSearched material — be explicit which is which. If WebSearch fails (no canonical source for question), say so honestly and recommend SEPA flag the finding as "needs human verification".

## When SEPA should NOT invoke you

- Pure logic checks (does this function have correct return type?) — SEPA reads the code directly
- File-size budget audits — SEPA greps LoC count directly
- Boundary-check enforcement — `.claude/hooks/boundary-check.sh` does that, not us

## Self-limits

- Max 3 WebFetch calls per SEPA invocation (per token-budget.md)
- Max 1500 token output per response (TIGHT default unless SEPA explicitly says VERBOSE)
- If a question can be answered from frozen context (Mode A), DO NOT WebSearch (waste of tokens)
- If WebSearch returns ambiguous/conflicting results, surface that honestly — DO NOT pick a winner

## Inquebrável discipline

You honor:
- Rule 3 (extreme honesty) — cite canonical sources, never fabricate
- Rule 9 (não reinvente) — adopt RFC/spec patterns, don't invent alternatives
- cycle-discover.md anti-pattern #10 — no training-data citations when WebSearch is available

# Plan: theo-memory-standalone-p0 Fixes Cycle 1 — F-rev-1 CRITICAL + 4 MAJOR absorption

> **Version 1.2** (2026-06-03) — Absorbs `/deps-audit theo-memory-standalone-p0-fixes-cycle-1` pre-flight: plan lacked `## Dependencies` section. Patched: NEW `## Dependencies` section added declaring zero new deps (all 5 absorption tasks use existing dependencies already pinned by the source plan's ADR D14). T2.1 specifically uses `hono ^4.6.0`'s built-in `body-limit` middleware (subpath `hono/body-limit` — no separate package install).
>
> **Version 1.1** (2026-06-03) — Absorbs `/edge-case-plan theo-memory-standalone-p0-fixes-cycle-1` report (9 edge cases: 2 MUST FIX + 5 SHOULD TEST + 2 DOCUMENT). **2 MUST FIX absorbed**: EC-1 (T2.1 ADR D3 contradiction on 413 envelope shape — clarified `onError` callback wiring constructs the `ContentTooLargeError` envelope via `mapDomainErrorToResponse` since `hono/body-limit`'s `onError` returns Response directly, NOT throwing to `app.onError`); EC-2 (T1.1 RED test 1 assertion drift — `POST /v1/remember` with `skillRepoId` hits zod `.strict()` `unrecognized_keys` path returning generic `VALIDATION_ERROR`, NOT `INVALID_SCOPE`; test assertion updated to match the production code path). **5 SHOULD TEST absorbed inline** in TDD blocks: EC-3 (T1.2 cross-file import sweep before refactor), EC-4 (scopesHandler skill short-circuit verification — `memory.skills` never called), EC-5 (OpenAPI re-validation post-removal — properties walk), EC-6 (T2.2 stderr noise mitigation via `vi.spyOn` in 8 existing run-server tests), EC-7 (T2.1 middleware order regression — bodyLimit fires before bearer). **2 DOCUMENT absorbed** in Acceptance Criteria notes: EC-8 (T2.2 future conditional-warning gating reminder comment), EC-9 (T2.1 gzip-compressed body bypass at P0 alpha — README note + reverse-proxy guidance).
>
> **Version 1.0** (2026-06-03) — Lift `/review theo-memory-standalone-p0` verdict from **NEEDS_FIXES** to **READY_TO_MERGE_WITH_CAVEATS**. Absorbs the 1 CRITICAL finding (skill-scope contract divergence — F-rev-1, confirmed by memory-layer F-dom-mem-1 + architecture F-arch-1 reviewers) + the 4 recommended MAJOR findings (F-rev-3 health-auth-exempt ADR D3 amendment; F-rev-4 ContentTooLargeError DOS surface — hono/body-limit middleware; F-rev-9 stub-embedder consumer honesty disclosure; F-rev-12 `_body-parsing.ts` SRP refactor). All 5 absorptions surface as small, focused commits the re-review can validate without re-spawning the full agent panel.

## Goal

> "Lift `/review theo-memory-standalone-p0` verdict from NEEDS_FIXES to READY_TO_MERGE_WITH_CAVEATS by absorbing the 1 CRITICAL + 4 recommended MAJOR findings, measured by `/review theo-memory-standalone-p0` re-run returning 0 BLOCKER + 0 CRITICAL findings on the same diff base."

## Context

### What exists today (post-`/review` 2026-06-03)

- The `/implement theo-memory-standalone-p0` halt-loop completed 18/18 tasks (commits `c101b3f` → `fc4ec5c`). Quality gates GREEN: 943 contract tests + THE GOAL TEST docker-stack 6/6 + v0.3 e2e regression PASS; typecheck + lint zero warnings.
- `/review theo-memory-standalone-p0` (commit `0e40344`, report at `.claude/knowledge-base/reviews/theo-memory-standalone-p0-review-2026-06-03.md`) spawned 8 specialized agents in parallel. Verdict **NEEDS_FIXES** because of 1 CRITICAL + ~13 MAJOR + ~22 MINOR.
- **`/dogfood` gate** remains EVIDENCE_INSUFFICIENT (audit `6f7ff87`). This plan does NOT unblock production-ready claims; Roadmap Item 11 v1.0 gate still requires the anchor scenario running ≥ 30 days.

### What's broken (the 5 findings absorbed by this plan)

1. **F-rev-1 CRITICAL** — REST schemas at `src/server/schemas.ts:14` admit `skillRepoId` as a 4th scope tier on `RememberBody`/`RecallBody`/`ReflectBody`/`ForgetBody`. `resolveScope` at `src/server/schemas.ts:108` routes it to `memory.skills(repoId)` returning `ScopedSkillMemory` (`add` / `recall` / `consolidate` / `forget` per `src/core/skill.ts:169-172`). Handlers then call `.remember()` / `.reflect()` / `.recall(query, options)` — methods that do NOT exist on `ScopedSkillMemory`. The `as unknown as MemoryLike` double-cast at `src/server/handlers/{remember,recall,reflect}.ts:29/29/31` bypasses TypeScript exactly at the load-bearing call site. **Production blast radius**: `POST /v1/{remember,recall,reflect}` with `skillRepoId` + `GET /v1/scopes/skill/:id/memories` (handler at `src/server/handlers/scopes.ts:49` casts `memory.skills(id) as unknown as ScopedMemory` then calls `getAll()` which also doesn't exist) all surface as 500 INTERNAL_ERROR (caught by `app.onError`). Test mocks shim `skills()` with a fake `ScopedMemory` shape; production `LocalScopedSkillMemory` does not.

   **Root cause:** `CLAUDE.md § ADR-0010` (RepoScope as 4th tier) says skill scope is "exposed ONLY through `Memory.skills(...)` (not on the public 4 verbs)". The implementer (me) extended `skillRepoId` to the REST 4-verb surface as scope creep. Plan ground truth was always 3-tier verbs.

2. **F-rev-3 MAJOR** — T3.5 commit `fc4ec5c` extended the EC-19 OpenAPI auth-exempt pattern to `/v1/health` + `/v1/health/db` to fix the docker-compose healthcheck round-trip (the orchestrator probe doesn't carry credentials). Industry-correct per RFC 9110 + OWASP `/healthz` convention. Shipped WITHOUT amending plan ADR D3 (bearer middleware) → cycle-implement anti-pattern #7 (silent scope creep). Regression tests exist (`handlers.test.ts` 11a + 11b) but the ADR amendment is missing.

3. **F-rev-4 MAJOR** — `mapDomainErrorToResponse` at `src/server/errors.ts` maps `ContentTooLargeError → 413` but nothing in `src/server/` ever raises it. `safeJson()` at `src/server/handlers/remember.ts` reads `c.req.text()` unbounded. Real DOS surface — an attacker can send a 1GB body and the handler will buffer it before zod parsing rejects it.

4. **F-rev-9 MAJOR** — `themory server` silently wires `DeterministicStubEmbedder` + `StubLLM` by default (`src/agent-tools/run-server.ts:110-122`). Consumers of `ghcr.io/usetheo/themory:0.1.0-alpha` have no runtime signal that recall produces coincidental cosine-1.0 hits against stored text rather than semantic retrieval. THE GOAL TEST JSDoc admits the trade-off; the runtime does not. Inquebrável Rule 3 (honesty) violation at the consumer-facing boundary.

5. **F-rev-12 MAJOR** — `recall.ts`, `forget.ts`, `reflect.ts` import `safeJson` / `EMPTY_BODY` / `MALFORMED_BODY` / `scopeOrValidationError` from `./remember.js`. `remember.ts` now has TWO reasons to change (the `/v1/remember` semantic AND the shared body-parser utilities). SRP violation + avoidable directed coupling.

### Evidence motivating NOW (not later)

1. **F-rev-1 is a CRITICAL gate.** Cycle-review.md § Hard gates: "any CRITICAL → HALT unless explicitly dismissed with ADR-style rationale in the report." We choose to fix (Option 1 from the review report), not dismiss — the bug is real, the fix is small, and the dismissal would require explicit ADR that "REST routes return 500 on skill-scope inputs by design" which is bad consumer UX.
2. **F-rev-4 is a real DOS surface** observable today: `curl -X POST http://localhost:8080/v1/remember -d "$(yes a | head -c 100000000)" -H "Authorization: Bearer ..."` would buffer 100MB before zod rejects. Cheap to fix (1 import + 1 middleware mount line) + 1 RED test.
3. **F-rev-3/9/12 are honesty + hygiene debt** that grows if left unattended. ADR amendment is one paragraph; loud-warn is one stderr line; extract is one new file + 4 import path edits. All under 1 hour each.
4. **Re-running `/review` end-to-end after these fixes** demonstrates the cycle's value: surface the CRITICAL, absorb it, validate the absorption, ship clean. Letting the bug slide into a PR with WITH_CAVEATS framing would set a bad precedent (Inquebrável Rule 1 — 95% confidence is on the actor).

## Objective

- [ ] Sub-goal 1 — F-rev-1 CRITICAL closed: `skillRepoId` removed from `SCOPE_KEYS` + `ScopeFields` + `resolveScope` + `MemoryLike`; the `as unknown as MemoryLike` cast in 3 handlers is now type-clean (or simplified); ADR-0010 honored (skill ONLY via SDK)
- [ ] Sub-goal 2 — `GET /v1/scopes/skill/:id/memories` returns deterministic 501 `NOT_IMPLEMENTED` with body `{code:'SKILL_LISTING_NOT_IMPLEMENTED',message:'...'}` instead of crashing into 500 INTERNAL_ERROR
- [ ] Sub-goal 3 — F-rev-12: `src/server/handlers/_body-parsing.ts` extracted; `remember.ts`/`recall.ts`/`forget.ts`/`reflect.ts` import from the new helper; `remember.ts` no longer exports those utilities
- [ ] Sub-goal 4 — F-rev-4: `hono/body-limit` middleware mounted on `/v1/*` with 1 MB cap; `ContentTooLargeError` mapper wired so the 413 envelope fires for oversized POST bodies; 1 RED test asserts 413 on oversized body
- [ ] Sub-goal 5 — F-rev-9: `themory server` writes loud stderr warning at startup when wired to `DeterministicStubEmbedder` + `StubLLM` (default path); README/CHANGELOG note the gap
- [ ] Sub-goal 6 — F-rev-3: ADR D3 amendment block added to the SOURCE plan (`theo-memory-standalone-p0-plan.md` v1.3 → v1.4) documenting health-auth-exempt extension as RFC-9110 / OWASP-conformant; CHANGELOG entry mirrors the rationale
- [ ] Sub-goal 7 — re-running `/review theo-memory-standalone-p0` (against the SAME diff base `f94c3007^`) returns **0 BLOCKER + 0 CRITICAL**; verdict moves to `READY_TO_MERGE_WITH_CAVEATS` or `READY_TO_MERGE`

## Dependencies

Per `cycle-plan.md` v1.1 § Trigger conditions — every plan declares its dependency surface, even when it introduces ZERO new packages.

### Existing — use as-is (NO version changes)

| Package | Version (current in `package.json`) | Ecosystem | Why this plan uses it |
|---|---|---|---|
| `hono` | `^4.6.0` | npm | T2.1 uses `hono/body-limit` (built-in middleware subpath ~~no separate dep~~). Pin already locked via source plan ADR D14 (sunset 2026-09-01). |
| `vitest` | `^4.0.0` | npm | All RED tests across T1.1, T1.2, T2.1, T2.2 run on the existing vitest install. |
| `zod` | `^3.25.0` | npm | T1.1 leverages existing `.strict()` schema rejection of unknown `skillRepoId` key (EC-2 absorption hinges on this behavior). |
| `@modelcontextprotocol/sdk` | `^1.29.0` | npm | T2.2 stub-embedder warning fires in `run-mcp-server.ts` (uses the existing SDK transport). |
| `pg` | `^8.13.0` | npm | T1.1 + T2.1 do not touch pg directly; mentioned for completeness — runServer composition root (T2.3 of source plan, unchanged here) already pins this. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why |
|---|---|---|---|---|
| **(none)** | — | — | — | This fix-up plan introduces ZERO new dependencies. T2.1 specifically uses `hono ^4.6.0`'s **built-in** `body-limit` middleware via the `hono/body-limit` subpath — this is a Hono SDK feature, NOT a separate npm package. Verified at `node_modules/hono/dist/types/middleware/body-limit/index.d.ts`. |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| **(none)** | — | — |

### Note on `hono/body-limit` subpath

`hono/body-limit` is a documented Hono built-in middleware exported under the `hono` package at the `body-limit` subpath. `package.json#exports` of `hono ^4.6.0` advertises this subpath. No `npm install` required; no ADR D14 amendment needed. The existing `hono ^4.6.0` pin (with ADR D14 sunset 2026-09-01) covers this usage.

## ADRs

### D1 — Remove `skillRepoId` from REST scope keys (CRITICAL absorption)

- **Decision:** Drop `skillRepoId` from `SCOPE_KEYS` + `ScopeFields` + `resolveScope` + `MemoryLike` in `src/server/schemas.ts`. REST 4-verb surface accepts only `userId` / `sessionId` / `agentId` per CLAUDE.md `architecture.md § 1` (3-tier scope locked). Skill scope is exposed ONLY via the SDK `Memory.skills(repoId)` per CLAUDE.md `ADR-0010` (locked 2026-05-30). `GET /v1/scopes/skill/:id/memories` returns 501 NOT_IMPLEMENTED with a body explaining skill listing is SDK-only at P0.
- **Rationale:** Smallest diff. Restores plan ground truth (the source plan v1.3 only mandated 3-tier REST verbs — `skillRepoId` was undeclared scope creep in implementation). Honors Inquebrável Rule 11 (YAGNI) — extending `ScopedSkillMemory` with `remember`/`reflect`/`getAll` to satisfy a REST surface ADR-0010 explicitly says skill is NOT on would be far larger surface change.
- **Alternatives considered:**
  - **B (Extend `ScopedSkillMemory`):** add `remember`/`reflect`/`getAll` methods that throw `NotImplementedError`. Rejected: bloats the SDK contract for a REST-only need; violates ADR-0010 ("exposed ONLY through `Memory.skills(...)`"); larger walk-back cost.
  - **C (Discriminated-union dispatch in handlers):** route `skillRepoId` to a separate `skillRememberHandler` returning 422 explaining skill scope is unsupported. Rejected: keeps the misleading affordance in the public API surface; consumer still sees a Bad Request mid-flight rather than the scope being absent from the schema.
- **Consequences:** Test `scopes.test.ts` test #12 (skill type dispatches to memory.skills) is REWRITTEN to assert 501 NOT_IMPLEMENTED. OpenAPI registration's `ScopeTypeEnum` keeps `'skill'` in the enum (case-sensitive validation per EC-13) — the handler returns the 501 before reaching the dispatch shim. The `MemoryLike` interface in `schemas.ts` drops the `skills` member, removing the false contract entry — the double-cast at `handlers/{remember,recall,reflect}.ts:29/29/31` becomes a single cast or an `import type { Memory }` direct typing (F-arch-2 also closed as a side effect).

### D2 — Single `_body-parsing.ts` helper module

- **Decision:** Extract `safeJson` / `EMPTY_BODY` / `MALFORMED_BODY` / `scopeOrValidationError` from `src/server/handlers/remember.ts` into `src/server/handlers/_body-parsing.ts`. `remember.ts` imports from the new file; sibling handlers (`recall.ts`, `forget.ts`, `reflect.ts`) update their imports.
- **Rationale:** SRP per `architecture.md § 7` — `remember.ts` had two reasons to change (handler semantic + shared utility surface). The leading underscore prefix (`_body-parsing.ts`) signals "module-internal helper, not a public handler". DIP unchanged; module hygiene improves.
- **Alternatives considered:**
  - **B (Move into `src/server/schemas.ts`):** rejected — schemas.ts is the zod schema surface; adding HTTP body-parsing utilities expands its concern.
  - **C (Leave as is, accept the smell):** rejected — F-rev-12 + F-arch-3 + F-dom-api-6 + F-wire-6 — four reviewers independently flagged this. The cost of NOT fixing now grows as more handlers are added.

### D3 — `hono/body-limit` middleware with 1 MB cap (EC-1 MUST FIX absorbed)

- **Decision:** Mount `bodyLimit({ maxSize: 1_000_000, onError })` from `hono/body-limit` (built-in middleware in `hono ^4.6.0`, ADR D14-pinned) on `/v1/*` BETWEEN the existing OTel and bearer middlewares (ORDER: `OTel → bodyLimit → bearer`). The `onError` callback explicitly constructs the `ContentTooLargeError` envelope via `mapDomainErrorToResponse` and returns it through `c.json` — preserving the T1.6 consumer contract that EVERY 4xx/5xx from `/v1/*` carries the structured `{code, message, field?}` envelope shape.
  - **Verified library shape** (per `node_modules/hono/dist/types/middleware/body-limit/index.d.ts`): `BodyLimitOptions = { maxSize: number; onError?: (c: Context) => Response | Promise<Response> }`. The `onError` callback returns a Response directly — it does NOT throw to `app.onError`. Without an explicit `onError`, `hono/body-limit` writes its own default 413 response that does NOT match the structured envelope.
  - **Exact wiring (verbatim — implementer copies this into `app.ts`):**
    ```ts
    import { bodyLimit } from 'hono/body-limit';
    import { mapDomainErrorToResponse } from './errors.js';
    import { ContentTooLargeError } from '../core/errors.js';
    // ...
    app.use('/v1/*', otelMiddleware(tracer));
    app.use(
      '/v1/*',
      bodyLimit({
        maxSize: 1_000_000,
        onError: (c) => {
          // EC-1 absorption: hono/body-limit's onError returns Response directly
          // without going through app.onError. Construct the T1.6 envelope here so
          // 413 responses carry the same {code, message} shape as every other 4xx.
          // `-1` actualSize sentinel — hono doesn't surface the actual size at hit.
          const { status, body } = mapDomainErrorToResponse(
            new ContentTooLargeError(1_000_000, -1),
          );
          return c.json(body, status as Parameters<typeof c.json>[1]);
        },
      }),
    );
    app.use('/v1/*', bearerAuth(authVerifier));
    ```
- **Rationale:** Cheap DOS guard at the edge per `architecture.md § 8` (validate at boundaries). 1 MB is generous for a single-fact remember call (typical body < 4 KB); leaves headroom for `infer:false` callers shipping pre-extracted fact arrays. Middleware order `OTel → bodyLimit → bearer` ensures: (a) OTel captures all 413s for ops visibility; (b) bodyLimit rejects oversized payloads before bearer is consulted (no auth-status information leak on oversize unauth requests); (c) handlers run last. Operators can override via a future `--body-limit` flag (out of scope for this plan).
- **Alternatives considered:**
  - **B (Built-in 413 — no `onError` callback):** rejected after EC-1 MUST FIX absorption — `hono/body-limit` writes a plain 413 by default that does NOT match the structured `{code, message}` envelope from T1.6. Consumers parsing 4xx envelopes uniformly would break. Reusing `mapDomainErrorToResponse` via explicit `onError` is the consistent path.
  - **C (Wire `ContentTooLargeError` through `app.onError` by throwing inside `onError`):** rejected — `onError` returns `Response` per the library type; throwing would propagate but Hono's internal middleware dispatch may not route throws from middleware uniformly. Direct `c.json` from `onError` is the documented + tested path.
  - **D (Defer to operator-side reverse proxy):** rejected — README + the standalone image stance is "consumer decides on reverse proxy" but the image MUST be safe out-of-box. DOS guard belongs in the image.

### D4 — Stub-embedder loud startup warning

- **Decision:** `src/agent-tools/run-server.ts` emits `process.stderr.write` lines at startup when the wired embedder is `DeterministicStubEmbedder` AND the wired LLM is `StubLLM`, including a one-line link to the README section that explains how to wire `OpenAIEmbedder` or `LocalTransformerEmbedder`. Same warning fires from `run-mcp-server.ts` for parity. `themory health --deep` surfaces the same banner before printing per-check results.
- **Rationale:** Inquebrável Rule 3 (extreme honesty) at the consumer-facing boundary. Operators booting `ghcr.io/usetheo/themory:0.1.0-alpha` are entitled to know that recall is shape-correct but semantically a smoke test until they wire real providers. Loud warning is the lowest-friction disclosure that doesn't break the boot.
- **Alternatives considered:**
  - **B (Fail-fast: refuse to boot unless `THEMEMORY_ALLOW_STUB=true`):** rejected — too aggressive at P0 alpha; would break THE GOAL TEST and force every operator to opt-in just to see the wire round-trip. Deferred to a future cycle when real-provider wiring is the documented default.
  - **C (Single-shot warning at first verb call, not boot):** rejected — operators look at stdout/stderr during boot for sanity checks; deferring the warning to first call buries it under request logs.

### D5 — ADR D3 amendment for health auth-exempt extension

- **Decision:** Amend the SOURCE plan `theo-memory-standalone-p0-plan.md` (v1.3 → v1.4) to add an ADR D3 amendment block documenting that `GET /v1/health` + `GET /v1/health/db` are auth-exempt by design, mirroring the EC-19 pattern for `GET /v1/openapi.json`. Rationale: RFC 9110 § 5.1 + OWASP `/healthz` convention — orchestrator probes (Kubernetes readiness/liveness, ECS health checks, docker-compose `--wait`) do not carry credentials. Cross-link the regression tests `handlers.test.ts` 11a/11b that pin the invariant. CHANGELOG entry under `[Unreleased]` mirrors the rationale.
- **Rationale:** Cycle-implement anti-pattern #7 (silent scope creep) requires post-hoc ADR amendment for behavior shipped without prior plan declaration. The amendment converts the silent extension into a documented decision.
- **Alternatives considered:**
  - **B (New ADR D15 instead of amending D3):** rejected — D3 is the bearer middleware ADR; the auth-exemption list belongs in the same ADR for findability.
  - **C (Leave undocumented):** rejected — that's exactly the anti-pattern.

## Dependency Graph

```
Phase 1: CRITICAL absorption + refactor (parallelizable)
  ┌── T1.1 (F-rev-1) Remove skillRepoId from REST scope keys ──┐
  │                                                            │
  └── T1.2 (F-rev-12) Extract _body-parsing.ts helper ─────────┤
                                                               │
                                                               ▼
Phase 2: MAJOR absorptions (parallelizable)                ───────
  ├── T2.1 (F-rev-4) hono/body-limit middleware                  │
  ├── T2.2 (F-rev-9) Stub-embedder loud startup warning          │
  └── T2.3 (F-rev-3) ADR D3 amendment + CHANGELOG entry          │
                                                               ───
                                                                 │
                                                                 ▼
Phase 3 (FINAL): Integration validation + /review re-run
```

T1.1 and T1.2 are independent edits over `src/server/handlers/*` — both can run in parallel by the halt-loop. T2.1, T2.2, T2.3 are also independent. Phase 3 runs after all Phase 1+2 commits land.

---

## Phase 1: CRITICAL + SRP refactor

**Objective:** Close F-rev-1 (the CRITICAL gate) and F-rev-12 (the SRP refactor that simplifies subsequent handler edits).

### T1.1 — Remove `skillRepoId` from REST scope keys (F-rev-1 absorption)

#### Objective
Drop `'skillRepoId'` from `SCOPE_KEYS` + `ScopeFields` + `resolveScope` + `MemoryLike` in `src/server/schemas.ts`. Route `GET /v1/scopes/skill/:id/memories` to a deterministic 501 NOT_IMPLEMENTED response (preserves the SCOPE_TYPES case-sensitive enum at the path level per EC-13; replaces the broken dispatch). Update tests.

#### Evidence
- `src/server/schemas.ts:14` includes `'skillRepoId'` in `SCOPE_KEYS`; line 37 defines the `skillRepoId` zod field; line 108 routes to `memory.skills(body['skillRepoId'])`.
- `src/server/handlers/scopes.ts:49` casts `memory.skills(id) as unknown as ScopedMemory` then calls `getAll()` at line 113 — `getAll` does not exist on `ScopedSkillMemory` (`src/core/skill.ts:169-172` declares only `add`/`recall`/`consolidate`/`forget`).
- `src/server/handlers/{remember,recall,reflect}.ts:29/29/31` use `memory as unknown as MemoryLike` because the real `Memory` type does not match the locally-redeclared `MemoryLike` (which lies about `skills`).
- `src/server/__tests__/scopes.test.ts` test #12 (`12. skill type dispatches to memory.skills(repoId) per ADR-0010`) is the test that masks the production bug: the stub for `skills()` returns a `ScopedMemory`-shaped fake with `getAll`.
- `CLAUDE.md § ADR-0010`: "RepoScope for skill memory. Memory.skills(repoId) returns a ScopedSkillMemory... Exposed ONLY through Memory.skills(...) (not on the public 4 verbs)."

#### Files to edit
```
src/server/schemas.ts                          — drop skillRepoId from SCOPE_KEYS + ScopeFields + resolveScope; drop skills from MemoryLike; update error message
src/server/handlers/scopes.ts                  — handle 'skill' branch with 501 NOT_IMPLEMENTED before dispatch; remove the as unknown cast
src/server/handlers/remember.ts                — drop the `memory as unknown as MemoryLike` double-cast (now type-clean after MemoryLike fix)
src/server/handlers/recall.ts                  — same cast cleanup
src/server/handlers/reflect.ts                 — same cast cleanup
src/server/handlers/forget.ts                  — verify (likely already correct since forget is top-level Memory.forget)
src/server/openapi-registration.ts             — drop `skillRepoId` from body schemas (RememberBody etc. that this file references through zod imports)
src/server/__tests__/handlers.test.ts          — drop any skillRepoId tests if present (audit); add RED test that POST /v1/remember with skillRepoId returns 422 INVALID_SCOPE
src/server/__tests__/scopes.test.ts            — REWRITE test #12: skill type returns 501 NOT_IMPLEMENTED instead of dispatching to memory.skills
src/server/__tests__/openapi.test.ts           — verify spec no longer documents skillRepoId on remember/recall/reflect bodies
tests/integration/rest-api.test.ts             — verify (no skill-scope coverage today; no edit expected)
tests/integration/docker-stack.test.ts         — verify (THE GOAL TEST uses userId, no edit expected)
```

#### Deep file dependency analysis

- `src/server/schemas.ts` — the SoT for REST body shapes + `resolveScope` dispatch. After this task: `SCOPE_KEYS` = `['userId', 'sessionId', 'agentId']`; `ScopeFields` drops `skillRepoId` field; `resolveScope` drops the `skillRepoId` branch; `MemoryLike` drops the `skills` member (it was lying about contract); `superRefine` error message updates to list only 3 tiers. **Downstream**: every handler that imports `RememberBody`/`RecallBody`/`ReflectBody`/`ForgetBody`/`resolveScope` automatically benefits. The `MemoryLike` change is the key: dropping `skills` makes `Memory` (real type) structurally assignable to the trimmed `MemoryLike` shape, so the `as unknown as MemoryLike` cast in 3 handlers collapses to a plain assignment.
- `src/server/handlers/scopes.ts` — the path param validator already returns `c.notFound()` on unknown scope types. With this task, `'skill'` still parses (preserved in `SCOPE_TYPES` to honor T1.3 EC-13 case-sensitive enum) but the handler short-circuits with 501 BEFORE the dispatch to `memory.skills()`. **Downstream**: `src/server/__tests__/scopes.test.ts` test #12 rewritten.
- `src/server/handlers/{remember,recall,reflect}.ts` — drop `as unknown as MemoryLike` (now redundant). **Downstream**: F-arch-2 closed as side effect.
- `src/server/openapi-registration.ts` — the OpenAPI body schemas are auto-derived from `RememberBody` etc. via zod-openapi. Removing `skillRepoId` from those schemas drops it from the OpenAPI spec automatically. **Downstream**: `openapi.test.ts` test #1 (`SwaggerParser.validate`) still passes.

#### Deep Dives

- **Why keep `'skill'` in scope listing SCOPE_TYPES but return 501?** Removing `'skill'` from `SCOPE_TYPES` makes the route return 404 (per the case-sensitive enum). 404 is OK shape-wise but misleading semantically — the operator might think the route doesn't exist. 501 NOT_IMPLEMENTED is the honest HTTP status: "the route exists, the operation is not supported on this scope". Mirror of the `BiTemporalNotSupportedLocally → 501` mapper for `asOf` on skill scope (CLAUDE.md ADR-0011 plan v1.3 ADR D4 amendment).
- **Why 501 instead of extending `ScopedSkillMemory.getAll()`?** Extending the interface is a larger SDK contract change. Operators who need skill listing today can use the SDK `memory.skills(repoId)` directly + the `recall(query='')` workaround OR wait for a future cycle. Per Inquebrável Rule 11 (YAGNI), do not extend the SDK for REST-only need yet.
- **501 envelope shape**: `{ code: 'SKILL_LISTING_NOT_IMPLEMENTED', message: 'Skill scope listing is not exposed via REST at v0.1.0-alpha. Use the SDK `memory.skills(repoId).recall(...)` directly. See README § Skill scope.' }`. Honest, actionable, includes the SDK escape hatch.

#### Tasks
1. Edit `src/server/schemas.ts`: remove `'skillRepoId'` from `SCOPE_KEYS`; remove `skillRepoId: z.string().min(1).optional()` from `ScopeFields`; remove the `if (typeof body['skillRepoId'] === 'string')` branch from `resolveScope`; remove `skills: ...` from `MemoryLike` interface; update `superRefine` error message.
2. Edit `src/server/handlers/scopes.ts`: short-circuit `'skill'` branch with `return c.json({ code: 'SKILL_LISTING_NOT_IMPLEMENTED', message: '...' }, 501);` BEFORE `pathParamsToScoped`. Remove the broken `case 'skill':` from `pathParamsToScoped` switch (or assert never).
3. Edit `src/server/handlers/{remember,recall,reflect}.ts`: drop `as unknown as MemoryLike` casts (the real `Memory` type is now structurally compatible with the trimmed `MemoryLike`).
4. Verify `src/server/openapi-registration.ts`: zod-openapi auto-derives — confirm RememberBody schema (used at line 53) no longer carries `skillRepoId` in the resolved OpenAPI spec.
5. Rewrite `src/server/__tests__/scopes.test.ts` test #12 to assert 501 NOT_IMPLEMENTED response with `code: 'SKILL_LISTING_NOT_IMPLEMENTED'`.
6. Add RED test in `src/server/__tests__/handlers.test.ts`: `POST /v1/remember` with `{ skillRepoId: 'r' }` returns 422 INVALID_SCOPE (the SCOPE_KEYS array no longer recognizes the field; superRefine counts 0 tiers present → 422).
7. Run `npm test` + `npm run typecheck` + `npm run lint` to confirm green.

#### TDD
```
RED:     test('POST /v1/remember with skillRepoId in body returns 422 (zod .strict() unrecognized_keys path)') (NEW handlers.test.ts assertion — proves the scope key is rejected at the SCHEMA layer, not the superRefine layer)
         — assert res.status === 422 AND body code is VALIDATION_ERROR (or whatever scopeOrValidationError surfaces for non-INVALID_SCOPE issues — see EC-2 absorption note below)
RED:     test('POST /v1/remember with ONLY skillRepoId (no userId/sessionId/agentId) returns 422 — same code path, double-confirmation')
RED:     test('GET /v1/scopes/skill/repo-x/memories returns 501 SKILL_LISTING_NOT_IMPLEMENTED') (REWRITE of scopes.test.ts test #12)
RED:     test('scopesHandler short-circuits skill BEFORE calling memory.skills') (EC-4 — vi.spyOn(memory,'skills').mockImplementation throw 'should not be called'; assert 501 returned without spy firing)
RED:     test('OpenAPI spec drops skillRepoId from remember/recall/reflect/forget request bodies') (EC-5 — walk paths['/v1/remember'].post.requestBody.content['application/json'].schema.properties; assert skillRepoId absent on all 4 verbs)
RED:     test('GET /v1/scopes/user/alice/memories still returns 200 with items') (regression guard — no collateral damage on supported tiers)
GREEN:   apply T1.1 tasks 1-4
REFACTOR: drop `as unknown as MemoryLike` from 3 handlers (lands in GREEN — the type collapses to identity once MemoryLike loses the false `skills` field)
VERIFY:  npm test -- src/server/__tests__/handlers.test.ts src/server/__tests__/scopes.test.ts src/server/__tests__/openapi.test.ts
```

**EC-2 MUST FIX absorption note:** `RememberBody` is defined with `.strict().superRefine(...)`. When a request includes `{userId:'a', skillRepoId:'r', text:'x'}`, zod's `.strict()` rejects on `skillRepoId` as an unknown key (`ZodIssueCode.unrecognized_keys`) BEFORE `superRefine` counts tier presence. The existing `scopeOrValidationError` helper at `remember.ts:47-50` only branches on `i.message.startsWith('INVALID_SCOPE')` — unknown-key issues fall through to the generic `VALIDATION_ERROR` branch returning 422 with a path-aware field. The RED test 1 assertion is therefore "status 422 + body code is NOT 'INTERNAL_ERROR'" (any of `VALIDATION_ERROR` / `INVALID_BODY` is acceptable since the body shape is rejected at the schema layer, not the scope layer). Implementer MUST verify against the actual `scopeOrValidationError` return shape — pinning `code === 'INVALID_SCOPE'` would FAIL because that code only fires when `superRefine` runs (and `superRefine` runs only if `.strict()` passes).

**EC-4 absorption note:** the scopes-skill short-circuit test uses `vi.spyOn(memory, 'skills').mockImplementation(() => { throw new Error('should not be called'); })`. If the implementation order is wrong (memory.skills called before the 501 branch), the spy fires and the test fails with the thrown error. This pins the load-bearing branch ordering in `scopesHandler` so a future refactor can't silently relocate the dispatch above the short-circuit.

**EC-5 absorption note:** OpenAPI spec validation walks `paths['/v1/{verb}'].post.requestBody.content['application/json'].schema.properties` for the 4 verbs (remember, recall, reflect, forget) and asserts `'skillRepoId' in properties === false`. Existing `openapi.test.ts` test #1 only validates well-formedness via `SwaggerParser.validate`; this test adds field-membership validation specifically for the removal.

#### Acceptance Criteria
- [ ] `grep -n "skillRepoId" src/server/` returns ZERO hits
- [ ] `grep -n "as unknown as MemoryLike" src/server/handlers/` returns ZERO hits
- [ ] `src/server/__tests__/scopes.test.ts` test #12 asserts 501 + `SKILL_LISTING_NOT_IMPLEMENTED`
- [ ] New `handlers.test.ts` test asserts `POST /v1/remember` with `skillRepoId` returns 422 (any 4xx body-validation code per EC-2 absorption note — NOT pinning `INVALID_SCOPE`)
- [ ] EC-4 absorption: `scopesHandler` skill short-circuit test confirms `memory.skills` is NEVER called (vi.spyOn throws if invoked)
- [ ] EC-5 absorption: OpenAPI field-membership test confirms `skillRepoId` absent from all 4 verb request bodies
- [ ] `npm test` passes (all 943+ tests + new ones)
- [ ] `npm run typecheck` PASS — drop of `as unknown as MemoryLike` doesn't surface new errors
- [ ] `npm run lint` PASS — zero warnings
- [ ] OpenAPI spec at `GET /v1/openapi.json` no longer documents `skillRepoId` (verify via the new EC-5 field-membership test)
- [ ] File size: `src/server/schemas.ts` ≤ 200 LoC (currently ~125, decreases)
- [ ] CHANGELOG entry under `[Unreleased] ### Fixed` documenting the CRITICAL absorption with `Fixes /review F-rev-1` reference

#### DoD
- [ ] Commit message: `fix(server): T1.1 F-rev-1 remove skillRepoId from REST scope keys (CRITICAL)`
- [ ] Branch: `develop` (no feature branch — same branch as the 18 task commits)
- [ ] All tests passing locally + lint + typecheck

### T1.2 — Extract `_body-parsing.ts` shared helper (F-rev-12 absorption)

#### Objective
Move `safeJson`, `EMPTY_BODY`, `MALFORMED_BODY`, `scopeOrValidationError` from `src/server/handlers/remember.ts` to a new `src/server/handlers/_body-parsing.ts` module. Update `recall.ts`, `forget.ts`, `reflect.ts` (and `remember.ts` self) to import from the new helper.

#### Evidence
- Wiring F-wire-6 INFO: `remember.ts:63` re-exports `safeJson`/`scopeOrValidationError`/`EMPTY_BODY`/`MALFORMED_BODY` for sibling handlers — functional reuse but SRP smell; remember.ts is the de facto handlers helper module.
- Architecture F-arch-3 MAJOR + api-design F-dom-api-6 MINOR + wiring F-wire-6 INFO + memory-layer (independent) — four independent reviewers flagged this.

#### Files to edit
```
src/server/handlers/_body-parsing.ts          (NEW) — exports safeJson, EMPTY_BODY, MALFORMED_BODY, scopeOrValidationError
src/server/handlers/remember.ts               — drop the in-file definitions + drop the re-export lines; import from _body-parsing.ts
src/server/handlers/recall.ts                 — update import path
src/server/handlers/forget.ts                 — update import path
src/server/handlers/reflect.ts                — update import path
```

#### Deep file dependency analysis

- `src/server/handlers/_body-parsing.ts` (NEW) — pure module exporting 4 names; ≤ 60 LoC; no Hono context dependency in the symbol type signatures.
- `src/server/handlers/remember.ts` — loses ~30 LoC (the function bodies and the `export` lines); is now ≤ 60 LoC and concerned ONLY with `POST /v1/remember`.
- `src/server/handlers/{recall,forget,reflect}.ts` — single import-line change; no logic change.

#### Deep Dives

- **Why prefix with underscore (`_body-parsing.ts`)?** Signals module-internal helper not part of the public handler routing surface. Hono auto-discovers nothing here — Hono routes are mounted explicitly in `app.ts` — so the prefix is informational, not load-bearing.
- **Why NOT move into `src/server/schemas.ts`?** Per ADR D2 Rationale.

#### Tasks
1. **EC-3 pre-flight sweep:** run `grep -rn "from.*'\\./remember\\.js'" src/server/__tests__ tests/` AND `grep -rn "{[^}]*safeJson\\|EMPTY_BODY\\|MALFORMED_BODY\\|scopeOrValidationError[^}]*}" src/server/__tests__ tests/` BEFORE editing. Catalog every file that imports the 4 symbols from `./remember.js` (currently: `recall.ts`, `forget.ts`, `reflect.ts`; verify NO test file imports them directly — if any does, that file is in scope for this commit).
2. Create `src/server/handlers/_body-parsing.ts` with the 4 exports (cut from `remember.ts`).
3. Update `remember.ts`: remove the function bodies + their `export` keywords; import the 4 names from `./_body-parsing.js`.
4. Update `recall.ts`, `forget.ts`, `reflect.ts` AND any test files surfaced by Task 1: change `import { ... } from './remember.js'` to `import { ... } from './_body-parsing.js'`.
5. Verify zero behavior change: re-run `npm test`. All 14 T1.2 tests + 12 T1.3 tests + 6 T1.6 tests + new T1.1 tests still pass.

#### TDD
```
RED:     None new — the existing 32+ handler tests in handlers.test.ts cover the contract. Refactor must keep them green.
         EC-3 pre-flight sweep (Task 1) IS the test that the import surface is fully catalogued before edits begin.
GREEN:   apply T1.2 tasks 2-4
REFACTOR: None expected
VERIFY:  npm test -- src/server/__tests__/handlers.test.ts src/server/__tests__/errors.test.ts
         grep -rn "from.*'\\./remember\\.js'" src/server/handlers/ src/server/__tests__ tests/  → returns ZERO hits (every consumer updated)
```

#### Acceptance Criteria
- [ ] `src/server/handlers/_body-parsing.ts` exists, ≤ 60 LoC
- [ ] `src/server/handlers/remember.ts` ≤ 60 LoC + no longer exports `safeJson`/`scopeOrValidationError`/`EMPTY_BODY`/`MALFORMED_BODY`
- [ ] EC-3 absorption: `grep -rn "from.*'\\./remember\\.js'" src/server/handlers/ src/server/__tests__ tests/` returns ZERO hits (every consumer — handlers AND test files — updated to import from `./_body-parsing.js`)
- [ ] All existing handler/errors tests pass GREEN unchanged
- [ ] `npm test` + `npm run typecheck` + `npm run lint` all GREEN

#### DoD
- [ ] Commit message: `refactor(server): T1.2 F-rev-12 extract _body-parsing.ts (SRP)`

---

## Phase 2: MAJOR absorptions

### T2.1 — `hono/body-limit` middleware on `/v1/*` with 1 MB cap (F-rev-4 absorption)

#### Objective
Mount `bodyLimit({ maxSize: 1_000_000 })` from `hono/body-limit` on `/v1/*` AFTER the OTel + bearer middlewares (so 413 is observable in spans AND bearer is verified first — wait, actually bearer should run AFTER body-limit so we don't reveal auth status for over-sized unauthenticated probes; CONFIRM in deep dive). Add a RED test asserting 413 fires on oversized body.

#### Evidence
- api-design F-dom-api-4 MAJOR: `ContentTooLargeError → 413` mapper exists at `src/server/errors.ts` but NOTHING in the server triggers it. `safeJson()` reads `c.req.text()` unbounded. Real DOS surface.

#### Files to edit
```
src/server/app.ts                              — import bodyLimit from 'hono/body-limit'; mount on /v1/* after otelMiddleware, before bearerAuth
src/server/__tests__/handlers.test.ts          — RED test asserting POST /v1/remember with 2MB body returns 413
```

#### Deep file dependency analysis

- `src/server/app.ts` — middleware order is load-bearing (per T1.5 OTel + T1.1 bearer comment). Adding `bodyLimit` between OTel and bearer means: every request gets a span (OTel observes 413), oversize body is rejected BEFORE bearer is consulted (we don't reveal whether the token is valid for a body that's too large — minor information-leak defense), bearer runs only on requests with body ≤ 1MB.
- Hono's `bodyLimit` middleware (`hono/body-limit`) writes the 413 response itself (does NOT throw); we do NOT need to wire `ContentTooLargeError` through `app.onError` for the body-limit path. The `ContentTooLargeError` mapper remains for hypothetical future SDK-side throws (e.g., embedding API rejects oversize text); honest reuse, not dead code.

#### Deep Dives

- **Why `1_000_000` (1 MB)?** Typical fact text is < 4 KB; an `infer:false` caller with pre-extracted facts might ship a few KB array. 1 MB is generous + standard for JSON APIs (Express default is 100 KB; we're more permissive). Operators with legitimate large-body needs (bulk import) get a 413 + the README documents how to override (deferred to a future `--body-limit` flag).
- **Middleware order (CONFIRMED in deep dive — not deferred):** mount order `OTel → bodyLimit → bearer → handlers`. Rationale: (a) OTel captures all 413s for ops visibility; (b) bodyLimit rejects oversized payloads before any further processing (DOS guard); (c) bearer verifies auth after the payload passed size gate (no token leak on oversize unauth requests); (d) handlers run last. Tested by the RED test asserting 413 with NO bearer header still fires (or 401-then-413 acceptable depending on hono internals; deep test will confirm exact order).

#### Tasks
1. Edit `src/server/app.ts`: import `bodyLimit` from `'hono/body-limit'` AND wire `onError` per ADR D3 verbatim block above. Mount on `/v1/*` BETWEEN `otelMiddleware` and `bearerAuth`.
2. Add RED test in `handlers.test.ts`: `POST /v1/remember` with a JSON body of size 2 MB (e.g., `text: 'a'.repeat(2_000_000)`) returns **413** with **`Content-Type: application/json`** AND body **`{code: 'CONTENT_TOO_LARGE', message: ...}`** (the structured envelope — EC-1 MUST FIX absorbed; confirms the `onError` path constructs the envelope).
3. Add EC-7 RED test: `POST /v1/remember` with NO Authorization header AND a 2MB body, when `THEMEMORY_API_KEY` is set, returns **413** (NOT 401). Pins the load-bearing middleware order `OTel → bodyLimit → bearer`.
4. EC-9 DOCUMENT: add a one-line note to README under "REST API server" section: `**Body limit:** 1 MB on `/v1/*` POST endpoints. Compressed request bodies (`Content-Encoding: gzip`) are NOT auto-decompressed by Hono — operators serving large compressed payloads should enforce body limits at the reverse-proxy layer (nginx `client_max_body_size`, Caddy `request_body max_size`).`
5. Confirm the existing tests still pass — small bodies (< 1MB) are unaffected.

#### TDD
```
RED:     test('POST /v1/remember with 2MB body returns 413 with structured {code:CONTENT_TOO_LARGE,...} envelope') (NEW handlers.test.ts assertion — EC-1 MUST FIX)
RED:     test('bodyLimit fires BEFORE bearer: 2MB body + no Authorization + THEMEMORY_API_KEY set → 413 (NOT 401)') (NEW handlers.test.ts — EC-7 SHOULD TEST)
GREEN:   apply T2.1 tasks 1-4
REFACTOR: None expected
VERIFY:  npm test -- src/server/__tests__/handlers.test.ts
```

#### Acceptance Criteria
- [ ] `app.ts` imports `bodyLimit` from `'hono/body-limit'` AND wires the `onError` callback that constructs the `ContentTooLargeError` envelope via `mapDomainErrorToResponse` (per ADR D3 verbatim block)
- [ ] `app.use('/v1/*', bodyLimit(...))` mounts BETWEEN `otelMiddleware` and `bearerAuth` (verify by grep of `app.ts`)
- [ ] EC-1 RED test asserts 413 body matches `{code: 'CONTENT_TOO_LARGE', message: string}` (structured envelope shape from T1.6)
- [ ] EC-7 RED test asserts middleware order: 2MB body without bearer (when key set) returns 413, NOT 401
- [ ] EC-9 DOCUMENT: README "REST API server" section gains the gzip + reverse-proxy note
- [ ] Existing 32+ handler tests still PASS (smaller bodies are unaffected)
- [ ] `npm test` + `npm run typecheck` + `npm run lint` all GREEN
- [ ] CHANGELOG `[Unreleased] ### Added` entry: 413 DOS guard via `hono/body-limit` 1 MB cap with structured envelope

#### DoD
- [ ] Commit message: `feat(server): T2.1 F-rev-4 mount hono/body-limit 1MB cap (structured 413 envelope + EC-1/EC-7)`

### T2.2 — Stub-embedder loud startup warning (F-rev-9 absorption)

#### Objective
`themory server` writes `process.stderr.write` warning lines at startup when it wires `DeterministicStubEmbedder` + `StubLLM` (the default). `themory mcp` mirrors the warning. README adds a section linking from the warning to consumer wiring guidance.

#### Evidence
- architecture F-arch-5 MAJOR: consumers of `ghcr.io/usetheo/themory:0.1.0-alpha` have no runtime signal that recall produces coincidental cosine-1.0 hits.

#### Files to edit
```
src/agent-tools/run-server.ts                  — emit warning lines after factory init (before serve() listens)
src/agent-tools/run-mcp-server.ts              — emit equivalent warning for mcp transport
src/agent-tools/__tests__/run-server.test.ts   — RED test asserting startup stderr contains "STUB EMBEDDER ACTIVE" tokens
src/agent-tools/__tests__/cli.test.ts          — verify the existing 11 cli + 4 T2.2 tests don't regress; no edit expected
README.md                                      — add "Stub providers (alpha default)" sub-section under "REST API server"
CHANGELOG.md                                   — [Unreleased] ### Added entry for the warning
```

#### Deep file dependency analysis

- `run-server.ts` — emit warning after `createLocalMemory({ embedder: new DeterministicStubEmbedder(), llm: new StubLLM() })` resolves, before `serve()`. Warning is unconditional in this code path because the embedder is always `DeterministicStubEmbedder` in this default composition (no consumer override path exists yet — future cycle adds `--embedder openai|local` flag).
- `run-server.test.ts` — existing 8 tests use mocked `createLocalMemory`. Add a new test that confirms the warning lines are written to stderr (via `vi.spyOn(process.stderr, 'write')`).

#### Deep Dives

- **Warning text format**:
  ```
  themory server: WARNING — Stub embedder + Stub LLM in use (DeterministicStubEmbedder + StubLLM).
  themory server: Recall returns shape-correct results but is NOT semantic — only exact-text round-trips work reliably.
  themory server: For production, wire OpenAIEmbedder or LocalTransformerEmbedder. See README § Wiring real providers.
  ```
- **Why three lines?** Each line is intentionally < 80 chars so it survives narrow terminals + log aggregators. Line 1 is the headline; line 2 is the operational impact; line 3 is the call-to-action.

#### Tasks
1. Edit `run-server.ts`: after factory resolves, emit the 3-line warning to `process.stderr`. **EC-8 absorption:** add a `// FOLLOW-UP: gate this warning when src/agent-tools/run-server.ts gains real-provider config (e.g., THEMORY_EMBEDDER=openai|local env or --embedder flag). Currently unconditional because the default code path always uses DeterministicStubEmbedder.` comment near the emit site.
2. Edit `run-mcp-server.ts`: same warning + same EC-8 follow-up comment before transport connects.
3. Add RED test in `run-server.test.ts` asserting stderr contains "STUB EMBEDDER ACTIVE" or equivalent token (case-insensitive match on "stub embedder" suffices).
4. **EC-6 absorption:** mock `process.stderr.write` in the EXISTING 8 `run-server.test.ts` tests via `vi.spyOn(process.stderr, 'write').mockImplementation(() => true)` in a top-level `beforeEach` (right after the existing `vi.stubEnv` setup). The dedicated EC-6/T2.2 RED test (the one asserting the warning fires) checks `spy.mock.calls.flat().some(c => /stub embedder/i.test(String(c)))` against the same captured spy — it does NOT need `mockRestore`. Outcome: vitest log output stays clean across the 8 existing tests; the new test still asserts the warning honestly via the spy's call record.
5. Edit `README.md`: add "Stub providers (alpha default)" under "REST API server" section linking from the warning text.
6. Edit `CHANGELOG.md`: `[Unreleased] ### Added` — stub-embedder loud-warn discipline.

#### TDD
```
RED:     test('runServer writes stub-embedder warning to stderr on startup (case-insensitive "stub embedder" match in captured spy calls)') (NEW run-server.test.ts)
RED:     None new for EC-6 — the EC-6 absorption is INFRASTRUCTURE (beforeEach spy) shared by ALL run-server.test.ts tests. The 8 existing tests continue passing; the new test reads from the same spy.
GREEN:   apply T2.2 tasks 1-5
REFACTOR: None
VERIFY:  npm test -- src/agent-tools/__tests__/run-server.test.ts
         # Confirm test output is clean (no warning lines leaking to stderr during the 8 existing tests).
```

#### Acceptance Criteria
- [ ] `run-server.ts` emits stderr warning containing "Stub embedder" (case-insensitive) at startup
- [ ] `run-mcp-server.ts` emits same warning
- [ ] **EC-8 absorption:** both files carry the `// FOLLOW-UP: gate this warning when...` comment near the emit site
- [ ] **EC-6 absorption:** `run-server.test.ts` `beforeEach` mocks `process.stderr.write`; existing 8 tests still PASS; new EC-6/T2.2 test asserts the warning via the spy's call record (no stderr leak in CI log output)
- [ ] RED test asserts the warning fires
- [ ] README has "Stub providers (alpha default)" sub-section
- [ ] CHANGELOG entry added
- [ ] `npm test` + `npm run typecheck` + `npm run lint` GREEN

#### DoD
- [ ] Commit message: `feat(cli): T2.2 F-rev-9 stub-embedder loud startup warning (EC-6/EC-8 absorbed)`

### T2.3 — ADR D3 amendment + CHANGELOG entry for health auth-exempt (F-rev-3 absorption)

#### Objective
Amend the SOURCE plan `.claude/knowledge-base/plans/theo-memory-standalone-p0-plan.md` (v1.3 → v1.4) to add an ADR D3 amendment block documenting the health-endpoint auth-exempt extension as RFC-9110 / OWASP-conformant. Add a CHANGELOG entry mirroring the rationale.

#### Evidence
- cross-validation F-xval-2 MAJOR: T3.5 commit `fc4ec5c` extended the EC-19 OpenAPI auth-exempt pattern to `/v1/health` + `/v1/health/db` WITHOUT amending ADR D3.

#### Files to edit
```
.claude/knowledge-base/plans/theo-memory-standalone-p0-plan.md   — bump v1.3 → v1.4; add ADR D3 amendment block (one paragraph)
CHANGELOG.md                                                      — [Unreleased] ### Changed entry citing RFC 9110 + OWASP rationale
```

**NOTE: This is a documentation-only task with NO code changes and NO new tests.** Per cycle-implement § Quality rules, documentation tasks can ship without TDD if they are pure ADR/CHANGELOG additions (Inquebrável Rule 5 — TDD applies to code). The regression tests already exist (`handlers.test.ts` 11a/11b pinning the invariant).

#### Deep file dependency analysis

- `theo-memory-standalone-p0-plan.md` — adding a v1.4 header at the top + an ADR D3 amendment block. Plan version is "frozen at v1.3 / f94c3007" per the review report; bumping to v1.4 for this amendment is appropriate (the amendment was shipped in code but undocumented in plan — this task closes the doc gap). Cross-validation reviewer flagged this as "scope creep documented post-hoc" — the amendment converts it to "scope creep absorbed via ADR".
- `CHANGELOG.md` — `[Unreleased] ### Changed` entry referencing F-rev-3 + the regression tests that pin the invariant.

#### Deep Dives

- **ADR D3 amendment text** (verbatim addition to the plan ADR D3 block):
  > **Amendment 2026-06-03 (v1.4 — closes F-rev-3 from `/review theo-memory-standalone-p0` 2026-06-03):** the bearer middleware mounted on `/v1/*` EXEMPTS `GET /v1/health` + `GET /v1/health/db` by mounting them BEFORE the bearer middleware (mirroring the EC-19 pattern for `GET /v1/openapi.json`). Rationale: RFC 9110 § 5.1 + OWASP `/healthz` convention — orchestrator probes (Kubernetes readiness/liveness, ECS health checks, docker-compose `--wait`) do NOT carry credentials. Without this exemption, the docker-compose healthcheck round-trip in T3.5 GOAL TEST cannot complete (orchestrator gets 401 → container marked unhealthy → `--wait` times out). Regression pinned by `src/server/__tests__/handlers.test.ts` 11a + 11b asserting 200/503 (NOT 401) when `THEMEMORY_API_KEY` is set.
- **Why bump plan version (v1.3 → v1.4)?** Per cycle-plan.md, plan amendments after `/implement` ships require an explicit version bump to make the post-hoc absorption visible in the audit trail.

#### Tasks
1. Edit `theo-memory-standalone-p0-plan.md`: bump version header to v1.4; add ADR D3 amendment block (text above).
2. Edit `CHANGELOG.md`: `[Unreleased] ### Changed` — "Bearer middleware now exempts `GET /v1/health` + `GET /v1/health/db` per ADR D3 amendment (RFC 9110 + OWASP `/healthz` convention). Closes `/review` F-rev-3."

#### TDD
```
RED:     None — regression already pinned by handlers.test.ts 11a + 11b (shipped with fc4ec5c).
GREEN:   apply T2.3 tasks 1-2
REFACTOR: None
VERIFY:  grep -n "Amendment 2026-06-03" .claude/knowledge-base/plans/theo-memory-standalone-p0-plan.md  → returns 1 line
```

#### Acceptance Criteria
- [ ] Plan v1.4 header added with amendment summary
- [ ] ADR D3 amendment block matches the verbatim text above
- [ ] CHANGELOG `[Unreleased] ### Changed` entry added
- [ ] No code changes (this task is documentation-only)

#### DoD
- [ ] Commit message: `docs(plan): T2.3 F-rev-3 plan v1.4 — ADR D3 amendment (health auth-exempt RFC 9110)`

---

## Phase 3: Final Integration Validation (MANDATORY)

### T3.1 — Re-run `/review theo-memory-standalone-p0` (the gate)

#### Objective
Re-invoke `/review theo-memory-standalone-p0` against the SAME diff base (`f94c3007^`) AFTER Phase 1+2 commits land. The /review skill spawns the 8 specialized agents in parallel, consolidates findings, runs deterministic gates. Target verdict: **READY_TO_MERGE_WITH_CAVEATS** or **READY_TO_MERGE** (the F-rev-1 CRITICAL must be gone; remaining MAJORs are accepted-with-caveats or pre-existing-debt).

#### Evidence
- The 0-BLOCKER + 0-CRITICAL gate is the THE GOAL TEST of this entire fix-up plan. Without it, the fix-up didn't fix.

#### Files to edit
None. This task INVOKES the `/review` skill which spawns its own agents and writes its own report at `.claude/knowledge-base/reviews/theo-memory-standalone-p0-review-{date2}.md`.

#### Tasks
1. Verify Phase 1+2 commits are all on `develop` with green local gates (`npm test` + `npm run typecheck` + `npm run lint`).
2. Invoke `/review theo-memory-standalone-p0`. Wait for the 8 agents to complete in parallel.
3. Read the consolidated report. Verify: **0 BLOCKER + 0 CRITICAL**. MAJORs ≤ pre-fix count (some absorbed F-rev-1/3/4/9/12; the residual MAJORs F-rev-2/5/6/7/8/10/11/13/14 are accepted with caveats per PR description).
4. If `/review` still surfaces BLOCKER/CRITICAL: loop back to `/implement` with a Phase 4 sub-plan addressing them.
5. If verdict is **READY_TO_MERGE_WITH_CAVEATS** or **READY_TO_MERGE**: the fix-up plan is DONE. Open PR `develop → main` with the consolidated cycle summary.

#### TDD
```
RED:     None — the /review skill IS the test.
GREEN:   /review returns 0 BLOCKER + 0 CRITICAL
VERIFY:  cat .claude/knowledge-base/reviews/theo-memory-standalone-p0-review-{date2}.md | grep -E "BLOCKER:|CRITICAL:"
```

#### Acceptance Criteria
- [ ] `/review theo-memory-standalone-p0` re-run returns 0 BLOCKER + 0 CRITICAL
- [ ] Consolidated report exists at `.claude/knowledge-base/reviews/theo-memory-standalone-p0-review-{date2}.md`
- [ ] All MAJOR findings absorbed by this plan (F-rev-1/3/4/9/12) are NOT present in the re-review report
- [ ] Verdict: `READY_TO_MERGE_WITH_CAVEATS` or `READY_TO_MERGE`

#### DoD
- [ ] PR draft `develop → main` includes the consolidated /review + this fix-up plan link
- [ ] Plan archived per Global DoD checkbox below (move to `plans/completed/` AFTER PR merge)

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | F-rev-1 CRITICAL — skill-scope contract divergence (4 verbs accept `skillRepoId` but `ScopedSkillMemory` shape incompatible) | T1.1 | Remove `skillRepoId` from `SCOPE_KEYS`/`ScopeFields`/`resolveScope`/`MemoryLike`; return 501 for `GET /v1/scopes/skill/:id/memories`; rewrite test #12; new RED test for 422 on remember with skillRepoId |
| 2 | F-rev-12 MAJOR — `remember.ts` exports shared body-parsing utilities (SRP violation) | T1.2 | Extract `src/server/handlers/_body-parsing.ts` exporting 4 names; update 4 handler imports |
| 3 | F-rev-4 MAJOR — `ContentTooLargeError` mapper unenforced — DOS surface | T2.1 | Mount `hono/body-limit` 1 MB cap on `/v1/*` between OTel and bearer; RED test asserting 413 on 2 MB body |
| 4 | F-rev-9 MAJOR — stub-embedder silent default (consumer honesty gap) | T2.2 | `themory server` + `themory mcp` emit loud stderr warning on startup; README + CHANGELOG document the gap |
| 5 | F-rev-3 MAJOR — health auth-exempt shipped without ADR D3 amendment | T2.3 | Plan v1.3 → v1.4 with ADR D3 amendment block (RFC 9110 + OWASP); CHANGELOG entry |
| 6 | Final gate — re-run `/review` returns 0 BLOCKER + 0 CRITICAL | T3.1 | The cycle-review gate IS the test for the fix-up plan |
| 7 | **EC-1 MUST FIX** — T2.1 ADR D3 vs Sub-goal 4 contradiction on 413 envelope shape | T2.1 | ADR D3 v1.1 specifies verbatim `onError` callback constructing `ContentTooLargeError` envelope via `mapDomainErrorToResponse`; RED test asserts `{code:'CONTENT_TOO_LARGE',...}` body shape |
| 8 | **EC-2 MUST FIX** — T1.1 RED test 1 assertion mismatch (`INVALID_SCOPE` vs actual zod `.strict()` `VALIDATION_ERROR`) | T1.1 | Test assertion updated: 422 + body code is NOT `INTERNAL_ERROR`; absorption note explains zod `.strict()` runs BEFORE `superRefine` |
| 9 | **EC-3 SHOULD TEST** — T1.2 cross-file import sweep before refactor (catch test-file imports of moved symbols) | T1.2 | Pre-flight Task 1 catalogs every importer via grep; acceptance criterion verifies grep returns ZERO post-refactor |
| 10 | **EC-4 SHOULD TEST** — `scopesHandler` skill short-circuit verification | T1.1 | RED test uses `vi.spyOn(memory,'skills').mockImplementation throw`; asserts 501 returned without spy firing |
| 11 | **EC-5 SHOULD TEST** — OpenAPI re-validation post-`skillRepoId`-removal (field-membership) | T1.1 | RED test walks `paths['/v1/{verb}'].post.requestBody.content['application/json'].schema.properties`; asserts `skillRepoId` absent on all 4 verbs |
| 12 | **EC-6 SHOULD TEST** — T2.2 stderr noise mitigation in existing 8 tests | T2.2 | `beforeEach` `vi.spyOn(process.stderr, 'write')` shared infra; dedicated test asserts warning via captured spy calls |
| 13 | **EC-7 SHOULD TEST** — T2.1 middleware order regression (bodyLimit BEFORE bearer) | T2.1 | RED test: 2MB body + no Authorization + key set → 413 (NOT 401); pins load-bearing OTel→bodyLimit→bearer order |
| 14 | **EC-8 DOCUMENT** — T2.2 future conditional-warning gating when real-provider config lands | T2.2 | Inline `// FOLLOW-UP: gate this warning when...` comment near emit site in both run-server.ts + run-mcp-server.ts |
| 15 | **EC-9 DOCUMENT** — T2.1 gzip-compressed body bypasses size limit at P0 alpha | T2.1 | README "REST API server" gains note: Hono does NOT auto-decompress; recommend reverse-proxy enforcement (nginx `client_max_body_size`, Caddy `request_body max_size`) |

**Coverage: 15/15 gaps covered (100%)** — 6 original (review findings) + 9 absorbed (edge-case-plan).

## Global Definition of Done

- [ ] All 3 phases completed (Phase 1: T1.1 + T1.2; Phase 2: T2.1 + T2.2 + T2.3; Phase 3: T3.1)
- [ ] All tests passing — `npm test` GREEN (current 943 + ~4 new RED tests from this plan)
- [ ] Zero TypeScript errors — `npm run typecheck` GREEN
- [ ] Zero lint warnings — `npm run lint` GREEN
- [ ] File-size budget respected per `architecture.md § Module hygiene` (every changed file ≤ 500 LoC; `schemas.ts` decreases; new `_body-parsing.ts` ≤ 60 LoC)
- [ ] CHANGELOG.md updated under `[Unreleased]` (Inquebrável Rule 6) — at least 3 new entries (T1.1 ### Fixed, T2.1 ### Added, T2.2 ### Added, T2.3 ### Changed)
- [ ] Backward compatibility preserved across public API: `src/server/index.ts` exports unchanged; the only public-surface change is the REST `skillRepoId` removal which is correctly rejected with 422 (consumers who naively passed it get a clear error instead of silent 500)
- [ ] `/review theo-memory-standalone-p0` re-run returns 0 BLOCKER + 0 CRITICAL (the THE GOAL METRIC for THIS fix-up plan)
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE_WITH_CAVEATS` or `READY_TO_MERGE` AND the `develop → main` PR has been merged, move `.claude/knowledge-base/plans/theo-memory-standalone-p0-fixes-cycle-1-plan.md` to `.claude/knowledge-base/plans/completed/`. Associated artifacts (review reports, agent definitions) stay in their original locations per `audit-trail-rotation.md`.

## Final Phase: Integration Validation (MANDATORY)

> This phase IS T3.1. The `/review theo-memory-standalone-p0` re-run is the integration validation gate.

### Execution

```bash
# Pre-flight (local)
npm test                        # 943+ unit + integration tests
npm run typecheck               # zero TS errors
npm run lint                    # zero lint warnings
DOCKER_INTEGRATION=true npm run test:integration -- docker-stack.test.ts  # THE GOAL TEST 6/6 PASS

# The gate
/review theo-memory-standalone-p0
```

### Acceptance Criteria

- [ ] All test suites GREEN (943+ contract + integration + THE GOAL TEST 6/6)
- [ ] Coverage no-regression on changed files (T1.1 schemas.ts, scopes.ts, handlers/*.ts; T1.2 new _body-parsing.ts + 4 handlers; T2.1 app.ts + handlers.test.ts; T2.2 run-server.ts + run-server.test.ts)
- [ ] Zero TypeScript errors
- [ ] Zero lint warnings
- [ ] `/review` re-run: 0 BLOCKER + 0 CRITICAL (the THE GOAL METRIC)

### If Validation Fails

1. Identify which failures are caused by this fix-up plan's changes vs pre-existing (the cross-validation reviewer's task-vs-commit table in the previous review report is the baseline)
2. Fix all plan-caused failures before declaring the plan complete
3. Re-run `/review` to confirm fixes
4. If `/review` STILL surfaces BLOCKER/CRITICAL after 2 absorption iterations: HALT and surface to user per cycle-implement Stop Condition #4 (plan defect)

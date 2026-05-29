# Discovery Plan: v0.2 — TheoKit binding (`@usetheo/memory/theokit`)

> **Version 1.0** — Investigation to inform the v0.2 implementation plan for the `@usetheo/memory/theokit` subpath: auto-resolves `user_id` / `session_id` / `agent_id` from TheoKit request context so handlers call `memory.remember(text)` without explicit scoping, and ships default-on in scaffolded TheoKit apps via `create-theo` templates. **Primary investigation target: `../theokit/`** (sibling project — the binding target itself); **secondary: `.claude/knowledge-base/references/mem0/`** (framework-adapter precedent) + **`.claude/knowledge-base/references/letta/`** (per-request scope in FastAPI). LangMem deferred per D3.

**Slug:** `v0-2-theokit-binding`
**Owner:** TheMemory v0.2 cycle-discover
**Created:** 2026-05-23
**Time budget:** 7h (TheoKit 4h primary + Mem0 2h + Letta 1h; LangMem deferred via D3)

## Context

Closes **Roadmap Item 3** (CLAUDE.md § Macro roadmap, Phase I Foundation, post v0.1 — currently Planned). The v0.1 local runtime shipped 2026-05-23 (PR #8): `createMemory(config)` works end-to-end but requires the caller to write `memory.user(req.ctx.session.userId).remember(text)` in every handler. v0.2 closes the ergonomics gap + enables the **deliberate lock-in surface** that CLAUDE.md § Architectural Decisions Locked (the three root overrides, item 1) ratified: TheoKit + TheMemory + TheoCloud is a single-platform consolidation; walk-away costs a memory migration.

**Evidence that motivates this discovery NOW:**

- Roadmap Item 3 (CLAUDE.md): "Subpath `@usetheo/memory/theokit` resolves `user_id`/`session_id`/`agent_id` from request context automatically; default-on memory in scaffolded TheoKit apps. This is the deliberate lock-in surface (override of Cross-Project Rule 6)."
- The v0.1 contract already has the three-tier API (`memory.user(id)` / `memory.session(id)` / `memory.agent(id)`) per ADR-0002 + `architecture.md § 1 Three-tier scope`. The binding work is purely about resolving those IDs from request context, NOT about new contract types.
- TheoKit `defineRoute({ handler: ({ ctx, request, ... }) => ... })` already builds `ctx` per-request via middleware (`../theokit/packages/theo/src/server/middleware-runner.ts`). The fixture pattern at `../theokit/fixtures/sessions-auth/server/context.ts` shows `RequestContext { session: UserSession | null }` with `userId: string`. The binding consumes this surface.
- **Critical preliminary finding (already verified):** TheoKit does NOT use `AsyncLocalStorage` (zero grep hits in `../theokit/packages/`). `ctx` is purely arg-passed via the handler signature. This shapes the binding API — implicit propagation across async boundaries is NOT available; the binding must either (a) accept `ctx` explicitly per call OR (b) wrap the handler.

**Project rules consumed:**

- `.claude/rules/architecture.md § 1 Three-tier scope` — locked discriminated union; binding produces these from `ctx`.
- `.claude/rules/architecture.md § 3 Dependency direction (DIP)` — `src/theokit/` MUST NOT import from `src/local/` or `src/cloud/`; binding stays runtime-agnostic.
- `.claude/rules/architecture.md § 5 Two runtimes, one contract` — binding consumes whatever `MemoryStore` the consumer wired; works with both local and cloud runtimes.
- `.claude/rules/public-copy.md § 2` — README must not weaken positioning; "Lock-in is a feature, owned explicitly" anchor preserved when v0.2 plan lands.
- `.claude/rules/testing.md § Pyramid` — E2E with scaffolded TheoKit app belongs in `tests/e2e/`, integration in `tests/integration/`.

## Objective

Produce a blueprint that lets `/to-plan v0-2-theokit-binding` lock concrete decisions for: (a) the binding API surface (auto-scoping ergonomics — handler-arg vs wrapper vs HOC), (b) the peer-dependency contract with TheoKit (open Request/ctx surface vs explicit peer-dep), (c) the `create-theo` template integration ("default-on memory" mechanism), (d) the per-request scope-resolution algorithm (read userId/sessionId/agentId from `ctx`, validate, build `Scope`), and (e) the test pyramid (unit + integration via fixture TheoKit app + E2E via scaffolded `create-theo` template).

Measurable success criteria:

- [ ] All 7 research questions answered with citations to `../theokit/` and/or `.claude/knowledge-base/references/`
- [ ] Cross-cutting comparison table populated (TheoKit vs Mem0 server vs Letta FastAPI) for at least: request→ctx flow, scope resolution mechanism, default-on integration pattern, test approach
- [ ] Recommendations section provides at least one concrete decision proposal per research question
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `../theokit/` (PRIMARY) | `packages/theo/src/server/` (define-route, middleware-runner, middleware-scan), `packages/create-theo/src/`, `packages/create-theo/templates/`, `examples/full-stack-agent/server/`, `fixtures/*/server/context.ts` | The binding target. Need: ctx shape, middleware contract, scaffolding mechanism, real handler patterns |
| `.claude/knowledge-base/references/mem0/` | `mem0-ts/src/community/src/integrations/`, `mem0-ts/src/oss/examples/`, `server/auth.py`, `server/db.py`, `docs/integrations/` (text-shape) | Framework-adapter precedent: how does Mem0 bind to a server / which integration shape? |
| `.claude/knowledge-base/references/letta/` | `letta/letta/server/rest_api/`, `letta/letta/server/server.py`, `letta/tests/test_sdk_client.py` | Per-request scope resolution in a FastAPI server; how Letta propagates session_id across handlers |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/langmem/` (entire project) | DEFERRED via ADR D3 — LangMem is for procedural memory (prompt rewriting); no HTTP server framework binding surface. Will revisit at v0.6 (Voyager skill library) per Roadmap Item 8. |
| `../theokit/packages/theo/dist/` | Build artifacts; source of truth is `src/` |
| `../theokit/coverage/`, `../theokit/test-results/` | Generated artifacts |
| `.claude/knowledge-base/references/mem0/embedchain/` | Different product (RAG framework, not memory primitive); not relevant to binding |
| `.claude/knowledge-base/references/mem0/docs/` (except `integrations/` subdirectory) | Marketing docs; integrations subdirectory is the only useful slice for adapter patterns |
| `.claude/knowledge-base/references/letta/letta/server/ws_api/` | WebSocket API; v0.2 binding targets HTTP routes only (WebSocket binding is v0.3+ if relevant) |
| Any project NOT cloned into `.claude/knowledge-base/references/` OR `../theokit/` | Cross-Project Rule: never claim a project feature without reading its source |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** TheoKit (`../theokit/`): 4h (primary target); Mem0 (`.claude/knowledge-base/references/mem0/`): 2h (framework-adapter precedent); Letta (`.claude/knowledge-base/references/letta/`): 1h (per-request FastAPI scope); LangMem: 0h (D3 deferred). Total: 7h.

**Rationale:** TheoKit IS the binding target — without deep understanding of its middleware contract + ctx shape + scaffolding mechanism, the binding API will fight the framework. Mem0 + Letta are precedent for "how does a memory primitive bind to a server" — Mem0's `server/` shows the server-style integration; Letta's FastAPI shows per-request session handling. LangMem has no binding-relevant surface (deferred via D3).

**Alternatives considered:** (a) Equal split (1.75h each) — rejected: under-budgets TheoKit which is the primary target. (b) TheoKit-only (7h) — rejected: misses Mem0/Letta precedent for adapter design, which is non-obvious without comparison. (c) Skip LangMem entirely — adopted (via D3 explicit deferral).

**Stop condition — per question:** When a question's Fase A returns empty matches after 3 consecutive retries with different query variants (pattern → kind-based → alternate path → broader scope), mark the question BLOCKED with reason "Fase A exhausted — no hotspots found" and continue to the next. Do NOT pad with unrelated hotspots from a different question's scope.

**Stop condition — per project:** When a project's time budget is exhausted with N questions still pending, mark all remaining questions for that project as BLOCKED with reason "budget exhausted" and continue with the next project (or, if last, emit the promise with the honest blocked-questions report).

**Anti-pattern:** NEVER fabricate Fase B answers to close a question whose Fase A was exhausted. Honest BLOCKED with reason is required (Inquebrável Rule 3).

**Consequences:** The halt-loop stops iterating on a project when its budget is exhausted, even if some questions remain blocked. Blueprint surfaces blocked questions explicitly. TheoKit's larger budget (4h) reflects its primary-target status.

### D2 — Investigation depth: read-end-to-end for binding-target files; Grep-then-spot-read for precedents

**Decision:** For `../theokit/` core surface (`define-route.ts`, `middleware-runner.ts`, `middleware-scan.ts`, all 5 fixtures' `context.ts`, `create-theo/src/cli.ts` + `install.ts`, all 5 templates' top-level `theo.config.ts` + `server/routes/*.ts`): Read end-to-end. For `.claude/knowledge-base/references/mem0/` + `.claude/knowledge-base/references/letta/`: Grep to identify hotspots, then Read specific functions/classes in detail (not full-file end-to-end).

**Rationale:** TheoKit IS the binding target — fragmentary understanding produces a fragile binding. `.claude/knowledge-base/references/` projects are precedent, not contract; full-file reads exceed budget without proportional payoff (the binding doesn't need to know every Mem0 server detail, only the adapter shape).

**Alternatives considered:** (a) Read end-to-end everywhere — rejected: budget-blowing (TheoKit alone has ~30+ relevant files). (b) Grep-only everywhere — rejected: TheoKit's middleware contract has subtle ordering rules (per-route vs global) that require contextual reading.

**Consequences:** TheoKit citations land with line-exact context; `.claude/knowledge-base/references/` citations land with function/class-exact context but may miss surrounding nuance. Blueprint marks the asymmetry explicitly in its Sources section.

### D3 — Defer LangMem: no binding-relevant surface

**Decision:** LangMem is OUT-OF-SCOPE for this discovery. No research questions target LangMem.

**Rationale:** LangMem implements procedural memory via prompt rewriting (`langmem/src/langmem/prompts/`). It is a memory implementation, not a framework integration. There is no HTTP server binding, no request-context resolution pattern, no scaffolding template equivalent to investigate. Forcing a question to fit the question budget per corner would produce fabricated relevance.

**Alternatives considered:** (a) Include LangMem for completeness — rejected: produces unfocused questions. (b) Include LangMem only for the techniques corner — rejected: same issue. (c) Defer entirely — adopted.

**Consequences:** LangMem revisited at v0.6 (Voyager skill library, Roadmap Item 8) where procedural memory is the actual scope. Blueprint marks LangMem as "deferred D3" in the LangMem column of any per-project synthesis.

### D4 — Cite `../theokit/` paths with the same hygiene as `.claude/knowledge-base/references/` paths

**Decision:** Every `../theokit/{path}` citation in this plan AND in the resulting blueprint MUST pass `Path.exists()` check on the filesystem at plan-write time AND blueprint-write time. Treat fabricated `../theokit/` paths the same as fabricated `.claude/knowledge-base/references/` paths.

**Rationale:** The discover-confidence hard cap on fabricated citations targets `.claude/knowledge-base/references/` explicitly. `../theokit/` is outside that scope, but a fabricated TheoKit path is equally dishonest. Inquebrável Rule 3 + Rule 9 (Não Reinvente — verify before claiming) both apply.

**Alternatives considered:** (a) Cite `../theokit/` paths loosely since they're outside the confidence script's check — rejected: violates Inquebrável Rule 3. (b) Skip `../theokit/` entirely — rejected: the binding target IS TheoKit; you cannot design the binding without reading the target.

**Consequences:** Pre-write Path.exists() check on every `../theokit/` path BEFORE adding it to plan or blueprint. Already executed for all paths cited in this plan (see Step-3 verification log in the cycle session transcript).

### D5 — Code-reality framing: when TheoKit's actual behavior contradicts its docs/CLAUDE.md, REPORT code reality

**Decision:** If `../theokit/CLAUDE.md` or any `../theokit/docs/` markdown says one thing and the actual source code says another, the BLUEPRINT reports the source-code reality with line-exact citation. Markdown narrative gets a "documentation drift" footnote.

**Rationale:** Same lesson as the v0-1-local-runtime blueprint D1 (8-phase code reality vs 6-phase ADR narrative): docs drift; code doesn't lie. The v0.2 binding will be built against TheoKit's actual surface, not its marketing surface.

**Alternatives considered:** (a) Trust markdown over source — rejected: prior session burned by this exact pattern. (b) Report both equally — accepted as fallback when code+docs agree; code wins when they disagree.

**Consequences:** Blueprint may surface "TheoKit drift items" — places where TheoKit's own docs are stale vs its source. These become potential PRs against TheoKit itself (out of scope for v0.2 implementation, but documented for the TheoKit team).

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — ast-grep / Grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How does Mem0 bind to a server framework? Does the `.claude/knowledge-base/references/mem0/mem0-ts/src/community/src/integrations/` directory contain framework adapters (express middleware, fastify plugin), or just LangChain integration? | tests | `.claude/knowledge-base/references/mem0/` | `ls .claude/knowledge-base/references/mem0/mem0-ts/src/community/src/integrations/` (text-shape; verified at plan-write time — only `langchain/`); `find .claude/knowledge-base/references/mem0/mem0-ts/src/oss/examples -type f` for OSS examples; `find .claude/knowledge-base/references/mem0/docs/integrations -type f` for docs-side integration list | Read each adapter file end-to-end; capture the adapter pattern (factory + middleware vs decorator vs HOC vs direct-call); identify request-context resolution mechanism (if any) | Table: integration target → adapter pattern → request-context resolution → citation. Conclusion: does Mem0 have a server-framework adapter we can mirror, OR is the precedent purely "consumer calls `MemoryClient.add()` directly inside their handler"? |
| Q2 | How does Letta's FastAPI server propagate per-request session state through its handlers? Does it use FastAPI `Depends()` (DI-style) or a global request-scoped context object? | tests | `.claude/knowledge-base/references/letta/` | `find .claude/knowledge-base/references/letta/letta/server/rest_api -type f -name "*.py"` to list route files; `Grep -rn "Depends\|Request\|request.state" .claude/knowledge-base/references/letta/letta/server/rest_api/` to identify the propagation primitive; `Grep -rn "test_sdk_client\|integration_test_" .claude/knowledge-base/references/letta/tests/ | head` to find route tests | Read 2-3 route handlers + `server.py` + global_exception_handler + 1 integration test that exercises per-request scope; capture the propagation flow end-to-end | Description: FastAPI primitive used (Depends DI / request.state / global async-local) + 1-2 code snippets + citation to a route file + citation to a test that exercises scope isolation |
| Q3 | What's the minimum dependency surface `@usetheo/memory/theokit` needs from TheoKit? Open Request / ctx interface (no peer-dep on `theokit` package), OR explicit peer-dep on `theokit` for typed `RouteConfig` + `MiddlewareFn`? Will the binding work against any consumer's `ctx` shape, or only against TheoKit's canonical `createContext` output? | deps | `../theokit/` | Read `../theokit/packages/theo/src/server/define-route.ts` end-to-end (RouteConfig signature); Read `../theokit/packages/theo/src/server/middleware-runner.ts` end-to-end (MiddlewareFn contract); Grep `../theokit/packages/theo/package.json` for exports map (what does `theokit/server` export?) | Already done end-to-end during plan-write Step-1 probe; recapture for blueprint: RouteConfig has `handler({ ctx, request, ... })` where `ctx` is `TCtx = unknown` (consumer-defined). Implication: the binding can be agnostic of TheoKit if it accepts any `ctx` extends `{ session?: { userId?: string } }`; OR can peer-dep TheoKit for first-class types. | Decision table: peer-dep TheoKit (full types) vs structural typing on `ctx` (no peer-dep, looser types) — trade-offs, with code snippets of both binding shapes |
| Q4 | How does `create-theo` scaffold templates? What's the file-tree shape produced? Where would "default-on memory module" land (separate `server/memory.ts`? merged into existing `server/context.ts`? new `server/routes/memory.ts`)? | tools | `../theokit/` | Read `../theokit/packages/create-theo/src/cli.ts` + `install.ts` + `bare-transform.ts` end-to-end (~3 files); `find ../theokit/packages/create-theo/templates -maxdepth 3 -type f \( -name "*.ts*" -o -name "package.json" \)` for full template file tree; pick 2 templates to compare (`default` + `saas`) | Read `templates/default/theo.config.ts` + `templates/default/server/routes/chat.ts` + `templates/saas/theo.config.ts` + `templates/saas/server/context.ts` end-to-end | Description: scaffolding mechanism (file copy + variable substitution? AST transform via bare-transform?), file tree of `default` template, proposed insertion point for "default-on memory module" (with 1 alternative + rationale) |
| Q5 | TheoKit `ctx` contract — what shape does `createContext({ request, response })` return across the 5 fixture variants? Does every fixture produce a `session: { userId: string } \| null`-style shape, OR do shapes diverge enough that the binding cannot rely on a canonical shape? | techniques | `../theokit/` | Read all 5 fixture `context.ts` files (`../theokit/fixtures/{sessions-auth,template-saas,auth-providers-with-authjs,template-postgres,auth-providers-diy-github}/server/context.ts`) end-to-end | Side-by-side compare the 5 `RequestContext` shapes; identify common subset (does `session.userId: string` appear in all? what about `session.id` / `session.sub`? Auth.js may use different field name); identify whether a structural-typing protocol (`{ session?: { userId?: string } }`) covers all 5 OR if there's divergence requiring an explicit `extractScope(ctx)` callback in `MemoryConfig` | Table: fixture name → RequestContext type → `session` field shape → user-id field name + type. Conclusion: structural-typing-safe SUBSET (works as a default) OR explicit `extractScope` callback REQUIRED (no safe default). |
| Q6 | Request-scoped context propagation across async boundaries — TheoKit does NOT use `AsyncLocalStorage` (verified: zero grep hits in `../theokit/packages/`). Implications for binding ergonomics: is implicit `memory.remember(text)` (no `ctx` arg) achievable inside an async chain (`await getUser(); await memory.remember()`), OR is `memory.user(ctx.userId).remember(text)` the cleanest possible API? | techniques | `../theokit/` + Node.js `node:async_hooks` docs | `Grep -rn "AsyncLocalStorage\|async_hooks" ../theokit/packages/` (already done — zero hits); `Grep -rn "AsyncLocalStorage" .claude/knowledge-base/references/mem0/ .claude/knowledge-base/references/letta/` to check if precedents use it; check Node.js stable since 16+; check perf cost (cited from Node docs + benchmarks) | Read 1-2 handler examples from `../theokit/examples/full-stack-agent/server/routes/` to see actual async patterns + propagate decision: introduce `AsyncLocalStorage` wrapper inside binding (cost: setup ceremony) vs keep explicit `ctx` arg (cost: noise in every call) | Recommendation: bind shape (`bindMemory(memory)(ctx)` HOC pattern vs `memory.fromCtx(ctx)` named ctor vs explicit `memory.user(ctx.userId)`) with trade-offs. At least one prototype-code snippet per option. |
| Q7 | Auth-side identity propagation: how does TheoKit's `createSessionManager` (cited in `fixtures/sessions-auth/server/context.ts`) construct `session.userId`? Is it stable across requests for the same user? Is it the same value that `memory.user(userId)` would key on? | techniques | `../theokit/` | `Grep -rn "createSessionManager\|SessionManager" ../theokit/packages/theo/src/` to find the implementation; `Grep -rn "userId" ../theokit/packages/theo/src/session*` to find userId construction | Read `createSessionManager` implementation end-to-end; capture how userId is set (from cookie? from JWT claim? from OAuth provider response?) | Description: identity-construction flow + 1 worked example (e.g., GitHub OAuth → userId = `gh:${profile.id}`); stability guarantees; whether the binding needs to namespace the userId (e.g., `theokit:${session.userId}`) to avoid collision with consumer-provided IDs |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q1, Q2 | Covered (2 questions) |
| Dependencies | Q3 | Covered (1 question) |
| Tools | Q4 | Covered (1 question) |
| Techniques | Q5, Q6, Q7 | Covered (3 questions — max for the corner) |

**Coverage: 4/4 corners covered (100 %)**

Question budget check: 7 total questions (within 5-10 range), 3 max per corner (techniques hits the cap), 1 min per corner (all four hit the floor), every question maps to exactly one corner. Plan validates against `discover-plan-golden-rule.md § Question budget`.

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | Every `../theokit/{path}` and `.claude/knowledge-base/references/{project}/{path}` declared in Fase A exists per `Path.exists()` | Mark Qx BLOCKED with reason "path not found", continue to next |
| Per-question Fase A budget | Fase A returned at least one hotspot OR 3 query-variant retries attempted | After 3 retries with empty results, mark Qx BLOCKED with reason "Fase A exhausted"; continue |
| After answering Qx | Blueprint section under Qx has at least one citation to either `../theokit/` or `.claude/knowledge-base/references/` | Re-iterate Qx (1 retry max) |
| Mid-loop sanity | Total citations to `../theokit/` + `.claude/knowledge-base/references/` ≥ 1 / 200 words of blueprint prose | Add citations to under-cited paragraphs (1 retry max); soft-cap at 89 if density stays low (acceptable for synthesis prose) |
| Per-project time budget | TheoKit ≤ 4h, Mem0 ≤ 2h, Letta ≤ 1h | When exhausted, mark all remaining Qx for that project BLOCKED with reason "budget exhausted"; advance to next project |
| Before promising complete | All 4 coverage corners have populated sections AND every cited `../theokit/` path passes `Path.exists()` (D4 enforcement) | Refuse promise, continue iterating |

## Acceptance Criteria

- [ ] All 7 research questions answered OR explicitly marked BLOCKED with reason
- [ ] All four coverage corners have populated sections in the blueprint
- [ ] Every citation in the blueprint points to a real path (`../theokit/{...}` per D4 OR `.claude/knowledge-base/references/{...}` per existing golden rule)
- [ ] At least one ADR section in the blueprint synthesizes decisions taken (D4 + D5 from this plan + new D6+ from the synthesis)
- [ ] Cross-cutting comparison table populated for at least 4 dimensions (request→ctx flow, scope resolution mechanism, default-on integration pattern, test approach)
- [ ] Recommendations section provides at least 1 concrete decision proposal per research question (7 recommendations minimum)
- [ ] Time budget respected per project (TheoKit ≤ 4h, Mem0 ≤ 2h, Letta ≤ 1h)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/v0-2-theokit-binding-blueprint.md`

## Global Definition of Done

- [ ] All phases completed (this plan → `/discover-edge-cases` → `/discover-execute` → `/discover-confidence` → optional `/discover-improve` → re-score)
- [ ] Final `/discover-confidence` verdict recorded in the blueprint header
- [ ] No fabricated citations (per D4: `../theokit/` paths held to same standard as `.claude/knowledge-base/references/`)
- [ ] Coverage Matrix 100 % covered (already 4/4 in this plan)
- [ ] ADRs reference at least one project rule (`architecture.md § 3 DIP` for the binding-isolation rule, `architecture.md § 5 Two runtimes` for runtime-agnostic surface, `public-copy.md § 2` for positioning anchor preservation) — D1-D5 above already cite these
- [ ] Plan archived to `.claude/knowledge-base/discoveries/plans/completed/` after the blueprint reaches SHIPPABLE_WITH_CAVEATS+ and the v0.2 implementation plan ships (mirroring the v0-1 lifecycle)

## Related

- Upstream cycle: [`cycle-discover.md`](../../../rules/cycle-discover.md) — this skill is phase 1
- Downstream skills: `/discover-edge-cases` (phase 2), `/discover-execute` (phase 3), `/discover-confidence` (phase 4), optional `/discover-improve` (phase 5), optional skill-distillation tail (phases 6-8)
- Sibling discovery (already completed): `.claude/knowledge-base/discoveries/blueprints/v0-1-local-runtime-blueprint.md` — v0.1 local runtime; this v0.2 binding builds on its `createMemory` factory
- Completed plans this builds on: `.claude/knowledge-base/plans/completed/memory-contract-v0-0-plan.md` (v0.0 contract); `.claude/knowledge-base/plans/completed/v0-1-local-runtime-plan.md` (v0.1 runtime)
- Roadmap entry: `CLAUDE.md § Macro roadmap` Item 3 (currently Planned; this discovery feeds the `/to-plan v0-2-theokit-binding` step)
- TheoKit source of truth: `../theokit/CLAUDE.md` (sibling project contract) + `../theokit/packages/theo/` (the binding target)

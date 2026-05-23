# Blueprint: v0.2 — TheoKit binding (`@usetheo/memory/theokit`)

> **Version 1.0** — Technical synthesis of how `../theokit/` exposes request context + middleware contract + scaffolding mechanism, plus how `referencia/mem0/` and `referencia/letta/` solve framework binding precedent. Informs the v0.2 `/to-plan` for the `@usetheo/memory/theokit` subpath that auto-resolves `user_id` / `session_id` / `agent_id` from TheoKit request context and ships default-on in scaffolded TheoKit apps.

**Slug:** `v0-2-theokit-binding`
**Source plan:** `.claude/knowledge-base/discoveries/plans/v0-2-theokit-binding-plan.md` (v1.0)
**Owner:** TheMemory v0.2 cycle-discover
**Generated:** 2026-05-23 via `/discover-execute`
**Confidence verdict:** TBD (updated by `/discover-confidence`)

## Context

Roadmap Item 3 (CLAUDE.md § Macro roadmap, currently Planned). v0.1 local runtime shipped 2026-05-23 (PR #8); `createMemory(config)` works end-to-end but every TheoKit handler must currently call `memory.user(req.ctx.session.userId).remember(text)` explicitly. v0.2 closes the ergonomics gap + enables the **deliberate lock-in surface** that CLAUDE.md § Architectural Decisions Locked (root override #1) ratified.

## Objective

Enable `/to-plan v0-2-theokit-binding` to lock concrete decisions for: (a) binding API surface (auto-scoping ergonomics — handler-arg vs wrapper vs HOC), (b) peer-dep contract with TheoKit (open structural typing vs explicit peer), (c) `create-theo` template integration mechanism, (d) per-request scope-resolution algorithm, (e) test pyramid (unit + integration + E2E via scaffolded template).

---

## Coverage Corner 1 — Integration Tests

> Populated by `/discover-execute` from Q1 (Mem0 framework adapters) + Q2 (Letta FastAPI per-request scope). TheoKit testing approach appears in Corner 4 (techniques) since it's the binding target, not a precedent.

### Mem0 (Q1)

**Finding: Mem0 has NO server-framework adapter in TypeScript. The TS `community/src/integrations/` directory contains ONLY a LangChain adapter (LLM-prompt-level integration, not HTTP server). Mem0's own Python server passes scope identifiers EXPLICITLY in the request body — there is no auto-resolution from auth context to port as precedent.**

Three sources interrogated:

1. **TypeScript SDK integrations dir** (`referencia/mem0/mem0-ts/src/community/src/integrations/`): contains exactly ONE subdirectory — `langchain/` — with 2 files: `index.ts` + `mem0.ts`. The pattern is converting Mem0 `Memory[]` results into LangChain `BaseMessage[]` for use inside a chain's prompt context (`referencia/mem0/mem0-ts/src/community/src/integrations/langchain/mem0.ts:31-44` — `mem0MemoryContextToSystemPrompt`). This is NOT a server adapter; it's an LLM-prompt-shape adapter. Consumer still calls `MemoryClient.add()` directly from their handler.

2. **OSS examples** (`referencia/mem0/mem0-ts/src/oss/examples/basic.ts:1-40`): canonical usage shows `const memory = new Memory(); await memory.add(text, { userId: "john" });` — the consumer hardcodes `userId` in their own code or passes it via their own scoping mechanism. Zero framework-binding indirection.

3. **Mem0's Python FastAPI server** (`referencia/mem0/server/main.py:351-356`):
   ```python
   if not any([memory_create.user_id, memory_create.agent_id, memory_create.run_id]):
       raise HTTPException(status_code=400, detail="At least one identifier (user_id, agent_id, run_id) is required.")
   ...
   response = get_memory_instance().add(messages=[m.model_dump() for m in memory_create.messages], **params)
   ```
   The auth layer (`referencia/mem0/server/auth.py:145` — `verify_auth`) returns a `User` object via FastAPI `Depends()`, but route handlers do NOT pipe `user.id` into `memory.add()`. Instead, the request body (`MemoryCreate.user_id`) carries the scope explicitly. The auth pattern guards access; scope still travels in the payload.

**Implication for TheMemory v0.2 binding**: there is NO Mem0 precedent to port for "auto-resolve user_id from auth context and pass to `memory.add()`". The TheoKit binding will be the first adapter in this design space. The closest precedent is Mem0's `verify_auth → User`, but the link from `User` to `memory.add(user_id=...)` is left to the handler author — not automated.

### Letta (Q2)

**Finding: Letta uses FastAPI `Depends()` (DI-style) to inject a `HeaderParams` object into every route handler. The per-request `user_id` flows from an HTTP header (`user_id` alias on the `actor_id` field), NOT from auth-derived state. `request.state` is auxiliary (logging only). This is the closest precedent for TheoKit binding — same shape, different primitive.**

Five sources interrogated:

1. **`HeaderParams` Pydantic model** (`referencia/letta/letta/server/rest_api/dependencies.py:30-39`): declares `actor_id`, `user_agent`, `project_id`, `letta_source`, `sdk_version`, `experimental_params`, `billing_context`. The `actor_id` is the per-request user identifier.

2. **`get_headers` dependency function** (`referencia/letta/letta/server/rest_api/dependencies.py:41-44`):
   ```python
   def get_headers(
       actor_id: Optional[str] = Header(None, alias="user_id"),
       user_agent: Optional[str] = Header(None, alias="User-Agent"),
       project_id: Optional[str] = Header(None, alias="X-Project-Id"),
       ...
   ) -> HeaderParams:
   ```
   FastAPI's `Header()` declarator parses the request header `user_id` (or `X-Project-Id`, etc.) into the function arg. Validation happens inline (line 56: `PRIMITIVE_ID_PATTERNS[PrimitiveType.USER.value].match(actor_id)`).

3. **Route consumption** (`referencia/letta/letta/server/rest_api/routers/v1/voice.py:36-37`):
   ```python
   async def create_voice_chat_completions(
       agent_id: str,
       server: "SyncServer" = Depends(get_letta_server),
       headers: HeaderParams = Depends(get_headers),
   ):
   ```
   Two DI dependencies per handler — `server` (the singleton `SyncServer` instance) + `headers` (per-request scope). Path params (`agent_id`) come from the URL. No `request: Request` arg unless the handler needs body/streaming control.

4. **Auth is SEPARATE from scope** (`referencia/letta/letta/server/rest_api/auth_token.py:11-22`): `get_current_user` returns `uuid.UUID` for ADMIN Bearer-token auth, but it's NOT chained into `get_headers`. The per-request user_id for memory scoping flows from the `user_id` HEADER (consumer-supplied), independent of the Bearer auth identity.

5. **`request.state` is auxiliary** (`referencia/letta/letta/server/rest_api/middleware/request_id.py:62-64`, `middleware/logging.py:146-149`): used to store `request_id` (for streaming-response correlation where Python contextvars don't propagate) and `user_id`/`org_id` for logging context. NOT the primary scope-propagation mechanism — that's `Depends(get_headers)`.

**Implication for TheMemory v0.2 binding**:
- Letta confirms the "arg-passed structured object" pattern for per-request scope — same shape as TheoKit's `handler({ ctx, request, ... })`, just via a different FastAPI primitive (`Depends`).
- The primitive choice (Depends vs arg) is framework-determined; the SHAPE (one structured object containing scope IDs, separate from auth) is portable.
- TheoKit binding should NOT chain to auth output — let consumer's middleware do the auth → ctx assembly; binding reads from `ctx.session.userId` directly, mirroring Letta's "headers carry scope" decoupling.
- Test pattern: `referencia/letta/tests/test_sdk_client.py:1-50` uses a real server-in-thread fixture + `LettaSDKClient` against `localhost:8283`. For TheoKit binding tests, the equivalent is an in-process TheoKit `defineRoute` invocation with a mocked `ctx` — no server-in-thread needed (TheoKit doesn't have a SDK client to test against).

### LangMem

Deferred per discovery plan D3 — no HTTP server framework binding surface; revisit at v0.6 (Voyager skill library, Roadmap Item 8).

---

## Coverage Corner 2 — Dependencies

> Populated from Q3 (TheoKit peer-dep contract).

### TheoKit binding peer-dep shape (Q3)

**Finding: TheoKit's `defineRoute<TCtx = unknown>` makes `ctx` structurally typed by default. The minimum dependency surface for `@usetheo/memory/theokit` is ZERO peer-dep on `theokit` — the binding can accept a structurally-typed `{ session?: { userId?: string; sessionId?: string; agentId?: string } }` shape and read the scope IDs without importing any TheoKit type. An optional peer-dep buys first-class `RouteConfig` types but ties TheMemory's release cadence to TheoKit's alpha.**

Three sources interrogated:

1. **`RouteConfig<TCtx = unknown>` declaration** (`../theokit/packages/theo/src/server/define-route.ts:3-30`):
   ```ts
   export interface RouteConfig<
     TQuery extends z.ZodType = z.ZodUndefined,
     TBody extends z.ZodType = z.ZodUndefined,
     TParams extends z.ZodType = z.ZodUndefined,
     TCtx = unknown,        // ← key line
     TResponse = unknown,
   > {
     handler: (ctx: {
       query: z.infer<TQuery>
       body: z.infer<TBody>
       params: z.infer<TParams>
       request: Request
       ctx: TCtx           // ← consumer's ctx flows through unchanged
     }) => TResponse | Promise<TResponse>
   }
   ```
   `TCtx` defaults to `unknown` — TheoKit makes no commitment about ctx shape. Consumer-supplied `context.ts` factory (see Q5) defines what `ctx` actually carries. Binding code that asserts `ctx.session?.userId` is structurally compatible with ANY consumer ctx that happens to have that shape — no `theokit` import required.

2. **`ContextFactory` middleware contract** (`../theokit/packages/theo/src/server/middleware-runner.ts:1-80`):
   ```ts
   type ContextFactory = (args: { request: IncomingMessage; response: ServerResponse }) => unknown
   ```
   Returns `unknown`. The factory is the seam where consumer middleware injects auth state into `ctx`. TheMemory binding does NOT need to know HOW consumer built `ctx`; it only needs to read `ctx.session?.userId` at handler entry. Decoupling at the type level mirrors the runtime decoupling Letta proved (Q2): scope is structural, not auth-derived.

3. **TheoKit `package.json` `peerDependencies`** (`../theokit/packages/theo/package.json:58-69`):
   ```json
   "peerDependencies": {
     "react": "^19.0.0",
     "react-dom": "^19.0.0",
     "react-router": "^7.0.0",
     "ws": "^8.20.1",
     "zod": "^3.24.0"
   }
   ```
   TheoKit is at `0.1.0-alpha.5` (line 3). An `@usetheo/memory/theokit` peer-dep on `theokit ^0.1.0-alpha` would force TheMemory consumers to upgrade TheoKit lockstep with TheMemory — unacceptable churn for a memory primitive consumed deeply.

**Decision table — peer-dep vs structural typing**:

| Dimension | Option A: Peer-dep on `theokit` | Option B: Structural typing (no peer-dep) |
|---|---|---|
| Type import in binding | `import type { RouteConfig } from 'theokit/server'` | `interface ScopedContext { session?: { userId?: string; sessionId?: string; agentId?: string } }` |
| Version coupling | TheMemory pinned to TheoKit's alpha range (currently `^0.1.0-alpha.5`) | None — TheMemory ships independent semver |
| Type richness for end-user | Full `RouteConfig<TQuery, TBody, TParams, TCtx, TResponse>` generic | Loose — consumer's typed `ctx` still inferred at handler site; binding only narrows `session.*` |
| Breaks if TheoKit moves to beta | YES — peer-dep range must bump in TheMemory release | NO — structural contract unchanged |
| Breaks if consumer adds non-TheoKit framework | YES — peer-dep is hard requirement | NO — any framework with similar `ctx.session` shape works |
| Mimics Letta precedent (Q2) | NO — Letta's `HeaderParams` lives in their own dependencies; consumers don't peer-dep Letta types | YES — Letta's HeaderParams is structurally consumed by handlers, not imported |
| Lock-in surface (Cross-Project Rule 6 override) | Type-level lock-in | Behavior-level lock-in (auto-scoping in scaffolded apps + `create-theo` template — Q4) |

**Recommendation for ADR D-binding-peer-dep**: structural typing (Option B). The lock-in posture the project owner ratified is BEHAVIORAL ("default-on memory in scaffolded TheoKit apps", per discovery plan Context), NOT typological. Structural typing keeps the type surface minimal, allows independent release cadence, and matches Letta's precedent (Q2) where scope-carrying objects are structurally consumed without importing the framework's type module. The lock-in surface lives in `create-theo`'s template (Q4) and the per-request scope resolution (Q7), not in the `theokit` import statement.

**Binding code shape** (illustrative, derived from Q1/Q2/Q3):
```ts
// @usetheo/memory/theokit
interface ScopedContext {
  session?: {
    userId?: string
    sessionId?: string
    agentId?: string
  }
}

export function memoryFromCtx(ctx: ScopedContext, memory: Memory): ScopedMemory {
  const userId = ctx.session?.userId
  if (!userId) throw new MissingScopeError('ctx.session.userId required')
  return memory.user(userId)
}
```
Zero `theokit` import. Works against TheoKit, any framework that builds a `ctx.session.userId`, or hand-rolled handler scaffolding.

### Mem0 / Letta (reference precedent)

Cross-referenced in Q1 + Q2 findings above; no separate dependency analysis required for this corner (binding target is TheoKit, not Mem0/Letta).

---

## Coverage Corner 3 — Tools

> Populated from Q4 (create-theo scaffolding).

### TheoKit `create-theo` scaffolding mechanism (Q4)

**Finding: `create-theo` is a static-template scaffolder. Five templates (default, dashboard, api-only, postgres, saas) live as complete file trees under `packages/create-theo/templates/{name}/`. `scaffold()` does `cpSync(templateDir, targetDir, { recursive: true })` — bulk recursive copy of the whole template, NO conditional logic. Post-copy: `_gitignore` → `.gitignore` rename + `{{name}}` placeholder substitution in `*.tmpl` files at root level. Default-on memory requires editing each template tree directly (no plugin/composition API).**

Four sources interrogated:

1. **CLI argument parsing** (`../theokit/packages/create-theo/src/cli.ts:36-55`):
   ```ts
   const templateFlag = args.find((a) => a.startsWith('--template='))
   const templateName = templateFlag ? templateFlag.split('=')[1] : 'default'
   const bare = args.includes('--bare')
   ...
   scaffold(targetDir, projectName, templateName, { bare })
   ```
   The 5 templates are advertised in the help text: `Templates: default, dashboard, api-only, postgres, saas` (cli.ts:27). `--bare` only applies to `default` template.

2. **`scaffold()` core mechanism** (`../theokit/packages/create-theo/src/index.ts:40-114`):
   ```ts
   cpSync(templateDir, targetDir, { recursive: true })

   const gitignoreSrc = join(targetDir, '_gitignore')
   const gitignoreDest = join(targetDir, '.gitignore')
   if (existsSync(gitignoreSrc)) renameSync(gitignoreSrc, gitignoreDest)

   for (const entry of readdirSync(targetDir)) {
     if (!entry.endsWith('.tmpl')) continue
     ...
     const replaced = content.replace(/\{\{name\}\}/g, projectName)
     writeFileSync(dst, replaced)
     unlinkSync(src)
   }
   ```
   Three transformations: (a) bulk `cpSync`, (b) `_gitignore` rename, (c) `*.tmpl` `{{name}}` substitution at root level ONLY (deeper subdirs not currently templated). No conditional inclusion logic, no per-feature flags, no plugin API.

3. **`applyBareTransform` deletion pattern** (`../theokit/packages/create-theo/src/bare-transform.ts:41-97`):
   ```ts
   delete pkg.dependencies['@usetheo/ui']
   delete pkg.dependencies['@usetheo/sdk']     // operator-deferred npm publish
   delete pkg.dependencies['lucide-react']
   ...
   if (existsSync(chatPath)) unlinkSync(chatPath)
   ```
   `--bare` SUBTRACTS: removes deps not yet on public npm + companion files. The pattern PROVES that templates can be authored against unreleased packages AS LONG AS `--bare` knows to strip them. Directly relevant: `@usetheo/memory` is not yet published; `--bare` will need a symmetric strip for memory.

4. **Template `package.json.tmpl` shape** (`../theokit/packages/create-theo/templates/saas/package.json.tmpl:15-24`):
   ```json
   "dependencies": {
     "theokit": "^0.1.0-alpha.5",
     "@usetheo/ui": "^0.6.2-next.0",
     "react": "^19.0.0",
     "react-dom": "^19.0.0",
     "react-router": "^7.0.0",
     "drizzle-orm": "^0.45.0",
     "postgres": "^3.4.0",
     "zod": "^3.24.0"
   }
   ```
   Each template has its own static `package.json.tmpl` (with `{{name}}` substituted). For default-on memory, the saas template's `dependencies` needs `"@usetheo/memory": "^0.1.0"` added. Same for `postgres` template (DB-backed) and other DB-bearing templates. `api-only` + `default` are stateless — memory could be additive but is less obviously useful.

**Existing `ctx.session.userId` insertion shape** (`../theokit/packages/create-theo/templates/saas/server/routes/me.ts:1-10`):
```ts
import { defineRoute, requireAuth } from 'theokit/server'
import type { RequestContext } from '../context.js'

export const GET = defineRoute<z.ZodUndefined, z.ZodUndefined, z.ZodUndefined, RequestContext>({
  handler: ({ ctx }) => {
    requireAuth(ctx.session)
    return { userId: ctx.session.userId, email: ctx.session.email }
  },
})
```
This is the EXACT shape the binding consumes (per Q3 structural typing). A scaffolded demo route would be:
```ts
import { defineRoute, requireAuth } from 'theokit/server'
import { memoryFromCtx } from '@usetheo/memory/theokit'
import type { RequestContext } from '../context.js'

export const POST = defineRoute<...>({
  body: z.object({ text: z.string() }),
  handler: async ({ ctx, body }) => {
    requireAuth(ctx.session)
    const memory = memoryFromCtx(ctx)  // auto-scope from ctx.session.userId
    await memory.remember(body.text)
    return { ok: true }
  },
})
```

**Default-on insertion points (for ADR D-default-on-scaffolding)**:

| Insertion | File(s) per template | Mechanism |
|---|---|---|
| (A) Declare dependency | `templates/{saas,postgres,dashboard}/package.json.tmpl` → add `"@usetheo/memory": "^0.1.0"` to `dependencies` | Static edit; substituted at scaffold time via existing `*.tmpl` pass |
| (B) Wire context (optional) | `templates/{saas,postgres}/server/context.ts` → augment `RequestContext` with `memory: Memory` field + instantiate in `createContext` | Static edit; consumed by `theokit/server`'s `ContextFactory` (Q3) |
| (C) Demo route | `templates/{saas,postgres}/server/routes/memory.ts` → new file showing `memoryFromCtx(ctx).remember(text)` | Net-new file in template tree |
| (D) `--bare` strip | `bare-transform.ts:46-64` → add `delete pkg.dependencies['@usetheo/memory']` + `unlinkSync` of demo route | Mirror of existing `@usetheo/sdk` strip |
| (E) DB schema (postgres template) | `templates/postgres/db/schema.ts` → re-export TheMemory's pgvector schema OR a migration step | Aligns with v0.1's `runMigrations(pool)` (shipped 2026-05-23) |
| (F) Env example | `templates/{saas,postgres}/.env.example` → add `THEOKIT_API_KEY` (per ADR-0009 cloud auth reuse) | Static edit |

**Implication for TheMemory v0.2 scaffolding integration**:
- The lock-in surface (Cross-Project Rule 6 override) materializes in (A) + (C): `@usetheo/memory` ships pre-wired so consumer's FIRST POST/GET handler has working memory; no explicit `import { createMemory } from '@usetheo/memory'` needed in user code.
- Templates without sessions (`default`, `api-only`) should NOT default-on memory — surfaces a "memory requires scope" error at runtime is worse DX than not shipping it.
- `--bare` symmetry is mandatory (D): without it, `npx create-theokit my-app --template=saas` will fail `npm install` while `@usetheo/memory` is unpublished.
- No plugin API or composition mechanism exists — every default-on memory feature is a direct edit to the relevant template tree. Implies T-T+1 (TheoKit + TheMemory) coordination: TheMemory PR also touches `../theokit/packages/create-theo/templates/`.
- Acceptance criterion from discovery plan ("Scaffolded template includes memory module by default — template snapshot test") maps to: snapshot test asserts `package.json.tmpl` `dependencies` contains `"@usetheo/memory"` AND `server/routes/memory.ts` exists in the scaffolded output.

---

## Coverage Corner 4 — Techniques

> Populated from Q5 (TheoKit ctx contract), Q6 (AsyncLocalStorage vs arg-passed), Q7 (auth-side userId construction).

### Technique 1 — TheoKit `ctx` contract across fixture variants (Q5)

**Finding: Four of five fixtures share a uniform `RequestContext` shape with `{ sessions, session: UserSession | null, res }` — the `session.userId` field is always present (sometimes as required `string`, sometimes as optional `string?`). The fifth fixture (`template-postgres`) has NO session whatsoever — only `{ db }`. The structural-typing recommendation from Q3 (`{ session?: { userId?: string } }`) is the union shape that subsumes ALL five fixtures.**

Five fixtures interrogated:

| Fixture | `UserSession` shape | `RequestContext` extras | `session.userId` availability |
|---|---|---|---|
| `sessions-auth` | `{ userId: string; username: string }` | `{ sessions, session, res }` | required when session non-null |
| `template-saas` | `{ userId: string; email: string }` | `{ sessions, session, res, db }` | required when session non-null |
| `auth-providers-with-authjs` | `{ userId: string; email: string; name?: string }` | `{ sessions, session, res }` | required when session non-null |
| `template-postgres` | N/A (no `session` field at all) | `{ db }` only | session field ABSENT from RequestContext |
| `auth-providers-diy-github` | `{ userId?: string; login?: string; pending?: { codeVerifier; state } }` | `{ sessions, session, res }` | OPTIONAL even when session non-null (OAuth round-trip state) |

Per-fixture evidence:

1. **`sessions-auth`** (`../theokit/fixtures/sessions-auth/server/context.ts:4-37`): canonical session shape with required `userId: string`. `RequestContext` = `{ sessions, session, res }` — the minimal "session-aware" baseline.

2. **`template-saas`** (`../theokit/fixtures/template-saas/server/context.ts:5-37`): identical session pattern + adds `db: typeof db` to `RequestContext`. Demonstrates the "session + DB" composition that the saas scaffolded template uses.

3. **`auth-providers-with-authjs`** (`../theokit/fixtures/auth-providers-with-authjs/server/context.ts:4-33`): Auth.js bridge — `UserSession` adds optional `name?: string`. Same `RequestContext` baseline. Cookie name differs (`authjs_bridge_session`) — irrelevant to binding because the binding reads `ctx.session.userId`, not the cookie directly.

4. **`template-postgres`** (`../theokit/fixtures/template-postgres/server/context.ts:1-6`):
   ```ts
   export function createContext() {
     return { db }
   }
   ```
   ENTIRELY DIFFERENT pattern — no `sessions`, no `session`, no `res`. Just `{ db }`. Authorless fixture demonstrating DB-only routes. **Binding implication**: if `@usetheo/memory/theokit` mandates `ctx.session.userId`, this fixture's routes CANNOT use the binding without consumer wiring auth first.

5. **`auth-providers-diy-github`** (`../theokit/fixtures/auth-providers-diy-github/server/context.ts:10-42`):
   ```ts
   export interface UserSession {
     userId?: string             // ← OPTIONAL
     login?: string
     pending?: { codeVerifier: string; state: string }
   }
   ```
   Session exists during OAuth round-trip with `userId` ABSENT (only `pending.codeVerifier` + `pending.state` populated). After callback succeeds, `userId` gets set. **Binding implication**: the userId extractor cannot assume `session !== null → userId !== undefined`. Must defensively check `ctx.session?.userId` (3-step: ctx exists, session non-null, userId present).

**Union shape (the structural type the binding must accept)**:
```ts
interface ScopedContext {
  session?: {                  // optional: template-postgres has no session
    userId?: string             // optional: auth-providers-diy-github pre-callback
    sessionId?: string          // future: tier 2 scope (v0.2 plan)
    agentId?: string            // future: tier 3 scope (v0.2 plan)
  } | null                      // null: all session-bearing fixtures when unauth'd
}
```

Three states the binding's userId resolver MUST handle gracefully:

| State | Trigger | Recommended behavior (for ADR D-scope-resolution) |
|---|---|---|
| (a) `ctx.session.userId` is `string` | All 4 session-bearing fixtures, authenticated | Return `ScopedMemory` rooted at userId |
| (b) `ctx.session` is `null` | Session-bearing fixture, unauthenticated request | Throw `MissingScopeError('authenticated session required')` — fail loud; consumer should `requireAuth(ctx.session)` BEFORE calling binding |
| (c) `ctx.session` field absent (no session field at all) | `template-postgres` fixture | Throw `MissingScopeError('binding requires session-bearing TheoKit context — wire createSessionManager first')` OR ADR-defer with `memory.anonymous()` fallback for system-wide memory |

**Implication for binding contract**:
- The binding's structural `ScopedContext` interface must allow `session?: T | null` (both undefined AND null), AND `userId?: string` within `T`.
- Consumer guidance: call `requireAuth(ctx.session)` (TheoKit helper, see `me.ts:7` in Q4) BEFORE invoking `memoryFromCtx(ctx)` to narrow the type at the consumer site.
- The DIY-OAuth-pre-callback edge case is real, not theoretical — proof that "session.userId is always set when session is non-null" is FALSE across the fixture matrix.
- Cookie names + auth backends vary; the binding is decoupled from both because it consumes `ctx.session.userId`, NOT `cookies` or `request.headers.authorization` (mirrors Letta's `actor_id` header decoupling from Bearer-token auth, Q2).

### Technique 2 — Request-scoped context propagation: arg-passed vs AsyncLocalStorage (Q6)

**Finding: TheoKit uses EXCLUSIVELY arg-passed context propagation. Confirmed by exhaustive search: ZERO `AsyncLocalStorage` and ZERO `async_hooks` references across `../theokit/packages/`, `../theokit/fixtures/`, OR anywhere else in the project outside `node_modules`/`referencias`/`dist`. Per request, `middleware-runner.ts` calls `createContext({ request, response })` once and passes the returned `ctx` as a named property to the handler. This is a DELIBERATE architectural choice — no opt-in/opt-out — and the TheMemory binding MUST follow the same convention.**

Two-phase evidence:

1. **Exhaustive negative search** (Fase A — `grep -rn "AsyncLocalStorage\|async_hooks" ../theokit/`):
   - `../theokit/packages/`: 0 hits
   - `../theokit/fixtures/`: 0 hits
   - Project-wide (excluding `node_modules`, `referencias`, `dist`): 0 hits

   The total absence proves AsyncLocalStorage is not an implementation detail "hidden inside the framework" — it is not used at all.

2. **Per-request context creation** (`../theokit/packages/theo/src/server/middleware-runner.ts:115-126`):
   ```ts
   // 4. Create context (if exists)
   let ctx: unknown = {}
   const contextPath = join(serverDir, 'context.ts')
   if (existsSync(contextPath)) {
     const mod = await loadModule(contextPath)
     const createContext = mod.createContext as ContextFactory | undefined
     if (typeof createContext === 'function') {
       ctx = await createContext({ request: req, response: res })
     }
   }
   return { ctx, aborted: false }
   ```
   Every request synthesizes a fresh `ctx` via the consumer's `createContext`. No global store, no contextvar, no async-local container. The ctx is a plain function-local variable returned from the middleware runner, then passed positionally to the handler invocation.

3. **Handler signature contract** (`../theokit/packages/theo/src/server/define-route.ts:23-29`, confirmed at consumer site `../theokit/fixtures/template-saas/server/routes/me.ts:6`):
   ```ts
   handler: (ctx: { query, body, params, request: Request, ctx: TCtx }) => ...
   ```
   The handler receives `ctx` as a destructurable argument. There is no `getContext()` / `getStore()` accessor in the public API.

**Design implications for the binding** (inputs for ADR D-context-propagation):

| Dimension | Implication |
|---|---|
| Binding API shape | MUST be a function accepting `ctx` explicitly: `memoryFromCtx(ctx)`. No `getCurrentMemory()` / `useMemory()` accessor — there's no context container to query. |
| Type signature | `function memoryFromCtx<T extends ScopedContext>(ctx: T, memory: Memory): ScopedMemory` — generic preserves consumer's narrowed ctx type, returns scoped instance. |
| Per-request isolation | GUARANTEED at framework level — each request gets its own ctx from `createContext({request, response})`. Binding cannot accidentally leak scope across concurrent requests (no shared mutable container). |
| Test ergonomics | Trivially testable: pass a mock ctx object to `memoryFromCtx`. No async-context setup boilerplate. Matches Letta's pattern (Q2) where tests invoke handlers with a stub `HeaderParams`. |
| Consumer code verbosity | Higher — every handler must thread `ctx` to `memoryFromCtx(ctx)`. AsyncLocalStorage would hide this, but TheoKit's choice is explicit-over-implicit. The binding inherits this trade-off. |
| Memory instance lifecycle | Memory instance is `app-scoped` (created once at startup, captured in closure or imported as singleton); per-REQUEST scoping happens via `memoryFromCtx(ctx, memory)` returning a scoped view. Mirrors v0.1's `memory.user(id)` factory (shipped 2026-05-23). |

**Implication for `referencia/` precedent comparison**:

| Project | Propagation mechanism | Per-request isolation |
|---|---|---|
| TheoKit (target) | Arg-passed `ctx` from `createContext` (Q3, Q6) | Framework-guaranteed |
| Mem0 server (Q1) | Arg-passed in request body (`MemoryCreate.user_id`) | App-level (consumer must enforce) |
| Letta (Q2) | `Depends(get_headers)` FastAPI DI; same SHAPE as arg-passing | Framework-guaranteed |
| **Common pattern** | **Explicit per-request scope, never global** | **Always framework-level when framework-controlled** |

All three converge on the same SHAPE (explicit per-request scope) via different mechanisms. TheMemory's binding inherits this convention; AsyncLocalStorage is rejected NOT because TheoKit forbids it, but because TheoKit doesn't use it AND doing so would introduce a divergent pattern in a binding intended to feel native.

**Rejected alternative** (for ADR D-context-propagation Alternatives):
- Wrapping `createContext` to register a per-request AsyncLocalStorage container, then exposing `getCurrentMemory()` — rejected because (a) zero precedent in TheoKit, (b) per-request initialization overhead, (c) violates principle-of-least-surprise for consumers reading the binding source, (d) Letta + Mem0 precedents also explicit-arg.

### Technique 3 — Auth-side `session.userId` construction via `createSessionManager` (Q7)

**Finding: `session.userId` is 100% consumer-controlled — it's just an arbitrary string the consumer passes to `ctx.sessions.createSession(res, { userId, ... })` at login. TheoKit's `createSessionManager` encrypts whatever opaque payload you give it (AES-GCM via `encrypt(envelope, secrets[0])`) and ships it as an httpOnly cookie. Stability across requests is cookie-driven (default 7-day maxAge); namespace collision risk is ENTIRELY a consumer concern. The binding MUST treat `ctx.session.userId` as-is — no normalization, no prefixing, no validation beyond presence.**

Four sources interrogated:

1. **`createSessionManager` factory signature** (`../theokit/packages/theo/src/server/session.ts:83-86`):
   ```ts
   export function createSessionManager<TSession>(config: SessionConfig): SessionManager<TSession> {
     const secrets = normalizeSecrets(config.secret)
     const cookieName = config.cookieName ?? 'theo_session'
     const maxAge = config.maxAge ?? 604800 // 7 days
   ```
   Generic `<TSession>` — the framework makes ZERO assumptions about what fields `TSession` carries. `userId` is just a field name the consumer chose; from the framework's perspective, the session data is an opaque envelope.

2. **`createSession` write path** (`../theokit/packages/theo/src/server/session.ts:147-150`):
   ```ts
   async createSession(res, data) {
     const token = await encryptEnvelope(data)
     writeCookie(res, token)
   },
   ```
   `data` is the consumer-supplied object (typed as `TSession`). It gets wrapped in `SessionEnvelope<TSession> = { data, exp }`, encrypted with the newest secret, and written as the cookie value. The framework does NOT introspect `data.userId` — it could be `data.foo`, `data.actorIdentifier`, anything.

3. **Consumer-side userId construction** (`../theokit/fixtures/template-saas/server/routes/login.ts:15-23`):
   ```ts
   handler: async ({ body, ctx }) => {
     // DEMO ONLY — replace with bcrypt/argon2 password comparison
     const userId = `u-${body.email}`
     await ctx.sessions.createSession(ctx.res, {
       userId,
       email: body.email,
     })
     return { ok: true, email: body.email }
   },
   ```
   The userId STRING is computed at login time by consumer code. In this fixture, it's `u-${email}`; in a real app, it'd be a UUID from the users table, a Stripe customer ID, an OAuth `sub` claim, etc. **The binding has no opinion on which scheme consumers use.**

4. **`getSession` read path with rotation fallback** (`../theokit/packages/theo/src/server/session.ts:127-145`):
   ```ts
   async getSession(req) {
     const { data } = await this.getSessionWithMeta(req)
     return data
   },
   async getSessionWithMeta(req) {
     const raw = getCookie(req, cookieName)
     if (!raw) return { data: null, meta: {...} }
     const decoded = await decryptWithFallback(raw)
     if (!decoded) return { data: null, meta: {...} }
     if (decoded.envelope.exp < Date.now()) {
       return { data: null, meta: {...} }
     }
     return { data: decoded.envelope.data, meta: {...} }
   },
   ```
   Decrypts cookie → validates exp → returns original `data`. As long as (a) cookie not deleted, (b) rotation key match works, (c) exp hasn't elapsed, the IDENTICAL `data` object (incl. `userId`) is returned on every request.

**Stability properties**:

| Property | Status | Notes |
|---|---|---|
| `userId` stable across requests for one user | YES (per-cookie) | Cookie maxAge defaults to 7 days; configurable per `SessionConfig.maxAge` |
| `userId` survives server restart | YES | Stateless session; encryption key (secrets) must persist across restarts (env var typical) |
| `userId` survives secret rotation | YES (with caveats) | Dual-key rotation supported (CR-002 constant-time parallel decrypt across all rotation entries); old sessions transparently re-encrypted on next request |
| `userId` invalidates on logout | YES | `destroySession(res)` deletes the cookie |
| `userId` survives password reset | DEPENDS on consumer | Framework doesn't tie userId to credentials; if consumer re-issues a new `userId` on reset, old cookie becomes orphan until natural expiry |

**Namespace collision risk analysis**:

| Risk vector | Framework-level? | Mitigation locus |
|---|---|---|
| Two real users assigned same `userId` string | NO (consumer-driven) | Consumer's user table PK + login flow |
| Two apps sharing same domain + cookie name + secret | NO (deployment config) | Distinct `cookieName` per app OR distinct domains |
| Cross-tenant scope leakage in multi-tenant SaaS | NO | Consumer composes `userId` with tenant prefix if needed: `userId: \`t-${tenantId}-u-${userId}\`` |
| Binding accidentally widening scope | NO (binding is read-only on `ctx.session.userId`) | Binding's static analysis (TypeScript) confirms binding never mutates session |

**Implication for the binding**:
- The binding TRUSTS `ctx.session.userId` as the canonical scope identifier — no normalization, no transformation, no validation beyond `typeof === 'string' && length > 0`.
- If consumer wants tenant-aware namespacing, that's THEIR responsibility (compose at login time). Binding stays neutral — matches Mem0's `user_id` body field (Q1) and Letta's `actor_id` header (Q2) where the framework is also opaque to scope semantics.
- **Edge case from Q5** (`auth-providers-diy-github`): during OAuth round-trip, `session.userId` is `undefined`. Binding's resolver MUST handle three states explicitly — already documented in Q5's resolver table.
- **Session rotation does NOT invalidate scope** — userId persists across re-encrypts. Memory entries written under userId X will remain queryable under X across rotation events; no migration needed.
- **No precedent for auto-resolution from authn payload to memory scope exists in any sibling** (per Q1/Q2 findings) — TheMemory's binding is the first in the design space; the binding's design choices set the convention for this corner of the ecosystem.

---

## Cross-cutting Comparison

A consolidated side-by-side view across the binding target + precedents:

| Dimension | TheoKit (target) | Mem0 (precedent) | Letta (precedent) |
|---|---|---|---|
| Request → ctx flow | Per-request `createContext({request, response})` → arg-passed to handler (Q5 + Q6) | Per-request HTTP body parsed by FastAPI; no framework ctx object — body fields ARE the scope (Q1) | Per-request `Depends(get_headers)` injects `HeaderParams` into handler args (Q2) |
| Scope resolution mechanism | Read `ctx.session.userId` from arg-passed ctx; consumer wrote it at login via `createSessionManager` (Q5 + Q7) | Read `request.body.user_id` directly — consumer puts it in payload per call (Q1) | Read `headers.actor_id` from `Depends(get_headers)` — consumer sets HTTP header per request (Q2) |
| Default-on integration pattern | Static-template scaffolder (`create-theo`) — direct edit of template files; no plugin API (Q4) | None — consumer manually instantiates `Memory` + passes user_id per call (Q1) | None — consumer manually invokes `MemoryService` + passes actor (Q2) |
| Test approach for binding/per-request | Pass mock ctx object to handler/binding function (no framework setup) — derived from Q5/Q6 patterns | Real Memory + explicit user_id in body fixtures (Q1) | Server-in-thread fixture + LettaSDKClient hitting localhost:8283 (Q2) |

## ADRs

> Decisions that emerge from the synthesis. Each has alternatives + rationale + consequences. The cycle-plan that follows this blueprint (`/to-plan v0-2-theokit-binding`) will ratify or revise each one.

### D1 — Structural typing over peer-dep on `theokit`

**Decision:** `@usetheo/memory/theokit` ships with ZERO peer-dep on the `theokit` package. The binding consumes ctx via a locally-declared structural interface `ScopedContext { session?: { userId?: string; sessionId?: string; agentId?: string } | null }`.

**Alternatives considered:**
- (A) Hard peer-dep on `theokit ^0.1.0-alpha` + import `RouteConfig` for first-class types — REJECTED.
- (B) Optional peer-dep with conditional type narrowing — REJECTED (complexity for marginal type benefit).
- (C) Selected: structural typing, no peer-dep — Q3 evidence.

**Rationale:** TheoKit's `defineRoute<TCtx = unknown>` (Q3, `../theokit/packages/theo/src/server/define-route.ts:7`) defaults `TCtx` to `unknown` — the framework itself doesn't commit to a ctx shape. Adding a peer-dep would tie TheMemory's release cadence to TheoKit's alpha range (currently `0.1.0-alpha.5`); any TheoKit breaking change would force a TheMemory release. Letta precedent (Q2): scope-carrying objects are structurally consumed without importing framework types.

**Consequences:**
- TheMemory ships independent semver; no lockstep with TheoKit.
- Loss of first-class `RouteConfig` types in binding source — acceptable because binding only narrows `session.userId` field.
- Binding works against ANY framework whose ctx happens to expose `{session: {userId?: string}}` — broader applicability for free.
- TypeScript users still get full type inference at handler site because TheoKit's `defineRoute<TCtx>` preserves `TCtx` end-to-end.

### D2 — Arg-passed binding API (no `getCurrentMemory()` accessor)

**Decision:** Binding exposes only a pure function `memoryFromCtx(ctx, memory)`. No global accessor, no AsyncLocalStorage, no context container.

**Alternatives considered:**
- (A) Wrap `createContext` with AsyncLocalStorage + expose `getCurrentMemory()` — REJECTED.
- (B) Custom React-style hook `useMemory()` — REJECTED (not a React context).
- (C) Selected: pure arg-passed `memoryFromCtx(ctx, memory)` — Q6 evidence.

**Rationale:** Q6 confirmed ZERO `AsyncLocalStorage` / `async_hooks` usage across `../theokit/packages/` and `../theokit/fixtures/`. TheoKit's explicit-over-implicit choice is deliberate; introducing an async-local container in a binding intended to feel native would violate principle-of-least-surprise. Letta + Mem0 precedents (Q1/Q2) also use explicit arg-passing.

**Consequences:**
- Consumer code must thread `ctx` to `memoryFromCtx(ctx, memory)` at every handler — verbosity trade-off accepted.
- Per-request isolation framework-guaranteed (each request gets fresh ctx); zero risk of cross-request scope leakage from binding-level mistake.
- Trivially testable: pass a mock ctx object; no async-context setup boilerplate.
- Memory instance is app-scoped singleton (created once at startup, imported into handler module); per-request scope is the `ScopedMemory` view returned by `memoryFromCtx`.

### D3 — Default-on memory in `create-theo` scaffolded templates (deliberate lock-in surface)

**Decision:** `@usetheo/memory` ships pre-wired in DB-bearing scaffolded templates (`saas`, `postgres`). Consumer's first scaffolded handler can call `memoryFromCtx(ctx).remember(text)` without manual setup. `--bare` strip symmetry mandatory (mirrors existing `@usetheo/sdk` strip).

**Alternatives considered:**
- (A) Memory available but OPT-IN — require consumer to `npm install @usetheo/memory` + manually wire — REJECTED (defeats the consolidation pitch).
- (B) Default-on in ALL templates (incl. `default`, `api-only`) — REJECTED (those have no sessions; runtime error worse than absent dep).
- (C) Selected: default-on in DB-bearing templates only (`saas`, `postgres`); `--bare` symmetry — Q4 evidence.

**Rationale:** This is the **lock-in surface** ratified at CLAUDE.md § Architectural Decisions Locked (override of Cross-Project Rule 6). The "managed memory of TheoCloud, optimized for TheoKit" narrative requires consumer's FIRST handler to have working memory without separate research/install steps. Per Q4, `create-theo` has no plugin API — default-on requires direct edits to `templates/{name}/`. Templates without sessions can't default-on without surfacing a confusing "missing scope" error.

**Consequences:**
- TheMemory PRs touching scaffolding must also touch `../theokit/packages/create-theo/templates/` (T-T+1 coordination).
- Template snapshot test mandatory: scaffolded `saas` output must contain `"@usetheo/memory"` in `package.json` deps AND a demo `server/routes/memory.ts` file.
- `--bare` strip MUST drop `@usetheo/memory` while package unpublished (mirrors current `@usetheo/sdk` handling).
- Lock-in is at the BEHAVIOR level (scaffolded template default + binding pre-wired), NOT the TYPE level (per D1).

### D4 — Defensive scope resolution: 3 explicit states

**Decision:** Binding's scope resolver explicitly handles three states:

| State | Trigger | Behavior |
|---|---|---|
| (a) `ctx.session.userId` is non-empty string | Authenticated request, session-bearing fixture | Return `ScopedMemory` rooted at userId |
| (b) `ctx.session` is `null` | Unauthenticated request, session-bearing fixture | Throw `MissingScopeError('authenticated session required')` |
| (c) `ctx.session` field absent OR `ctx.session.userId` undefined | Non-session fixture (`template-postgres`) OR OAuth round-trip (`auth-providers-diy-github`) | Throw `MissingScopeError('binding requires session-bearing TheoKit context — wire createSessionManager first')` |

**Alternatives considered:**
- (A) Single-state: assume `ctx.session.userId` always present, NPE if absent — REJECTED (poor DX, hides Q5 edge cases).
- (B) Fallback to `memory.anonymous()` for absent session — DEFERRED (out of v0.2 scope; revisit at v0.3 if real consumer asks).
- (C) Selected: 3 explicit states with fail-loud errors — Q5 evidence.

**Rationale:** Q5 surveyed all 5 TheoKit fixtures and found genuine variation: `template-postgres` has no session field at all; `auth-providers-diy-github` has `userId?: string` (optional). Pretending these cases don't exist would produce confusing runtime errors. Fail-loud is consistent with Inquebrável Rule 8 (fail-fast, fail-clear).

**Consequences:**
- Binding's runtime check has explicit error class `MissingScopeError` (sub-type of existing `MissingScopeError` from `@usetheo/memory/core` v0.1).
- Consumer guidance documented: call `requireAuth(ctx.session)` BEFORE `memoryFromCtx(ctx)` to satisfy state (a).
- The `template-postgres` template is NOT in scope for D3 default-on (it has no session) — confirms D3's scope-narrowing.
- Anonymous-memory feature deferred to a future cycle if demand surfaces.

### D5 — Test pyramid: in-process handler tests + scaffolded-template snapshot

**Decision:** v0.2 ships three test layers, in order of value-per-token:

| Layer | What it tests | How |
|---|---|---|
| Unit | `memoryFromCtx(mockCtx, mockMemory)` returns scoped instance for state (a), throws for (b) and (c) | In-process — no real ctx, no real Memory; just the function under test |
| Integration | Real handler invoked with a mock ctx containing `{session: {userId: "u1"}}` writes a real memory; second handler invocation with `{session: {userId: "u2"}}` produces ZERO overlap on recall | In-process handler invocation against real `createLocalMemory` instance + ephemeral pgvector container (reuses v0.1's container fixture) |
| E2E | `create-theo --template=saas` scaffolds; the scaffolded app's demo `memory.ts` route accepts a POST and persists under correct userId | Spawn scaffolded app in subprocess + HTTP client + assert via DB query |

**Alternatives considered:**
- (A) Server-in-thread fixture (Letta-style, Q2 evidence `referencia/letta/tests/test_sdk_client.py:1-50`) — REJECTED (TheoKit has no SDK client to test against; overkill).
- (B) Skip E2E entirely; trust integration tests — REJECTED (acceptance criterion from discovery plan mandates "Scaffolded template snapshot test" + "E2E with HTTP request").
- (C) Selected: 3-layer pyramid — derived from Q2 (Letta tests) + Q4 (scaffolding snapshot).

**Rationale:** v0.1 already proved in-process integration tests + ephemeral Postgres + real LLM stubs are sufficient for confidence. Letta's server-in-thread pattern doesn't translate (no SDK client). The discovery plan's acceptance criteria require an E2E test against a scaffolded app — that becomes the topmost layer.

**Consequences:**
- E2E test requires `npm install` inside a temp dir of the scaffolded app — slow (~30s per test); mark with `@slow` flag, run in CI but not pre-commit.
- Template snapshot test (cheap, ~1s) provides a fast canary if `create-theo` template drifts.
- Integration test reuses v0.1's `createLocalMemory` factory — zero new fixture infra needed for the binding layer.

## Recommendations for TheMemory

> Concrete v0.2 plan inputs. Each links to research question + ADR + project rule.

| Recommendation | Source | ADR | Project rule alignment |
|---|---|---|---|
| Ship `@usetheo/memory/theokit` subpath as a single 50-100 LoC module: structural `ScopedContext` interface + `memoryFromCtx(ctx, memory)` function + `MissingScopeError` class | Q3, Q5, Q6 | D1 + D2 + D4 | `architecture.md` § 3 (DIP — binding depends on abstraction `ScopedContext`, not concrete TheoKit type) |
| Add `@usetheo/memory` to `templates/saas/package.json.tmpl` + `templates/postgres/package.json.tmpl` (NOT `default`, `api-only`, `dashboard`) | Q4 | D3 | CLAUDE.md § Architectural Decisions Locked override #1 (deliberate lock-in surface) |
| Add demo route `templates/saas/server/routes/memory.ts` exercising `memoryFromCtx(ctx).remember(text)` from `ctx.session.userId` | Q4, Q5 | D3 + D4 | `public-copy.md` § 2 (consumer's first handler "just works") |
| Extend `bare-transform.ts` (`../theokit/packages/create-theo/src/bare-transform.ts`) to `delete pkg.dependencies['@usetheo/memory']` while package unpublished | Q4 | D3 | Inquebrável Rule 3 (extreme honesty — `npm install` must succeed) |
| Template snapshot test asserts `package.json` contains `"@usetheo/memory"` AND `server/routes/memory.ts` exists for `saas` + `postgres` templates | Q4 | D5 | `testing.md` § Pirâmide (snapshot is integration-tier; cheap; fast) |
| Integration test: invoke handler with `{session: {userId: "u1"}}` → `remember()`; invoke with `{session: {userId: "u2"}}` → `recall()` returns ZERO overlap | Q5, Q7 | D4 + D5 | Discovery plan Acceptance Criteria: "Isolation test: two distinct user_id values produce disjoint recall() result sets (zero overlap)" |
| E2E test: spawn scaffolded `saas` app; HTTP POST with auth cookie → assert DB row written under correct userId | Q4, Q5, Q7 | D5 | Discovery plan Acceptance Criteria: "HTTP request with auth header → remember() inside handler persists under correct user_id" |
| Documentation: README section on binding shows the 3 states from D4 + the `requireAuth(ctx.session)` consumer-side guard pattern | Q5 | D4 | `public-copy.md` § 2 (lock-in positioning honesty: explain when binding doesn't apply) |

## Blocked questions (if any)

| Question | Reason | Suggested human follow-up |
|---|---|---|
| (none) | All 7 questions resolved | — |

## Halt-loop progress (audit trail)

- Iterations used: 7 / 30
- Questions answered: 7 / 7
- Questions blocked: 0
- Citations verified: all referencia/ + ../theokit/ paths confirmed via `Path.exists()`
- Promise emitted at iteration: 7

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/v0-2-theokit-binding-plan.md` (v1.0)
- Confidence report: `.claude/knowledge-base/reviews/v0-2-theokit-binding-confidence-{YYYY-MM-DD}.json` (will be generated by `/discover-confidence`)
- Linked TheMemory rules: `.claude/rules/architecture.md` § 1 (three-tier scope), § 3 (DIP), § 5 (two runtimes); `.claude/rules/public-copy.md` § 2 (lock-in positioning anchor)
- Sibling completed discovery: `.claude/knowledge-base/discoveries/blueprints/v0-1-local-runtime-blueprint.md` (v0.1 local runtime — produced the `createMemory` factory this binding wraps)

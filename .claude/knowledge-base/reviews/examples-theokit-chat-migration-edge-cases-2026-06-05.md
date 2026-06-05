# Edge Case Review — examples-theokit-chat-migration

Data: 2026-06-05
Tasks analisadas: 11 (T0.1, T1.1, T1.2, T2.1, T2.2, T3.1, T3.2, T4.1, T5.1, T5.2, T6.1)
Edge cases encontrados: **12 total** (MUST FIX: 4, SHOULD TEST: 5, DOCUMENT: 3)

## MUST FIX

### EC-1: `theokit ^0.4.0` may NOT be published as standalone npm package

- **Task afetada:** T1.2 (Sub-goal 1)
- **Família:** Resource (dep availability)
- **Cenário:** Plan declares `dependencies.theokit: ^0.4.0` per ADR D1. Empirical check: `theokit/examples/full-stack-agent/package.json` uses `"theokit": "workspace:*"` — this implies `theokit` is **workspace-only**, NOT published as standalone. `npm view theokit version` may return 404 / not exist OR return a different version line entirely.
- **Impacto:** T1.2 step 6 (`npm install`) fails immediately with `npm ERR! 404 Not Found: theokit@^0.4.0`. Phase 1 BLOCKED. Plan non-viable until resolved.
- **Fix sugerido:** Add T0.1 PRE-FLIGHT check (step 0): `npm view theokit version 2>&1` — if 404 OR workspace-only, **stop the plan IMMEDIATELY** and surface to user: "TheoKit not published; options: (a) publish theokit to npm registry first; (b) monorepo-link via `file:../../../theokit-tools/theokit/packages/theo` like the current `@usetheo/memory: file:../..` pattern; (c) move `examples/chat-with-memory/` INTO the theokit monorepo." Each option is a 30-min decision that re-shapes the plan.

### EC-2: `@theokit/sdk` vs `@usetheo/sdk` — plan conflates two DIFFERENT packages

- **Task afetada:** T3.2 (Sub-goal 5)
- **Família:** Boundary (package identity)
- **Cenário:** Current `examples/chat-with-memory/package.json` has `"@usetheo/sdk": "1.3.0"`. TheoKit canonical example (`theokit/examples/full-stack-agent`) has `"@theokit/sdk": "workspace:*"`. The plan uses **both names interchangeably** (ADR D5 says "Replace `openai` direct dep with `@theokit/sdk` `Agent.prompt`" while T3.2 § Files-to-edit doesn't update the package name). These are EITHER the same package under two names (npm-scoped vs branded) OR two genuinely-different siblings.
- **Impacto:** Migration imports `@theokit/sdk` but `package.json` still has `@usetheo/sdk` — runtime `Cannot find module '@theokit/sdk'`. OR the user-intended package is `@usetheo/sdk` and plan ADR D5 is using wrong name throughout.
- **Fix sugerido:** Add T0.1 pre-flight check: `npm view @theokit/sdk version` AND `npm view @usetheo/sdk version`. Then plan ADR D5 must be amended to NAME THE CORRECT package explicitly. If they ARE the same package: drop `@usetheo/sdk` and add a 1-line clarification in ADR D5 ("the npm-scoped name is `@usetheo/sdk@1.3.0`; the brand-internal name is `@theokit/sdk`"). If they are DIFFERENT: pick one + justify per Rule 9.

### EC-3: `@usetheo/memory/theokit` subpath presence in published rc.4 NOT verified

- **Task afetada:** T3.1 (Sub-goal 4)
- **Família:** Boundary (claim vs reality)
- **Cenário:** Plan claims v0.2 PR-A shipped this subpath at PR #11. Empirical check at theo-memory `package.json#exports` shows `"./theokit"` IS present (Read tool inspection during session: `./theokit: { types: ./src/theokit/index.ts, default: ./src/theokit/index.ts }`). HOWEVER the plan declares `dependencies."@usetheo/memory": "file:../.."` — under the file: protocol, npm resolves the LOCAL package state. Local state has `./theokit` exports map per package.json, but local also has `dist/` build artifacts which may or may not have `./theokit` resolved post-build. **Plus**: `memoryFromCtx` named export — does it actually exist in `src/theokit/index.ts`? Plan didn't grep.
- **Impacto:** T3.1 step 1 `import { createLocalMemory, memoryFromCtx } from '@usetheo/memory/theokit'` may import `memoryFromCtx` that doesn't exist; runtime error OR typescript compile error.
- **Fix sugerido:** Add T0.1 sentinel test 7: `grep -q 'export.*memoryFromCtx' src/theokit/index.ts` (verifies the canonical export exists). If it doesn't, plan T3.1 needs to ALSO add the export, which expands scope significantly.

### EC-4: `memoryFromCtx(ctx, memory)` requires wired TheoKit session — plan doesn't include session manager setup

- **Task afetada:** T3.1 (Sub-goal 4)
- **Família:** State (session wiring)
- **Cenário:** Per TheoKit CLAUDE.md: "AUTH-DELEGATION — LOCKED 2026-05-19: TheoKit ships 5 RFC-stable protocol primitives PLUS session primitives (`createSessionManager`, `requireAuth`, `rotateSession`)." TheoKit sessions are **opt-in via `createSessionManager` wiring**. The current Next.js demo likely doesn't wire any session (chat round-trip uses URL query params or req.body for scope). Plan T3.1 says "uses `memoryFromCtx(ctx, memory)` to derive scope from `ctx.session.userId`" — but `ctx.session` will be UNDEFINED if no session manager wired.
- **Impacto:** Every memory route throws `Cannot read property 'userId' of undefined`. Demo fully broken at runtime.
- **Fix sugerido:** Plan T3.1 must include sub-task: "Wire TheoKit session manager (`createSessionManager` in `app/_entry.tsx` OR `server/middleware/*.ts`) with a minimal anonymous-user-id strategy (e.g., cookie-derived UUID per browser session) before `memoryFromCtx` is called." This is ~30 LoC + 1 ADR section. Alternative: use a SIMPLER scope-derivation pattern (e.g., user-id from URL query param like current demo) and SKIP `memoryFromCtx` adoption, framing the migration as "TheoKit entrypoint adoption" only. **Recommended**: bump plan to v1.1 with NEW T3.0 (Wire session manager) before T3.1.

## SHOULD TEST

### EC-5: `app/api/` actual file inventory NOT enumerated

- **Task afetada:** T2.1 (Sub-goal 2)
- **Teste sugerido:** `test_app_api_routes_enumerated` — at T0.1 sentinel test 8 OR T2.1 step 0: run `find examples/chat-with-memory/app/api -name 'route.ts' -type f`. Plan lists 7 expected routes (info/memories/history/skills/reflect/distill/forget); empirical count may differ. Each missed route = silently-broken tab. Recommendation: T2.1 step 0 ENUMERATE first, then migrate ALL discovered files.

### EC-6: TheoKit Vite + Tailwind CSS pipeline migration NOT addressed

- **Task afetada:** T1.1 (Sub-goal 1)
- **Teste sugerido:** `test_tailwind_directives_resolved_post_migration` — TheoKit uses `@tailwindcss/vite` (per `theokit/examples/full-stack-agent`). Current demo uses `postcss.config.mjs` + Tailwind. Plan T1.1 DELETES `postcss.config.mjs` but doesn't add `@tailwindcss/vite` config. If `app/globals.css` has `@tailwind base/components/utilities` directives, build fails.

### EC-7: TheoKit `.env` reading conventions vs Next.js

- **Task afetada:** T1.2 (Sub-goal 1)
- **Teste sugerido:** `test_env_vars_read_post_migration` — verify TheoKit reads `examples/chat-with-memory/.env` same as Next.js. Likely YES (both use `dotenv` under the hood) but unverified. If TheoKit requires `.env.local` OR a different prefix (e.g., `VITE_*` for client-side; `process.env.*` for server), all 3 env vars (`THEOMEM_PG_URI`, `OPENAI_API_KEY`, `THEOKIT_API_KEY`) silently unset → chat + memory broken.

### EC-8: Test file discovery — `tests/integration/examples/*` vs `examples/chat-with-memory/server/routes/__tests__/*`

- **Task afetada:** T0.1 + T2.2 (Sub-goal 2)
- **Teste sugerido:** T0.1 file at theo-memory ROOT (`tests/integration/examples/theokit-chat-migration.test.ts`) is picked up by `vitest.integration.config.ts` glob (which scans `tests/integration/**/*.test.ts`). HOWEVER T2.2 § Files-to-edit says `examples/chat-with-memory/server/routes/__tests__/*.test.ts` — **THIS PATH IS NOT IN VITEST'S GLOB**. Tests written, never run. Sentinel: assert that `npx vitest --reporter=json --no-color | jq '.testFiles[].name'` includes the new test paths.

### EC-9: Which 3 of 33 scenarios get ADR-deferred — enumerate CRITERIA, not post-hoc choice

- **Task afetada:** T5.2 (Sub-goal 7)
- **Teste sugerido:** `test_deferred_scenarios_have_explicit_criteria` — T5.2 step 1.5 must enumerate the OBJECTIVE criteria for deferral (e.g., "scenario depends on Next.js-specific build-time bundle fingerprint"; "scenario depends on RSC streaming") BEFORE the migration runs. Otherwise the implementer picks the EASIEST 3 to defer (post-hoc rationalization), hiding real coverage loss. Plan currently leaves this implicit. Should explicitly list which scenarios are AT-RISK and document the deferral decision pre-implementation.

## DOCUMENT

### EC-10: `theokit dev` cold-start may exceed 10s (Vite + better-sqlite3 ABI rebuild + 1000s of modules)

- **Risco aceito:** TheoKit `theokit dev` is Vite-backed (fast); BUT first-cold-start with full dep tree may exceed 10s due to (a) better-sqlite3 ABI preflight rebuild (per TheoKit native bindings discipline), (b) Vite indexing the dep graph, (c) initial Tailwind CSS compilation. Plan T6.1 acceptance says "boots in < 10s" — too aggressive. Recommend RELAX to `< 30s on cold start, < 5s on warm` in T6.1 acceptance.

### EC-11: `.theokit/` runtime directory handled by TheoKit framework

- **Risco aceito:** Current `examples/chat-with-memory/.theokit/agents/` + `.theokit/memory/` are TheoKit runtime state (conversation history per `@theokit/sdk` per agent ID; cached embeddings/memory artifacts). After migration, `theokit dev` may overwrite these. Acceptable — these are runtime artifacts, NOT load-bearing for the migration. Anchor scenario S1 dogfood evidence lives at `.claude/knowledge-base/dogfood/evidence/` (theo-memory root), NOT under `examples/`.

### EC-12: T2.1 must migrate ALL routes in ONE commit (not piecemeal)

- **Risco aceito:** If T2.1 migrates routes one-by-one across multiple commits, the demo is BROKEN MID-CYCLE between commits. Manual testing during the half-migrated state reveals false positives ("route X is broken"). Accept the constraint: T2.1 ships as a single atomic commit with all routes migrated simultaneously, even if it's a larger diff. Document in T2.1 Tasks: "All routes migrated in ONE commit; partial-state is non-viable per integration parity contract."

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 0 (sentinel additions are MUST-FIX absorptions, not T0.1 defects) | 0 | 0 | 0 |
| T1.1 | 2 (Tailwind, .theokit dir) | 0 | 1 (EC-6) | 1 (EC-11) |
| T1.2 | 3 (theokit availability, env vars, cold-start timing) | 1 (EC-1) | 1 (EC-7) | 1 (EC-10) |
| T2.1 | 2 (route enumeration, atomic commit) | 0 | 1 (EC-5) | 1 (EC-12) |
| T2.2 | 1 (test discovery) | 0 | 1 (EC-8) | 0 |
| T3.1 | 2 (subpath verify, session wiring) | 2 (EC-3, EC-4) | 0 | 0 |
| T3.2 | 1 (package name confusion) | 1 (EC-2) | 0 | 0 |
| T4.1 | 0 | 0 | 0 | 0 |
| T5.1 | 0 | 0 | 0 | 0 |
| T5.2 | 1 (deferral criteria) | 0 | 1 (EC-9) | 0 |
| T6.1 | 1 (cold-start timing — covered by EC-10) | 0 | 0 | 0 |
| **Total** | **12** | **4** | **5** | **3** |

**Veredicto:** **PLANO PRECISA DE AJUSTE**

4 MUST FIX edges (EC-1 ÷ EC-4) bloqueiam o plano. Sem absorvê-los, T1.2 / T3.1 / T3.2 falham determinísticamente. Recomendação:

1. **Bump plan v1.0 → v1.1** com pre-flight checks consolidados em T0.1 (steps 0a/0b/0c/0d):
   - 0a: `npm view theokit version` (EC-1)
   - 0b: `npm view @theokit/sdk version` + `npm view @usetheo/sdk version` (EC-2)
   - 0c: `grep -q 'export.*memoryFromCtx' src/theokit/index.ts` (EC-3)
   - 0d: Decision: session manager wiring path OR alternative scope-derivation (EC-4) — likely NEW T3.0 sub-task

2. **Inline SHOULD TEST absorptions** em T0.1 (sentinels 7+8) e T2.1 step 0.

3. **Re-rodar `/plan-confidence`** após v1.1 — verdict-flip esperado mesma trajetória dos prior planos desta sessão (v1.0 INVALID → v1.1 SHIPPABLE_WITH_CAVEATS após orphan-task cleanup, se aplicável).

Os MUST FIX são todos **discover-empirical-now** que cabem em ~30min de research + 1 commit de plan amendment. Não exigem novo cycle-discover; são gaps de pre-flight discipline que o plan v1.0 perdeu.

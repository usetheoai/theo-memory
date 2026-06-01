# Edge Case Review — adapters-openai-cycle-2

Data: 2026-06-01
Tasks analisadas: 7 (T0.1, T1.1, T1.2, T2.1, T3.1, T3.2, T4.1)
Edge cases encontrados: 10 (MUST FIX: 0, SHOULD TEST: 4, DOCUMENT: 6)

## MUST FIX

(none) — MOVE-only scope (ADR D3) bounds risk surface; all real-world concerns are either inherited from current demo behavior (DOCUMENT carried-over) or verifiable via test (SHOULD TEST).

---

## SHOULD TEST

### EC-1: Demo grep for `./openai-adapters` references BEFORE T3.2 delete (catch orphan importers)

- **Task afetada:** T3.1, T3.2
- **Família:** Integration
- **Cenário:** Plan claims "ONLY `lib/memory.ts` imports `./openai-adapters`" but this hasn't been mechanically verified across ALL demo paths (`app/`, `components/`, `lib/`). If a forgotten consumer exists (e.g., `app/api/*/route.ts` or `components/*-form.tsx`), T3.2 delete breaks demo build silently in CI but not necessarily in incremental TS server.
- **Teste sugerido:** Add as T3.1 sub-step BEFORE the import update: `find examples/chat-with-memory -name '*.ts' -o -name '*.tsx' | xargs grep -lE 'from .*openai-adapters' | wc -l` must return exactly **1** (only `lib/memory.ts`). If returns > 1, update ALL importers in T3.1 atomically; if returns 0, abort (plan claim was wrong).

### EC-2: Smoke tests do NOT hit network / require API key

- **Task afetada:** T1.1, T1.2
- **Família:** Boundary
- **Cenário:** New smoke tests at `src/{embedders,llms}/__tests__/openai.test.ts`. If a test accidentally `await embedder.embed(...)`, npm test in CI would hit OpenAI API (cost + 401 + flakiness). The lazy-singleton pattern guards INSTANTIATION but NOT method calls.
- **Teste sugerido:** Smoke test asserts ONLY (a) `expect(OpenAIEmbedder).toBeDefined()`, (b) `expect(typeof new OpenAIEmbedder().embed).toBe('function')`, (c) `expect(typeof new OpenAIEmbedder().embedBatch).toBe('function')`. **NEVER** `await embedder.embed('...')` in the smoke test. Add an explicit JSDoc note above the test: "DO NOT call .embed() / .embedBatch() here — hits live API".

### EC-3: Root `src/index.ts` import surface MUST NOT pull `openai` transitively

- **Task afetada:** T2.1
- **Família:** Boundary
- **Cenário:** Consumer who imports ONLY `@usetheo/memory` (root) for a stub-only use case should NOT pay bundle cost for the `openai` SDK. This requires verifying that root barrel does NOT re-export `OpenAIEmbedder` / `OpenAILLM` (per ADR D4 of Cycle 1) AND that no INTERNAL path under `src/core/` / `src/local/` imports anything that transitively pulls `src/embedders/openai.ts`.
- **Teste sugerido:** Extend `src/__tests__/no-root-reexport.test.ts` (already exists from Cycle 1 EC-6) to also assert `expect(root.OpenAIEmbedder).toBeUndefined()` AND `expect(root.OpenAILLM).toBeUndefined()`. Plus 1 new test: `import * as root from "../index.js"` followed by `try { require.resolve("openai"); /* should not be in resolve cache from root import */ }` — alternatively, use bundle-size sentinel test that imports root + asserts no `'openai'` substring in compiled module path.

### EC-4: `_tools?: readonly unknown[]` 3rd param actually exists in the DIP

- **Task afetada:** T1.2
- **Família:** Format
- **Cenário:** Plan ADR D3 says "MOVE-only with EXACTLY ONE addition: `_tools` 3rd param". This presumes `src/core/dip/llm.ts:LLM.generateResponse` actually has the 3rd param `tools?: readonly unknown[]`. Verify before T1.2 writes the new file — Cycle 1's fix-up cycle absorbed this via SEPA pre-RED brief; need to re-verify the DIP signature today.
- **Teste sugerido:** As T1.2 pre-flight: `grep -A3 "generateResponse" src/core/dip/llm.ts` confirms the signature has `tools?` parameter. If absent, the 3rd-param addition is invalid (would deviate from current DIP) — escalate to plan revision before T1.2 GREEN.

---

## DOCUMENT

### EC-5: Plan text misleadingly claims `MAX_EMBEDDING_DIM` constant is referenced

- **Risco aceito:** Plan § "Deep file dependency analysis" of T1.1 says "MAX_EMBEDDING_DIM constant from `src/core/constants.ts` referenced via symbolic import (matches Cycle 1 stub pattern)" — BUT the demo's OpenAIEmbedder does NOT reference MAX_EMBEDDING_DIM. The 1536 dim is implicit via the OpenAI model `text-embedding-3-small`. Removing the misleading sentence is doc-only; behavior is correct. Note this in T1.1 commit body: "demo's hard-coded model implies 1536 dim; no constant import per MOVE-only ADR D3 — plan claim about MAX_EMBEDDING_DIM was inaccurate, lifted file does NOT reference it".

### EC-6: optionalDependencies + TypeScript compilation in consumers using `--no-optional`

- **Risco aceito:** A consumer who runs `npm install --no-optional` to skip `openai` SDK download AND THEN imports `@usetheo/memory/embedders/openai` will encounter TypeScript compile error (can't resolve `'openai'` module). This is INTENTIONAL — consumers who opt out should NOT import openai paths. Document in JSDoc of the new files: "Requires `openai` SDK as an optionalDependency. Consumers using `npm install --no-optional` will get TS compile errors if they import this module; use `@usetheo/memory/embedders/stub` instead for offline/deterministic dev". Per Inquebrável Rule 3 (extreme honesty) + Rule 9 (use existing libs).

### EC-7: Hard-coded `EMBED_MODEL = 'text-embedding-3-small'` + `CHAT_MODEL = 'gpt-4o-mini'`

- **Risco aceito:** Consumers who want `text-embedding-3-large` (3072 dims) or `gpt-4o` (more capable) cannot configure via constructor param today. MOVE-only scope (ADR D3) defers this to a future Cycle 2.X (constructor parameterization). Current behavior matches demo today; consumer who needs other models can copy-paste the file. Document in JSDoc + add a `@todo Cycle 2.X: constructor param for model selection` marker.

### EC-8: Lazy singleton `_openai` — one client per process

- **Risco aceito:** Module-level `_openai: OpenAI | null` means ONE shared client across `OpenAIEmbedder` + `OpenAILLM` instances + ALL importers in the same process. Consumer who wants TWO OpenAI accounts (e.g., one for embedding production-tier + one for chat dev-tier) cannot today. Carried-over from demo. Document in JSDoc as `@remarks One client per process; constructor param for multi-account deferred to Cycle 2.X`.

### EC-9: `process.env.OPENAI_API_KEY` read on first `client()` call (late-set env hazard)

- **Risco aceito:** If env var is set AFTER first `embed()` call (e.g., dotenv `.env.local` loaded async via `import("dotenv/config")` AFTER the singleton instantiates), the first call uses `apiKey: undefined` → OpenAI client throws or sends 401. Carried-over from demo. Document in JSDoc: "process.env.OPENAI_API_KEY must be set BEFORE first .embed() call. If using dotenv, ensure `import 'dotenv/config'` runs before any import of this module".

### EC-10: `generateResponse({type:'json'})` returns opaque `{error: 'non_json_response', raw: content}` on parse failure

- **Risco aceito:** Per ADR D3 MOVE-only, the JSON-parse error path is PRESERVED verbatim from demo. Caller doesn't know the response was malformed unless they inspect the shape (`if (result.error === 'non_json_response')`). Carried-over from demo. Document in JSDoc: "On JSON parse failure, returns `{error: 'non_json_response', raw: <content>}` instead of throwing. Caller MUST check `result.error` before processing. Future Cycle 2.X may throw a typed `OpenAIJsonParseError` instead.".

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T1.1 | 4 | 0 | 1 | 3 (EC-5+EC-7+EC-8) |
| T1.2 | 3 | 0 | 1 | 2 (EC-7+EC-10 — EC-7 shared with T1.1) |
| T2.1 | 1 | 0 | 1 | 0 |
| T3.1 | 1 | 0 | 1 | 0 |
| T3.2 | 1 | 0 | (folded in EC-1) | 0 |
| T4.1 | 0 | 0 | 0 | 0 |
| Cross-cutting (EC-6 optionalDeps + EC-9 env) | 2 | 0 | 0 | 2 |
| **Total** | **10** | **0** | **4** | **6** |

**Veredicto:** PLANO OK — zero MUST FIX. Recommend absorbing the 4 SHOULD TEST items as sub-steps + the 6 DOCUMENT items as JSDoc notes + 1 plan-text correction (EC-5). After absorption: re-run `/plan-confidence` to validate v1.0 → v1.1 score.

Strong scope discipline (MOVE-only ADR D3 + 92 LoC lift) keeps edge-case surface narrow. All 6 DOCUMENT items are carried-over behaviors from existing demo — future Cycle 2.X hardening cycle can address them in scope.

# Edge Case Review — theo-memory-standalone-p0-fixes-cycle-2

**Date:** 2026-06-03
**Plan reviewed:** `.claude/knowledge-base/plans/theo-memory-standalone-p0-fixes-cycle-2-plan.md` v1.0
**Tasks analyzed:** 4 (T1.1 + T1.2 + T1.3 + T1.4) + Final Phase
**Edge cases identified:** 6 (MUST FIX: 1, SHOULD TEST: 3, DOCUMENT: 2)

**Veredicto:** **PLANO PRECISA DE AJUSTE** — 1 MUST FIX in T1.4 assertion path requires absorption before /implement; 3 SHOULD TEST + 2 DOCUMENT are small inline absorptions.

## Filosofia da revisão

Plan is structurally tight (4 tasks, ~35 LoC, all parallelizable on paper). The 5 absorptions all target documented spec-side gaps from cycle-1 review with runtime already correct. Surface area is small; risk surface is largely about library-output assumptions and TDD discipline at the test-vs-production-edit boundary.

The findings below are pragmatic — every MUST FIX has a ≤3-line code fix, every SHOULD TEST adds one assertion or one beforeEach line, and DOCUMENTs are inline acceptance-criteria notes.

## MUST FIX

### EC-1: T1.4 test #8 assertion path assumes `parameters[i].schema.description` — zod-to-openapi serialization is unverified

- **Task afetada:** T1.4 (F-arch-2 + F-dom-api-6 absorption)
- **Família:** Format / Boundary (zod-to-openapi library output shape)
- **Cenário:** Plan's test #8 asserts `typeParam?.schema?.description` propagates `.describe()` from `ScopeTypeEnum`. Verified empirically: NO existing `.describe()` usage in `src/server/` (grep returned zero hits). zod-to-openapi may serialize `.describe()` to EITHER `parameters[i].description` OR `parameters[i].schema.description` depending on whether the description lives on the enum schema or gets bubbled to the param level when the enum is referenced inside `z.object({ type: ScopeTypeEnum, ... })`. Without empirical verification, the test may FAIL at GREEN phase even though `.describe()` was correctly applied — implementer wastes time debugging the library output OR (worse) "fixes" the test with a wrong assertion path.
- **Impacto:** T1.4 halts at GREEN with library-output-mismatch debugging cost; potentially a malformed test assertion lands that masks future drift.
- **Fix sugerido (≤3 lines in the test):**
  ```ts
  // Walk BOTH possible paths — zod-to-openapi version may put the description
  // on the parameter object OR on the nested schema. Either is OpenAPI 3.1-conformant.
  const descr = (typeParam as { description?: string })?.description ?? typeParam?.schema?.description;
  expect(descr).toBeDefined();
  expect(descr).toMatch(/501|SDK-only/);
  expect(descr).toMatch(/skill/i);
  ```
  Update T1.4 § Deep Dives test assertion block to use the fallback chain. No production-code change needed.

## SHOULD TEST

### EC-2: T1.1 must clear `THEOMEM_MCP_TRANSPORT` env var in beforeEach (test pollution risk)

- **Task afetada:** T1.1
- **Teste sugerido:** Add `vi.stubEnv('THEOMEM_MCP_TRANSPORT', '')` in the `beforeEach` block alongside the existing `THEOMEM_PG_URI` stub. `resolveTransport()` at `run-mcp-server.ts:46-51` returns `'stdio'` by default when env is unset/empty, which matches the mocked `connectStdio` path. Without explicit clearing, an outer suite OR system env carrying `THEOMEM_MCP_TRANSPORT=streamable-http` would route to `connectStreamableHttp` and hit `resolvePort`/`resolveHost` paths the mock infrastructure isn't set up for.
- **Why this matters:** TheMemory tests run in CI and locally. Local devs may export `THEOMEM_MCP_TRANSPORT` during interactive testing; the test must be defensive.

### EC-3: T1.2/T1.3/T1.4 spec additions must NOT break existing test #1 swagger-parser OpenAPI 3.1 validation

- **Task afetada:** T1.2 + T1.3 + T1.4
- **Teste sugerido:** Existing `openapi.test.ts` test #1 (`returns valid OpenAPI 3.1 spec (swagger-parser validates)`) calls `SwaggerParser.validate(clone)`. The 3 new spec additions (501 + 4× 413 + ScopeTypeEnum description) MUST keep test #1 PASSING. Each task's DoD includes `npm test` green — but `openapi.test.ts` test #1 is the structural sentinel and must be verified per-task. If swagger-parser rejects (e.g., due to malformed `description` field, missing required key in 501/413 responses), test #1 catches it before commit.
- **No code change needed** — already implicitly covered by `npm test`. Just call it out explicitly in each task's acceptance criteria checkbox.

### EC-4: T1.1 manual RED verification must be reproducible — commit message MUST quote the verification steps

- **Task afetada:** T1.1
- **Teste sugerido:** T1.1's DoD already says "Manual RED verification documented in commit message". Add an inline assertion in the acceptance criteria that the commit message contains the literal substring `Verified RED by temporarily commenting lines 95-103 of run-mcp-server.ts`. A future auditor (or `/review` cross-validation agent) can grep `git log --grep='Verified RED by'` to confirm the discipline. Without the literal substring, the manual-RED claim is unverifiable.
- **Why this matters:** T1.1's "PASS-on-first-run RED test" is an explicit TDD-discipline departure (Inquebrável Rule 5 literal-sense). The commit-message audit trail is the only honesty signal that the manual RED verification actually happened.

## DOCUMENT

### EC-5: T1.2/T1.3/T1.4 all edit `openapi-registration.ts` — "parallelizable" claim is misleading

- **Task afetada:** T1.2 + T1.3 + T1.4 (Dependency Graph section)
- **Risco aceito:** Plan declares all 4 tasks parallelizable. Halt-loop is sequential so this is moot in practice (`/implement` halt-loop processes tasks one at a time). BUT if a future automation parallelizes by topic, T1.2/T1.3/T1.4 simultaneously editing `openapi-registration.ts` would produce merge conflicts. Recommend amending the Dependency Graph section with a one-line note: *"T1.2, T1.3, T1.4 edit the same file (`openapi-registration.ts`); halt-loop serializes them in order. Independent only at the topic level."* T1.1 remains genuinely independent (new file).

### EC-6: T1.1's new test pins UNCONDITIONAL stub-embedder warning — future "gate when real provider configured" change breaks the test

- **Task afetada:** T1.1
- **Risco aceito:** `run-mcp-server.ts:93-94` carries the comment `FOLLOW-UP: gate this warning when run-mcp-server.ts gains real-provider config`. The new test will FAIL when the gating change lands (because the warning will only fire conditionally). This is FINE — the failing test will signal "update the test to reflect the new gated behavior", which is the right outcome. Add an inline JSDoc note in T1.1's new test file that references the FOLLOW-UP comment + says "this test pins the CURRENT unconditional behavior; update when the FOLLOW-UP at run-mcp-server.ts:93-94 lands".

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T1.1 | 3 | 0 | 2 (EC-2, EC-4) | 1 (EC-6) |
| T1.2 | 1 | 0 | 1 (EC-3 shared) | 0 |
| T1.3 | 1 | 0 | 1 (EC-3 shared) | 0 |
| T1.4 | 2 | 1 (EC-1) | 1 (EC-3 shared) | 1 (EC-5 shared) |
| Final Phase | 0 | 0 | 0 | 0 |
| **Total** | **6 unique** | **1** | **3** | **2** |

## Veredicto

**PLANO PRECISA DE AJUSTE** — 1 MUST FIX requires plan absorption (EC-1: T1.4 assertion path fallback chain) before `/implement` proceeds. The 3 SHOULD TEST items are inline test-discipline additions (env clearing, swagger-parser sentinel acknowledgment, commit-message audit trail) — small inline patches. The 2 DOCUMENT items are one-line Dependency Graph + test-JSDoc clarifications.

After absorption, the plan bumps v1.0 → v1.1 and `/plan-confidence` re-scores. No structural rewrite needed; all 6 absorptions are mechanical patches preserving the plan's task/ADR/DoD skeleton.

## Next action

Patch the plan absorbing all 6 edge cases inline:
- **EC-1 MUST FIX** → update T1.4 § Deep Dives test assertion to use fallback chain `typeParam?.description ?? typeParam?.schema?.description`
- **EC-2 SHOULD TEST** → add `vi.stubEnv('THEOMEM_MCP_TRANSPORT', '')` to T1.1 beforeEach in § Deep Dives
- **EC-3 SHOULD TEST** → add explicit acceptance-criteria checkbox per T1.2/T1.3/T1.4: "openapi.test.ts test #1 (swagger-parser validate) still PASSES after the spec addition"
- **EC-4 SHOULD TEST** → tighten T1.1 acceptance criteria: commit message MUST contain literal substring `Verified RED by temporarily commenting lines 95-103`
- **EC-5 DOCUMENT** → Dependency Graph note: T1.2/T1.3/T1.4 edit the same file; halt-loop serializes
- **EC-6 DOCUMENT** → T1.1 new-test JSDoc cites FOLLOW-UP coupling to `run-mcp-server.ts:93-94`

Then proceed to `/deps-audit theo-memory-standalone-p0-fixes-cycle-2` per `cycle-plan.md` v1.1 chain.

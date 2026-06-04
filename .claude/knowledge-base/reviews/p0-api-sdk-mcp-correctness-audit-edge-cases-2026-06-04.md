# Edge Case Review — p0-api-sdk-mcp-correctness-audit

**Data:** 2026-06-04
**Tasks analisadas:** 14 (T0.1, T0.2, T1.1, T1.2, T1.3, T2.1, T2.2, T2.3, T3.1, T3.2, T3.3, T3.4, T4.1, T5.1)
**Edge cases encontrados:** 14 (MUST FIX: 4, SHOULD TEST: 6, DOCUMENT: 4)

## MUST FIX

### EC-1: Plan missing `## Dependencies` section — `/deps-audit` will hard-cap at 49 (INVALID)

- **Task afetada:** plan-level (cross-cutting)
- **Família:** Format / chain-contract
- **Cenário:** Per `cycle-plan.md` v1.1 + `deps-audit-golden-rule.md` § "The Rule" rule 1, every plan MUST declare a `## Dependencies` section with Existing / New / Removed tables. The current v1.0 plan does NOT have one. When `/deps-audit p0-api-sdk-mcp-correctness-audit` runs (next step in cycle-plan chain), it returns verdict `INVALID_PLAN_DEPS` with stable identifier `plan_dependencies_section_missing` — which caps `/plan-confidence` at 49 (INVALID). Cycle stops at the hard gate.
- **Impacto:** Cycle-plan chain blocked at deps-audit; /plan-confidence cannot return ≥ SHIPPABLE_WITH_CAVEATS; /implement cannot start.
- **Fix sugerido:** Add `## Dependencies` section before `## ADRs`. Even though the plan introduces zero new deps (Inquebrável Rule 11 YAGNI), declare: Existing (`vitest`, `pg`, `@modelcontextprotocol/sdk`, `@xenova/transformers` optional, `openai` optional, `commander`) with current versions from `package.json`; New = (none); Removed = (none). This honors the contract.

### EC-2: T3.2 REST stub removal breaks existing integration tests that depend on stub providers

- **Task afetada:** T3.2
- **Família:** Boundary / regression
- **Cenário:** `tests/integration/docker-stack.test.ts` + sibling REST integration tests currently boot `themory server` without `OPENAI_API_KEY` because the current REST path uses `DeterministicStubEmbedder + StubLLM`. After T3.2 lands hard-fail-on-missing-OPENAI_API_KEY, those tests start exiting code 2 instead of booting. Plan claims "still green" in DoD but does not declare HOW (env var injection, mock provider, skip pattern).
- **Impacto:** Quality gates (T5.1 `npm test`) fail with pre-existing-passing-tests now red; cycle stuck at /implement validation.
- **Fix sugerido:** T3.2 Acceptance Criteria explicit: "tests/integration/docker-stack.test.ts updated to inject `OPENAI_API_KEY=fake-test-key` in env OR mark `describe.skipIf(!process.env.OPENAI_API_KEY)` per T3.3 precedent". Add to T3.2 Files to edit.

### EC-3: T3.3 MCP boot test cryptic failure when `dist/` missing or env unset

- **Task afetada:** T3.3
- **Família:** Resource / Environment
- **Cenário:** Test spawns `node dist/agent-tools/cli.js mcp` via `child_process.spawn`. If `dist/` doesn't exist (developer skipped `npm run build`), spawn fails with `ENOENT` — error surfaces as test failure with confusing stack. Same for `OPENAI_API_KEY` unset: child process exits 2 silently after spawn succeeds. Plan mentions "skip cleanly" but the mechanism is left implicit.
- **Impacto:** Confusing CI failures; developers debug for hours before discovering missing build/env.
- **Fix sugerido:** T3.3 RED tests preceded by `beforeAll`: `if (!existsSync('dist/agent-tools/cli.js')) describe.skip('dist missing — run `npm run build`'); if (!process.env.OPENAI_API_KEY) describe.skip('OPENAI_API_KEY required');`. Document the requirement in test file header comment.

### EC-4: T0.2 export-matrix script misses `export type` + re-export patterns

- **Task afetada:** T0.2
- **Família:** Format / parser-completeness
- **Cenário:** Plan says "ast-grep pattern `export { $$NAMES }`" — this matches `export { Foo }` but NOT `export type { Foo }` (separate TypeScript keyword) NOR `export * from './sibling.js'` (re-export). Fallback regex `^export ` is also incomplete. The matrix undercounts; Phase T1 closures miss those exports; THE GOAL TEST's 49-export count assertion fails.
- **Impacto:** Hidden gaps in JSDoc/@see closure; THE GOAL TEST fails because matrix count != measured count.
- **Fix sugerido:** T0.2 ast-grep patterns expanded to 3: `export { $$NAMES }`, `export type { $$NAMES }`, `export * from $SPEC`. For re-exports, walk target file recursively. Update T0.2 Deep Dives with the 3 patterns + recursion rule.

## SHOULD TEST

### EC-5: T1.3 `any` grep misses `Array<any>`, `Promise<any>`, `Record<string, any>`

- **Task afetada:** T1.3
- **Teste sugerido:** `test_any_grep_catches_generic_args` — assert that the regex `\bany\b` (NOT `: any\b`) matches inside generic arguments. Update T1.3 RED test pattern from `: any\b|as any\b` to `\bany\b` (word-boundary only) with explicit allowlist for legitimate `any` usage if any.

### EC-6: T2.1 `@xenova/transformers` downloads ~200MB on first run; CI may stall

- **Task afetada:** T2.1
- **Teste sugerido:** `test_subpath_embedders_local_skip_when_xenova_absent` — assert `await import('@usetheo/memory/embedders/local')` either succeeds OR skips with `ERR_MODULE_NOT_FOUND` rationale in test name. Mark `describe.skipIf(!isXenovaInstalled())` per the optionalDependencies precedent (similar to `adapters-or-local-e2e-smoke.test.ts` pattern).

### EC-7: T2.2 bundle isolation walk must be RECURSIVE through transitive imports

- **Task afetada:** T2.2
- **Teste sugerido:** `test_default_barrel_static_walk_is_recursive` — sentinel test using `dependency-cruiser` OR manual recursive walk. The 9 subpath impl files must NOT be reachable from ANY transitive static import starting at `src/index.ts`. Current plan describes the test as "walk import graph" — make it explicit that walk is depth-N (until no new files added), not depth-1.

### EC-8: T3.1 paper name in LLM prompt text (e.g., `src/core/reflection/prompt.ts`) may behavior-shift LLM output

- **Task afetada:** T3.1
- **Teste sugerido:** `test_reflection_prompt_output_stable_post_rename` — regression test against a frozen LLM stub: run reflection with a fixed input + StubLLM that asserts the PROMPT text doesn't contain paper names AND captures the produced output. If prompt text changes, but stub still returns same shape, test is green. If prompt change inadvertently changes behavior of a real-LLM run, that's a different cycle's concern.

### EC-9: T3.3 child_process JSON-RPC over stdio needs readline buffering

- **Task afetada:** T3.3
- **Teste sugerido:** `test_mcp_tools_list_parses_line_delimited_json` — assert response parsing uses `readline.createInterface` (line-delimited) NOT raw `Buffer.toString()` concatenation. The MCP stdio transport sends one JSON-RPC message per LINE; raw buffer reads may split messages.

### EC-10: T4.1 aggregate test should organize into `describe` blocks per sub-goal for failure attribution

- **Task afetada:** T4.1
- **Teste sugerido:** Refactor `tests/integration/p0-audit/full-public-surface.test.ts` to wrap the 81 assertions in 6 `describe` blocks: `describe('Sub-goal 1: API correctness', ...)`, `describe('Sub-goal 2: SDK functional', ...)`, `describe('Sub-goal 3: Paper names', ...)`, `describe('Sub-goal 4: MCP availability', ...)`, `describe('Sub-goal 5: REST stub removal', ...)`, `describe('Bundle isolation', ...)`. Failure surfaces the broken sub-goal in 1 second instead of grep-the-stacktrace minutes.

## DOCUMENT

### EC-11: T0.1 paper-name regex behavior may differ Linux vs macOS

- **Risco aceito:** Per project CLAUDE.md, primary dev env is Linux. `grep -E "\\b{token}\\b"` behavior is BSD-grep vs GNU-grep — slight differences in word-boundary handling. Plan T0.1 should note the script targets GNU grep (Linux); document in script header.

### EC-12: T2.3 `npm pack --dry-run --json` output shape varies across npm versions

- **Risco aceito:** Test uses tolerant assertions (`expect(manifest.files.length).toBeGreaterThan(N)` not exact). If npm version diff produces structural break, that's a tool-update concern, not a test bug. Note in T2.3 test file header which npm major version was used at audit time (current: from `node --version` + `npm --version`).

### EC-13: T1.1/T1.2 git log first-commit heuristic for `@see` reference is fuzzy

- **Risco aceito:** Some exports were introduced before plans existed (v0.0/v0.1 contract design era). Their `@see` reference may point to an ADR (ADR-0001 contract foundation) or to README rather than a plan. T1.1 task description should note "best-effort canonical reference" and accept ADR-0001 or `CLAUDE.md § ... Locked names` as valid targets when no plan exists.

### EC-14: T2.1 subpath resolution in workspace requires careful tsconfig

- **Risco aceito:** When tests do `await import('@usetheo/memory/subpath')`, Node ESM resolves via `package.json#exports` map. In dev (no `node_modules/@usetheo/memory` install), tests use the local package via tsconfig `paths` OR workspace setup. Plan T2.1 should note that tests may need tsconfig `paths` entry OR use relative imports `await import('../../src/subpath/index.js')` to validate the SOURCE — testing the `exports` map at INSTALL time happens post-`npm pack` extract.

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| plan-level | 1 | 1 (EC-1) | 0 | 0 |
| T0.1 | 1 | 0 | 0 | 1 (EC-11) |
| T0.2 | 1 | 1 (EC-4) | 0 | 0 |
| T1.1 | 1 | 0 | 0 | 1 (EC-13) |
| T1.2 | 0 | 0 | 0 | 0 |
| T1.3 | 1 | 0 | 1 (EC-5) | 0 |
| T2.1 | 2 | 0 | 1 (EC-6) | 1 (EC-14) |
| T2.2 | 1 | 0 | 1 (EC-7) | 0 |
| T2.3 | 1 | 0 | 0 | 1 (EC-12) |
| T3.1 | 1 | 0 | 1 (EC-8) | 0 |
| T3.2 | 1 | 1 (EC-2) | 0 | 0 |
| T3.3 | 2 | 1 (EC-3) | 1 (EC-9) | 0 |
| T3.4 | 0 | 0 | 0 | 0 |
| T4.1 | 1 | 0 | 1 (EC-10) | 0 |
| T5.1 | 0 | 0 | 0 | 0 |
| **Total** | **14** | **4** | **6** | **4** |

**Veredicto:** PLANO PRECISA DE AJUSTE

## Notas adicionais

**EC-1 é o bloqueador imediato.** Mesmo todos os outros estando como SHOULD TEST/DOCUMENT, sem o `## Dependencies` section o cycle morre em /deps-audit antes de chegar em /plan-confidence. Absorção desse EC é pré-requisito para próxima fase.

**EC-2 + EC-3 + EC-4 são bloqueadores funcionais.** Implementação landaria mas /implement halt-loop bateria em GREEN failure (EC-2: docker-stack test red), GREEN cryptic (EC-3: ENOENT) ou COVERAGE gap (EC-4: matrix incomplete). Devem ser absorvidos em v1.1 do plano.

**6 SHOULD TEST devem ser absorvidos inline nos TDD blocks das tasks correspondentes** — não criam novas tasks, apenas asserções adicionais. Custo: ~10-20 LoC de test por edge.

**4 DOCUMENT são notas inline** — preferencialmente em comentários de header dos scripts/testes correspondentes.

Bumpem o plano para v1.1 com:
- `## Dependencies` section adicionada (EC-1)
- T3.2 Files to edit estendido com docker-stack test (EC-2)
- T3.3 RED tests preceded by `beforeAll` skip checks (EC-3)
- T0.2 patterns expandidos para 3 (EC-4)
- 6 RED tests adicionados inline às tasks correspondentes (EC-5 → EC-10)
- 4 notas DOCUMENT inline (EC-11 → EC-14)

Depois re-rodar `/deps-audit` → `/plan-confidence` para validar.

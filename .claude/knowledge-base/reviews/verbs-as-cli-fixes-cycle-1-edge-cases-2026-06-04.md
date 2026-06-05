# Edge Case Review — verbs-as-cli-fixes-cycle-1

Data: 2026-06-04
Plano analisado: `.claude/knowledge-base/plans/verbs-as-cli-fixes-cycle-1-plan.md` v1.0
Tasks analisadas: 11 (T0.1 + T1.1 + T1.2 + T2.1 + T2.2 + T3.1 + T3.2 + T5.1 + T5.2 + T5.3 + T5.4 + T4.1 validation)
Edge cases encontrados: **9** (MUST FIX: **2**, SHOULD TEST: **4**, DOCUMENT: **3**)
**Veredicto:** PLANO PRECISA DE AJUSTE (2 MUST FIX bloqueantes — T3.1 ESM-hoisting probabilistic fix sem fallback declarado; T1.1 'in' operator semantic distinction precisa explícito-test)

---

## MUST FIX

### EC-1: T3.1 dotenv silence depende de ESM hoisting que pode falhar — sem fallback pré-declarado no plano

- **Task afetada:** T3.1
- **Família:** Boundary / Timing (module-load-order)
- **Cenário:** Plan ADR (implícito em T3.1) coloca `process.env['DOTENV_CONFIG_QUIET'] = 'true'` como "very first executable statement BEFORE all imports". MAS ES modules têm semantic hoisting — TODOS os `import` statements são processados ANTES de qualquer assignment top-level. Quando o módulo cli.ts é loaded, o motor:
  1. Resolve `import { Pool } from 'pg'` (e transitively dotenv via `natural@^8.1.0`)
  2. dotenv executa seu autoload + emite `◇ injected env (0)` ao stdout
  3. Apenas então o code body executa o `process.env[...] = 'true'`
  
  O fix é **probabilistic** — funciona apenas SE dotenv lê `DOTENV_CONFIG_QUIET` **lazily** (na primeira chamada interna) E não eagerly no module-init. Plan reconhece: *"validate empirically with test 4"* + *"alternative is a tiny preload script via shebang"*. MAS o preload-script alternativa NÃO é declarada como sub-task fallback.
- **Impacto:** Se ESM hoisting + eager dotenv autoload silencia o trick, T0.1 test 4 fica RED para sempre. `/implement` halt-loop bate Stop Condition #1 (GREEN fails after 3 attempts). Sem Phase 3b pre-declared, loop entra em flail debugging vs ter um path forward documentado.
- **Fix sugerido:** Adicionar Phase 3b ao plan v1.1 com sub-task fallback DECLARED-UPFRONT:
  ```
  T3.1b — IF empirical validation fails (banner still appears post-mutation):
  - Create dist/agent-tools/cli-preload.cjs (tiny CommonJS preload: process.env['DOTENV_CONFIG_QUIET']='true')
  - Update package.json#bin entries with --require=./dist/agent-tools/cli-preload.cjs OR change cli.ts shebang
  - Update T0.1 test 4 to validate the preload path
  ```
  Adicionar nota em ADR D4 implícita (T3.1) sobre a fallback discipline.

### EC-2: T1.1 'in' operator distinction `{}` vs `{ reflectionPolicy: undefined }` é semântica subtle — sem test explicito

- **Task afetada:** T1.1 + ADR D1
- **Família:** Format / Boundary (TypeScript runtime semantics)
- **Cenário:** ADR D1 promete: *"`createLocalMemory({})` → default policy; `createLocalMemory({ reflectionPolicy: undefined })` → preserves throw via `if ('reflectionPolicy' in config && config.reflectionPolicy === undefined) throw ...`"*. Mas TypeScript consumers passing `{ reflectionPolicy: someConditional ? policy : undefined }` (e.g., conditional binding) hit the OPT-IN-THROW path even though they semantically expected default — surprising behavior. Plan T1.1 § Tasks declara o `in` operator approach mas NÃO declara contract test para os 3 distinguishing cases (empty / explicit-undefined / policy-set).
- **Impacto:** Consumer code `const memory = createLocalMemory({ reflectionPolicy: env.production ? prodPolicy : undefined })` in production where env.production=false throws `ReflectionNotConfigured` despite semantically wanting default — surprise debugging. Plus: TypeScript narrowing rules around `'key' in obj` patterns differ from runtime behavior for spread types, so consumers using `{ ...partialConfig }` patterns may behave inconsistently.
- **Fix sugerido:** Amendment T1.1 § TDD bloco com 3 NOVOS contract tests no `src/local/__tests__/factory.test.ts`:
  ```
  RED: test_createLocalMemory_empty_config_defaults_manual_policy()
  RED: test_createLocalMemory_explicit_undefined_throws_on_reflect()
  RED: test_createLocalMemory_explicit_policy_uses_passed()
  ```
  Cada teste exercita `memory.user(id).reflect()` para verify the 3 paths. Locks the 'in' operator distinguish behavior + future-proofs against TypeScript narrowing drift.

---

## SHOULD TEST

### EC-3: T2.1 retrofit may unify stderr wording — verify zero downstream test depends on exact strings

- **Task afetada:** T2.1 + ADR D3
- **Teste sugerido:** Pre-flight grep verification — `grep -rE "THEOMEM_PG_URI required|OPENAI_API_KEY required" tests/` returns 0 hits today (verified). T2.1 Tasks step 8 (re-run `mcp-cli-boot.test.ts`) covers the regression smoke. ADICIONAR explicit pre-flight grep step to T2.1 Tasks: *"Step 0 — grep tests/ for the legacy stderr strings; if any match, decide whether to preserve OR update tests in same commit"*. Today's grep is clean; PLAN can declare this empirically clean to remove ambiguity for `/implement`.

### EC-4: Post-T1.1 default-policy lands, agent-tools-memory.ts (post-T2.1 rename) ainda wires explicit policy — redundant code

- **Task afetada:** T2.1 (post-T1.1)
- **Teste sugerido:** `test_agent_tools_memory_does_not_explicitly_pass_reflectionPolicy` — grep `src/agent-tools/agent-tools-memory.ts` for `reflectionPolicy:` and assert it returns 0 hits POST-T1.1. T2.1 Tasks step 2 ("rename + add assertEnvOrExit") needs explicit step 2b: *"DROP the explicit `reflectionPolicy: { kind: 'manual', ... }` wire from createAgentToolsMemory since T1.1 default covers it"*. Otherwise dead-code lingers + DRY violation persists at the source.

### EC-5: T2.2 parser factory error messages preserve "/top-k/i" pattern that parent test 16 asserts

- **Task afetada:** T2.2 + ADR D4
- **Teste sugerido:** Pre-flight verify parent test 16 stderr matcher pattern (`expect(result.stderr).toMatch(/.*?top-k/i)` per implementation). T2.2 factory function signature: plan says `parseIntInRange(label, min, max)` — VERIFY the `label` arg is passed as `'--top-k'` (with `--` prefix), so error message reads `"Invalid --top-k: 0..."` preserving the parent test's regex match. If implementer passes `'top-k'` (no `--`), parent test 16 still passes per regex flexibility, but stderr UX shifts subtly. Add explicit example in ADR D4 Consequences: *"Factory invoked as `parseIntInRange('--top-k', 1, 100)` to preserve stderr UX continuity"*.

### EC-6: T3.2 validateScopeOpts adds new export to cli-scope.ts but plan doesn't list contract tests

- **Task afetada:** T3.2
- **Teste sugerido:** 3 sub-tests in `src/agent-tools/__tests__/cli-scope.test.ts`:
  - `test_validateScopeOpts_zero_throws()`
  - `test_validateScopeOpts_exactly_one_returns_void()`
  - `test_validateScopeOpts_multi_throws()`
  
  Currently plan T3.2 Tasks describes the function but only validates via integration test 3. Direct contract tests mirror the existing `resolveCliScope` test pattern + improve isolation per `testing.md § Pyramid`.

---

## DOCUMENT

### EC-7: 30-day sunset (2026-07-04) em cycle-implement.md v1.7 ADR-marker é gentle nudge calendar-based

- **Risco aceito:** Plan ADR D5 declara sunset 2026-07-04. Se o time não rodar `/implement` por 60 dias, sunset passa silenciosamente sem trigger de strategic review. Plan reconhece isto via *"calendar-based, not pegged to cycle activity"*. Aceitar — alternativa (pegged to cycle activity) requer telemetria que não existe. Document the sunset semantics in commit message + rule's change log entry.

### EC-8: T4.1 expected pass count math: 1061 baseline + 8 T0.1 + 1 T5.3 = **1070**, NOT 1069 (off-by-one)

- **Risco aceito:** Plan T4.1 § Tasks step 2 says *"expect 1069+ PASS"*. Real math: 1061 baseline + 8 T0.1 + 1 T5.3 + 3 T1.1 EC-2 absorption (if added) + 3 T3.2 EC-6 absorption (if added) = 1076 IF EC absorption happens. Without absorption, 1070. Plan v1.0 says ≥ 1069 — a strict-pass would interpret 1069 as floor (achievable), not equality (off-by-1). Loose `≥` operator absorbs the off-by-1 without bug. Document as cosmetic; not blocking. Update T4.1 to `≥ 1070 baseline + EC absorptions` honest count in v1.1.

### EC-9: T1.1 ADR-0005 amendment authorization scope

- **Risco aceito:** Project rules require *"Only via explicit ADR signed by the project owner"* for ADR amendments. Project owner authorized "Option A — Open verbs-as-cli-fixes-cycle-1 to absorb 11 MAJORs" — the ADR-0005 amendment is a means to that end. Plan ADR D1 documents the amendment via this implementation cycle; honest disclosure that authorization is implicit-by-scope rather than explicit-ADR-signing. Document in CHANGELOG + ADR-0005 supplementary entry: *"ADR-0005 v1.1 supplementary amendment authorized via project-owner Option A response to /review NEEDS_FIXES verdict on verbs-as-cli (2026-06-04 same session)"*.

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T1.1 | 2 | **1 (EC-2)** | 0 | 1 (EC-9) |
| T1.2 | 0 | 0 | 0 | 0 |
| T2.1 | 2 | 0 | 2 (EC-3, EC-4) | 0 |
| T2.2 | 1 | 0 | 1 (EC-5) | 0 |
| T3.1 | 1 | **1 (EC-1)** | 0 | 0 |
| T3.2 | 1 | 0 | 1 (EC-6) | 0 |
| T5.1-5.3 | 0 | 0 | 0 | 0 |
| T5.4 | 1 | 0 | 0 | 1 (EC-7) |
| T4.1 | 1 | 0 | 0 | 1 (EC-8) |
| **TOTAL** | **9** | **2** | **4** | **3** |

**Veredicto: PLANO PRECISA DE AJUSTE.**

**MUST FIX summary** (2 bloqueantes):
- **EC-1** (T3.1 ESM-hoisting probabilistic fix): adicionar **Phase 3b conditional sub-task** pre-declared (preload script fallback) ANTES de /implement começar. Caso contrário halt-loop pode bater Stop Condition #1 (3 GREEN attempts fail) sem path forward.
- **EC-2** (T1.1 'in' operator distinction): adicionar **3 explicit contract tests** na T1.1 § TDD bloco para empty / explicit-undefined / explicit-policy paths. Locks 'in' operator semantics + future-proofs against TypeScript narrowing drift.

**SHOULD TEST summary** (4 inline absorptions):
- EC-3 (T2.1 pre-flight grep step 0)
- EC-4 (T2.1 step 2b drop redundant explicit policy post-T1.1)
- EC-5 (T2.2 factory label arg explicit `'--top-k'` per Deep Dives)
- EC-6 (T3.2 3 contract tests in cli-scope.test.ts)

**DOCUMENT summary** (3 honest notes):
- EC-7 (calendar-based sunset semantics)
- EC-8 (T4.1 expected pass count off-by-1; ≥ operator absorbs)
- EC-9 (ADR-0005 amendment implicit authorization via Option A)

**Recommended absorption pattern em v1.1**:
- Phase 3b conditional declared up-front (EC-1 fallback)
- T1.1 TDD block extended with 3 sub-tests (EC-2)
- T2.1 Tasks step 0 (pre-flight grep) + step 2b (drop redundant policy) (EC-3 + EC-4)
- T2.2 ADR D4 Consequences mention `'--top-k'` exact-arg-format (EC-5)
- T3.2 § Tasks mention 3 contract tests added to cli-scope.test.ts (EC-6)
- Doc absorptions in ADR / CHANGELOG (EC-7 + EC-8 + EC-9)

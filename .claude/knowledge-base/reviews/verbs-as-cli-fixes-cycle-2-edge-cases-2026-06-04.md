# Edge Case Review — verbs-as-cli-fixes-cycle-2

Data: 2026-06-04
Tasks analisadas: 12 (T0.1 + T1.1 + T1.2 + T2.1 + T2.2 + T2.3 + T2.4 + T3.1 + T3.2 + T3.3 + T5.1 + T5.2 + T4.1)
Edge cases encontrados: 8 (MUST FIX: 0, SHOULD TEST: 5, DOCUMENT: 3)

## MUST FIX

(nenhum)

O plano é estruturalmente saudável. Os 10 MAJORs sob fix são finitos + escopo-acotado; nenhum edge case justifica uma sub-task NOVA no plano. Os 5 SHOULD TEST abaixo são absorvidos inline no TDD existente de cada task; os 3 DOCUMENT são disclosure de risco-aceito que não bloqueiam ship.

## SHOULD TEST

### EC-1: `Number('')` retorna 0 silenciosamente em `parseFloatInRange('--threshold', 0, 1)`

- **Task afetada:** T1.1 (ADR D1 strict-coercion)
- **Família:** Input
- **Cenário:** Consumer invoca `themory recall 'q' --user u --threshold ''` (empty string via shell variable expansion `$VAR` quando `VAR` is unset). `Number('') === 0`. `Number.isFinite(0) === true`. Para `--threshold` cujo range é `[0, 1]`, 0 ESTÁ no range → silent pass com threshold=0 (valor extremo, retorna tudo).
- **Impacto:** consumer pensa que sua variável foi expandida corretamente mas threshold cai para 0 (returns everything). Difícil de diagnosticar em produção.
- **Teste sugerido:** `test_parseFloatInRange_empty_string_throws` — `parseFloatInRange('--threshold', 0, 1)('')` MUST throw `InvalidArgumentError` mesmo que 0 esteja no range. Implementação: extender ADR D1 com `raw.trim().length === 0 → throw` antes do `Number(raw)`.

### EC-2: Hex / scientific notation accepted silently

- **Task afetada:** T1.1 (ADR D1 strict-coercion)
- **Família:** Input
- **Cenário:** `Number('0x1F') === 31` (hex literal accepted), `Number('5e2') === 500` (scientific). `parseIntInRange('--top-k', 1, 100)('0x1F')` returns 31 silently (in range). User typed hex by accident (clipboard paste from a different context); top-k silently becomes 31 instead of failing.
- **Impacto:** consumer surprise — POSIX argument convention is base-10 integers; hex acceptance via `Number()` violates least-surprise. Not catastrophic; bounded by range check.
- **Teste sugerido:** `test_parseIntInRange_hex_input_throws` + `test_parseIntInRange_scientific_notation_throws` — implementação extender ADR D1 com explicit regex check `/^-?\d+$/.test(raw)` BEFORE `Number(raw)` for ints, `/^-?\d+(\.\d+)?$/.test(raw)` for floats.

### EC-3: `wireMemoryFromPool(pool)` MUST NOT close the pool internally

- **Task afetada:** T3.1 (ADR D4 helper extract)
- **Família:** State / Lifecycle
- **Cenário:** Future regression — someone "improves" `wireMemoryFromPool` by adding a `pool.end()` finally clause "for safety". `createAgentToolsMemory()` then returns a Memory whose underlying pool is closed; first `.remember()` call fails with `Cannot use a pool after calling end on the pool`. Similarly `run-mcp-server.ts` would crash on first MCP request.
- **Impacto:** silent data-path regression — Memory instance returned but unusable.
- **Teste sugerido:** `test_wireMemoryFromPool_does_not_close_pool` — `await wireMemoryFromPool(pool); await pool.query('SELECT 1');` MUST succeed (probes that pool stays open). Pin the lifecycle contract via test rather than via comment-only convention.

### EC-4: Regex sentinel `/\.option\(\s*['"]--user/` matches `--user-name` falsely

- **Task afetada:** T3.3 (ADR D6 regex-pinned sentinel)
- **Família:** Format / Pattern matching
- **Cenário:** A future commit introduces `.option('--user-name <name>', ...)` (compound flag). The locked-names regex `/\.option\(\s*['"]--user/` matches the literal `--user-name` because `--user` is a prefix. Sentinel reports PASS for `--user` flag, but `--user` flag may have been actually deleted from cli.ts.
- **Impacto:** locked-names sentinel weaker than promised; false-positive coverage.
- **Teste sugerido:** Modify regex in T3.3 to require boundary character after flag name: `/\.option\(\s*['"]--user[\s'"<]/` (matches `--user `, `--user <id>`, `--user"`, but NOT `--user-name`). Hand-author all 9 patterns this way.

### EC-5: `npm pack --dry-run` does NOT auto-build, masking M5 fix verification

- **Task afetada:** T4.1 step 7 ("`npm pack --dry-run` — confirm ZERO `cli-memory-factory.js` entry")
- **Família:** State / Build ordering
- **Cenário:** Developer runs `npm pack --dry-run` WITHOUT first running `npm run build`. If `dist/` is stale from PRIOR build (pre-prebuild:clean fix shipped this cycle), the stale `cli-memory-factory.js` may STILL appear in pack manifest — sentinel reports false fail. Conversely, if `dist/` is clean from a fresh build of this cycle, the file is absent — sentinel passes correctly.
- **Impacto:** T4.1 step 7 is order-dependent on developer running `npm run build` first. Acceptable but fragile as a closure metric.
- **Teste sugerido:** Add `"prepack": "npm run build"` script to `package.json` IN T1.2 (Sub-goal 2). Then `npm pack` ALWAYS runs the build first, making T4.1 step 7 order-independent. Free defense-in-depth.

## DOCUMENT

### EC-6: `rmSync('dist', { force: true })` on Windows with locked file

- **Risco aceito:** On Windows, if a running `themory server`/`themory mcp` process holds a file handle on something inside `dist/`, `rmSync` fails with `EBUSY` even with `force: true`. Developer's `npm run build` fails until they stop the running binary. Linux/macOS don't have this constraint (Unix file deletion is decoupled from handle lifecycle). Acceptable per project's dev-tier expectations (PRIORITY 0 freeze tolerates dev-tier rough edges). Surface in T1.2 implementation comment.

### EC-7: Type widening `ReflectionPolicy | undefined` cascades to `CloudMemoryConfig extends MemoryConfig`

- **Risco aceito:** ADR D3 widens `MemoryConfig.reflectionPolicy?: ReflectionPolicy | undefined`. `CloudMemoryConfig extends MemoryConfig` inherits the widening. Cloud runtime is pre-release (Roadmap Item 7 BLOCKED on Theo PaaS GA) — zero shipped consumers. Acceptable; mention in CHANGELOG `### Changed` entry for completeness. No code path is affected today; the cascade is purely typedef-level.

### EC-8: `@internal` JSDoc tag is advisory without api-extractor / tsc-bundle

- **Risco aceito:** T2.3 tags 6 exports with `@internal`. By default, `tsc` emits the `.d.ts` containing all `export`-keyword declarations regardless of `@internal`. Strict public/internal enforcement requires either api-extractor configuration OR a separate tsc bundle that strips `@internal` types. Per PRIORITY 0 sub-goal 1 ("APIs corretas — every export documented"), the @internal tag IS documentation (consumers reading TypeDoc see the tag). Full enforcement deferred to v1.0 contract-freeze cycle. Surface in T2.3 implementation comment + a follow-up plan slug `api-extractor-internal-stripping`.

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T1.1 | 2 | 0 | 2 (EC-1, EC-2) | 0 |
| T1.2 | 2 | 0 | 1 (EC-5) | 1 (EC-6) |
| T2.1 | 0 | 0 | 0 | 0 |
| T2.2 | 1 | 0 | 0 | 1 (EC-7) |
| T2.3 | 1 | 0 | 0 | 1 (EC-8) |
| T2.4 | 0 | 0 | 0 | 0 |
| T3.1 | 1 | 0 | 1 (EC-3) | 0 |
| T3.2 | 0 | 0 | 0 | 0 |
| T3.3 | 1 | 0 | 1 (EC-4) | 0 |
| T5.1 | 0 | 0 | 0 | 0 |
| T5.2 | 0 | 0 | 0 | 0 |
| T4.1 | 0 | 0 | 0 | 0 |
| **Total** | **8** | **0** | **5** | **3** |

**Veredicto:** **PLANO OK** — 0 MUST FIX means no NEW tasks needed. The 5 SHOULD TESTs are absorbable inline into existing T1.1 / T1.2 / T3.1 / T3.3 / T4.1 TDD blocks. The 3 DOCUMENT items are honest risk-disclosure that don't block ship.

## Recomendação para v1.1 absorption

Antes de invocar `/deps-audit` + `/plan-confidence`, recomendo bumpar plan v1.0 → v1.1 com:

1. **ADR D1 ammendment** (Sub-goal 1) — add explicit regex check `/^-?\d+$/` for integer factories + `raw.trim().length > 0` guard, BEFORE `Number(raw)` call. Closes EC-1 + EC-2 inline.
2. **T1.2 Tasks step extension** — add `"prepack": "npm run build"` script alongside `prebuild:clean`. Closes EC-5 free.
3. **T3.1 TDD block extension** — add 1 explicit test for "pool stays open after wireMemoryFromPool". Closes EC-3.
4. **T3.3 Tasks step** — use regex pattern with boundary char (`/\.option\(\s*['"]--user[\s'"<]/`) for all 9 flag sentinels. Closes EC-4.
5. **DOCUMENT footnote** in plan header — disclosure of EC-6/7/8 acceptance.

No mudanças estruturais (Coverage Matrix 12 entries unchanged; ADR count 6 unchanged; sub-goals 9 unchanged). Score esperado em `/plan-confidence` unchanged at SHIPPABLE_WITH_CAVEATS band.

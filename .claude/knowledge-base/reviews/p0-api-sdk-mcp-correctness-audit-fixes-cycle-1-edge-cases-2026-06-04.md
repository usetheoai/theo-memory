# Edge Case Review — p0-api-sdk-mcp-correctness-audit-fixes-cycle-1

Data: 2026-06-04
Plano analisado: `.claude/knowledge-base/plans/p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-plan.md` v1.0
Tasks analisadas: 11 (T0.1 → T4.1)
Edge cases encontrados: **6** (MUST FIX: **1**, SHOULD TEST: **2**, DOCUMENT: **3**)
**Veredicto:** PLANO PRECISA DE AJUSTE (1 MUST FIX bloqueia P0 sub-goal closure)

---

## MUST FIX

### EC-1: `dist/**/*.sql` (migrações copiadas por postbuild) não inclusas no files glob — `themory migrate` quebra post-install

- **Task afetada:** T1.1 (extensão do `package.json#files`)
- **Família:** Boundary / Format (publish manifest gap)
- **Cenário:**
  - `package.json:78 postbuild:copy-migrations` copia `src/local/migrations/**` → `dist/local/migrations/` durante `npm run build`.
  - `src/local/index.ts:1452-1456` (verificado empiricamente) faz `migrationsFolder = resolvePath(dirname(fileURLToPath(import.meta.url)), 'migrations')` — em produção (rodando do dist) resolve `dist/local/migrations`.
  - Plan T1.1 estende `files` com `"dist/**/*.js"` + `"dist/**/*.d.ts"` MAS NÃO inclui `"dist/**/*.sql"`.
  - Consumer roda `npx @usetheo/memory migrate` post-install → bin dispatch → `runMigrations(pool)` → `migrate(db, { migrationsFolder: '.../dist/local/migrations' })` → `Cannot find module migrations/0000_*.sql`.
- **Impacto:** P0 sub-goal 3 ("MCP server available + reliable") fecha pela porta `themory mcp` mas reabre pela porta `themory migrate`. A regressão **é exatamente o F-T7.1-3** registrado em `architecture.md § 10.1`: *"`dist/local/migrations/` was missing after `npm run build`, causing `runMigrations()` to fail at E2E time with `Cannot find module migrations/0000_*.sql`"*. O plano resolve a sintoma análoga (sibling .js missing) sem aplicar a mesma rule aos sibling .sql.
- **Fix sugerido:** Extender o patch de T1.1 / ADR D1 para 3 globs:
  ```diff
  +  "dist/**/*.js",
  +  "dist/**/*.d.ts",
  +  "dist/**/*.sql"
  ```
  Acceptance criteria de T1.1 ganha 1 linha: `expect(packPaths).toContain('dist/local/migrations/0000_initial.sql')` (e fortalecer T0.1 test 4 floor para ≥ 9 dist entries + 1 sql entry mínima OU usar o mesmo `readdirSync` pattern do T3.3 para enumerar dinamicamente). Adicionar Sub-goal 1b à seção `## Objective`: *"`dist/local/migrations/*.sql` files ship in pack manifest — post-install `themory migrate` succeeds"*.

---

## SHOULD TEST

### EC-2: T3.2 inline snapshot poderia non-determinizar se `prompt.ts` futuro embedar timestamp/UUID/random

- **Task afetada:** T3.2 (reflection prompt SHAPE-stability test)
- **Família:** State / Timing
- **Cenário:** `prompt.ts` hoje é determinístico (verificado: zero hits para `Date.now`, `Math.random`, `crypto.`, `randomUUID`). Inline snapshot lock funciona AGORA. Refactor futuro que adicione `Date.now()` em prompt header, ou UUID-based session identifier, ou `Math.random()` para temperature seed, faz o snapshot quebrar **a cada run**. Snapshot test perde valor: dev re-roda `--update-snapshot` para silenciar.
- **Teste sugerido:** `test_reflection_prompt_is_pure_deterministic_function` — após snapshot capture, asserir que a string rendered NÃO contém:
  - Padrão ISO 8601 (`/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/`)
  - UUID v4 (`/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/` excluindo os UUIDs hard-coded do fixture)
  - Unix timestamp (`/\b1[6-7]\d{8}\b/` aproximadamente 10-digit `>= 1.6e9` typical of `Date.now()/1000`)
  
  Trava determinismo forward sem bloquear renames legítimos. Acrescentar como 3ª asserção em `src/core/reflection/__tests__/prompt.test.ts` per Acceptance Criteria de T0.4.

### EC-3: T0.1 post-install-bin.test.ts mascara regressão como "skip" quando `dist/` ausente — CI poderia passar com bug presente

- **Task afetada:** T0.1 (e por consequência Phase 4 validação)
- **Família:** State / Boundary (test-runner observability)
- **Cenário:** T0.1 usa `describe.skipIf(!DIST_EXISTS || !NPM_AVAILABLE || !TAR_AVAILABLE)` com LOUD `console.warn`. Em CI verde sem step explícito `npm run build` antes de `npm test`, o `dist/` não existe → 6 tests skip silenciosamente do ponto de vista do gate. Verdict per cycle-implement.md = "tests não falharam" mas o regression realmente NÃO foi exercido. Falso-verde camuflado de honest-skip.
- **Teste sugerido:** `test_dist_freshness_required_for_post_install_bin_assertions` — antes do `describe.skipIf`, adicionar um `test('0. SKIP-prerequisite: dist/agent-tools/cli.js exists OR test fails loud', () => { expect(DIST_EXISTS).toBe(true); })` que SEMPRE roda (não gated por skipIf) e FALHA loudly se `dist/` ausente em vez de skip. Per Inquebrável Rule 3 (honesty), CI deve falhar ALOUD quando uma test suite essencial não pode rodar. Plano cita parent EC-3 LOUD warn como precedente; este test extends it. Alternativa simpler: instruir T4.1 § Execution a anexar `npm run build &&` antes de `npm test`.

---

## DOCUMENT

### EC-4: npm version ≥ 7 requirement para `--json` + `--pack-destination` flags

- **Risco aceito:** `npm pack --json` foi adicionado em npm 7 (2020). `--pack-destination` em npm 7. Node.js 22 (cited no Dockerfile) ships com npm 10+. Project's dev OS é Linux per CLAUDE.md. CI runs Node 22. Risco realista zero hoje. Adicionar 1-linha no header do `tests/integration/p0-audit-fixes/post-install-bin.test.ts` documentando: *"Requires npm >= 7 for --json + --pack-destination flags. Node 22 ships npm 10+."* — quem mantenha no futuro entende a precondition.

### EC-5: Edits em T2.1 (JSDoc) e T3.1 (CHANGELOG marker) têm zero efeito em coverage / runtime

- **Risco aceito:** T2.1 muda apenas JSDoc; runtime de `run-mcp-server.ts` byte-idêntico. Coverage delta = 0. T3.1 muda apenas CHANGELOG.md (não vai em coverage). T2.2 muda apenas README.md. Plan já documenta isso em T4.1 Acceptance Criteria ("package.json is config — not subject to coverage; run-mcp-server.ts JSDoc-only edit — coverage unchanged"). Coverage tooling (`vitest --coverage`) pode emitir warnings em arquivos changed-but-zero-delta. Verificar visualmente; se nenhum warning, ✅. Se warning, adicionar nota em CHANGELOG entry do fix-cycle. Não bloqueia plan.

### EC-6: Sequencialidade Phase 0 RED → Phase 1 fix requer ordem de iterações no ralph-loop

- **Risco aceito:** Phase 0 (T0.1 + T0.2 + T0.3 + T0.4 + T0.5) escreve 5 arquivos de teste; Phase 1 (T1.1 + T1.2) modifica `package.json` + roda build. Se `/implement` executar Phase 1 ANTES de T0.1, T0.1 nunca observa "RED" — testes nascem GREEN. Quebra TDD discipline per Inquebrável Rule 5. Mitigação no plano: Dependency Graph já mostra `Phase 0 ──▶ Phase 1`. /implement halt-loop respeita esse ordering per task ID order (T0.x precede T1.x). Sem ação no plano; documentação suficiente. Reviewer pode verificar via `git log --oneline` que cada T0.x commit precede o T1.x correspondente.

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 1 | 0 | 1 (EC-3) | 1 (EC-4) |
| T0.2 | 0 | 0 | 0 | 0 |
| T0.3 | 0 | 0 | 0 | 0 |
| T0.4 | 0 | 0 | 0 | 0 |
| T0.5 | 0 | 0 | 0 | 0 |
| T1.1 | 1 | **1 (EC-1)** | 0 | 0 |
| T1.2 | 0 | 0 | 0 | 0 |
| T2.1 | 1 | 0 | 0 | 1 (EC-5) |
| T2.2 | 0 | 0 | 0 | 0 |
| T3.1 | 0 | 0 | 0 | 0 |
| T3.2 | 1 | 0 | 1 (EC-2) | 0 |
| T3.3 | 0 | 0 | 0 | 0 |
| T4.1 | 0 | 0 | 0 | 0 |
| Cross | 1 | 0 | 0 | 1 (EC-6) |
| **TOTAL** | **6** | **1** | **2** | **3** |

**Veredicto: PLANO PRECISA DE AJUSTE.**

EC-1 é MUST FIX bloqueante: a CRITICAL fix proposta no plano fecha 1 de 2 buracos pós-install (cli.js dispatch funciona) mas deixa o outro aberto (`themory migrate` quebra). Fix é trivial — uma linha a mais no `files` glob — mas precisa ser absorvido na versão v1.1 do plano antes de `/plan-confidence`, caso contrário o fix-cycle ship-a com o mesmo tipo-de-bug que está tentando eliminar (post-install regressão por publish-manifest gap), violando Inquebrável Rule 3 honestidade extrema.

EC-2 e EC-3 são SHOULD TEST: pequenas extensões inline nas TDD blocks de T0.1 e T0.4, não exigem nova task.

EC-4, EC-5, EC-6 são DOCUMENT: header note + acceptance criteria notes inline, zero estrutura nova.

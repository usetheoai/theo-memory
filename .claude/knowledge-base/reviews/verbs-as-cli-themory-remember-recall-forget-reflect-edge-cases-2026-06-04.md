# Edge Case Review — verbs-as-cli-themory-remember-recall-forget-reflect

Data: 2026-06-04
Plano analisado: `.claude/knowledge-base/plans/verbs-as-cli-themory-remember-recall-forget-reflect-plan.md` v1.0
Tasks analisadas: 11 (T0.1 + T1.1 + T1.2 + T2.1-T2.4 + T3.1 + T4.1)
Edge cases encontrados: **9** (MUST FIX: **3**, SHOULD TEST: **4**, DOCUMENT: **2**)
**Veredicto:** PLANO PRECISA DE AJUSTE (3 MUST FIX, 2 deles type-level bugs no contrato)

---

## MUST FIX

### EC-1: `ScopedMemory` interface NÃO tem `forget()` — plan T2.3 + ADR D2 incorretos

- **Task afetada:** T2.3 + ADR D2
- **Família:** Type / Boundary (contract mismatch)
- **Cenário:** Empiricamente verificado em `src/core/memory-store.ts:59-67` — `ScopedMemory` interface EXPLICITAMENTE comenta: *"Notably excludes `forget` (memoryId is globally unique — use top-level Memory.forget)"*. `forget(memoryId, options)` é método do **top-level `Memory` interface** (line 110), NOT do scoped. Plan T2.3 + ADR D2 falam "invokes scoped.forget(id, options)" + ADR D2 wording "maps to memory.user(opts.user!)... before invoking the verb" — para forget, scope é IRRELEVANTE (memoryId é globalmente único).
- **Impacto:** T2.3 code não compila (`scoped.forget` não existe). ADR D2 footgun: forces user to pass `--user X` para forget mesmo quando memoryId já identifica a row unicamente. Pior: user passa `--user A` para forgetting row que pertence a user B → silent cross-scope deletion authorization (security).
- **Fix sugerido:** Amendment de T2.3 + ADR D2:
  - T2.3 `runForget(opts)`: invoke `memory.forget(opts.id, { hard: opts.hard })` directly (no scope binding); drop `--user/--session/--agent/--skills` flags from forget subcommand.
  - ADR D2 amendment: "rule applies to remember/recall/reflect ONLY; forget does NOT bind scope — memoryId is globally unique per ADR-0002".
  - T3.1 forget `.command()` block: drop scope flags + drop scope validation.
  - T0.1 update tests 8+9 to NOT pass `--user`; test 12 round-trip same fix.

### EC-2: `--skills` flag returns `ScopedSkillMemory` (different verb surface) — plan T1.1 typed-union wrong

- **Task afetada:** T1.1 (cli-scope.ts) + T2.1/T2.2/T2.4
- **Família:** Type / Format (interface mismatch)
- **Cenário:** Empiricamente verificado em `src/core/skill.ts` — `ScopedSkillMemory` exposes a DIFFERENT verb surface: `add` (not `remember`), `consolidate` (not `reflect`), `recall` (signature differs — returns `SkillItemWithScore`, not `MemoryItemWithScore`), `forget` (signature shares with global). Plan T1.1 `resolveCliScope` returns "discriminated union OR ScopedMemory" — but `ScopedSkillMemory` is NOT structurally compatible with `ScopedMemory` (different methods, different parameter types).
- **Impacto:** T2.1 `runRemember` would call `scoped.remember(text)` — but if user passed `--skills <repoId>`, the returned `ScopedSkillMemory` has NO `remember()` method (it has `add(payload)` with `code-as-skill` shape per ADR-0010 § blueprint). Runtime TypeError OR worse: TypeScript compilation fails. T2.4 `runReflect` would call `scoped.reflect()` — `ScopedSkillMemory` has no `reflect()`, it has `consolidate()`.
- **Fix sugerido:** Amendment de T1.1 + ADR D2:
  - Drop `--skills` flag entirely from THIS plan. Skill-CLI surface is a separate concern; the skill verb names (add/recall/forget/consolidate) deserve their own subcommand namespace (`themory skill add` / `themory skill recall` / `themory skill forget` / `themory skill consolidate`) per ADR-0010 verb-surface divergence.
  - Update ADR D2: "exactly one of `--user / --session / --agent` (3-tier, NOT 4-tier)" — skill scope deferred to follow-up cycle.
  - Update T0.1 tests to NOT include `--skills` cases.
  - Update Coverage Matrix row 5 description.

### EC-3: commander v12 swallows promise rejection → exits 1 instead of plan-promised exit 2

- **Task afetada:** T3.1 + ADR D4
- **Família:** State / Permission (exit-code contract)
- **Cenário:** ADR D4 promete "Hard-fail with exit 2 + stderr error on missing required env (mirror of e43d801 anti-stub regime)". Implementation pattern in `run-mcp-server.ts` + `run-server.ts` uses `process.exit(2)` directly inside the run function. But commander v12 `.action(async () => {...})` catches promise rejections AND exits with code 1 by default (NOT the throw's intent). If runRemember/etc. throws (instead of process.exit(2)), commander's default uncaughtException handler exits 1.
- **Impacto:** CI / ops scripts checking `$? == 2` for "missing env" path get `$? == 1` (generic failure). Breaks observability contract; debugging post-mortem becomes ambiguous (was it env-missing or true runtime error?).
- **Fix sugerido:** Amendment de T3.1 + add explicit ADR clause to D4:
  - Each `.action()` wraps the handler call in `try { await runVerb(opts) } catch (err) { process.stderr.write(err.message + '\n'); process.exit(2) }` for verb-handlers that throw env-related errors.
  - OR (cleaner): handlers themselves call `process.exit(2)` on env-fail (mirror of e43d801) BEFORE the throw path; commander never sees the rejection.
  - Add T0.1 test 13 (RED): `themory remember 'fact' --user u` without OPENAI_API_KEY → `expect(result.status).toBe(2)` (not 1).
  - Bump Goal SMART assertion floor 12 → 13.

---

## SHOULD TEST

### EC-4: Empty text input to `themory remember ''` — boundary validation

- **Task afetada:** T2.1
- **Teste sugerido:** `test_remember_empty_text_exits_2` — `themory remember '' --user u` exits 2 with stderr matching `/text/i`. The existing `remember()` likely accepts empty string but would write an empty fact (LLM extraction also no-ops). Per `architecture.md § 8` validate-at-boundary discipline, CLI should reject at input boundary BEFORE round-tripping to LLM (wastes API call + cents).

### EC-5: Invalid UUID to `themory forget invalid-id` — input validation

- **Task afetada:** T2.3
- **Teste sugerido:** `test_forget_invalid_uuid_exits_2` — `themory forget 'not-a-uuid' --user u` exits 2 with stderr matching `/uuid/i`. Plan T2.3 says "Validates id is UUID v4" but no test exercises the validation. Without the test, regression on the validator is silent.

### EC-6: `--top-k 0` / `--top-k -1` / `--top-k 1000` / `--threshold 2.0` — flag bounds validation

- **Task afetada:** T2.2
- **Teste sugerido:** `test_recall_top_k_out_of_bounds_exits_2` + `test_recall_threshold_out_of_bounds_exits_2` + `test_recall_diversify_lambda_out_of_bounds_exits_2`. Plan T2.2 says "integer 1-100 validated" + "float 0-1 validated" + "optional float 0-1" but no tests assert boundary rejection. Mirror existing `mcp` subcommand --port validator pattern at `cli.ts:71-77`.

### EC-7: recall result JSON includes `embedding: number[]` (1536 floats) → 8 KB+ per item, 80 KB+ for top-k=10

- **Task afetada:** T2.2 + ADR D3
- **Teste sugerido:** `test_recall_json_does_not_include_embedding_array` — assert `result.stdout` is below 50 KB for a top-k=10 recall against a real fixture; assert `JSON.parse(result.stdout)[0]` does NOT contain key `embedding`. Per `architecture.md § 9` public-API surface: `MemoryItemWithScore` may carry `embedding: number[]` internally; CLI should strip it before stdout serialization OR document the inclusion. Without test, ops scripts piping `recall | jq` can OOM or truncate via terminal-width.

---

## DOCUMENT

### EC-8: Per-invocation warm-up cost ~2-5s — batch ops should use REST server

- **Risco aceito:** Each CLI invocation creates Memory factory → downloads Xenova model (cached after first) → connects to pg (~50ms) → runs Drizzle journal sync (~100ms). First invocation cold-start ~2-5s; subsequent invocations ~500ms-1s. For ops scripts looping (`for fact in $(cat facts.txt); do themory remember "$fact" --user X; done`) over 1000 facts → 16 minutes wall-clock. Plan should add 1-line note in T2.1 acceptance criteria: *"For batch ops > 50 invocations, recommend `themory server` + curl OR Node.js bulk-import script. CLI invocation is per-call setup-heavy."*

### EC-9: recall returns `MemoryItemWithScore[]`, NOT plain `MemoryItem[]` — JSON shape differs across verbs

- **Risco aceito:** Per memory-store.ts:66, `recall()` returns `Promise<readonly MemoryItemWithScore[]>` — each item has an extra `score: number` field. Plan ADR D3 text renderer mentions `[<score>] <id>: <text>` (implying score is present). JSON output via D3 default is `JSON.stringify(result, null, 2)` — score field will be included automatically. No code change needed; just document that recall JSON shape carries `score` field that remember/forget/reflect outputs do NOT have. Add to T2.2 Deep Dives: *"Output shape: `MemoryItemWithScore[]` — includes `score: number` field for each item, distinguishable from `MemoryItem[]` returned by remember."*

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T1.1 | 1 | **1 (EC-2)** | 0 | 0 |
| T1.2 | 0 | 0 | 0 | 0 |
| T2.1 | 2 | 0 | 1 (EC-4) | 1 (EC-8) |
| T2.2 | 2 | 0 | 2 (EC-6, EC-7) | 1 (EC-9) |
| T2.3 | 2 | **1 (EC-1)** | 1 (EC-5) | 0 |
| T2.4 | 0 | 0 | 0 | 0 |
| T3.1 | 1 | **1 (EC-3)** | 0 | 0 |
| T4.1 | 0 | 0 | 0 | 0 |
| **TOTAL** | **9** | **3** | **4** | **2** |

**Veredicto: PLANO PRECISA DE AJUSTE.** 3 MUST FIX bloqueiam — 2 são type-level bugs sobre o contrato real (EC-1 ScopedMemory.forget não existe; EC-2 ScopedSkillMemory tem verb surface divergente) + 1 contract bug em exit-code semantics (EC-3 commander promise-rejection swallow).

**Recommended absorption pattern em v1.1:**
- **EC-1**: drop scope flags do `forget` subcommand; T2.3 invoke top-level `memory.forget(id)`; ADR D2 amendment.
- **EC-2**: drop `--skills` do plan; ADR D2 = 3-tier only; skill-CLI surface deferred to separate plan (per ADR-0010 verb-surface divergence — skill verbs are `add/recall/forget/consolidate`, NOT `remember/recall/forget/reflect`).
- **EC-3**: handlers call `process.exit(2)` on env-fail BEFORE throw; bump Goal floor 12 → 13 assertions.
- **EC-4..EC-7**: 4 inline tests added to T0.1 (bump 13 → 17 assertions).
- **EC-8 + EC-9**: 1-line notes in T2.1 + T2.2 Deep Dives.

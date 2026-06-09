# SEPA initial brief — v0-9-vendor-client-impls (2026-06-07)

> Persisted at `/implement` Step 2.5 step 3. Single Agent invocation against SEPA agent file `.claude/agents/implement-v0-9-vendor-client-impls-2026-06-07/sepa.md` via general-purpose fallback path (per `implementation-prompt.md § SEPA invocation discipline`). Subsequent halt-loop iterations consult SEPA 3× per iteration with TIGHT/VERBOSE mode discipline.

## Highest-risk areas (ordered by likelihood × impact)

- **R1 (CRITICAL × HIGH) — EC-3 Mem0 field mapping `r.memory` → `text`**: silent runtime corruption. Adapter returns `[{ text: undefined, score }]`; integration test (T4.2) passes by accident because array is non-empty, but downstream benchmark scoring vs TheMemory is invalidated. The vendor-client unit test in T1.1 is the LAST gate — if a stub returns shape-compatible objects without exercising the literal `r.memory` field name, GREEN passes vacuously. Watch T1.1 stub `searchResult` shape carefully.
- **R2 (CRITICAL × MEDIUM) — EC-1 3-name rename**: ralph-loop literal `userId` → `scopeKey` grep-replace pattern is the canonical failure mode. Adapter shells confirmed: `Mem0VendorClient(userId)`, `ZepVendorClient(sessionId)`, `LettaVendorClient(agentId)`. T0.1 RED MUST emit **3 distinct TS errors** (one per vendor stub) — single error = grep-replace shortcut taken.
- **R3 (CRITICAL × MEDIUM) — EC-7 bundle isolation**: 3 new heavy SDKs as `dependencies` (per ADR D5, NOT `optionalDependencies`). `Mem0OfficialClient`/`ZepOfficialClient`/`LettaOfficialClient` MUST NOT be exported from `src/index.ts` default barrel. T4.1 adds the assertion — if T1.2/T2.2/T3.2 land first AND the implementer re-exports for "convenience", bundle leak ships before the regression test gates it. Recommend T4.1 land **early** (before T1.2 GREEN) OR explicit `git grep "OfficialClient" src/index.ts` per phase.
- **R4 (MAJOR × MEDIUM) — EC-2 typed error discipline**: easiest deviation — implementer reaches for `throw new Error('...')` as it "feels lighter". T0.3 must land BEFORE Phase 1; SEPA must verify `import { VendorSynthesizeUnsupportedError }` exists in each `vendor-client.ts` at post-GREEN.
- **R5 (MAJOR × MEDIUM) — EC-4/EC-11 Zep idempotency + concurrency**: try/catch+ignore-409 around BOTH `user.add` AND `memory.addSession` is brittle. The plan's T2.2 code shows it explicitly — verify literal preservation; concurrent test (`Promise.all([add, add])`) must NOT deadlock the in-flight idempotency check.
- **R6 (MAJOR × LOW) — EC-5 Letta passage score fallback**: `score: p.score ?? 1.0 / (i + 1)` is a heuristic. RED test (T3.1) asserts `results[0].score > results[1].score` — fine for the literal `1/(i+1)` impl but fragile if implementer "improves" to `0.5` constant.
- **R7 (CROSS-CUTTING) — paper-names rule + no-paper-names meta-test pattern**: vendor names `Mem0`, `Zep`, `Letta` ARE permitted in `src/benchmarks/{mem0,zep,letta}/` paths (vendor identification is structural, not paper-citation), BUT JSDoc/comments must not cite the vendor's research papers or marketing positioning. The rule's grep sentinel matches contiguous word boundaries — vendor-namespace dir names won't trigger it; vendor-class names like `Mem0OfficialClient` WILL trigger if the sentinel grep walks `src/**/*.ts` with `Mem0` as a banned token. **Need to verify** before T1.2 that the sentinel's `BANNED_TOKENS` either (a) excludes vendor classnames or (b) excludes `src/benchmarks/` from its sweep. If not excluded, the meta-test will block T1.2 GREEN.

## EC absorption verification (spot-check 5 critical absorptions in plan v1.2)

- **EC-1**: ABSORBED CORRECTLY. ADR D1 § Decision explicitly enumerates 3 distinct names. T0.1 § TDD explicitly says "3 distinct interface-mismatch errors (one per vendor stub). NOT a single grep-replace of `userId`."
- **EC-2**: ABSORBED CORRECTLY. New T0.3 task creates `VendorSynthesizeUnsupportedError` BEFORE Phase 1 needs it. ADR D2 § Decision revised to typed error.
- **EC-3**: ABSORBED CORRECTLY. Sub-goal 1 cites empirical evidence (`mem0.types.ts:89` + `helpers.ts:67`). T1.1 has dedicated test `test_mem0_search_maps_memory_field_to_text_per_EC3` with stub returning `{ memory: 'hello world', score: 0.9 }`.
- **EC-7**: ABSORBED CORRECTLY. T4.1 modifies `tests/integration/public-paths.test.ts` with `test_default_barrel_does_not_pull_vendor_sdks_per_EC7`. CAVEAT: assertion uses `Object.keys(mod)` — only catches direct re-exports. SEPA Pre-COMMIT should verify with `grep -r "from.*vendor-client" src/core src/local src/cloud` returns 0.
- **EC-13**: ABSORBED CORRECTLY. Global DoD checkbox explicitly mandates `BREAKING:` prefix in CHANGELOG.

## Recommended task ordering deviation

- **Move T4.1 (bundle isolation test) EARLIER — between T0.3 and T1.1**. Currently T4.1 lands AFTER T3.2 (all 3 OfficialClients written). If T1.2 implementer accidentally adds `export { Mem0OfficialClient } from './benchmarks/mem0/vendor-client.js'` to `src/index.ts` "for testing convenience", the leak ships through T1.2/T2.2/T3.2 GREEN unnoticed and only surfaces at T4.1 RED — by then 3 commits in.
- **Verdict**: ADVISORY — main session may decline if it prefers strict plan ordering. The plan's verdict (SHIPPABLE 96.4/100) is unaffected.

## Pre-RED watchpoints for the first task (T0.1)

- **W1**: `npm run typecheck` reports **EXACTLY 3** TS errors. One per vendor stub.
- **W2**: each stub class declaration uses literal `scopeKey: string` (NOT `userId: string`) in the 3 `adapter.test.ts` files. Verify by `grep -n "scopeKey: string" src/benchmarks/{mem0,zep,letta}/__tests__/adapter.test.ts` → 6 matches expected.
- **W3**: each stub class still implements its NAMED interface — the stub should fail TS check because INTERFACE still has old name. T0.1 must NOT pre-emptively rename the interface — that's T0.2's job.
- **W4**: file scope of T0.1 edits = ONLY `src/benchmarks/{mem0,zep,letta}/__tests__/adapter.test.ts` (3 files). NOT `adapter.ts`. NOT any `vendor-client.ts`.
- **W5**: no paper names in test descriptions. `describe` / `it` test names should describe behavior.
- **W6**: T0.1 has NO functional code change — only test edits.

## Confidence in plan readiness

**HIGH** — explicit reasoning:

1. Plan is v1.2 with `/plan-confidence` SHIPPABLE 96.4/100; 26 citations resolved; hard_caps empty.
2. All 14 ECs are absorbed inline.
3. ADRs D1-D5 are all complete: § Decision + § Rationale + § Consequences + § Alternatives present.
4. TDD discipline is BLOCK-shaped per `check_tdd_shape.py` convention.
5. Coverage Matrix has 16/16 (100%).
6. Existing vendor adapter shells empirically confirm the 3 pre-existing param names match ADR D1's Decision text exactly.

**Caveats** (NOT blockers):
- The plan ships under PRIORITY 0 freeze. It qualifies as hardening.
- The "Mem0-ts response shape drift" risk (`^3.0.6` caret) is real but acceptable for v0.9.
- The `optionalDependencies` deferral means default `npm install @usetheo/memory` pulls ~5-15MB of transitive vendor SDKs. EC-7 bundle isolation test gates runtime barrel but install-time cost is real.

**Plan readiness verdict: HIGH.** Recommend proceeding to T0.1 RED with the W1-W6 watchpoints in mind and the R7 paper-name-rule pre-flight check on the meta-test sentinel before T1.2 GREEN.

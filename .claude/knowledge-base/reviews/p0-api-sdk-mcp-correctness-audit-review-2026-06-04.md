# Review: p0-api-sdk-mcp-correctness-audit

**Date:** 2026-06-04
**Verdict:** NEEDS_FIXES
**Reviewers (spawned agents):** 7 (review-p0-api-sdk-mcp-correctness-audit-architecture, cross-validation, review-p0-api-sdk-mcp-correctness-audit-domain-api-design, review-p0-api-sdk-mcp-correctness-audit-domain-cli-tooling, review-p0-api-sdk-mcp-correctness-audit-domain-db-migrations, review-p0-api-sdk-mcp-correctness-audit-tests, review-p0-api-sdk-mcp-correctness-audit-wiring)
**Total findings:** 41

## Findings summary by severity

| Severity | Count |
|---|---|
| BLOCKER | 0 |
| CRITICAL | 1 |
| MAJOR | 11 |
| MINOR | 13 |
| INFO | 16 |

## CRITICAL findings (1)

### F-dom-api-1: `package.json#bin` points BOTH `themory` and `themory-mcp` at
`./dist/agent-tools/cli.js`, but `package.json#files` declares the
published artifact as source-only (`src/**/*.ts` + `src/local/migrations/**`)
with NO `dist/**` glob. Empirically verified via `npm pack --dry-run --json`:
only ONE `dist/` entry ships — `dist/agent-tools/cli.js` itself, auto-included
by npm because it is a bin target.

`src/agent-tools/cli.ts` (and its compiled dist sibling) imports from
`./run-mcp-server.js`, `./run-server.js`, `./run-migrate.js`, `./run-health.js`.
After `npm install @usetheo/memory`, those sibling `.js` files would NOT
exist in the installed tree because (a) they are not in `files` and
(b) they are not bin targets so npm does not auto-include them.

Net effect: `npx @usetheo/memory mcp` will fail post-install with
`Cannot find module './run-mcp-server.js'`. The T3.3 boot sentinel
runs against the LOCALLY-built dist tree which is complete, but does
NOT simulate post-install conditions. Sub-goal 3 ("MCP server
available + reliable") is empirically open: locally yes, third-party
install no.

Plan § Context line 23 ("dist/** is consumed only by the bin entries;
published artifact is source-only (consumer compiles)") restates the
contract, but that contract is incoherent with the bin pointing to a
compiled file — consumers cannot "compile" the source if the bin
target itself is pre-compiled. Either (a) files must include
`dist/**` and the bin must continue pointing at `dist/agent-tools/cli.js`,
OR (b) the bin must point at a `src/agent-tools/cli.ts` runnable via
a shebang + a runtime TS loader (functionally equivalent of `tsx`),
OR (c) a tarball-install regression test must be added so this gap
is at least surfaced.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-domain-api-design
- **File:** `package.json` line 76
- **Plan reference:** Plan § Goal + Sub-goal 3 + ADR D5 ('themory mcp boots from the dist/ artifact')
- **Domain anchor:** CLAUDE.md § PRIORITY 0 sub-goal 3 (MCP server available + reliable post-install)
- **Evidence:**

  $ node -e "console.log(JSON.stringify(require('./package.json').bin))"
  {"themory":"./dist/agent-tools/cli.js","themory-mcp":"./dist/agent-tools/cli.js"}
  
  $ node -e "console.log(JSON.stringify(require('./package.json').files))"
  ["src/**/*.ts","!src/**/__tests__/**","!src/**/*.test.ts","!src/**/*.test-d.ts","src/local/migrations/**"]
  
  $ npm pack --dry-run --json | jq '.[0].files | map(.path) | map(select(startswith("dist/")))'
  ["dist/agent-tools/cli.js"]
  
  $ grep -E '^import' src/agent-tools/cli.ts
  import { Command, Option } from 'commander';
  import { runHealth } from './run-health.js';
  import { runMcpServer } from './run-mcp-server.js';
  import type { RunMcpServerOptions } from './run-mcp-server.js';
  import { runMigrate } from './run-migrate.js';
  import { runServer } from './run-server.js';
  import type { RunServerOptions } from './run-server.js';

- **Recommended action:** OPTION A (matches plan's "consumer compiles" intent, but breaks bin):
  Remove the `bin` field; document `themory mcp` only as a dev-time
  command after the consumer runs `tsc` themselves. Conflicts with
  the ergonomics Sub-goal 3 promises.

OPTION B (minimal change; preserves bin ergonomics):
  Extend `package.json#files` to include
  `"dist/agent-tools/**", "dist/local/**", "dist/core/**", "dist/embedders/**", "dist/llms/**", "dist/server/**", "dist/theokit/**"`
  (or simply `"dist/**"` if bundle-size is acceptable). The plan's
  own narrative "dist/** is consumed only by the bin entries" then
  becomes empirically TRUE.

OPTION C (defensive — catch this in CI):
  Add T2.4 (or extend T3.3) — tarball-install regression test:
  `npm pack` → install into `tmp/install-test/node_modules` → run
  `node tmp/install-test/node_modules/@usetheo/memory/dist/agent-tools/cli.js mcp`
  and assert `tools/list` returns 4 verbs. This would have caught
  the gap automatically.

Recommended: B + C in the same follow-up cycle. P0 sub-goal 3 is
explicitly contingent on third-party install working.



## MAJOR findings (11)

### F-dom-api-2: T3.2 ships a behavioral break in the `themory server` CLI: pre-T3.2
the REST server booted by default with `DeterministicStubEmbedder` +
`StubLLM` and printed a stub-warning; post-T3.2 it hard-fails with
exit 2 on missing `OPENAI_API_KEY`. This break is described in the
`[Unreleased] § Changed` prose ("hard-fails with exit 2", "No silent
stub fallback") but is NOT marked as **BREAKING** in the same
explicit way prior cycles flagged behavioral breaks (e.g., line 75
"BREAKING (theoretical) — PgvectorStore constructor 2nd arg
widened" and line 118 "BREAKING: Memory.forget(id) now soft-deletes").

Any third-party operator running `themory server` against a
pgvector deployment WITHOUT `OPENAI_API_KEY` set (a working
configuration pre-T3.2, since the stubs returned shape-correct
empty extractions) will see their deployment crash at startup
post-upgrade.

Public-API symbols `StubEmbedder` + `StubLLM` are PRESERVED
(verified at `src/index.ts:76` + `src/embedders/index.ts` +
`src/llms/index.ts`), so the break is wiring/CLI-only, not
surface-API. That's the correct scope, but it deserves explicit
**BREAKING** marking for ops who consume the bin.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-domain-api-design
- **File:** `CHANGELOG.md` line 9
- **Plan reference:** Plan ADR D3 (REST server stub removal) + T3.2 acceptance
- **Domain anchor:** Keep a Changelog § Categorias permitidas + CLAUDE.md Inquebrável Rule 6 (changelog discipline)
- **Evidence:**

  $ grep -n "BREAKING" CHANGELOG.md
  73:- (BREAKING theoretical PgvectorStore)
  75:- BREAKING (theoretical) — PgvectorStore constructor 2nd arg widened
  118:- BREAKING: Memory.forget(id) now soft-deletes via t_invalid
  
  The Unreleased entry at line 9 does not contain a BREAKING marker;
  the T3.2 break is described as "hard-fails with exit 2" in the
  Changed prose. Operators reading the CHANGELOG for upgrade
  guidance would miss the explicit signal.

- **Recommended action:** Add a sibling BREAKING entry under [Unreleased] § Changed (or
under a dedicated § Removed for the stub default-wiring) following
the established marker pattern. Minimal text:

- **BREAKING — `themory server` CLI no longer boots with stubs by
  default**: post-T3.2 (`f1e50dc`), the REST server hard-fails
  with exit 2 when `OPENAI_API_KEY` is unset. Migration: set
  `OPENAI_API_KEY` (real OpenAI or OpenRouter via `OPENAI_BASE_URL`)
  before starting the server. The exported `StubEmbedder` +
  `StubLLM` symbols are preserved at `@usetheo/memory` for
  consumers needing stubs in custom wirings; only the CLI's
  DEFAULT changed.

This costs ~5 lines, takes <2 min, and closes the honesty gap
Inquebrável Rule 3 + Rule 6 jointly require.


### F-dom-api-3: Test #4 of `pack-manifest.test.ts` asserts only `>= 1` migration
entry ships under `src/local/migrations/**`. That floor lets a
future regression slip through where (e.g.) only the journal
ships but the SQL migration files do not, or where a NEW
migration is added but a typo in the files glob excludes it.

The plan's Coverage Matrix entry #6 is "npm pack manifest
assertions incomplete → T2.3 (pack-manifest test)". Stronger
assertion that ALL expected migration files ship would close the
gap properly.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-domain-api-design
- **File:** `tests/integration/p0-audit/pack-manifest.test.ts` line 75
- **Plan reference:** Plan T2.3 § Acceptance Criteria + EC-12 absorption
- **Domain anchor:** architecture.md § 10.1 (non-.ts assets must reach dist/)
- **Evidence:**

  $ awk 'NR>=75 && NR<=78' tests/integration/p0-audit/pack-manifest.test.ts
  test('4. pack manifest ships >= 1 src/local/migrations/** entry...
  ...
    expect(migrations.length).toBeGreaterThanOrEqual(1);
  
  $ ls src/local/migrations/*.sql | wc -l
  12  (rough count; actual N varies)
  
  Floor "1" + reality "12" leaves 11 migrations of slack where a
  drop-out would not break this test.

- **Recommended action:** Replace `>= 1` with a count derived from the filesystem at test
time (e.g., `expect(migrationsShipped.length).toBe(migrationsOnDisk.length)`),
OR list the migration filenames explicitly and assert each ships.
The first form is robust against new migrations landing
automatically; the second is more explicit but requires updating
the test on every new migration. EC-12 absorption already
established "tolerant assertions" — favor the first form, which
is tolerant of count drift but rigorous about completeness.


### F-dom-cli-1: JSDoc header at run-mcp-server.ts:9-12 still describes the composition root as wiring
"src/local/ (pgvector + stubs)" — a stale narrative pre-dating the e43d801 stub removal.
The actual implementation at lines 114-125 now wires LocalTransformerEmbedder + OpenAILLM
(real providers); the word "stubs" in the JSDoc is now factually wrong AND undermines the
T3.2 disclosure narrative ("MCP no longer uses stubs"). T3.2 explicitly required REST
to mirror MCP per e43d801, but the MCP JSDoc itself was not refreshed when e43d801 landed.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-domain-cli-tooling
- **File:** `src/agent-tools/run-mcp-server.ts` line 10
- **Plan reference:** ADR D3 — verbatim port of e43d801 (REST + MCP symmetry); Inquebrável Rule 3 (honesty)
- **Domain anchor:** no-paper-names-in-code.md AND public-copy.md § 6 (pre-release honesty)
- **Evidence:**

  Lines 9-12 of run-mcp-server.ts:
  ```
   * Composition root (DIP-allowed): this file wires src/local/ (pgvector +
   * stubs) into the agent-tools McpServer. Library layer `src/agent-tools/
   * index.ts` does NOT re-export src/local/ — the bin entry IS the composition
   * site per ADR D8.
  ```
  Actual wiring at lines 120-125:
  ```ts
  const memory = await createLocalMemory({
    vectorStore: new PgvectorStore(pool, { embeddingDim: LOCAL_EMBEDDER_DIM }),
    embedder: new LocalTransformerEmbedder(),
    llm: new OpenAILLM(),
    embeddingDim: LOCAL_EMBEDDER_DIM,
  });
  ```
  No StubEmbedder / StubLLM in the actual imports. The JSDoc is dishonest copy.

- **Recommended action:** Edit run-mcp-server.ts:9-12 to read e.g. "this file wires src/local/ (pgvector) +
src/embedders/local + src/llms/openai into the agent-tools McpServer" — describing
what the code does now. Same commit can include the parallel JSDoc tweak on
run-server.ts (line 18-21) to maintain symmetry. Sister file's JSDoc is already
cleaner ("REST server composition root").


### F-dom-cli-2: T3.4 Task 3 explicitly required the README to cross-reference the `.mcp.json.example`
template file. The template EXISTS at /home/paulo/Projetos/usetheo/theo-memory/.mcp.json.example
(and is gitignored per its own self-description), but the README MCP section does NOT
reference it. A third-party reader following the README has no signal that a fill-in
template exists in the repo root. The README provides an inline JSON block instead,
which forces the user to manually edit absolute paths + secrets every time the install
docs are followed. T3.4's `readme-mcp-section.test.ts` does NOT assert on `.mcp.json.example`
so the omission slipped past the dedicated sentinel.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-domain-cli-tooling
- **File:** `README.md` line 191-271 (MCP section), no .mcp.json.example reference anywhere
- **Plan reference:** T3.4 Task 3 — "Add cross-reference to the `.mcp.json.example` template file"
- **Domain anchor:** T3.4 § Deep Dives — "Include the .mcp.json example block (currently in .mcp.json.example template)"
- **Evidence:**

  grep result confirms zero hits:
  $ grep -n "\.mcp\.json\.example" README.md
  (no output)
  
  Plan T3.4 task 3 (plan line 895): "Add cross-reference to the `.mcp.json.example` template file."
  
  Plan T3.4 Deep Dives (plan line 888): "Include the `.mcp.json` example block (currently in
  `.mcp.json.example` template)."

- **Recommended action:** Add one line to README ~line 205 (just before the inline JSON block):
"A pre-filled template lives at `.mcp.json.example` in this repo — copy it to `.mcp.json`
and replace the secret. `.mcp.json` is gitignored so the key never reaches a commit."
Add a corresponding assertion to readme-mcp-section.test.ts test #7:
`expect(section).toMatch(/\.mcp\.json\.example/);`


### F-tests-1: Plan T3.1 TDD RED block explicitly names two tests that do NOT exist as
standalone files: (a) `test_no_paper_names_in_src` greps all 5 tokens
against src/**/*.ts asserting 0 hits — only folded into
full-public-surface.test.ts assertions 29-33; (b) the dedicated regression
sentinel `tests/integration/p0-audit/no-paper-names.test.ts` named in T3.1
VERIFY + DoD is missing entirely. Failure of one of the 5 token greps in
the GOAL TEST is harder to localize than in a dedicated 5-test file.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-tests
- **File:** `tests/integration/p0-audit/(MISSING)` line N/A
- **Plan reference:** T3.1 § TDD RED — `test_no_paper_names_in_src`; T3.1 § DoD — `npm test -- tests/integration/p0-audit/no-paper-names.test.ts green`
- **Evidence:**

  find tests/integration/p0-audit -name 'no-paper-names*' returns 0 files.
  grep -n '29\.\|30\.\|31\.\|32\.\|33\.' full-public-surface.test.ts shows
  the 5 token assertions folded into Sub-goal 4 describe block of the GOAL
  TEST only.

- **Recommended action:** Either (a) extract the 5 paper-name token assertions into a dedicated
tests/integration/p0-audit/no-paper-names.test.ts file (matches plan T3.1
VERIFY+DoD, gives finer-grained failure attribution); OR (b) update the
plan's T3.1 § TDD + DoD to honestly reflect that the paper-name regression
gate lives inside full-public-surface.test.ts assertions 29-33 (no
standalone file). Path (a) is preferable per testing pyramid — small
focused regression sentinel survives THE GOAL TEST refactor and surfaces
paper-name regressions in CI test reports under its own name.


### F-tests-2: EC-8 absorption (plan Coverage Matrix row 22) says "RED test against
StubLLM with frozen baseline". The named test
`test_reflection_prompt_shape_stable_post_rename` does NOT exist in
tests/. Renaming JSDoc/comments is shape-safe; renaming text INSIDE the
LLM prompt template (src/core/reflection/prompt.ts) — which T3.1 touched
— could shift LLM output without any test catching the drift. The
regression guard the plan called out is absent.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-tests
- **File:** `tests/integration/p0-audit/(MISSING)` line N/A
- **Plan reference:** T3.1 § TDD RED — `test_reflection_prompt_shape_stable_post_rename` (EC-8 absorption)
- **Evidence:**

  grep -rn 'ReflectionPipeline\|reflection_prompt_shape\|prompt_shape_stable'
  tests/ returns 0 hits. The plan T3.1 TDD § RED block lists this as the
  second RED test required for EC-8 absorption (plan lines 722-723).
  git log shows T3.1 paper-name remediation shipped in commits 9274aed,
  2b13883, 67daf22 without this test ever appearing.

- **Recommended action:** Author tests/integration/p0-audit/reflection-prompt-shape.test.ts (or
similar) per plan T3.1 EC-8 RED contract — instantiate ReflectionPipeline
with StubLLM that captures the rendered prompt, assert zero of [Mem0,
Letta, LangMem, Voyager, MemGPT, CoALA, Honcho, Graphiti] tokens AND
assert the StubLLM-captured shape matches a frozen baseline committed in
tests/integration/p0-audit/fixtures/reflection-prompt-baseline.json.
Without this guard, EC-8 absorption ships in plan-only form (Coverage
Matrix marks it covered but no test enforces it — coverage theater).


### F-tests-3: Test 3.X asserts `@see` PRESENCE in JSDoc only — not that the cited
filesystem path EXISTS. A fabricated path like
`@see .claude/knowledge-base/plans/fictional.md` would PASS the regex
`/@see/` while violating plan T1.1 Acceptance Criterion #2. Same
omission in exports-contract.test.ts (test 3, line 89-99). The plan
EXPLICITLY requires path-resolution.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-tests
- **File:** `tests/integration/p0-audit/exports-root.test.ts` line 102-108
- **Plan reference:** T1.1 § Acceptance Criteria — "`@see` references resolve to existing files (not fabricated)"
- **Evidence:**

  exports-root.test.ts:107 — `expect(jsdoc!).toMatch(/@see/)`.
  exports-contract.test.ts:94 — `if (jsdoc === null || !/@see/.test(jsdoc))`.
  Neither test resolves the cited path via fs.existsSync. The plan
  Acceptance Criterion line 393 says "`@see` references resolve to existing
  files (not fabricated)". MANUAL re-verification by this reviewer (via
  grep + while-loop test) confirms all @see paths DO resolve, so the
  coverage-gap is latent (no current regression), but the sentinel is
  missing — a future commit adding a fabricated `@see` would slip through.

- **Recommended action:** Extend the JSDoc check in exports-root.test.ts + exports-contract.test.ts
to parse `@see (\S+)` filesystem paths and assert `existsSync(path)` for
each. Mirrors plan-confidence-golden-rule.md § fabricated-citation hard
gate semantics. The check is cheap (≤ 50 paths) and closes the
coverage-theater risk path completely.


### F-tests-4: Assertion 14 ("EC-6 sentinel — skipIf naming surfaces missing optional
deps in test report") includes a TAUTOLOGICAL final assertion:
`expect(xenovaInstalled || openaiInstalled || true).toBe(true)`. The `||
true` makes the expression unconditionally `true`. The earlier if-guarded
asserts can BOTH be inactive (when neither package installed) leaving
this assertion testing nothing. Violates Inquebrável Rule 3 (a test that
ALWAYS passes is not a test).


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-tests
- **File:** `tests/integration/p0-audit/subpath-smoke-import.test.ts` line 121-133
- **Plan reference:** testing.md § Anti-patterns — "Tests that only assert structure (`expect(result).toBeDefined()`) — assert actual behavior with explicit values"
- **Evidence:**

  subpath-smoke-import.test.ts:132 — `expect(xenovaInstalled ||
  openaiInstalled || true).toBe(true)`. The `|| true` is a vacuous OR.

- **Recommended action:** Replace with a meaningful behavior. Two options: (a) DELETE the test
entirely — the EC-6 contract is already validated by test.skipIf branches
6/7/10 PRINTING the dep name in the skipped-test descriptor in the
vitest output (the EC-6 absorption goal); the explicit "sentinel" test
adds no signal. (b) Convert to a node:assert that errors LOUDLY when
BOTH installed-flags are false (CI environment must surface the missing
optionals — fail-loud rather than fake-pass).


### F-tests-5: Test 3 ("EC-3 sentinel — skipIf decisions are based on observable env
state") is self-documented as "This test always passes". The 3
`expect(typeof ... === 'boolean')` checks ALWAYS hold because
`existsSync`, `process.env[...] !== undefined && !== ''`, and similar
JavaScript expressions ALWAYS produce booleans. Vacuous test.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-tests
- **File:** `tests/integration/p0-audit/mcp-cli-boot.test.ts` line 73-83
- **Plan reference:** testing.md § Anti-patterns — "Tests that only assert structure"
- **Evidence:**

  mcp-cli-boot.test.ts:78 — code comment: "This test always passes; it
  documents the skip semantic for CI auditors."

- **Recommended action:** Replace with a non-vacuous assertion. The intent (audit-trail for skip
decisions) is honest but the implementation is theater. Two paths:
(a) DELETE the test — the warn-on-stderr lines (37-44) already publish
the skip reasons to CI logs, satisfying the "observable" contract
without a fake pass. (b) Replace with an assertion that PRODUCES an
observable artifact (e.g., write a `.skip-evidence/{date}-mcp-boot.json`
file capturing dist/OPENAI/PG state at test time, then assert the file
exists and is JSON-parseable). Path (a) is preferable per KISS.


### F-tests-6: Multiple tests have `and` in the name and bundle multiple assertions:
- baseline.test.ts:24 "exists AND is executable" (2 conditions checked
  as 1 — actually only checks existsSync, ignoring executable bit)
- baseline.test.ts:28 "exits 0 AND emits valid JSON" (2 distinct
  assertions in one test)
- baseline.test.ts:65 "counts both src/index.ts AND src/core/index.ts"
  (2 distinct file checks)
- matrix.test.ts:43 "exits 0 AND emits valid JSON"
Per testing.md § Anti-patterns, these MUST be split.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-tests
- **File:** `tests/integration/p0-audit/baseline.test.ts` line 24, 28
- **Plan reference:** testing.md § Anti-patterns — "Tests with `and` in the name (...) — split into two tests, each testing one thing"
- **Evidence:**

  grep '\sand\s' tests/integration/p0-audit/*.test.ts reveals 8+ test names
  containing the literal "and" conjunction.

- **Recommended action:** Split each `and`-name test into focused single-behavior tests. Examples:
- "1a. scripts/audit/p0-baseline.sh exists" + "1b. script is executable
  (mode includes user-x bit)" — the second test currently has no
  assertion (only existsSync was wired).
- "2a. script exits 0" + "2b. stdout is valid JSON".
- "5a. exports field has src/index.ts entry" + "5b. exports field has
  src/core/index.ts entry".
Failure attribution sharpens; debugging time drops.


### F-tests-7: The `static-walk.ts` helper implements the import-graph walk via 3 regex
patterns (RE_RUNTIME_IMPORT, RE_SIDE_EFFECT_IMPORT, RE_VALUE_RE_EXPORT).
Regex-based parsing is fragile against TypeScript's full import syntax:
(a) multi-line imports `import {\n  Foo,\n  Bar\n} from './x.js'` —
`RE_RUNTIME_IMPORT` uses `^...` per gm flag; the `[^;]+?` may match
newlines, but `import { Foo from './x.js'` with the closing brace on a
different line tests the regex's resilience.
(b) Dynamic imports `await import('./x.js')` are NOT walked — which is
intentional per the bundle-isolation contract but should be DOCUMENTED
as part of the helper's contract test.
(c) Re-exports with named selectors like `export { default as Foo } from
'./x.js'` may fall through the value-re-export regex.
No unit test exists for the walker itself; correctness is assumed.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-tests
- **File:** `tests/integration/p0-audit/bundle-isolation.test.ts` line 17 (uses _helpers/static-walk.ts:20-22)
- **Plan reference:** EC-7 absorption (plan Coverage Matrix row 21); testing.md § What to test — "test behavior, not implementation"
- **Evidence:**

  _helpers/static-walk.ts uses 3 hand-written regex patterns. No sibling
  _helpers/__tests__/static-walk.test.ts exists. The bundle-isolation test
  asserts 9 NEGATIVE paths-not-reached + 2 POSITIVE sanity (errors.ts +
  core/index.ts reached) — the positives validate ONE re-export pattern
  (`export {...} from ...`) but not multi-line imports or named-default
  re-exports.

- **Recommended action:** Author a unit test for the walker at
tests/integration/p0-audit/_helpers/static-walk.test.ts covering:
(1) Multi-line `import { A, B } from './x.js'` parse correctly.
(2) `import type { ... } from './x.js'` is SKIPPED (no false positive).
(3) Dynamic `await import(...)` is SKIPPED (out of static graph).
(4) `export { default as Foo } from './x.js'` produces an edge.
(5) Side-effect `import './x.js'` produces an edge.
Without these, the GOAL TEST passes via a walker whose correctness is
itself untested — coverage theater at one layer of indirection.



## MINOR findings (13)

### F-arch-1: `LOCAL_EMBEDDER_DIM = 384` is duplicated verbatim between run-server.ts
and run-mcp-server.ts (line 37). Intentional symmetry per ADR D3, but
represents a small DRY trade-off the next reader will notice.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-architecture
- **File:** `src/agent-tools/run-server.ts` line 43
- **Plan reference:** T3.2 + ADR D3 of plan v1.1
- **Evidence:**

  ```ts
  // src/agent-tools/run-server.ts:43
  const LOCAL_EMBEDDER_DIM = 384;
  
  // src/agent-tools/run-mcp-server.ts:37
  const LOCAL_EMBEDDER_DIM = 384;
  ```
  Each declaration carries a JSDoc explicitly citing the sibling
  ("Mirrors run-mcp-server.ts LOCAL_EMBEDDER_DIM constant (commit
  e43d801)"), so the duplication is documented + load-bearing for the
  "both composition roots stay in lockstep" claim of ADR D3.

- **Recommended action:** Acceptable as-is — composition roots intentionally own their
constants to stay independently auditable. If a third caller appears
(cloud composition root v0.5, REST + MCP unified bin entry, etc.),
promote the constant into a shared `src/agent-tools/constants.ts`
with an ADR documenting the move. Until then, do nothing.


### F-arch-2: The `memoryShim` Proxy pattern is unusual and warrants a brief ADR
cross-reference inside the file. Currently the JSDoc at the top of
the file mentions EC-33 readiness-gate but does not flag the Proxy
pattern as a deliberate design choice — a future reader may mistake
it for a smell.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-architecture
- **File:** `src/agent-tools/run-server.ts` line 157-166
- **Plan reference:** T3.2 (mechanical port of e43d801; no plan-task addition)
- **Evidence:**

  ```ts
  const memoryShim = new Proxy({} as Awaited<ReturnType<typeof createLocalMemory>>, {
    get(_target, prop) {
      if (memory === undefined) {
        throw new Error(
          'Memory not ready: server is still warming up. Poll GET /v1/health until 200 before sending verb traffic.',
        );
      }
      return Reflect.get(memory, prop) as unknown;
    },
  });
  ```
  The Proxy is a defense-in-depth for the EC-33 async-warm window. It
  is correct; just under-documented at the call site.

- **Recommended action:** Add a 2-line JSDoc above the `memoryShim` declaration citing the
ADR/EC: "Defense-in-depth shim for EC-33 readiness gate: the
/v1/health 503-then-200 transition is the primary contract; the
Proxy guards against an orchestrator routing traffic before the
factory warm Promise resolves. See ADR D8 + EC-33 of the
theo-memory-standalone-p0 plan." No behavior change.


### F-arch-3: Two `as unknown` casts at the composition-root boundary. Both are
pre-existing (predate T3.2) and architecturally justified per
architecture.md § 7 ("If you must escape the type system, use
`unknown` with a runtime assertion"). Surfaced for completeness;
not a regression of this cycle.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-architecture
- **File:** `src/agent-tools/run-server.ts` line 164, 177
- **Plan reference:** T3.2 (pre-existing casts; not introduced by this cycle)
- **Evidence:**

  ```ts
  // src/agent-tools/run-server.ts:164
  return Reflect.get(memory, prop) as unknown;
  
  // src/agent-tools/run-server.ts:177
  }) as unknown as HttpListener;
  ```
  Line 164: `Reflect.get` return type widens to `unknown` per TS spec.
  Line 177: `@hono/node-server` `serve` returns an opaque type; cast
  to local `HttpListener` interface for `listener.close(...)` /
  `listener.on(...)` ergonomics.

- **Recommended action:** Acceptable. The local `HttpListener` interface (lines 77-80) is the
runtime assertion architecture.md § 7 requires; the Proxy Reflect.get
cast is unavoidable per TS Proxy semantics. No action needed.


### F-arch-4: Regex-based static-import extraction handles `import { ... }`,
side-effect `import '...'`, and value `export { ... } from '...'` /
`export * from '...'`. It does NOT handle multi-line import clauses
where the brace span includes embedded newlines (rare in this
codebase, but possible if future contributors format long import
lists across lines). Acceptable for a pragmatic test-helper layer
but worth knowing.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-architecture
- **File:** `tests/integration/p0-audit/_helpers/static-walk.ts` line 20-22
- **Plan reference:** T2.2 / EC-7 (SHOULD TEST absorption)
- **Evidence:**

  ```ts
  const RE_RUNTIME_IMPORT = /^\s*import(?!\s+type)\s+[^;]+?\s+from\s+['"]([^'"]+)['"]/gm;
  ```
  The `[^;]+?` non-greedy quantifier stops at the first newline-or-
  semicolon. A multi-line import like
  ```ts
  import {
    Foo,
    Bar,
  } from './baz.js';
  ```
  would NOT match. The fix would be `[\s\S]+?` instead of `[^;]+?`,
  OR a real TS parser (overkill at this scale).

- **Recommended action:** Accept as a known pragmatic limitation; document the constraint in
the helper's top JSDoc ("Regex-based; multi-line import clauses
currently not supported — convert to single-line import or extend
the regex if encountered."). Promote to a real TS parser only if
the codebase starts using multi-line imports systematically.


### F-arch-5: T3.2 ships source code change + the regression sentinel test
(`run-server-stub-removal.test.ts`, 59 LoC, 8 assertions) in the
SAME commit `f1e50dc`. Commit message claims "RED: 8 assertions
would fail against pre-edit run-server.ts" but the RED phase was
not materially demonstrated in a prior commit. Procedural finding,
not architectural — the resulting code IS correctly tested and
the assertions ARE behavior-shape-correct.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-architecture
- **File:** `src/agent-tools/run-server.ts (T3.2)` line full file change in commit f1e50dc
- **Plan reference:** T3.2 TDD discipline (Inquebrável Rule 5)
- **Evidence:**

  `git show --stat f1e50dc` shows all 5 files modified together:
  ```
  README.md                                              |  4 +-
  src/agent-tools/run-server.ts                          | 61 +++---
  tests/integration/cli-consolidated.test.ts             | 11 +++-
  tests/integration/docker-stack.test.ts                 |  5 ++
  tests/integration/p0-audit/run-server-stub-removal.test.ts | 59 +++++
  ```
  Per `.claude/rules/testing.md § TDD — Red-Green-Refactor`: "Never
  write production code without a failing test that justifies its
  existence." A separate RED commit before f1e50dc would have closed
  this honestly.

- **Recommended action:** Document procedurally (not architecturally) in the cycle's
retrospective: when porting a verbatim sibling fix, ship the
sentinel test in its own RED commit BEFORE the source-code GREEN
commit. No code change required now; the resulting state is
correct and locked by a passing test. Inquebrável Rule 3 (extreme
honesty) calls for surfacing this even though it's pre-existing /
cosmetic.


### F-dom-api-4: The wildcard `export * from './core/index.js'` at line 148 of
src/index.ts re-exports all 41 contract symbols into the default
barrel. The plan's T1.1 + T1.2 ADR D4 absorption places JSDoc at
the declaration site OR at the export site; for wildcard re-exports
neither location carries JSDoc per symbol. Consumers reading
`import { hashFact } from '@usetheo/memory'` IDE-hover get the
JSDoc from `src/core/index.ts`, which is present. So the
ergonomic outcome is fine. But the JSDoc block on the wildcard
re-export at line 137-147 of src/index.ts mentions ONLY 5 token
categories ("Memory interface, scoped sub-objects, options shapes,
error classes, MemoryEvent union, MemoryItem DTO, and the 10 DIP
interfaces") — empirically `src/core/index.ts` now exports 13 DIPs
(Embedder, LLM, Tokenizer, VectorStore, HistoryManager,
ReflectionPolicy, SkillRepresentationStrategy, EvictionPolicy,
RecallCacheStore, ConflictResolutionPolicy, BenchmarkAdapter,
AuthVerifier — 12 visible + the eviction subset). The "10 DIP
interfaces" count is empirically out of date.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-domain-api-design
- **File:** `src/index.ts` line 148
- **Plan reference:** Plan T1.1 § Deep Dives (canonical home for JSDoc)
- **Domain anchor:** architecture.md § 6 (canonical home + 'avoid deep re-export chains')
- **Evidence:**

  $ awk 'NR>=137 && NR<=148' src/index.ts
  /**
   * Re-export the full v0.0 contract from `src/core` — Memory interface,
   * scoped sub-objects, options shapes, error classes, MemoryEvent union,
   * MemoryItem DTO, and the 10 DIP interfaces under `src/core/dip/`.
   ...
   */
  export * from './core/index.js';
  
  $ ls src/core/dip/*.ts | wc -l
  ~13 DIPs visible

- **Recommended action:** Update the wildcard re-export's JSDoc count phrase from "10 DIP
interfaces" to a count that does not require maintenance, e.g.,
"all DIP interfaces declared under src/core/dip/" — or fold the
precise count into a single source-of-truth ADR (ADR-0008 §
method counts) and link via `@see`. The latter is more rigorous;
the former is the YAGNI-aligned 1-line fix.


### F-dom-cli-3: The README env-var table covers 5 rows (THEOMEM_PG_URI, OPENAI_API_KEY, OPENAI_BASE_URL,
OPENAI_CHAT_MODEL, THEOMEM_MCP_DEFAULT_USER_ID) — this matches the T3.4 § Deep Dives
enumeration. However, the transport-tuning vars (THEOMEM_MCP_TRANSPORT, THEOMEM_MCP_HTTP_PORT,
THEOMEM_MCP_HTTP_HOST) consumed by run-mcp-server.ts at lines 58/70/79 are mentioned ONLY
inline in the streamable-http example block (lines 249-250). They are missing from the
table, so an operator reading the table top-to-bottom does not realize transport+host+port
are configurable. This is NOT a hard plan violation (plan's Deep Dives enumerated exactly
5 vars) but is a completeness gap for a hardening-mode README — Priority 0 § sub-goal 3
asks for "real third-party consumer can install + use without project-internal knowledge".


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-domain-cli-tooling
- **File:** `README.md` line 197-203 (env-var table)
- **Plan reference:** T3.4 § Deep Dives — env-var checklist explicitly enumerates 5 variables
- **Domain anchor:** completeness of operator-facing setup documentation
- **Evidence:**

  run-mcp-server.ts consumes 3 additional env vars NOT in the README table:
    - THEOMEM_MCP_TRANSPORT (line 58)  — stdio | streamable-http
    - THEOMEM_MCP_HTTP_PORT (line 70)  — defaults to 8080
    - THEOMEM_MCP_HTTP_HOST (line 79)  — defaults to 127.0.0.1
  All three default safely (per resolveTransport / resolvePort / resolveHost), so absence is
  not a boot-blocking issue — only a documentation completeness gap.

- **Recommended action:** Either:
(a) Add 3 rows to the env-var table flagged as transport-tuning ("only relevant when
    THEOMEM_MCP_TRANSPORT=streamable-http"); OR
(b) Add a one-line cross-reference under the table: "For HTTP transport tuning see the
    streamable-http example below (THEOMEM_MCP_TRANSPORT / THEOMEM_MCP_HTTP_PORT /
    THEOMEM_MCP_HTTP_HOST)."
Option (b) is lighter-touch and matches the plan's intentional 5-row enumeration.


### F-tests-8: The functions `findExportBlocks` + `findJsdocBlock` are DUPLICATED
verbatim across exports-root.test.ts AND exports-contract.test.ts
(lines 29-68 of contract = lines 37-84 of root). Two files, identical
~50 LoC blocks. DRY violation per testing.md + Inquebrável Rule 12.
The plan T1.2 itself was written as "Same as T1.1 but for the 41
contract exports"; the test mirror reflects the plan's per-file
separation but with copy-paste code.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-tests
- **File:** `tests/integration/p0-audit/exports-root.test.ts (+ siblings)` line 37-57 (function findExportBlocks)
- **Plan reference:** DRY (Inquebrável Rule 12)
- **Evidence:**

  diff <(sed -n '37,84p' tests/integration/p0-audit/exports-root.test.ts)
       <(sed -n '29,68p' tests/integration/p0-audit/exports-contract.test.ts)
  shows the two helper functions are byte-identical modulo formatting.

- **Recommended action:** Extract `findExportBlocks` + `findJsdocBlock` into
tests/integration/p0-audit/_helpers/jsdoc-walker.ts and import from
both test files. Single source of truth; both tests parameterize on
file path. Bonus: the helper becomes a reusable building block for
future export-surface gates.


### F-tests-9: Plan EC-10 absorption committed to 81 assertions; the implementation
ships 42 (matches "≥ 30 floor" of plan Acceptance Criteria, but materially
under the EC-10 absorption target of 81). The drop is BECAUSE the
JSDoc + @see closure verification (49 exports × 2 properties = 98 sub-
assertions per plan T1.1 + T1.2) collapsed into smoke-checks 5 + 6
(`@see count >= 8` and `>= 41`). Plan EC-10 said the GOAL test would
include "49 export-presence assertions (8 root + 41 contract)"; the
implementation includes 2 aggregate counts (smoke-check) instead.
Acceptance is met (42 > 30) but the EC-10 absorption claim of "81
assertions" is honest-only at the per-task sentinel level (T1.1 + T1.2
collectively test the 49 export blocks); GOAL TEST does not.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-tests
- **File:** `tests/integration/p0-audit/full-public-surface.test.ts` line 175 (assertions 20-28 use 0-indexed loop label `String(20+i)`)
- **Plan reference:** EC-10 absorption (plan Coverage Matrix row 24) — "81 assertions organized in 6 nested describe blocks"
- **Evidence:**

  full-public-surface.test.ts contains tests numbered 1..42 across the 6
  describe blocks. EC-10 absorption target was 81. Plan line 952 spells
  out: "Total: 13 + 9 + 5 + 4 + 1 + 49 = 81 assertions".

- **Recommended action:** Either (a) honest-update the plan EC-10 absorption row to reflect that
GOAL TEST aggregates and per-task sentinels (T1.1/T1.2) cover the 49
export-presence assertions cumulatively (truth); OR (b) inflate
full-public-surface.test.ts to include the 49 explicit export-presence
sub-assertions (matches the original commitment but doubles the file
size). Option (a) is preferable — the goal "≥ 30" was met and the
per-task tests already enumerate. The EC-10 absorption description
should match.


### F-tests-10: `walkStaticImports(ENTRY, REPO_ROOT)` is invoked at the describe-block
body level (not inside beforeAll/beforeEach), so the import-graph walk
runs ONCE at module load. Tests #2 (the 9 NINE_IMPL_FILES asserts)
share the resulting `reachable` set as test-suite state. If any test
could MUTATE `reachable` (e.g., via shared global), subsequent tests
could observe it. Today `reachable` is `Set<string>` and no test
mutates it; the determinism risk is latent but not actual. Still, the
shared-state shape is a minor anti-pattern per testing.md.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-tests
- **File:** `tests/integration/p0-audit/bundle-isolation.test.ts` line 39
- **Plan reference:** testing.md § Determinism (no shared state between tests)
- **Evidence:**

  bundle-isolation.test.ts:39-40 — `const visited = walkStaticImports(...);
  const reachable = new Set(toRelativePaths(visited, REPO_ROOT));` at the
  describe body. Same shape (line 158-159) in full-public-surface.test.ts
  Sub-goal 3 block.

- **Recommended action:** Optional refactor: move into `let reachable: Set<string>;` declared
describe-level + `beforeAll(() => { reachable = new Set(...); })`.
No functional change; signal correctness more explicitly. LOW priority
because today's tests do NOT mutate, but reduces future-regression
surface.


### F-tests-11: The skip-conditions LOUD console.warn calls run at MODULE EVALUATION
time (lines 36-44), not at test-run time inside describe.skipIf. When
vitest discovers the test file, the warns ALWAYS fire — even on CI
runs where the skip was intentional. Result: CI logs are noisier than
needed AND if a CI run has dist + OPENAI + PG all set, the warns
DON'T fire (correct) — so the always-on warn discipline is fine. The
MINOR concern is the warn message "Run `npm run build` first" uses
backtick markdown that may not render in plain CI logs. Cosmetic.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-tests
- **File:** `tests/integration/p0-audit/mcp-cli-boot.test.ts` line 46
- **Plan reference:** EC-3 absorption — "All 3 skip conditions LOUD via stderr console.warn"
- **Evidence:**

  mcp-cli-boot.test.ts:36-44 — three `if (!FLAG) { console.warn('T3.3
  SKIP — ...'); }` calls at the top level of the test module.

- **Recommended action:** Move the warns INSIDE the `describe.skipIf(...)` block so they ONLY
fire when the skip actually triggers a skipped test (matches EC-3
intent of "surface WHY the test skipped"). Drop the backticks from the
`npm run build` reference (CI log readability).


### F-wire-1: T3.2 RED #2 specifies behavioral assertion ("spawn `node dist/agent-tools/cli.js server`
without OPENAI_API_KEY; assert exit code 2"). The shipped T3.2 sentinel is grep-shape
only (8 readFileSync assertions that match strings in run-server.ts source); does NOT
spawn the dist artifact + observe exit code.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-wiring
- **File:** `tests/integration/p0-audit/run-server-stub-removal.test.ts` line 28-58
- **Plan reference:** T3.2 plan § TDD § RED test_run_server_hard_fails_without_openai_key
- **Evidence:**

  run-server-stub-removal.test.ts has 8 tests, all of the form:
  `expect(runServer).toMatch(/.../)` or `.not.toMatch(/.../)`
  No child_process.spawn anywhere in the file.
  
  Plan TDD spec (line 786-788 of plan):
    RED: test_run_server_does_not_import_stubs — grep [...] (PRESENT ✓)
    RED: test_run_server_hard_fails_without_openai_key — spawn `node dist/agent-tools/cli.js server`
         without OPENAI_API_KEY; assert exit code 2. (ABSENT)

- **Recommended action:** Add to run-server-stub-removal.test.ts (or cli-consolidated.test.ts § T2.3):
  test('themory server exits 2 when OPENAI_API_KEY unset (T3.2 RED #2)', async () => {
    const env = { ...process.env, THEOMEM_PG_URI: 'postgres://...', OPENAI_API_KEY: '' };
    const result = await spawnCli([CLI_DIST, 'server'], env, 5_000);
    expect(result.stderr).toMatch(/OPENAI_API_KEY required/);
    expect(result.exitCode).toBe(2);
  });
Mirrors the symmetric MCP behavioral assertion at cli-consolidated.test.ts:97.


### F-wire-2: THE GOAL TEST shipped with 42 assertions, not the 81 the plan declared. Floor (≥ 30
per Goal SMART statement) is met; plan total is 48% short.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-wiring
- **File:** `tests/integration/p0-audit/full-public-surface.test.ts` line N/A
- **Plan reference:** T4.1 plan § Deep Dives — 81 assertion budget
- **Evidence:**

  Plan T4.1 Deep Dives lines 944-952:
    - 13 subpath smoke-import assertions
    - 9 bundle isolation assertions
    - 5 paper-name token grep assertions
    - 4 MCP tools/list verb-presence assertions
    - 1 npm pack manifest assertion
    - 49 export-presence assertions
    Total: 81
  
  Shipped (per validation report `THE GOAL TEST: 42/42 PASS`):
    - Sub-goal 1 (exports surface): 6 tests
    - Sub-goal 2 (subpath smoke): 13 tests
    - Sub-goal 3 (bundle isolation): 9 tests (numbered 20-28)
    - Sub-goal 4 (paper-name): 5 tests (numbered 29-33)
    - Sub-goal 5 (REST + MCP): 5 tests
    - npm pack hygiene: 4 tests
    Total: 42

- **Recommended action:** Either (a) document in the validation report that the 81 → 42 collapse was DELIBERATE
with rationale (per-export covered upstream by T1.1/T1.2 sentinels; THE GOAL TEST
acts as the aggregator), OR (b) expand THE GOAL TEST to inline the 49 per-export
presence assertions for explicit Goal alignment. Option (a) is YAGNI-compliant.



## INFO findings (16)

### F-arch-6: Public-surface JSDoc + @see discipline cleanly aligned with
`no-paper-names-in-code.md` rule: every `@see` reference points to
a knowledge-base coordinate (ADRs, plans, blueprints) — not a
paper name. Zero paper-name leakage into the contract barrel.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-architecture
- **File:** `src/index.ts + src/core/index.ts` line full files
- **Plan reference:** T1.1 + T1.2
- **Evidence:**

  ```ts
  // src/index.ts:23-25
  * @see .claude/knowledge-base/adrs/ADR-0001-mem0-shape-architecture.md
  * @see .claude/knowledge-base/plans/completed/v0-1-local-runtime-plan.md § T7.2
  * @see .claude/knowledge-base/plans/completed/v0-4b-fixes-cycle-plan.md § ADR D6 (EvictionNotSupported)
  ```
  All 49 (8 root + 41 contract) exports follow the same pattern. The
  `no-paper-names-in-code.md` rule explicitly allows ADR-0001 (which
  cites "Mem0-shape architecture" inside the ADR title) as a
  filesystem coordinate, not a paper name in code.

- **Recommended action:** None — exemplary discipline. Leave as-is.

### F-arch-7: DIP composition-root pattern correctly applied: both files import
from src/local/, src/embedders/, src/llms/ + src/server/ (REST
only) — all "downstream" of src/core/. Neither file is imported BY
src/core/. The architecture.md § 3 boundary is respected; the
composition roots ARE the legitimate place to wire concrete
adapters into the contract.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-architecture
- **File:** `src/agent-tools/run-server.ts + src/agent-tools/run-mcp-server.ts` line full files
- **Plan reference:** ADR D3 + T3.2
- **Evidence:**

  ```ts
  // src/agent-tools/run-server.ts:28-36
  import { serve } from '@hono/node-server';
  import { Pool } from 'pg';
  import { LocalTransformerEmbedder } from '../embedders/local.js';
  import { OpenAILLM } from '../llms/openai.js';
  import { createLocalMemory, runMigrations } from '../local/index.js';
  import { PgvectorStore } from '../local/pgvector-store.js';
  import { BearerAuthVerifier, readApiKey } from '../server/auth/bearer-verifier.js';
  import { createServer } from '../server/index.js';
  ```
  `grep -rEn "from '\.\./local/" src/core` returns ZERO hits. DIP
  direction is sound.

- **Recommended action:** None — pattern is canonical. Leave as-is.

### F-arch-8: THE GOAL TEST organizes 42 assertions across 6 nested `describe`
blocks per sub-goal (EC-10 absorption). Failure attribution is
first-class: vitest output names the broken sub-goal in line 1
instead of forcing a stacktrace grep.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-architecture
- **File:** `tests/integration/p0-audit/full-public-surface.test.ts` line 48
- **Plan reference:** T4.1 / EC-10 absorption
- **Evidence:**

  ```ts
  describe('THE GOAL TEST — p0-api-sdk-mcp-correctness-audit (≥ 30 assertions)', () => {
    describe('Sub-goal 1: API correctness (public exports surface)', ...);
    describe('Sub-goal 2: SDK functional / subpath smoke imports (13 subpaths)', ...);
    describe('Sub-goal 3: Bundle isolation (9 subpath impl files)', ...);
    describe('Sub-goal 4: Paper-name policy compliance (5 tokens × 0 hits in src/**)', ...);
    describe('Sub-goal 5: REST stub removal + MCP availability', ...);
    describe('npm pack manifest hygiene', ...);
  });
  ```
  Plan goal floor was ≥ 30; landed 42 (40% above floor).

- **Recommended action:** None — well-structured. Leave as-is.

### F-dom-api-5: Five Drizzle table objects (`entities`, `history`, `memories`)
are re-exported at line 64 with JSDoc citing the schema ADR.
Consumers building custom queries against these tables couple
directly to the Drizzle schema shape — a TIGHT coupling that
survives future migrations only if the schema stays stable.
The JSDoc honestly discloses "schema-coupling cost in exchange
for query freedom" (lines 56-59), which honors Inquebrável
Rule 3. No defect. Logged for cross-validation reviewer as a
surface to watch when v1.2+ schema migrations land.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-domain-api-design
- **File:** `src/index.ts` line 64
- **Plan reference:** Plan T1.1 acceptance (every export has @see) + ADR D4
- **Domain anchor:** architecture.md § 9 (public API surface)
- **Evidence:**

  $ awk 'NR>=54 && NR<=65' src/index.ts
  /**
   * Drizzle table objects re-exported for consumers building custom
   * queries outside the `Memory` API (e.g., ETL pipelines, custom
   * dashboards).
   *
   * The 4-verb Memory API is the contract; these tables are the
   * LOAD-BEARING primitives behind it. Consumers using these
   * directly accept the schema-coupling cost in exchange for query
   * freedom.
   * ...
   */
  export { entities, history, memories } from './local/index.js';

- **Recommended action:** No action. Logged for visibility.


### F-dom-cli-4: Subtle asymmetry between REST and MCP migration paths that does NOT violate the plan but
IS worth recording as audit evidence per Inquebrável Rule 3 (honesty over silent diffs).
MCP path (run-mcp-server.ts:114) calls `runMigrations(pool, { embeddingDim: LOCAL_EMBEDDER_DIM })`
UNCONDITIONALLY at every boot. REST path (run-server.ts:113-123) gates the same call behind
`if (!shouldSkipMigrations())` AND wraps it in try/catch to translate any error into an
operator-readable stderr + exit 1. The REST path also supports `THEMEMORY_SKIP_MIGRATIONS`
env var for repeat-boot scenarios. ADR D8 (migrate-on-startup) is correctly served by REST;
MCP has neither the env-var opt-out NOR the try/catch translation. For T3.2's verbatim-port
directive, MCP is the canonical source; REST is the richer of the two paths AND was authored
LATER. This is a known divergence (run-server.ts has a richer story per Roadmap Item 16-18
composition root duties), but the ADR D3 wording "verbatim port" suggests symmetric behavior.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-domain-cli-tooling
- **File:** `src/agent-tools/run-server.ts vs src/agent-tools/run-mcp-server.ts` line run-server.ts:107 vs run-mcp-server.ts:114
- **Plan reference:** ADR D3 — verbatim port of e43d801 (REST + MCP symmetry)
- **Domain anchor:** SRP — both composition roots should run migrations identically OR document divergence
- **Evidence:**

  run-mcp-server.ts:114: `await runMigrations(pool, { embeddingDim: LOCAL_EMBEDDER_DIM });`
    (no try/catch; no skip env var; failure throws raw)
  
  run-server.ts:113-123:
  ```ts
  if (!shouldSkipMigrations()) {
    try {
      await runMigrations(pool, { embeddingDim: LOCAL_EMBEDDER_DIM });
    } catch (err) {
      process.stderr.write(
        `themory server: migrations failed (${err instanceof Error ? err.message : String(err)})\n`,
      );
      process.exit(1);
      return;
    }
  }
  ```

- **Recommended action:** No blocking action. Surface as INFO: either (a) document the divergence with a
JSDoc note on both files explaining MCP intentionally lacks the skip opt-out (and why),
OR (b) port the try/catch shape to MCP for symmetry (one-line stderr translation;
skip opt-out can stay REST-only since multi-boot scenarios are REST-flavored). Plan
does not require either; flagged for documentary honesty per Inquebrável Rule 3.


### F-dom-cli-5: Test #1 ("lists 4 verbs") and Test #2 ("registers exactly 4 tools") each spawn an
independent MCP child process via spawnMcpAndListTools — meaning two cold boots
per test run. With a 60_000 ms timeout each and a 30_000 ms response timeout, two
spawns serially can take meaningful wall-clock under contention. The two assertions
could be merged into one test calling spawnMcpAndListTools ONCE and asserting both
"set contains the 4 names" + "length === 4" — same coverage at half the boot cost.
Not a defect per the plan (T3.3 § DoD only requires "Test committed + green"), but
is a fairness-to-future-CI signal worth recording. Also matches testing.md § Pyramid
guidance — integration tests should reuse setup where possible.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-domain-cli-tooling
- **File:** `tests/integration/p0-audit/mcp-cli-boot.test.ts` line 56-62
- **Plan reference:** T3.3 § Acceptance Criteria — "Test exists + passes when OPENAI_API_KEY + THEOMEM_PG_URI set"
- **Domain anchor:** testing.md § Determinism + Pyramid (integration tier)
- **Evidence:**

  Two `await spawnMcpAndListTools(CLI_PATH, env, 30_000)` invocations at lines 56 and 66
  — each performs initialize handshake + tools/list against a fresh child process.

- **Recommended action:** Optional refactor. Either:
(a) Merge tests #1 + #2 into one test asserting both invariants on a single spawn; OR
(b) Hoist `spawnMcpAndListTools` into a `beforeAll` that caches `result.tools`, and
    let tests #1 + #2 assert against the shared snapshot.
Neither is plan-violating; flagged as low-cost-high-value test hygiene.


### F-dom-cli-6: `awaitResponse` polls the responses Map every 50 ms inside a busy `while` loop. While
semantically correct (the `await new Promise(setTimeout(..., 50))` yields control so
the readline 'line' handler can fire), polling with setTimeout is more idiomatic-Node
than reactive: an event-driven shape via a Promise resolver registered keyed by id
would eliminate the 50 ms latency floor. NOT a defect — this is a smoke gate
explicitly scoped per the helper's JSDoc — but is recorded as INFO for honesty since
polling can introduce flakiness under heavy-CPU CI (50 ms intervals stretch under
load; deadline may fire before a queued line fires).


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-domain-cli-tooling
- **File:** `tests/integration/p0-audit/_helpers/mcp-stdio-client.ts` line 53-65
- **Plan reference:** T3.3 § Deep Dives EC-9 absorption — readline + line-delimited parsing
- **Domain anchor:** testing.md § Determinism — no flaky tests; LLM/IO behavior deterministic
- **Evidence:**

  Lines 53-65 of mcp-stdio-client.ts:
  ```ts
  async function awaitResponse(id: number, label: string): Promise<JsonRpcResponse> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const r = responses.get(id);
      if (r !== undefined) return r;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`MCP ${label} timed out after ${String(timeoutMs)}ms`);
  }
  ```

- **Recommended action:** Optional. Replace responses Map with a Map<id, {resolve, reject}> of pending Promises;
the rl.on('line', ...) handler resolves the right entry. Eliminates the polling latency
floor and is idiomatic Node async. Defer if the test passes reliably under the current
shape on CI; revisit if intermittent timeouts appear.


### F-dom-cli-7: The HTTP transport install example at README lines 247-252 invokes
`npx @usetheo/memory/agent-tools` — implying the package is npm-published. Per CLAUDE.md
§ Locked names, the package is "reserved; not yet published". A third-party operator
copy-pasting the recipe will hit npm 404. The MCP stdio recipe at lines 207-223 uses
the local-build path (`/absolute/path/to/dist/agent-tools/cli.js`) which is honest for
pre-release. The two install recipes diverge in honesty: stdio is correct, HTTP claims a
published package. Same issue at line 234 ("Install as a stdio MCP server for other agents")
where the `command: "npx"` + `args: ["@usetheo/memory/agent-tools"]` shape implies publish.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-domain-cli-tooling
- **File:** `README.md` line 247-252 (HTTP transport example)
- **Plan reference:** T3.4 § Deep Dives — install recipes for stdio + HTTP transports
- **Domain anchor:** dogfood-golden-rule.md + Inquebrável Rule 3 — operator-facing setup currency
- **Evidence:**

  README line 233-234:
  ```json
  "command": "npx",
  "args": ["@usetheo/memory/agent-tools"],
  ```
  README line 251:
  ```bash
  npx @usetheo/memory/agent-tools
  ```
  CLAUDE.md § Locked names: "Canonical install command | `npm install @usetheo/memory` (reserved; not yet published)"

- **Recommended action:** Either:
(a) Add a CAVEAT block above the HTTP / non-Claude-Code recipes saying "package not yet
    published — recipes assume publish landed; until then, invoke via the absolute dist
    path as shown in the Claude Code recipe above"; OR
(b) Replace `npx @usetheo/memory/agent-tools` with `node /abs/path/to/dist/agent-tools/cli.js`
    in the example blocks, with an inline note that npx will work once the package ships.
Option (a) is lower-burden. This is an INFO finding because the affected blocks are
forward-looking recipes (consumers checking the README BEFORE the publish has landed
are explicitly off-the-happy-path), but Priority 0 sub-goal 3 explicitly demands
"third-party install + use without project-internal knowledge" — npx-404 fails that bar.


### F-dom-dbmig-1: No migration files were added, modified, or removed by any of the 17 commits in this
cycle (3c56754..HEAD). The cycle is a pure hardening cycle as declared. detect_domain.py
flagged this domain as PRIMARY due to keyword matches in JSDoc and prose ("migration",
"schema", "INDEX"), but those are FALSE POSITIVE matches against unchanged comment text.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-domain-db-migrations
- **File:** `src/local/migrations/meta/_journal.json` line 87
- **Plan reference:** N/A — out of plan scope
- **Domain anchor:** testing.md § "What to test by area" — Postgres + pgvector adapter integration
- **Evidence:**

  `git log --oneline 3c56754..HEAD -- src/local/migrations/` → 0 commits
  `git diff --name-only 3c56754..HEAD -- src/local/migrations/**` → empty set
  Only src/local/schema.ts touch in cycle: commit 2b13883 changes one JSDoc word
  ("Mem0's bivalent" → "the upstream bivalent"), purely cosmetic paper-name remediation.

- **Recommended action:** No action. This finding is INFO-level documentation that the domain detection was a
false positive and the cycle correctly avoided migration changes per the hardening
scope contract (PRIORITY 0 directive, CLAUDE.md).


### F-dom-dbmig-2: embeddingDim wiring is consistent and correct in both run-server.ts (T3.2) and the
reference run-mcp-server.ts (e43d801, pre-cycle). LOCAL_EMBEDDER_DIM = 384 is used
at all 3 call sites in BOTH files: runMigrations, new PgvectorStore, createLocalMemory.
The Xenova MiniLM model produces 384-dim vectors and the constant matches.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-domain-db-migrations
- **File:** `src/agent-tools/run-server.ts` line 43
- **Plan reference:** T3.2 — REST server stub removal (mirror of e43d801 MCP fix)
- **Domain anchor:** testing.md § "src/local/ — Postgres + pgvector adapter" + CLAUDE.md § Parametric embedding dim
- **Evidence:**

  run-server.ts:  43 (const), 115 (runMigrations), 137 (PgvectorStore), 140 (createLocalMemory) — all use LOCAL_EMBEDDER_DIM
  run-mcp-server.ts: 37 (const), 114 (runMigrations), 121 (PgvectorStore), 124 (createLocalMemory) — all use LOCAL_EMBEDDER_DIM
  Both files emit the dim in their "real providers wired" stderr disclosure per
  Inquebrável Rule 3 honesty.

- **Recommended action:** No action. Wiring is correct and symmetric. This validates that T3.2 fulfilled
the plan's "Pass `embeddingDim: LOCAL_EMBEDDER_DIM` to runMigrations, PgvectorStore,
createLocalMemory" requirement (plan line 771).


### F-dom-dbmig-3: The validation report's classification of journal-sync.test.ts as "Pre-existing;
out of plan scope" is EMPIRICALLY CORRECT. The failure root cause is the missing
src/local/migrations/meta/0011_snapshot.json companion file, introduced (by omission)
in commit 5c717aa "fix(local): T0.1 — migration 0011" at 2026-06-04 04:45:48 -0300,
~4 hours BEFORE the p0-api-sdk-mcp-correctness-audit cycle base 3c56754 (08:57:05).
That commit belongs to the principles-alignment-hardening plan, not to this one.

Test currently fails with 2 of 3 assertions red:
  - "every .sql migration has a matching meta/{tag}_snapshot.json (count match)": 12 vs 11
  - "every .sql migration has a matching meta/{idx}_snapshot.json (per-idx presence)": missing ['0011']
The "journal.json tag presence" assertion PASSES — _journal.json was updated
correctly; only the meta/0011_snapshot.json file is missing.

F-dom-db-1 BLOCKER context from the test's own docstring: this exact failure mode
("0003 + 0004 .sql files committed without journal sync") was the original v0.4b
regression that prompted writing the test. The same shape recurred in 0011 — a
regression of the regression, in a DIFFERENT plan.

Per Inquebrável Rule 3 (extreme honesty) and testing.md § Determinism, this failing
test SHOULD be fixed in a follow-up cycle (NOT in this hardening cycle's scope).
Leaving it red across cycles is the worst outcome — the determinism rule explicitly
forbids tolerating red tests. Recommend a 1-line follow-up cycle:
  1. Run `npx drizzle-kit generate:pg` to materialize 0011_snapshot.json from schema.ts.
  2. Commit alongside a regression-of-the-regression note in CHANGELOG.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-domain-db-migrations
- **File:** `tests/integration/migrations/journal-sync.test.ts` line 50
- **Plan reference:** N/A — pre-existing out-of-cycle failure
- **Domain anchor:** testing.md § Determinism ("A failing test is a bug with maximum priority")
- **Evidence:**

  `npx vitest run tests/integration/migrations/journal-sync.test.ts` →
    Test Files: 1 failed
    Tests: 2 failed | 1 passed (3)
    Missing snapshot file: src/local/migrations/meta/0011_snapshot.json
    Present companions: 0000_snapshot.json ... 0010_snapshot.json (11 files)
    Present sql files: 0000_*.sql ... 0011_*.sql (12 files)
    Present journal entries: idx 0..11 (12 entries, tag-matched for all)
  
  `git log -1 --name-only 5c717aa | grep meta/` → only _journal.json, no 0011_snapshot.json
  `git merge-base --is-ancestor 5c717aa 3c56754` → exit 0 (TRUE; 5c717aa is pre-cycle)

- **Recommended action:** Flag for follow-up cycle (NOT this review's PR). Open a small fix cycle:
  - Title: "fix(migrations): materialize 0011_snapshot.json — Drizzle journal sync"
  - Scope: 1 file added (meta/0011_snapshot.json) via `drizzle-kit generate:pg`
  - Justification: testing.md § Determinism + recurrence of F-dom-db-1 (v0.4b T0.1)
This review's PR should merge with this failure documented as pre-existing per the
validation report.


### F-dom-dbmig-4: detect_domain.py auto-classified this domain as PRIMARY based on keyword matches
("migration"/"schema"/"INDEX") that were entirely false positives — the matches
hit JSDoc/prose, not structural changes. The user's invocation prompt already
acknowledged this ("auto-detected as primary by detect_domain.py — false positive").

Recommend the detect_domain.py heuristic be tightened in a follow-up:
  - Filter matches to lines that are NOT inside /* ... */ or // comments, OR
  - Require git diff hunks against actual .sql or meta/ files for db-migrations classification, OR
  - Lower confidence weight when matches are concentrated in commit-message text vs source-code AST nodes.
Out of scope for this review.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-domain-db-migrations
- **File:** `.claude/agents/review-p0-api-sdk-mcp-correctness-audit-2026-06-04/domain-db-migrations.md` line 22
- **Plan reference:** N/A — review meta-finding
- **Domain anchor:** cycle-review.md § Domain detection
- **Evidence:**

  Cycle touched src/agent-tools/run-server.ts (T3.2) — comments + ADR D8 reference
  ("migrate-on-startup", "runMigrations runs BEFORE the port binds") match the
  detector's keyword bag without representing migration work.

- **Recommended action:** No action in this review. Note for future detect_domain.py tuning.


### F-tests-12: git log shows each task's test file shipped in a SINGLE commit that
contains both the test file AND the production artifact (e.g., T0.1
`6b1333c` ships both p0-baseline.sh + baseline.test.ts; T3.2 `f1e50dc`
ships both run-server.ts edits + run-server-stub-removal.test.ts). The
same-commit shape is consistent across all 12 tasks. Per Inquebrável
Rule 5 + cycle-implement.md, RED phase must commit a FAILING test
BEFORE the GREEN production code. With test + impl in the same commit,
it's impossible to verify post-hoc that the test was authored RED
first. The /implement halt-loop SHOULD have produced 2 commits per task
(RED commit + GREEN commit) for auditability.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-tests
- **File:** `tests/integration/p0-audit/(all 12 files)` line N/A
- **Plan reference:** TDD discipline § cycle-implement.md anti-pattern
- **Evidence:**

  git log --diff-filter=A --pretty=format:"%h %s" -- tests/integration/p0-audit/
  shows each test file added in commits that ALSO modify src/. Sample:
  `f1e50dc feat(agent-tools): T3.2 — REST server stub removal (mirror of
  e43d801 MCP fix)` modifies src/agent-tools/run-server.ts + adds
  tests/integration/p0-audit/run-server-stub-removal.test.ts in one
  commit. No prior commit shows the test failing.

- **Recommended action:** Process-level only — for this plan the same-commit shape is grandfathered
(review-after-implement). Going forward: cycle-implement halt-loop
driver prompts should require commits in pairs (RED-fail commit, then
GREEN-pass commit) so the TDD discipline is git-observable. Plans
whose tests landed atomic-with-impl pass the existence gate but fail
the TDD-order audit silently. This finding is INFO (not blocking)
because the test file QUALITY is solid and the implementation matches
the test contract; the procedural gap is real but downstream of this
plan's scope.


### F-tests-13: `npm pack --dry-run --json` is invoked TWICE per `vitest run` of the
audit suite — once in pack-manifest.test.ts AND once in
full-public-surface.test.ts Sub-goal 6. Each invocation takes 5-15s
depending on system state. Total p0-audit run takes ~13s per the local
execution above. Within the 30s soft warn, but redundant work.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-tests
- **File:** `tests/integration/p0-audit/full-public-surface.test.ts` line 246-275
- **Plan reference:** testing.md § Anti-patterns — "Integration tests >30s = warn"
- **Evidence:**

  Both pack-manifest.test.ts:41 + full-public-surface.test.ts:247 spawn
  `npm pack --dry-run --json` with `timeout: 60_000`. Local run reported
  `Duration  13.35s`.

- **Recommended action:** Optional optimization: extract the pack-result fetch into a fixture
cached via `globalSetup` (vitest) or a `beforeAll` shared across both
files (only if vitest config supports cross-file setup hooks). Low
priority — current runtime under the 30s soft floor; functional
correctness intact.


### F-wire-3: `test #3` "EC-3 sentinel — skipIf decisions are based on observable env state"
is a no-op assertion (`expect(typeof DIST_EXISTS).toBe('boolean')`). It always
passes regardless of system state.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-wiring
- **File:** `tests/integration/p0-audit/mcp-cli-boot.test.ts` line 73-82
- **Plan reference:** T3.3 RED — preconditions sanity test
- **Evidence:**

  Lines 73-82 of mcp-cli-boot.test.ts:
    test('3. EC-3 sentinel...', () => {
      expect(typeof DIST_EXISTS).toBe('boolean');
      expect(typeof HAS_OPENAI).toBe('boolean');
      expect(typeof HAS_PG_URI).toBe('boolean');
    });
  typeof always returns 'boolean' since the constants are computed as booleans
  via existsSync / process.env undefined comparison. Tautological assertion.

- **Recommended action:** Either delete the no-op test or replace its assertion body with a check that
the warn messages fired (e.g., spy on console.warn). Low priority.


### F-wire-4: Validation report explicitly discloses (§ "Honest disclosure" + § "Cycle implement
anti-patterns adherence" line 88) that the cycle invoked ralph-loop directly,
bypassing /implement skill's SEPA agent spawn. Synthetic report consolidated
post-facto.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-wiring
- **File:** `.claude/knowledge-base/reviews/p0-api-sdk-mcp-correctness-audit-implement-validate-2026-06-04.md` line 1-10
- **Plan reference:** cycle-implement.md § anti-pattern
- **Evidence:**

  Line 88: "Anti-pattern #10: violation in spirit — the user invoked ralph-loop:ralph-loop
            directly instead of /implement {slug} [...] The SEPA agent was NOT spawned
            for this cycle; this is a known mechanical gap from the raw-loop invocation path."

- **Recommended action:** For NEXT cycle: invoke `/implement {slug}` to engage the SEPA agent loop properly,
OR formalize the "raw ralph-loop bypass" path as a documented escape hatch in
cycle-implement.md. The cycle delivered correct code with honest disclosure;
no remedial action needed for THIS PR. Surface to /review baseline cross-validation
agent for cycle-implement contract hygiene tracking.



## Handoff decision

Implementation has BLOCKER and/or CRITICAL findings. Loop back to `/implement` to address.

## Audit trail

Spawned agents (their findings files live alongside this report):

- `.claude/agents/review-p0-api-sdk-mcp-correctness-audit-2026-06-04/review-p0-api-sdk-mcp-correctness-audit-architecture.md`
- `.claude/agents/review-p0-api-sdk-mcp-correctness-audit-2026-06-04/cross-validation.md`
- `.claude/agents/review-p0-api-sdk-mcp-correctness-audit-2026-06-04/review-p0-api-sdk-mcp-correctness-audit-domain-api-design.md`
- `.claude/agents/review-p0-api-sdk-mcp-correctness-audit-2026-06-04/review-p0-api-sdk-mcp-correctness-audit-domain-cli-tooling.md`
- `.claude/agents/review-p0-api-sdk-mcp-correctness-audit-2026-06-04/review-p0-api-sdk-mcp-correctness-audit-domain-db-migrations.md`
- `.claude/agents/review-p0-api-sdk-mcp-correctness-audit-2026-06-04/review-p0-api-sdk-mcp-correctness-audit-tests.md`
- `.claude/agents/review-p0-api-sdk-mcp-correctness-audit-2026-06-04/review-p0-api-sdk-mcp-correctness-audit-wiring.md`

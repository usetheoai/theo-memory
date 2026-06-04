# Review: verbs-as-cli-themory-remember-recall-forget-reflect

**Date:** 2026-06-04
**Verdict:** READY_TO_MERGE
**Reviewers (spawned agents):** 6 (review-verbs-as-cli-themory-remember-recall-forget-reflect-architecture, cross-validation, review-verbs-as-cli-themory-remember-recall-forget-reflect-domain-api-design, review-verbs-as-cli-themory-remember-recall-forget-reflect-domain-cli-tooling, review-verbs-as-cli-themory-remember-recall-forget-reflect-tests, review-verbs-as-cli-themory-remember-recall-forget-reflect-wiring)
**Total findings:** 48

## Findings summary by severity

| Severity | Count |
|---|---|
| BLOCKER | 0 |
| CRITICAL | 0 |
| MAJOR | 11 |
| MINOR | 13 |
| INFO | 24 |

## MAJOR findings (11)

### F-arch-1: ReflectionPolicy `{ kind: 'manual', shouldReflect: () => true }` is wired
ONLY in `cli-memory-factory.ts`, NOT in `run-mcp-server.ts` or
`run-server.ts`. This creates a behavioral divergence across the three
`createLocalMemory()` consumers in `src/agent-tools/`: a CLI invocation
`themory reflect --user alice` succeeds, but the same scope reaching
Memory.reflect() via MCP tool `mcp__themory__reflect` or REST endpoint
`POST /v1/reflect` throws `ReflectionNotConfigured`.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-architecture
- **File:** `src/agent-tools/cli-memory-factory.ts` line 57-60
- **Plan reference:** ADR D4 + in-cycle addition (not in original plan)
- **Evidence:**

  $ grep -l reflectionPolicy src/agent-tools/run-*.ts src/agent-tools/cli-memory-factory.ts
  src/agent-tools/cli-memory-factory.ts
  # (run-mcp-server.ts and run-server.ts do NOT wire reflectionPolicy)
  # cli-memory-factory.ts:57-60:
  reflectionPolicy: {
    kind: 'manual',
    shouldReflect: () => Promise.resolve(true),
  },

- **Recommended action:** Either (a) hoist the manual `reflectionPolicy` default into
`createLocalMemory()` itself so all three entrypoints (MCP/REST/CLI)
share the contract, OR (b) extract the `reflectionPolicy: {...manual}`
block into a shared helper `defaultManualReflectionPolicy()` invoked from
all three handlers. Document the choice with an ADR amendment, since the
plan's ADR D4 says "Reuse existing factory (chosen): zero new wiring"
but the in-cycle reality added new wiring asymmetrically. Flagged
explicitly in implement-validate as in-cycle delta vs plan.


### F-arch-2: Env-validation (`THEOMEM_PG_URI` / `OPENAI_API_KEY` hard-fail with
identical stderr strings + identical exit-2 contract) is now triplicated
across `run-mcp-server.ts:86-108`, `run-server.ts:83-104`, and
`cli-memory-factory.ts:29-43`. The newly extracted `createCliMemory()`
was a DRY win for the 4 verb handlers but did not absorb the duplication
with the two pre-existing entrypoints — exactly the DRY anti-pattern
called out in `/home/paulo/.claude/CLAUDE.md § 12` (knowledge
duplication, not code duplication: the same business rule "fail-2 on
missing env" lives in three places; changing the rule requires editing
three files).


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-architecture
- **File:** `src/agent-tools/cli-memory-factory.ts` line 28-43
- **Plan reference:** ADR D4 + DRY rule (architecture.md § DRY)
- **Evidence:**

  $ grep -c "THEOMEM_PG_URI required" src/agent-tools/run-mcp-server.ts src/agent-tools/run-server.ts src/agent-tools/cli-memory-factory.ts
  src/agent-tools/run-mcp-server.ts:1
  src/agent-tools/run-server.ts:1
  src/agent-tools/cli-memory-factory.ts:1

- **Recommended action:** Extract a shared `requireEnvOrExit2(name, hint)` helper in
`cli-memory-factory.ts` (or a new `agent-tools/env-guards.ts`) and adopt
it from `run-mcp-server.ts` + `run-server.ts` in a follow-up commit.
The "Regra de 3" trigger (DRY golden rule) is now met (three concrete
duplications); extraction is justified. Out-of-cycle hardening since
this triplication pre-dates the plan, but the cycle had the chance to
collapse it when extracting `cli-memory-factory.ts`.


### F-arch-3: cli.ts has 5 numeric parser functions with substantial duplication: the
two `--port` parsers (lines 87-93 and 107-113) are byte-identical; the
three new bound validators (`parseTopK`, `parseThreshold`,
`parseDiversify`) share the same structure (parse-cast-bound-throw).
`parseThreshold` and `parseDiversify` are functionally identical (both
float-0-1 bounds). Total ~50 LoC could be ~20 LoC via a shared
`parseIntInRange(name, min, max)` + `parseFloatInRange(name, min, max)`
factory. Architecture.md § 7 module hygiene + § 12 DRY.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-architecture
- **File:** `src/agent-tools/cli.ts` line 71-79, 87-93, 107-113, 141-161
- **Plan reference:** architecture.md § DRY + KISS
- **Evidence:**

  src/agent-tools/cli.ts:148-154 (parseThreshold)
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      throw new InvalidArgumentError(`Invalid --threshold: ${raw} ...`);
    }
    return n;
  src/agent-tools/cli.ts:155-161 (parseDiversify)
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      throw new InvalidArgumentError(`Invalid --diversify: ${raw} ...`);
    }
    return n;

- **Recommended action:** Extract a `parseFloatInRange(flagName, min, max)` and
`parseIntInRange(flagName, min, max)` factory at the top of
`buildProgram()` or in a new `cli-arg-parsers.ts`. Reduces 50 LoC to
20 LoC, eliminates byte-identical duplications, and makes future
validators trivial.


### F-dom-api-1: CLI `reflect` projects `ReflectionResult` into `CliReflectResult` with a
RENAMED field (`higherOrderMemories` → `derived`) — diverges from MCP +
REST surfaces and breaks 3-way parity. There is NO public ADR justifying
the field-name remap; ADR D3 merely says "consumer-friendly counts".


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-domain-api-design
- **File:** `src/agent-tools/run-reflect.ts` line 32-37
- **Plan reference:** ADR D3 + T2.4 Deep Dives ("consumer-friendly { sourceCount, derivedCount }")
- **Domain anchor:** CLAUDE.md § Locked names (4 verbs = remember/recall/forget/reflect — same
semantics across all three consumer surfaces); Architecture rule § 9
(Public API surface: "Adding a new public export requires updating
src/index.ts ... and a unit test that imports through the public path").

- **Evidence:**

  Three sibling surfaces ship different reflect shapes:
  
  (a) REST POST /v1/reflect (src/server/handlers/reflect.ts:32-33)
      returns `c.json(result, 202)` — RAW `ReflectionResult`:
        { higherOrderMemories: MemoryItem[], sourceIds: string[],
          derivedMemoriesCreated: number, reason?: ... }
  
  (b) MCP `mcp__themory__reflect` (src/agent-tools/tools/reflect-handler.ts:30-37)
      returns text-only summary `"Reflection complete. Produced N
      higher-order memories."` — neither raw nor projected; no structured
      payload at all.
  
  (c) CLI `themory reflect --json` (src/agent-tools/run-reflect.ts:32-38
      + src/agent-tools/cli-output.ts:27-32) returns PROJECTED
      `CliReflectResult`:
        { sourceCount: number, derivedCount: number,
          derived: MemoryItem[], reason?: ... }
  
  Consumer that uses `themory reflect --user u --json | jq .higherOrderMemories`
  gets `null`; the consumer would need `jq .derived` for the CLI surface,
  `jq .higherOrderMemories` for the REST surface, and the MCP surface
  cannot be JSON-queried at all. The 4-verb public API is locked under
  CLAUDE.md § Locked names — its output shape is part of the contract.
  A renamed projection in ONE surface is a public-API divergence.

- **Recommended action:** Two acceptable resolutions per Inquebrável Rule 3 (extreme honesty):
(A) CLI emits RAW `ReflectionResult` JSON (matching REST) — drop the
    `CliReflectResult` projection entirely. Text-format renderer keeps
    the `Reflected N → M insights` ergonomic line; JSON-format ships
    the raw contract. Restores 3-way parity (or at least 2-way; MCP
    text-only is a separate F-dom-domain issue).
(B) Document the divergence loudly: add a `## Public CLI surface
    stability` note in CHANGELOG `[Unreleased]` calling out that CLI
    reflect JSON differs from REST and explaining the trade-off, AND
    add a dedicated ADR D6 to the plan (post-merge follow-up cycle)
    locking the rename so future contributors do not silently re-shape it.

Resolution (A) is preferred — keeps the 4-verb contract uniform across
surfaces and removes the field-name asymmetry that breaks jq pipelines.


### F-dom-api-2: CHANGELOG `[Unreleased]` entry is comprehensive on EC absorptions (1-9)
and operational surface but DOES NOT surface 3 consumer-facing caveats
that the consumer will hit on day 1.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-domain-api-design
- **File:** `CHANGELOG.md` line 9
- **Plan reference:** T4.1 § Acceptance Criteria — "CHANGELOG [Unreleased] entry added"
- **Domain anchor:** Inquebrável Rule 3 (extreme honesty) + Rule 6 (changelog discipline:
"Toda entry DEVE ter referência ao ticket/issue/PR ... Escreva para o
consumidor, não para o desenvolvedor"). CLAUDE.md § Roadmap discipline:
"Caveat disclosure is non-negotiable. Every shipped feature lists its
caveats."

- **Evidence:**

  Missing caveats in the [Unreleased] entry (grep CHANGELOG.md:9):
  
  1. **Reflect projection divergence** — `themory reflect --json` emits
     `{ sourceCount, derivedCount, derived, reason? }` while
     `POST /v1/reflect` emits the raw `ReflectionResult`
     `{ higherOrderMemories, sourceIds, derivedMemoriesCreated, reason? }`.
     Consumer scripts that switch transports (CLI → REST during ops
     scaling) will break their jq pipelines silently. Not warned.
  
  2. **`DOTENV_CONFIG_QUIET=true` requirement for jq composability** —
     tests/integration/cli/verbs-cli.test.ts:73 injects this env to
     silence a dotenv v17 transitive banner that would otherwise
     pollute stdout. The CHANGELOG entry mentions it parenthetically
     ("Pre-existing dotenv v17 transitive auto-load surface noted: ...
     runtime is dependency-driven, not introduced by this cycle") but
     does NOT instruct CONSUMERS to set this in their own shell when
     piping `themory recall ... | jq`. This is consumer-load-bearing
     disclosure.
  
  3. **First-invocation warm-up cost (EC-8)** — handler JSDoc documents
     "~2-5s cold-start" but the CHANGELOG mentions "EC-8 + EC-9
     documented in handler JSDoc" without surfacing the actual
     number. Consumers planning batch scripting will not know to
     switch to REST until they hit the timeout.

- **Recommended action:** Add a "## Consumer caveats" sub-bullet (or inline `**Caveats:**` clause)
to the verbs-as-cli [Unreleased] entry covering:
(a) reflect-shape divergence (per F-dom-api-1 resolution choice);
(b) `DOTENV_CONFIG_QUIET=true` recommended in user shell for shell
    pipelines (or, better, fix at source: re-evaluate whether the
    dotenv banner should be silenced unconditionally in the CLI bin
    entry — but that's a separate change);
(c) cold-start ~2-5s; for batch ops > 50 invocations, use REST server +
    curl per EC-8 documented in run-remember.ts JSDoc.


### F-dom-api-3: The 4 CLI verbs + their flag set are NEW public CLI contract reachable
from `npm install @usetheo/memory && npx themory ...`. They are NOT
enumerated in CLAUDE.md § Locked names. Without explicit locking, a
future cycle could silently rename or remove a flag, breaking the v1.0
contract-freeze commitment (Roadmap Item 11).


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-domain-api-design
- **File:** `CLAUDE.md` line Locked names table
- **Plan reference:** Roadmap Item 18 (v1.0 contract freeze blocker per Item 11) + CLAUDE.md
§ PRIORITY 0 sub-goal 1 ("APIs corretas — every export in src/index.ts
... is documented, typed, narrowable").

- **Domain anchor:** CLAUDE.md § Locked names: "Decisions documented; changing requires a
CLAUDE.md update + CHANGELOG entry + strategic review for items marked
`strategic`." Roadmap Item 18 acceptance criterion locks the verb
surface; the CLI surface is now ALSO a public consumer entry-point.

- **Evidence:**

  CLAUDE.md § Locked names currently locks API verbs at the language
  surface ("API verbs: remember / recall / forget / reflect") but does
  NOT enumerate CLI subcommands. The Locked names table covers:
   - npm package name
   - Marketing name
   - License
   - Memory tiers
   - API verbs (language-only)
   - Two runtimes
   - Subpath exports
  
  The CLI surface introduced by this cycle:
   - `themory remember <text>` + scope flags + format flags
   - `themory recall <query>` + scope + tuning + format flags
   - `themory forget <id>` + --hard + format flags
   - `themory reflect` + scope flags + format flags
   - Flag names: --user, --session, --agent, --hard, --top-k,
     --threshold, --diversify, --json, --text
   - Output: JSON by default, --text opt-in
   - Bin entries: `themory` + `themory-mcp` (per ADR D5; package.json
     confirmed unchanged)
  
  None of the above is locked at CLAUDE.md strategic-marker level. v1.0
  contract freeze (Item 11) needs the CLI surface enumerated so that
  future refactors cannot silently break it.

- **Recommended action:** Follow-up cycle (NOT this merge — would scope-creep this plan past its
~500 LoC budget): add a "Consolidated CLI" row to CLAUDE.md § Locked
names enumerating the 4 verbs + the 9 stable flags + the JSON-default
output contract. Mark as `strategic`. Add a regression sentinel test
`tests/integration/p0-audit/cli-flag-stability.test.ts` that spawns
`themory <verb> --help` and asserts the printed flag set against a
frozen baseline. This closes the gap between Roadmap Item 18
"Consolidated CLI" line and the actual flag inventory.


### F-dom-cli-1: dotenv@17.4.2 (transitive via optionalDependency natural@^8.1.0) auto-loads on require and emits the
`◇ injected env (0) from .env // tip: ...` banner to stdout for EVERY invocation, including --help and
--version. The runtime suppresses it ONLY via the test-spawn-injected `DOTENV_CONFIG_QUIET=true` env
variable in tests/integration/cli/verbs-cli.test.ts:73. End-consumers running the bin entry directly
(`themory recall 'q' --user u | jq .[0]`) will hit JSON.parse / jq errors because the banner pollutes
the first 5+ lines of stdout BEFORE the actual JSON payload. This directly contradicts ADR D3's
"JSON-default-with-opt-out-text" contract whose rationale is "JSON is composable with jq / scripts /
Docker ops". The defect was discovered during this cycle (validation report § "Surfaces discovered
during implementation" item 4) but the fix landed only in the test harness, not the runtime.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-domain-cli-tooling
- **File:** `src/agent-tools/cli.ts` line 295-301 (module-level), implicit: handler entry
- **Plan reference:** Plan v1.1 § Open Question (implicit) — D3/D4 do not address dotenv banner
- **Domain anchor:** Plan v1.1 § Caveat (CHANGELOG line 9) acknowledges DOTENV_CONFIG_QUIET workaround for TEST spawn only; consumer-facing path is undocumented. Inquebrável Rule 3 honesty + plan § ADR D3 JSON-default-with-jq-composability contract.
- **Evidence:**

  $ node dist/agent-tools/cli.js --version
  ◇ injected env (0) from .env // tip: ⌘ custom filepath { path: '/custom/path/.env' }
  ◇ injected env (0) from .env // tip: ⌁ auth for agents [www.vestauth.com]
  ◇ injected env (0) from .env // tip: ⌘ multiple files { path: ['.env.local', '.env'] }
  ◇ injected env (0) from .env // tip: ⌘ override existing { override: true }
  ◇ injected env (0) from .env // tip: ⌘ suppress logs { quiet: true }
  0.1.0-alpha
  
  $ DOTENV_CONFIG_QUIET=true node dist/agent-tools/cli.js --version
  0.1.0-alpha
  
  tests/integration/cli/verbs-cli.test.ts:70-73 documents the workaround as a test-only env injection:
    // DOTENV_CONFIG_QUIET silences the dotenv v17 tip-of-the-day banner that
    // is auto-emitted to stdout by some transitive dep at module load
    env: { ...process.env, DOTENV_CONFIG_QUIET: 'true', ...extraEnv },

- **Recommended action:** Set DOTENV_CONFIG_QUIET=true at the TOP of src/agent-tools/cli.ts BEFORE any other import statement.
This is a 2-line fix:
  // Suppress dotenv@17 transitive banner BEFORE any import can trigger it
  // (natural@^8 → dotenv@^17 auto-load). Consumer-facing parity with the
  // test harness DOTENV_CONFIG_QUIET injection per plan T0.1 runCli().
  process.env['DOTENV_CONFIG_QUIET'] = 'true';

Then ALSO add a one-line note in README under the "CLI" section:
  > Note: the bin entry sets DOTENV_CONFIG_QUIET=true at startup to suppress
  > a transitive dotenv banner that would otherwise corrupt --json output.
Sample test fix follows naturally — remove the runCli() DOTENV_CONFIG_QUIET injection (it becomes
redundant once cli.ts handles it eagerly), demonstrating the workaround is now upstream of the
consumer process boundary.


### F-dom-cli-2: In run-remember, run-recall, and run-reflect, the handler invokes `createCliMemory()` BEFORE
`resolveCliScope()`. Result: when a consumer supplies invalid scope flags (zero scope OR multi-scope),
the handler still:
  1. Opens a pg Pool (~50ms)
  2. Calls runMigrations(pool) — Drizzle journal sync (~100ms)
  3. Initializes LocalTransformerEmbedder + OpenAILLM real providers
  4. Allocates createLocalMemory factory state
Only AFTER all that does it throw "--user / --session / --agent: exactly one required". With a real
PG server, the failure mode is even worse: when env IS set but the DB is unreachable, the consumer
sees `Error: connect ECONNREFUSED 127.0.0.1:5432` instead of the scope-error they actually triggered,
misdiagnosing the bug at their CLI invocation as a DB outage.

This violates fail-fast (architecture.md § 8) and burns the EC-8 warm-up cost (~2-5s) on a request
that should have rejected in <1ms. The contract in run-forget.ts already implements the correct
ordering (UUID-v4 validation BEFORE createCliMemory at run-forget.ts:25-29) — the other three
handlers were not aligned with that pattern.

Test #4 (multi-scope exits 2) passes BUT only verifies the exit code; it does NOT verify the error
message identifies the actual scope-flag defect. Replicate:
  $ THEOMEM_PG_URI='postgres://localhost:9999' OPENAI_API_KEY='fake' \
    node dist/agent-tools/cli.js remember 'hello' --user a --session b
  Error: connect ECONNREFUSED 127.0.0.1:9999
  exit=2

The consumer correctly gets exit 2 but the stderr message is misleading.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-domain-cli-tooling
- **File:** `src/agent-tools/run-remember.ts, src/agent-tools/run-recall.ts, src/agent-tools/run-reflect.ts` line run-remember.ts:33-35 (and parallel sites in run-recall + run-reflect)
- **Plan reference:** Plan v1.1 § ADR D2 (scope validation contract) + § T2.1 Deep Dives (EC-8 warm-up cost ~2-5s)
- **Domain anchor:** architecture.md § 8 Error handling — 'Valide inputs nas fronteiras do sistema'. Fail-fast principle. Plan v1.1 § ADR D4 envfail-via-process.exit(2).
- **Evidence:**

  src/agent-tools/run-remember.ts:33-35
    const [memory, dispose] = await createCliMemory();
    try {
      const scoped = resolveCliScope(memory, opts);  // ← scope validation is AFTER warm-up
  
  Compare to src/agent-tools/run-forget.ts:25-31 (CORRECT pattern):
    // EC-5 absorption — UUID v4 validator BEFORE Memory factory warm-up.
    if (!UUID_V4_REGEX.test(opts.id)) {
      process.stderr.write(`Error: Invalid <id>: must be UUID v4 (got: ${opts.id}).\n`);
      process.exit(2);
    }
    const [memory, dispose] = await createCliMemory();

- **Recommended action:** Refactor run-remember, run-recall, run-reflect to validate scope flags BEFORE invoking
createCliMemory(). Extract a static `assertExactlyOneScope(opts)` helper into cli-scope.ts that throws
WITHOUT requiring a Memory instance:
  export function assertExactlyOneScope(opts: CliScopeOptions): void { ... }
Each handler then becomes:
  export async function runRemember(opts) {
    if (opts.text.trim().length === 0) { ... process.exit(2); }
    assertExactlyOneScope(opts);  // ← NEW: fail-fast scope check
    const [memory, dispose] = await createCliMemory();
    ...
  }
Then add one integration assertion verifying multi-scope failure stderr matches /exactly one required/i
(currently test #4 only asserts exit code, not the error message identity).


### F-dom-cli-3: The README has ZERO mention of the new verbs-as-CLI surface. No usage examples for
`themory remember/recall/forget/reflect`, no documentation of flag semantics, no note about
DOTENV_CONFIG_QUIET, no JSON-vs-text format toggle. This is the consumer-facing surface that
Roadmap Item 18 promised; shipping it without README copy fails Inquebrável Rule 3 (honesty —
a feature consumers can't discover doesn't exist), CLAUDE.md § PRIORITY 0 sub-goal 1
("APIs corretas — every export is DOCUMENTED"), and the plan's stated B2 ergonomics goal.

The plan's Goal section explicitly cites Docker composability as motivation
("docker exec -it themory themory recall 'query' --user alice"). Consumers can't discover that
pattern without README copy.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-domain-cli-tooling
- **File:** `README.md` line (absent section)
- **Plan reference:** Plan v1.1 § Goal — Roadmap Item 18 verbs-as-CLI surface. CLAUDE.md Locked names § API verbs: remember/recall/forget/reflect.
- **Domain anchor:** CHANGELOG.md v0.0.0-rc.3 ships the public CLI surface; consumers will install @usetheo/memory@next and look for usage examples in README.
- **Evidence:**

  $ grep -n "themory remember\|themory recall\|themory forget\|themory reflect" README.md
  (no output)
  
  $ grep -n "DOTENV\|--user\|--session\|--agent" README.md
  (no output)

- **Recommended action:** Add a "CLI verbs" section under the existing "Quickstart" or new "Using the CLI" heading covering:
1. The 4 verbs with their canonical invocation shapes (remember/recall/forget/reflect)
2. Scope-flag semantics (mutually exclusive --user/--session/--agent; forget bypass per EC-1)
3. Output format toggle (--json default vs --text)
4. Common compositions (jq pipelines, Docker exec patterns)
5. Exit-code semantics (0 success / 1 commander generic / 2 invalid input or env-missing)
6. Note about DOTENV_CONFIG_QUIET (or remove after F-dom-cli-1 lands; preferable)
The README addition itself can be ~50 lines. Without it, the plan's "consumer can run via docker exec"
composability claim is shipped but invisible.


### F-wire-1: The cli-memory-factory.ts extraction was the right DRY surface but the duplicates
in src/agent-tools/run-mcp-server.ts:84-128 and src/agent-tools/run-server.ts:130-141
were NOT retrofitted to consume it. Architecture review flagged this as F-arch-1 + F-arch-2.
Currently 3 near-identical implementations of (env-fail validation + pg pool + runMigrations
+ createLocalMemory wiring) exist side by side.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-wiring
- **File:** `src/agent-tools/cli-memory-factory.ts` line 28
- **Plan reference:** T2 § Deep Dives (DRY extraction surface) + cycle-implement.md anti-pattern
- **Evidence:**

  grep -n "createCliMemory" run-mcp-server.ts run-server.ts → no matches.
  grep -n "createLocalMemory" run-mcp-server.ts:123, run-server.ts:136 — both still
  inline the factory call with the same env-fail block carbon-copied from the original.

- **Recommended action:** Open a follow-up cycle to retrofit run-mcp-server.ts + run-server.ts to consume
createCliMemory (or a renamed createMemoryFromEnv). Acceptance: the env-fail block
+ Pool() + runMigrations() + createLocalMemory({ ... }) literal appears in only one
location. Out of scope for verbs-as-cli cycle (correctly scoped fix); flagged as
hardening debt under Priority 0 sub-goal 1.


### F-wire-2: ReflectionPolicy asymmetry: createCliMemory wires `reflectionPolicy: { kind: 'manual', shouldReflect: () => Promise.resolve(true) }`
to permit `themory reflect`. Same factory pattern in run-mcp-server.ts (line 123) and
run-server.ts (line 136) does NOT set reflectionPolicy. Consequently, MCP `reflect` tool
(src/agent-tools/tools/reflect-handler.ts:31) and REST POST /v1/reflect handler
(src/server/handlers/reflect.ts:32) hit `scoped.reflect()` → throw `ReflectionNotConfigured`
(src/local/index.ts:632).


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-wiring
- **File:** `src/agent-tools/cli-memory-factory.ts` line 57
- **Plan reference:** T2.4 § ADR D4 + run-reflect.ts (ScopedMemory.reflect → ReflectionPolicy requirement)
- **Evidence:**

  grep -n "reflectionPolicy" run-mcp-server.ts run-server.ts cli-memory-factory.ts →
  only cli-memory-factory.ts:57 sets it.
  src/local/index.ts:631-632: `if (this.reflectionPolicy === undefined) { throw new ReflectionNotConfigured(); }`
  src/agent-tools/tools/reflect-handler.ts:31: `const result = await scoped.reflect();`
  src/server/handlers/reflect.ts:32: `const result = await scoped.reflect({ maxIterations });`

- **Recommended action:** Two options for the follow-up cycle: (a) move the manual ReflectionPolicy default
into createLocalMemory() — make reflectionPolicy default to { kind: 'manual' } when
omitted, so all 3 entry points get the safe default; OR (b) retrofit run-mcp-server.ts +
run-server.ts to set the policy explicitly (when bundled with F-wire-1 fix via
consuming createCliMemory). Option (a) is preferred per Inquebrável Rule 9 + 10 (KISS).



## MINOR findings (13)

### F-arch-4: The "defensive embedding strip" in `run-recall.ts` is cargo-cult: the
public `MemoryItemWithScore` TYPE does NOT declare an `embedding`
field. The strip-via-`Object.entries.filter` runs unconditionally on
every result and would only matter if a future adapter projection
leaked `embedding` through the type system via a structural-typing
bypass — at which point typecheck would catch it. The comment honestly
labels itself "defensive" but the operation has zero current behavioral
effect and adds O(n*k) per recall where k = field-count.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-architecture
- **File:** `src/agent-tools/run-recall.ts` line 41-49
- **Plan reference:** T2.2 EC-7 absorption
- **Evidence:**

  src/agent-tools/run-recall.ts:46-49:
    const stripped = items.map((item) => {
      const entries = Object.entries(item).filter(([key]) => key !== 'embedding');
      return Object.fromEntries(entries) as MemoryItemWithScore;
    });
  $ grep -n "embedding" src/core/memory-item.ts
  # (no matches — MemoryItem type does NOT include embedding)

- **Recommended action:** Either (a) keep the strip as a runtime sentinel against future adapter
regressions but add a single integration assertion that exercises the
branch (currently test #19 asserts the absence, but does not exercise
a row WITH embedding to prove the strip works), OR (b) delete the
strip entirely since type-safety already prevents it. Document the
choice with an ADR amendment to EC-7.


### F-arch-5: `makeMockMemory()` is a 23-line mock that synthesizes a fake `Memory`
with injected `__mockKind` / `__mockId` smuggle fields read back by
tests via `as unknown as Record<string, unknown>`. The mock shape uses
a non-canonical `reflect()` return shape `{ sourceCount, derivedCount,
derived }` that does NOT match `ReflectionResult` (which has
`higherOrderMemories` / `sourceIds` / `derivedMemoriesCreated`).
Testing.md § Anti-patterns: "Mocks that exceed 5 lines of setup — the
design is wrong; revisit SRP and the boundary."


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-architecture
- **File:** `src/agent-tools/__tests__/cli-scope.test.ts` line 12-34
- **Plan reference:** T1.1 contract tests + testing.md § Anti-patterns ("Mocks that exceed 5 lines of setup")
- **Evidence:**

  src/agent-tools/__tests__/cli-scope.test.ts:17:
    reflect: () => Promise.resolve({ sourceCount: 0, derivedCount: 0, derived: [] }),
  src/core/reflection-result.ts:8-26:
    export interface ReflectionResult {
      readonly higherOrderMemories: readonly MemoryItem[];
      readonly sourceIds: readonly string[];
      readonly derivedMemoriesCreated: number;
      ...
    }

- **Recommended action:** Replace `makeMockMemory()` with a minimal partial `Memory` typed as
`Pick<Memory, 'user' | 'session' | 'agent'>` so the mock surface
matches what `resolveCliScope` actually consumes (no need to fake
reflect/recall/remember/forget at all). Eliminates ~15 of the 23 mock
lines and removes the misleading non-canonical reflect shape.


### F-dom-api-4: EC-7 absorption strips `embedding` via runtime `Object.entries.filter`
on a value whose TYPE (`MemoryItemWithScore`) does NOT declare
`embedding`. The defensive strip is necessary but creates a
type-vs-runtime asymmetry that is invisible to readers of the public
type — and the asymmetry is not surfaced in JSDoc on
`MemoryItemWithScore`.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-domain-api-design
- **File:** `src/agent-tools/run-recall.ts` line 41-49
- **Plan reference:** EC-7 absorption (T0.1 test 19 + T2.2 Deep Dives)
- **Domain anchor:** Architecture rule § 9 (Public API surface — internal helpers stay
un-exported); CLAUDE.md § Princípio 3 (memory must be auditable —
including what the CLI consumer sees vs what the type system promises).

- **Evidence:**

  MemoryItemWithScore at src/core/memory-item.ts:129-132:
    export interface MemoryItemWithScore extends MemoryItem {
      readonly score: number;
    }
  MemoryItem (lines 9-121) does NOT declare `embedding`.
  
  run-recall.ts:46-49 strips a key that the type says cannot be there:
    const stripped = items.map((item) => {
      const entries = Object.entries(item).filter(([key]) => key !== 'embedding');
      return Object.fromEntries(entries) as MemoryItemWithScore;
    });
  
  This is the right defensive move (adapters may project the column at
  runtime even though it is not in the type contract — see comment at
  line 41-45 explaining the rationale), but the asymmetry is:
    - Type contract: embedding NEVER present
    - Runtime reality: embedding MAY be present (adapter-projected)
    - CLI surface contract: embedding NEVER reaches stdout
  
  A reader of `MemoryItemWithScore` cannot tell that runtime values may
  carry undeclared `embedding`. No JSDoc on MemoryItemWithScore warns
  about this. The strip silently does the right thing without
  documenting the gap.

- **Recommended action:** Add a single JSDoc paragraph to MemoryItemWithScore (or to the parent
MemoryItem) acknowledging:
 - The public type does NOT declare `embedding`.
 - Local Postgres / pgvector adapter implementations MAY project the
   embedding column at runtime (audit trail / debugging convenience).
 - Consumers serializing recall results to stdout / JSON should strip
   the field defensively (`themory recall` does this internally;
   REST `POST /v1/recall` SHOULD verify this — see follow-up).
Then verify REST `POST /v1/recall` (out of scope this plan) does the
same defensive strip; if it does NOT, the embedding may currently
leak through `c.json(result)` at the REST surface — that would be a
separate F-arch-style finding on the REST handler.


### F-dom-api-5: The global `program.exitOverride` translates BOTH
`commander.invalidArgument` AND `commander.invalidOptionArgument` to
exit 2 for the new verbs, but it also catches every other commander
exit (including --help, --version, unknown-command) and forwards
via `process.exit(err.exitCode)`. This is correct for the contract,
but the exit-2 contract is now silently load-bearing for the
pre-existing `mcp`/`server`/`migrate`/`health` subcommands too —
a regression there would be invisible.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-domain-api-design
- **File:** `src/agent-tools/cli.ts` line 71-79
- **Plan reference:** ADR D4 (EC-3 absorption — exit 2 via direct process.exit, not throw)
- **Domain anchor:** Architecture rule § 8 (Error handling — Never `catch (e)` and swallow);
CLAUDE.md § Princípio 3 (auditability — every decision rastreável).

- **Evidence:**

  cli.ts:71-79:
    program.exitOverride((err) => {
      if (
        err.code === 'commander.invalidArgument' ||
        err.code === 'commander.invalidOptionArgument'
      ) {
        process.exit(2);
      }
      process.exit(err.exitCode);
    });
  
  The exit-2 override applies globally to the program (all subcommands).
  No regression test verifies that, e.g., `themory mcp --port 0` still
  exits 2 (the pre-existing port validator in cli.ts:87-93 throws a
  plain Error, NOT InvalidArgumentError — so it currently exits 1 via
  .catch in main()). The CHANGELOG entry mentions "commander.exitOverride
  applies globally to the program; pre-existing mcp/server/migrate/health
  subcommands unaffected" but no test pins this claim.

- **Recommended action:** Add a single-assertion sentinel to tests/integration/p0-audit (or to
verbs-cli.test.ts as an addendum) that spawns one of:
 - `themory mcp --port 0` → expect exit code (current behavior:
   likely 1 because port validator throws plain Error in .action()
   body, NOT via parseFn callback that commander wraps in
   InvalidArgumentError)
 - `themory server --port 99999` → same
Document the actual exit code in the assertion. If the pre-existing
subcommands now also exit 2 (because the parseFn callback for `--port`
throws), that is actually MORE consistent — but it should be
documented either way. Closes the silent-load-bearing concern.


### F-dom-cli-4: Tests #3, #4, #13 assert only the exit code (`.toBe(2)`) without verifying the stderr message
identifies the actual failure mode. As long as the CLI exits 2 for ANY reason (env-missing,
DB-down, network error, validator failure), the test passes. This masks F-dom-cli-2 (scope
validation order) — the implementation could connect to PG, fail to authenticate, and exit 2 for
a completely different reason; the test would still report PASS even though the consumer would see
a misleading error.

Test #14 (empty text) DOES verify stderr: `expect(result.stderr).toMatch(/text/i)`. Same discipline
should apply to #3, #4, #13.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-domain-cli-tooling
- **File:** `tests/integration/cli/verbs-cli.test.ts` line 112-115 (test #4) + 107-110 (test #3) + 209-212 (test #13)
- **Plan reference:** Plan v1.1 § T0.1 TDD
- **Domain anchor:** testing.md § What to test — assert actual behavior with explicit values; do not just assert structure
- **Evidence:**

  tests/integration/cli/verbs-cli.test.ts:107-110:
    test('3. remember with zero scope flags exits 2', () => {
      const result = runCli(['remember', 'fact']);
      expect(result.status).toBe(2);  // ← no stderr assertion
    });
  tests/integration/cli/verbs-cli.test.ts:209-212:
    test('13. EC-3 — remember without OPENAI_API_KEY exits 2 (not commander default 1)', () => {
      const result = runCli(['remember', 'fact', '--user', 'u'], { OPENAI_API_KEY: '' });
      expect(result.status).toBe(2);  // ← no stderr assertion
    });

- **Recommended action:** Strengthen the 3 affected tests:
  test 3: add `expect(result.stderr).toMatch(/exactly one required/i)`
  test 4: add `expect(result.stderr).toMatch(/exactly one required/i)`
  test 13: add `expect(result.stderr).toMatch(/OPENAI_API_KEY/i)`
This locks the contract that scope errors stay scope errors (not env / DB / network errors) — and
forces F-dom-cli-2 (re-ordering) to be addressed before the test passes.


### F-dom-cli-5: Each .action() wraps the handler call in a try/catch that exits 2 on ANY exception, including
validator throws and adapter exceptions. This means: every internal handler exception (LLM 429
rate-limit, pg transient error, embedder model-load failure, etc.) is collapsed into exit 2
("invalid input"), which is the WRONG semantic for the consumer. Per architecture.md § 8 +
Inquebrável Rule 8, transient infrastructure errors should map to a different exit code (e.g., 1
for generic runtime) than user-input errors (e.g., 2 for input invalid).

The plan's T3.1 task 5 is partially correct (exit 2 IS needed for the user-input validator path that
throws via resolveCliScope) but the universal catch-all flattens the semantic distinction. With the
current code, a consumer cannot use shell pattern $? to distinguish "I typed it wrong" from "the
backend hiccupped — please retry".


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-domain-cli-tooling
- **File:** `src/agent-tools/cli.ts` line 186-191 (remember .action catch), 229-233 (recall .action catch), 249-252 (forget .action catch), 278-281 (reflect .action catch)
- **Plan reference:** Plan v1.1 § T3.1 task 5 — 'Each .action() wraps the handler call in try/catch with process.exit(2) fallback per ADR D4 EC-3 amendment'
- **Domain anchor:** architecture.md § 8 — 'Diferencie erros recuperáveis de irrecuperáveis'. Inquebrável Rule 8 fail-fast-clear.
- **Evidence:**

  src/agent-tools/cli.ts:186-191 (and 3 parallel sites):
    } catch (err: unknown) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(2);
    }
  All errors → exit 2. There is no exception-typing to map InvalidScopeError → 2,
  InfrastructureError → 1, etc.

- **Recommended action:** Defer to a follow-up cycle (this is YAGNI for the current set — there are no typed CLI errors yet),
BUT document the semantic in the plan's ADR D4 (or new ADR D6) as a known limitation:
  "Exit 2 catches BOTH user-input errors AND handler infrastructure errors via the .action() catch
   clause. A follow-up cycle MAY introduce typed CLI errors (CliInputError vs CliInfraError) and
   differentiate exit 1 (infra) vs exit 2 (input). For v1.5.x: any non-zero exit is 'CLI failed';
   check stderr for diagnostic detail."
Add a one-line CHANGELOG caveat under [Unreleased]: "CLI exit codes: 0 success, ≥1 any failure;
diagnostic identification via stderr (not exit code) — follow-up cycle may introduce typed exit
codes per architecture.md § 8."


### F-dom-cli-6: All 7 expected new dist artifacts ship per the npm pack manifest (verified empirically):
  dist/agent-tools/cli-memory-factory.{js,d.ts}
  dist/agent-tools/cli-output.{js,d.ts}
  dist/agent-tools/cli-scope.{js,d.ts}
  dist/agent-tools/run-{remember,recall,forget,reflect}.{js,d.ts}
Total 14 files (7 .js + 7 .d.ts) verified via `npm pack --dry-run --json | jq | grep agent-tools`.
The plan claimed "7 new artifacts" (4 handlers + 2 shared helpers + cli.ts already exists). Reality:
8 NEW files (4 handlers + 3 shared helpers — cli-memory-factory was an unplanned addition surfaced
during impl per validation report § Surfaces 1). This is +1 versus the plan but technically correct
— DRY refactor reduced repetition across handlers.

MINOR observation: the plan's prompt (and CHANGELOG line 9) cite "2 new shared helpers" + "1 new
factory helper" (totalling 3 new helper files); this matches reality. The agent prompt's "7 new
artifacts" floor still holds (4 handlers + cli-memory-factory + cli-output + cli-scope = 7 fresh
modules; cli.ts is the 8th but pre-existing). No defect; flagged for plan-vs-code-cardinality
consistency.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-domain-cli-tooling
- **File:** `package.json` line 61-64 + 68-78 (bin + files)
- **Plan reference:** Plan v1.1 § ADR D5 (no themory-mcp analog for verbs) + § ADR D1 (4 sibling artifacts auto-shipped via dist/**/*.{js,d.ts})
- **Domain anchor:** p0-api-sdk-mcp-correctness-audit-fixes-cycle-1 (parent cycle): pack manifest 415 entries; new artifacts ride the existing `dist/**/*.js` + `dist/**/*.d.ts` glob
- **Evidence:**

  $ npm pack --dry-run --json | jq -r '.[0].files[].path' | grep 'dist/agent-tools/(run-|cli)' | sort
  dist/agent-tools/cli-memory-factory.d.ts
  dist/agent-tools/cli-memory-factory.js
  dist/agent-tools/cli-output.d.ts
  dist/agent-tools/cli-output.js
  dist/agent-tools/cli-scope.d.ts
  dist/agent-tools/cli-scope.js
  dist/agent-tools/run-forget.{d.ts,js}
  dist/agent-tools/run-recall.{d.ts,js}
  dist/agent-tools/run-reflect.{d.ts,js}
  dist/agent-tools/run-remember.{d.ts,js}

- **Recommended action:** No code change. Confirm CHANGELOG accurately reflects "3 new shared helpers" (cli-scope, cli-output,
cli-memory-factory) — currently it says "2 new shared helpers ... 1 new factory helper" which is
consistent. Add a one-line item under p0-api-sdk-mcp-correctness-audit follow-up:
cli-memory-factory.ts was UNPLANNED in plan v1.1 and surfaced during ralph-loop — per Inquebrável
Rule 3 the validation report does disclose this, but it's a minor scope-creep that should have been
either (a) added to plan v1.2 before implementation, or (b) caught by SEPA (currently bypassed —
cycle-implement.md v1.6 § Acceptable bypass paths flagged this as THIRD consecutive bypass).


### F-tests-1: Test name "text forget includes id and hard flag" uses "and" — splits two assertions in one test

- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-tests
- **File:** `src/agent-tools/__tests__/cli-output.test.ts` line 70
- **Plan reference:** testing.md § Anti-patterns — "Tests with `and` in the name (`creates and validates`) — split into two tests, each testing one thing"
- **Evidence:**

  Line 70: `test('5. text forget includes id and hard flag', ...)`. Single test asserts on
  `Forgot id-1 (hard=true)` — text format is one combined string, so splitting would be
  contrived (regex pattern asserts BOTH id and hard flag in one render output). Same pattern
  at line 79: "text reflect includes source and derived counts". Plan does not flag this
  precisely because both render outputs are atomic single-string outputs.

- **Recommended action:** Either (a) accept as-is — the "and" describes COMPOSITION of the renderer output (which IS
a single behavior: "render forget as text with id and hard"); (b) rename to
"renders forget verb with id and hard-flag in single line" to clarify the behavior is the
render, not two operations. Recommend (a) — splitting would be artificial.


### F-tests-2: makeMockMemory() fixture is 22 lines (12-33) — exceeds the 5-line anti-pattern threshold

- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-tests
- **File:** `src/agent-tools/__tests__/cli-scope.test.ts` line 12
- **Plan reference:** testing.md § Anti-patterns — "Mocks that exceed 5 lines of setup — the design is wrong; revisit SRP and the boundary"
- **Evidence:**

  Function body lines 12-33 sets up a full Memory mock with .user/.session/.agent/.skills
  verb impls + scoped sub-objects (each itself a 5-method shape with mock kind/id injected
  as __mockKind/__mockId). The mock is necessary because resolveCliScope() takes a Memory
  and returns a ScopedMemory; without the full shape, TypeScript rejects via `Memory` interface.
  Cast to `as unknown as Memory` is double-escape (mock → object → Memory) used to inject
  `__mockKind` / `__mockId` test-only sentinels for assertion.

- **Recommended action:** Two options: (a) extract makeMockMemory into a tests/_fixtures/memory-mock.ts shared helper;
reduces per-test setup to 1 line; allows ScopedMemory mocks to share via test pyramid;
(b) accept — the size reflects the genuine shape of the Memory contract (15 methods across
top-level + 3 ScopedMemory tiers), and the mock IS centralized in one helper function.
The "design is wrong" verdict from testing.md is misaligned here — the mock is dictated
by the Memory interface size, not by the helper's complexity. Recommend (b) accept with
a follow-up to share fixture if a second test file needs the same mock shape.


### F-tests-3: Mock reflect() returns non-canonical CliReflectResult shape instead of public ReflectionResult

- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-tests
- **File:** `src/agent-tools/__tests__/cli-scope.test.ts` line 17
- **Plan reference:** testing.md § Anti-patterns — "Mocks that exceed 5 lines of setup"; architecture.md § 9 (canonical reflect shape)
- **Evidence:**

  Line 17 + line 30 return `{ sourceCount: 0, derivedCount: 0, derived: [] }` (CliReflectResult)
  but the public ScopedMemory.reflect() contract returns ReflectionResult
  `{ higherOrderMemories, sourceIds, derivedMemoriesCreated, reason? }` (see
  src/core/reflection-result.ts:8-26). Mock is type-fabricated via `as unknown as ScopedMemory`
  which bypasses TS detection. resolveCliScope() never calls .reflect(), so this never breaks
  the tests at runtime — but the mock fixture is honest-misleading: it implies the public
  contract is the CLI-projected shape, which it is NOT.

- **Recommended action:** Update the mock to return the canonical ReflectionResult shape:
`reflect: () => Promise.resolve({ higherOrderMemories: [], sourceIds: [], derivedMemoriesCreated: 0 })`.
Zero behavioral change (mock not asserted on), but prevents future readers from absorbing
the wrong contract from the fixture. Honors Inquebrável Rule 3 (extreme honesty).


### F-tests-11: Tests 5+6 lack explicit Arrange/Act/Assert separation (1-2 line tests)

- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-tests
- **File:** `src/agent-tools/__tests__/cli-output.test.ts` line 70-86
- **Plan reference:** testing.md § BDD — "Given-When-Then (or Arrange-Act-Assert)"
- **Evidence:**

  Tests 5 (line 70-77) and 6 (line 79-86) have a 4-line body: payload literal → call
  renderCliOutput → toMatch. The AAA boundaries are implicit — no comments separating
  phases. Same applies to tests 1-4 actually. testing.md § BDD says "Mandatory format:
  Given-When-Then (or Arrange-Act-Assert)" and the example uses `// Given/When/Then`
  comments. None of the 6 cli-output tests use these comments.

- **Recommended action:** Either (a) add inline `// Arrange / Act / Assert` comments to each test for explicit
AAA boundaries; (b) accept — the tests are short enough that the three phases are
visually obvious (1 line each in most cases). Recommend (a) for the integration test
(verbs-cli.test.ts) where tests are longer (e.g., test 12 round-trip has 5+ steps);
accept (b) for cli-output where each test fits on one screen line.


### F-wire-3: cli-memory-factory.ts (and pre-existing run-mcp-server.ts, run-server.ts) imports from
src/local/, src/embedders/, src/llms/ — three sibling tiers — to act as the runtime
composition root. architecture.md § 3 line 49 states "src/agent-tools/ (when created
— v0.3) depends on src/core/ only". The deviation is PRE-EXISTING (run-mcp-server.ts
precedent v0.3 / Roadmap Item 18) but the new file inherits + extends it.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-wiring
- **File:** `src/agent-tools/cli.ts` line 34-43
- **Plan reference:** architecture.md § 3 (DIP — agent-tools depends on src/core/ only)
- **Evidence:**

  grep "from '\.\./local\|from '\.\./embedders\|from '\.\./llms'" cli-memory-factory.ts
  → 4 lines: ../core, ../embedders/local, ../llms/openai, ../local/index, ../local/pgvector-store

- **Recommended action:** Out of scope for this cycle. Recommend the next architecture review formalize the
composition root carve-out in architecture.md § 3 (or add a `src/agent-tools/composition/`
sub-namespace allowed to cross tiers). The rule was written before v0.3 / Item 18
shipped; the precedent has since established the pattern.


### F-wire-4: DOTENV_CONFIG_QUIET workaround is documented inline and correct. Cross-validation
note: the comment correctly identifies this as a transitive-dep dotenv v17 module-load
banner, not a TheMemory-emitted artifact. Follow-up should evaluate whether dotenv
should be moved off the public load path (Inquebrável Rule 9 — is dotenv necessary
here?) since the CLI surface explicitly fails-fast on missing env vars and does NOT
require .env auto-loading at module level.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-wiring
- **File:** `tests/integration/cli/verbs-cli.test.ts` line 73
- **Plan reference:** T0.1 + EC-30 (dotenv v17 banner)
- **Evidence:**

  Smoke `node -e "require('./dist/agent-tools/cli.js')"` emits 5 dotenv banner lines
  to stdout BEFORE any cli.js code runs. This contaminates JSON parsing if consumers
  programmatically pipe `themory ... --json`.

- **Recommended action:** Investigate the transitive dotenv import chain (likely from a sub-dep) and either
(a) ensure it's loaded silently in production paths, OR (b) document
DOTENV_CONFIG_QUIET=true as a consumer-facing requirement in README. NOT a wiring
violation; affects DX.



## INFO findings (24)

### F-arch-6: The `program.exitOverride` block at lines 71-79 is correctly applied
globally on the root `program`. Side-effect: pre-existing commander
`commander.invalidArgument` / `commander.invalidOptionArgument` errors
from the `mcp` and `server` subcommands' `--port` validators now also
exit 2 (where they previously exited 1). This is documented as a
side-effect in the CHANGELOG entry but is not called out as a behavior
change for downstream consumers. Acceptable per ADR D5 backward-compat
(the only way to hit it was passing an invalid port; the exit code
semantics tighten, not loosen).


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-architecture
- **File:** `src/agent-tools/cli.ts` line 60-79
- **Plan reference:** T3.1 + ADR D4 EC-3
- **Evidence:**

  src/agent-tools/cli.ts:71-79:
    program.exitOverride((err) => {
      if (
        err.code === 'commander.invalidArgument' ||
        err.code === 'commander.invalidOptionArgument'
      ) {
        process.exit(2);
      }
      process.exit(err.exitCode);
    });

- **Recommended action:** No code change required. Add a one-line note to the CHANGELOG entry
explicitly flagging "mcp --port 99999" and "server --port 99999"
now exit 2 (was 1) — minor behavior tightening.


### F-arch-7: `resolveCliScope` is correctly SRP-shaped (one reason to change: scope
flag policy). Pure function, no side effects, throws on contract
violation. Returns concrete `ScopedMemory` (not a union with
`ScopedSkillMemory`) per EC-2 absorption. Naming + module hygiene
conform to architecture.md § 6/7. Clean implementation.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-architecture
- **File:** `src/agent-tools/cli-scope.ts` line 32-42
- **Plan reference:** T1.1 + ADR D2
- **Evidence:**

  src/agent-tools/cli-scope.ts:32-42:
    export function resolveCliScope(memory: Memory, opts: CliScopeOptions): ScopedMemory {
      const defined = [opts.user, opts.session, opts.agent].filter(
        (v): v is string => v !== undefined,
      );
      if (defined.length !== 1) {
        throw new Error('--user / --session / --agent: exactly one required');
      }
      ...
    }

- **Recommended action:** No issues found.

### F-arch-8: `CliReflectResult` correctly projects the public `ReflectionResult` to
a CLI-ergonomic shape (`sourceCount` / `derivedCount` / `derived`)
instead of leaking the raw API field names. Discriminated-union
`CliRenderableResult` is a clean Strategy-pattern fit for the
4-verb-shape rendering switch. Naming + module hygiene OK.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-architecture
- **File:** `src/agent-tools/cli-output.ts` line 27-67
- **Plan reference:** T1.2 + ADR D3
- **Evidence:**

  src/agent-tools/cli-output.ts:27-32:
    export interface CliReflectResult {
      readonly sourceCount: number;
      readonly derivedCount: number;
      readonly derived: readonly MemoryItem[];
      readonly reason?: 'no-source-memories' | 'no-consolidation';
    }

- **Recommended action:** No issues found.

### F-arch-9: Handler is correctly SRP (one reason to change: remember-flow wiring).
Correctly invokes EC-4 empty-text rejection BEFORE the costly
`createCliMemory()` warm-up (avoiding ~2-5s model download for a
guaranteed-fail invocation). Try/finally pattern around
`dispose()` honors the pool-lifecycle contract.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-architecture
- **File:** `src/agent-tools/run-remember.ts` line 26-42
- **Plan reference:** T2.1 + ADR D2/D4
- **Evidence:**

  src/agent-tools/run-remember.ts:28-31:
    if (opts.text.trim().length === 0) {
      process.stderr.write('Error: remember requires a non-empty text positional argument.\n');
      process.exit(2);
    }

- **Recommended action:** No issues found.

### F-arch-10: Cleanest of the four handlers — correctly bypasses scope binding per
EC-1 (top-level `memory.forget(opts.id, { hard })` invocation),
validates UUID v4 BEFORE Memory factory warm-up per EC-5, synthesizes
the JSON output payload from input opts (no contract violation since
`memory.forget()` returns void). SRP + KISS conformant.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-architecture
- **File:** `src/agent-tools/run-forget.ts` line 22-43
- **Plan reference:** T2.3 + EC-1 + EC-5
- **Evidence:**

  src/agent-tools/run-forget.ts:32-34:
    const hard = opts.hard ?? false;
    await memory.forget(opts.id, { hard });

- **Recommended action:** No issues found.

### F-arch-11: Handler delegates bounds validation to the cli.ts option parsers
(parseTopK/Threshold/Diversify) — single responsibility honored.
`recallOpts` is conditionally constructed to avoid passing `undefined`
keys to the public API. No SOLID issues.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-architecture
- **File:** `src/agent-tools/run-recall.ts` line 32-55
- **Plan reference:** T2.2 + ADR D2/D4 + EC-6/EC-7
- **Evidence:**

  src/agent-tools/run-recall.ts:36-39:
    const recallOpts: { topK?: number; threshold?: number; diversify?: { lambda: number } } = {};
    if (opts.topK !== undefined) recallOpts.topK = opts.topK;
    if (opts.threshold !== undefined) recallOpts.threshold = opts.threshold;
    if (opts.diversify !== undefined) recallOpts.diversify = { lambda: opts.diversify };

- **Recommended action:** Minor follow-up tied to F-arch-4: if the embedding strip is kept,
surface a runtime sentinel test (currently only the type-system
prevents an embedding from leaking).


### F-arch-12: Cleanly projects `ReflectionResult` to `CliReflectResult` per ADR D3.
Conditional spread `...(result.reason !== undefined ? { reason: ... }
: {})` honors the optional-field contract (no `reason: undefined` in
JSON output). SRP conformant.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-architecture
- **File:** `src/agent-tools/run-reflect.ts` line 25-43
- **Plan reference:** T2.4 + ADR D3
- **Evidence:**

  src/agent-tools/run-reflect.ts:32-37:
    const projected: CliReflectResult = {
      sourceCount: result.sourceIds.length,
      derivedCount: result.derivedMemoriesCreated,
      derived: result.higherOrderMemories,
      ...(result.reason !== undefined ? { reason: result.reason } : {}),
    };

- **Recommended action:** No issues found.

### F-arch-13: Integration test honors describe.skipIf LOUD-skip pattern, generates
unique UUIDs per test (no cross-test pollution), uses spawnSync per
the v0.3 T6.1 precedent. All 19 EC-mapped assertions present and
cover the absorbed MUST FIX + SHOULD TEST items. The DOTENV_CONFIG_QUIET
env injection is honestly disclosed (dotenv v17 transitive surface).


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-architecture
- **File:** `tests/integration/cli/verbs-cli.test.ts` line 1-253
- **Plan reference:** T0.1
- **Evidence:**

  tests/integration/cli/verbs-cli.test.ts:65-80:
    function runCli(args: readonly string[], extraEnv: Record<string, string> = {}): SpawnResult {
      const result = spawnSync('node', [CLI_PATH, ...args], {
        encoding: 'utf8',
        timeout: 60_000,
        env: { ...process.env, DOTENV_CONFIG_QUIET: 'true', ...extraEnv },
      });
      ...
    }

- **Recommended action:** No issues found.

### F-arch-14: 4 new `.command()` blocks correctly mirror the per-subcommand
convention (remember/recall/reflect with 3-tier scope flags; forget
without scope flags). Conditional-spread pattern for
`opts.X !== undefined ? { X: opts.X } : {}` honored — avoids passing
`undefined` flags into handlers. cli.ts LoC budget (architecture.md
§ 7 500-LoC budget): ~325 LoC, well under cap.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-architecture
- **File:** `src/agent-tools/cli.ts` line 165-283
- **Plan reference:** T3.1 + ADR D2
- **Evidence:**

  $ wc -l src/agent-tools/cli.ts
  325 src/agent-tools/cli.ts

- **Recommended action:** No issues found.

### F-arch-15: The extraction of `cli-memory-factory.ts` is honestly disclosed in
CHANGELOG as an in-cycle DRY win across the 4 verb handlers. SRP
conformant: one reason to change (CLI Memory factory wiring). Pool
lifecycle via tuple-return + dispose closure honors the
try-finally-dispose pattern. The in-cycle addition is genuine DRY
reduction within the 4 new handlers; the broader cross-handler DRY
gap (F-arch-2) is a separate concern.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-architecture
- **File:** `src/agent-tools/cli-memory-factory.ts` line 28-68
- **Plan reference:** In-cycle bonus (NOT in plan v1.1)
- **Evidence:**

  $ grep -l createCliMemory src/agent-tools/run-*.ts
  src/agent-tools/run-forget.ts
  src/agent-tools/run-recall.ts
  src/agent-tools/run-reflect.ts
  src/agent-tools/run-remember.ts

- **Recommended action:** No issues found within the cycle scope.

### F-arch-16: Contract tests follow BDD format (Given-When-Then via test name
describing behavior). Each test exercises ONE scenario.
`makeItem()` / `makeScored()` factories are minimal (5 lines each).
Tests assert actual rendered output (`expect(out).toMatch(/Wrote 2
memories: id-1, id-2/)`) — not just structure. Testing.md anti-patterns
cleared.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-architecture
- **File:** `src/agent-tools/__tests__/cli-output.test.ts` line 1-87
- **Plan reference:** T1.2
- **Evidence:**

  src/agent-tools/__tests__/cli-output.test.ts:50-51:
    test('2. text remember matches `Wrote <count> memories:` pattern', () => {
      ...
      expect(out).toMatch(/Wrote 2 memories: id-1, id-2/);

- **Recommended action:** No issues found.

### F-dom-api-6: Verb signatures consistency check PASSES:
  - `themory remember <text>` ↔ `ScopedMemory.remember(text, options)`
    positional matches; scope binding via flags maps to memory.user(id)
    per resolveCliScope (cli-scope.ts:32-42).
  - `themory recall <query>` ↔ `ScopedMemory.recall(query, options)`
    positional + tuning flags (--top-k, --threshold, --diversify) map
    to RecallOptions; bounds validators (1..100 / 0..1 / 0..1) honor
    contract floors from principles-alignment-hardening EC-3.
  - `themory forget <id>` ↔ top-level `Memory.forget(memoryId, options)`
    per EC-1 absorption; positional + --hard match; NO scope flag per
    ADR-0002 + memory-store.ts:59-60 ScopedMemory exclusion.
  - `themory reflect` ↔ `ScopedMemory.reflect(options)` — scope flags
    only, no positional, matches.
Informational: this confirms ADR D1 and ADR D2 are honored in code.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-domain-api-design
- **File:** `src/agent-tools/cli.ts` line 165-283
- **Plan reference:** ADR D1 (per-file handler) + ADR D2 (3-tier scope flags)
- **Domain anchor:** CLAUDE.md § Locked names ("API verbs: remember / recall / forget /
reflect"). Verb signatures match the public ScopedMemory contract.

- **Evidence:**

  Cross-checked:
   - src/agent-tools/cli.ts:166 `.command('remember <text>')` → matches
   - src/agent-tools/cli.ts:194 `.command('recall <query>')` → matches
   - src/agent-tools/cli.ts:237 `.command('forget <id>')` (NO scope option) → matches
   - src/agent-tools/cli.ts:256 `.command('reflect')` (no positional) → matches
   - src/agent-tools/run-forget.ts:34 `await memory.forget(opts.id, { hard })` → top-level invocation confirmed
  No defect here; recorded as INFO so the verdict consolidator can
  surface the positive signal.

- **Recommended action:** none

### F-dom-cli-7: Help text quality across the 4 new verbs is GOOD. All 4 .command() blocks declare:
  - Clear positional arg name (<text>, <query>, <id>)
  - Descriptive short description per ADR-0010 stylistic norms (no marketing fluff)
  - Each option has a one-line description
  - --json / --text properly distinguished as the format toggle
Verified empirically:
  $ themory remember --help → 5 options + <text> positional ✓
  $ themory recall --help   → 8 options + <query> positional ✓
  $ themory forget --help   → 3 options + <id> positional (NO scope flags per EC-1) ✓
  $ themory reflect --help  → 5 options (3 scope + 2 format), NO positional ✓

Backward compat: themory-mcp alias still triggers DEPRECATED warning + invokes mcp subcommand
correctly. The alias does NOT silently consume verb args — if a consumer mistakenly types
`themory-mcp recall 'q' --user u`, commander rejects with "error: unknown option '--user'" because
mcp doesn't take those flags. Expected behavior.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-domain-cli-tooling
- **File:** `src/agent-tools/cli.ts` line 165-191 (remember .command), 193-234 (recall), 236-253 (forget), 255-283 (reflect)
- **Plan reference:** Plan v1.1 § T3.1 + § ADR D2 + § ADR D3
- **Domain anchor:** commander v12 idiomatic patterns + plan T3.1 task list
- **Evidence:**

  $ DOTENV_CONFIG_QUIET=true node dist/agent-tools/cli.js --help
  Usage: themory [options] [command]
  @usetheo/memory CLI — managed three-tier memory layer
  Commands:
    remember [options] <text>  Write a fact to memory (3-tier scope required).
    recall [options] <query>   Query memory with optional --top-k, --threshold, --diversify.
    forget [options] <id>      Hard or soft delete a memory by UUID (NO scope flag — memoryId globally unique).
    reflect [options]          Trigger reflection pipeline; emits derived insights for the scope.

- **Recommended action:** None. No action required.

### F-dom-cli-8: 4 handler signatures are CONSISTENT with the plan's contract:
  run-remember.ts (43 LoC): RunRememberOptions { text, user?, session?, agent?, format }
  run-recall.ts   (55 LoC): RunRecallOptions { query, user?, session?, agent?, topK?, threshold?, diversify?, format }
  run-forget.ts   (43 LoC): RunForgetOptions { id, hard?, format }              ← NO scope per EC-1 ✓
  run-reflect.ts  (43 LoC): RunReflectOptions { user?, session?, agent?, format }
All 4 use the shared createCliMemory() factory. All 4 use renderCliOutput() for output. All 4 use
try/finally with dispose() to release the pg pool. cli.ts grows by ~140 LoC (was 145; now 285) —
well under the 500 LoC ADR D1 budget per file. Plan task T3.1 acceptance criterion "cli.ts LoC ≤ 250"
is exceeded (285 LoC actual) — but this is a +14% overage, within plan-budget tolerance for the
4 new sibling .command() blocks + 3 inline validators.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-domain-cli-tooling
- **File:** `src/agent-tools/cli.ts + src/agent-tools/run-*.ts` line Per-handler signature consistency
- **Plan reference:** Plan v1.1 § ADR D1 (per-file handlers) + § ADR D3 (format flag) + § ADR D4 (env-fail discipline)
- **Domain anchor:** architecture.md § 7 (module hygiene; LoC budgets) + § SOLID SRP
- **Evidence:**

  $ wc -l src/agent-tools/run-*.ts src/agent-tools/cli.ts src/agent-tools/cli-{scope,output,memory-factory}.ts
    43 src/agent-tools/run-forget.ts
    55 src/agent-tools/run-recall.ts
    43 src/agent-tools/run-reflect.ts
    43 src/agent-tools/run-remember.ts
   325 src/agent-tools/cli.ts        ← exceeds T3.1 budget 250 by ~14%
    43 src/agent-tools/cli-scope.ts
    69 src/agent-tools/cli-output.ts
    69 src/agent-tools/cli-memory-factory.ts

- **Recommended action:** No required action. Optional: a follow-up cycle could extract the 3 inline parsers (parseTopK,
parseThreshold, parseDiversify) from cli.ts:141-161 into a `cli-parsers.ts` helper to drop cli.ts
back under 250 LoC and align with the plan's stated budget. Not blocking.


### F-tests-4: T1.1 + T1.2 tests and implementations committed in same commit

- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-tests
- **File:** `src/agent-tools/__tests__/cli-scope.test.ts` line 1
- **Plan reference:** Commit 64407fd merged T1.1 RED + GREEN atomically
- **Evidence:**

  `git log --reverse b693361..HEAD --name-status` for commit 64407fd shows
  cli-scope.test.ts + cli-scope.ts + cli-output.test.ts + cli-output.ts all in one commit.
  Plan declares RED:GREEN as sequential phases. testing.md § R-G-R requires "Write the
  test FIRST. It MUST fail. ... Write the MINIMUM code that makes the test pass." but does
  NOT mandate separate git commits. The integration test (T0.1) IS separate (commit f9c214a).

- **Recommended action:** INFO-level note: TDD discipline can be honored within a single commit if the author ran
RED locally first. For future cycle-implement halt-loop iterations, prefer separate
RED and GREEN commits for shared-helper tasks so commit-log audit confirms ordering.
Same audit hygiene the integration test (T0.1 commit f9c214a) already follows.


### F-tests-5: DOTENV_CONFIG_QUIET=true injection — well-documented workaround for vitest stdout pollution

- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-tests
- **File:** `tests/integration/cli/verbs-cli.test.ts` line 73
- **Plan reference:** ADR D4 + EC-3 absorption; testing.md § Determinism
- **Evidence:**

  Line 70-73 comment explicitly documents why DOTENV_CONFIG_QUIET=true is set: silences
  dotenv v17 transitive auto-load banner that would emit `◇ injected env ...` lines to
  stdout, breaking JSON.parse(stdout) in 19/19 tests. Honest, surfaced, motivated.
  Mirrors Inquebrável Rule 3 (no silent gotchas).

- **Recommended action:** No action — this is GOOD test infrastructure discipline. Flagged INFO so the audit
trail records the pattern for other CLI integration tests in the project.


### F-tests-6: describe.skipIf with 3-precondition LOUD warn correctly implemented

- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-tests
- **File:** `tests/integration/cli/verbs-cli.test.ts` line 82
- **Plan reference:** testing.md § Determinism — no flaky tests
- **Evidence:**

  Lines 43-58 emit `console.warn('T0.1 SKIP — ...')` for each of the 3 missing preconditions
  (DIST_EXISTS / HAS_OPENAI / HAS_PG_URI) BEFORE the describe.skipIf gates the suite at
  line 82. Each warn is verbose with specific remediation guidance (e.g., "Run `npm run
  build` first"). Honors the parent plan's EC-3 pattern.

- **Recommended action:** No action — this is exemplary skip-with-honest-disclosure. Worth promoting to a
.claude/skills pattern if a similar pattern emerges in other integration suites.


### F-tests-7: Per-test scope isolation via randomUUID() — correct testing.md compliance

- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-tests
- **File:** `tests/integration/cli/verbs-cli.test.ts` line 86-251
- **Plan reference:** testing.md § Pyramid — "Reset DB state between tests"
- **Evidence:**

  11 tests use `const userId = randomUUID()` per-test (lines 86, 101, 118, 128, 137, 145,
  157, 170, 181, 189, 242). The 8 tests that do NOT use randomUUID (3, 4, 13, 14, 15, 16,
  17, 18) all assert ONLY exit code on early validation paths (zero/multi scope, missing
  env, empty text, invalid UUID, bounds violations) BEFORE any DB I/O happens — so they
  don't need scope isolation. This is correct discriminating use of test isolation discipline.

- **Recommended action:** No action. INFO logged so the pattern is auditable.


### F-tests-8: Version-agnostic full-file scan update is the right refactor

- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-tests
- **File:** `src/__tests__/changelog-breaking-marker.test.ts` line 28-37
- **Plan reference:** Inquebrável Rule 6 — Changelog forward-migration discipline
- **Evidence:**

  Pre-change (commit b693361): test extracted only [Unreleased] slice via `indexOf('## [Unreleased]')`
  + slice to next versioned header. Post-change: test scans full CHANGELOG.md with single
  `.toContain('**BREAKING (REST server):**')`. Comment at lines 31-33 explicitly motivates
  the change: "Marker may live in [Unreleased] OR in a versioned section once [Unreleased]
  has been migrated forward at release-cut time. Scan the full CHANGELOG so the regression
  sentinel survives version migrations per Inquebrável Rule 6 forward-migration discipline."
  The sentinel was failing because the 0.0.0-rc.3 release-cut commit (822a9f3) migrated
  the marker out of [Unreleased] into the versioned section.

- **Recommended action:** No action — refactor honors Inquebrável Rule 6 and surfaces the rationale in the test
docstring. Good rolling-window-sentinel discipline.


### F-tests-9: JSON indent assertion via prefix-string match is verifiable but fragile

- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-tests
- **File:** `src/agent-tools/__tests__/cli-output.test.ts` line 35-42
- **Plan reference:** ADR D3 — 2-space JSON indent format
- **Evidence:**

  Line 41 asserts `expect(out).toContain('  "id"')` — string match for 2-space indent.
  Works because JSON.stringify(_, null, 2) ALWAYS uses leading-space-2 for nested keys.
  Could fail if JSON.stringify behavior changes (unlikely in Node 22+) OR if indent
  becomes configurable.

- **Recommended action:** Acceptable for now. Could be tightened to `expect(out).toMatch(/^\s{2}"id"/m)` to assert
anchored at start-of-line; but the current form is honest about asserting "somewhere
in the output there is `  "id"`" which is what 2-space indent guarantees. NO-OP.


### F-tests-10: FROZEN date constant correctly used for deterministic fixtures

- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-tests
- **File:** `src/agent-tools/__tests__/cli-output.test.ts` line 13
- **Plan reference:** testing.md § Determinism — "Time-dependent tests use a frozen clock"
- **Evidence:**

  Line 13 `const FROZEN = new Date('2026-01-01T00:00:00.000Z')` reused across makeItem +
  makeScored. Test never asserts on time — frozen date is purely for fixture stability.
  Avoids vi.useFakeTimers() overhead because no Date.now() is consulted in renderCliOutput.

- **Recommended action:** No action. Good economy of mocking — frozen value instead of fake timers when fake
timers would be over-engineering.


### F-tests-12: Test 5 (top-k cap) asserts upper-bound only; does NOT verify items are actually returned

- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-tests
- **File:** `tests/integration/cli/verbs-cli.test.ts` line 117-125
- **Plan reference:** testing.md § Anti-patterns — "Tests that only assert structure (`expect(result).toBeDefined()`) — assert actual behavior with explicit values"
- **Evidence:**

  Line 124: `expect(items.length).toBeLessThanOrEqual(3)`. The assertion passes if 0 items
  are returned (which would happen if seeding silently failed). The test comment line 119
  says "LLM might extract 1-5 facts from prose" acknowledging the non-determinism but the
  assertion does NOT confirm seeding produced anything queryable.

- **Recommended action:** Tighten the test to also assert `expect(items.length).toBeGreaterThan(0)` — guards
against the silent-fail mode where remember() produces zero facts and recall() returns
empty. Per testing.md § Anti-patterns, "assert actual behavior with explicit values."
LOW priority because the round-trip test (test 12 line 188-207) does cover the
non-zero recall path semantically, so the regression coverage exists elsewhere.


### F-wire-5: Pillar (c) runtime metric correctly declared N/A per ADR D5. CLI verbs are end-consumer
surfaces; the metric path that would be observed (extraction.fact.count, recall.cache.hit,
etc.) was already wired into the underlying Memory implementations in prior cycles
(v0.1, v1.5, etc.) and exercised by their own integration suites. CLI handlers
transparently invoke those code paths.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-wiring
- **Plan reference:** ADR D5 + Inquebrável Rule 11 YAGNI
- **Evidence:**

  No `.wiring-evidence.json` file in repo for this cycle. Plan Global DoD § Runtime-metric
  proof explicitly defers to upstream wiring per Rule 11.

- **Recommended action:** none

### F-wire-6: Unlike the p0-audit cycle (which used a node_modules symlink approach to test
consumer-as-installed shape), the verbs-cli integration tests spawn from the in-repo
`dist/agent-tools/cli.js` directly + use real env from `process.env` (with explicit
DOTENV_CONFIG_QUIET override). This is appropriate because the test target is the
CLI surface, not the published-package shape — verb correctness is independent of
install location.


- **Found by:** review-verbs-as-cli-themory-remember-recall-forget-reflect-wiring
- **Plan reference:** Integration test pattern verification
- **Evidence:**

  tests/integration/cli/verbs-cli.test.ts:35 — CLI_PATH = join(REPO_ROOT, 'dist', 'agent-tools', 'cli.js')
  tests/integration/cli/verbs-cli.test.ts:67 — spawnSync('node', [CLI_PATH, ...args])
  No node_modules symlink setup.

- **Recommended action:** none. Pattern is correct for the test target.


## Handoff decision

Implementation passes all gates. Ready for merge.

## Audit trail

Spawned agents (their findings files live alongside this report):

- `.claude/agents/review-verbs-as-cli-themory-remember-recall-forget-reflect-2026-06-04/review-verbs-as-cli-themory-remember-recall-forget-reflect-architecture.md`
- `.claude/agents/review-verbs-as-cli-themory-remember-recall-forget-reflect-2026-06-04/cross-validation.md`
- `.claude/agents/review-verbs-as-cli-themory-remember-recall-forget-reflect-2026-06-04/review-verbs-as-cli-themory-remember-recall-forget-reflect-domain-api-design.md`
- `.claude/agents/review-verbs-as-cli-themory-remember-recall-forget-reflect-2026-06-04/review-verbs-as-cli-themory-remember-recall-forget-reflect-domain-cli-tooling.md`
- `.claude/agents/review-verbs-as-cli-themory-remember-recall-forget-reflect-2026-06-04/review-verbs-as-cli-themory-remember-recall-forget-reflect-tests.md`
- `.claude/agents/review-verbs-as-cli-themory-remember-recall-forget-reflect-2026-06-04/review-verbs-as-cli-themory-remember-recall-forget-reflect-wiring.md`

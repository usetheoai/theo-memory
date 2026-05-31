# Review: v0-4b-forgetting-pipeline

**Date:** 2026-05-30
**Verdict:** NEEDS_FIXES
**Reviewers (spawned agents):** 7 (review-v0-4b-forgetting-pipeline-architecture, cross-validation, review-v0-4b-forgetting-pipeline-domain-db-migrations, review-v0-4b-forgetting-pipeline-domain-memory-layer, review-v0-4b-forgetting-pipeline-domain-pgvector-schema, tests, wiring)
**Total findings:** 40

## Findings summary by severity

| Severity | Count |
|---|---|
| BLOCKER | 1 |
| CRITICAL | 5 |
| MAJOR | 13 |
| MINOR | 8 |
| INFO | 13 |

## BLOCKER findings (1)

### F-dom-db-1: Drizzle journal `_journal.json` stops at entry `0002_skill_columns` and has ZERO entries for `0003_eviction_columns` and `0004_eviction_half_life_trigger`. The paired snapshot files `meta/0003_snapshot.json` and `meta/0004_snapshot.json` do not exist either. Drizzle's `migrate()` API (used by `runMigrations()` at src/local/index.ts:593) reads ONLY the journal — files on disk that are not journal-tracked are silently ignored. Net effect on a fresh prod DB: `runMigrations(pool)` applies 0000-0002 and then `createMemory()` runs against a schema missing `last_accessed_at`, `access_count`, `half_life_seconds`, the `idx_memories_eviction_score` partial index, AND the `memories_reset_half_life_on_importance_update_trg` trigger. The eviction pipeline will fail at first `recall()` write-back hook with `column does not exist`. Verified via comparison with prior migrations: commit `4b75a20` (0002) added the snapshot AND bumped `_journal.json` in the same commit; commits `2a1a206` (T0.1) and `0739d26` (T2.2) added the .sql files only.


- **Found by:** review-v0-4b-forgetting-pipeline-domain-db-migrations
- **File:** `src/local/migrations/meta/_journal.json` line 26
- **Plan reference:** v0-4b plan § T0.1 (migration 0003), § T2.2 (migration 0004)
- **Domain anchor:** architecture.md § 10.2 "Production deployments use runMigrations() against a fresh DB"
- **Evidence:**

  $ ls src/local/migrations/meta/
  0000_snapshot.json
  0001_snapshot.json
  0002_snapshot.json
  _journal.json
  
  $ jq '.entries[].tag' src/local/migrations/meta/_journal.json
  "0000_crazy_mimic"
  "0001_reflection_columns"
  "0002_skill_columns"
  # <-- stops here; 0003 + 0004 absent
  
  $ git log --diff-filter=A --name-only -- 'src/local/migrations/meta/*'
  # Last entry: commit 4b75a20 added meta/0002_snapshot.json
  # No subsequent commit added meta/0003_snapshot.json or meta/0004_snapshot.json

- **Recommended action:** Before merging this PR, run `npm run db:generate` against a clean DB state to materialize the snapshots, OR hand-author both snapshot files + the two journal entries with the correct `idx`, `version: "7"`, `when` timestamps, `tag` strings, and `breakpoints: true` fields. Add an integration test that asserts `_journal.json` entries match every .sql file in the same directory (publish-readiness gate parity for the migration-set, not just the glob).



## CRITICAL findings (5)

### F-arch-1: TriadicScoringPolicy constructor takes 5 positional optional/nullable parameters
(weights, constants, halfLifePersister, neighborProvider, evictor); callers already exhibit
the SOLID smell with `new TriadicScoringPolicy(undefined, undefined, null, null, evictor)`
and `new TriadicScoringPolicy(undefined, undefined, null, neighborProvider, evictor)` —
positional placeholders defeat readability + force every future collaborator addition to
either break call sites or extend the param list (SRP + OCP + ergonomics regression).


- **Found by:** review-v0-4b-forgetting-pipeline-architecture
- **File:** `src/local/eviction/triadic-scoring-policy.ts` line 214
- **Plan reference:** T2.1 + T4.1 + T6.1 (TriadicScoringPolicy constructor evolution)
- **Evidence:**

  ```ts
  // src/local/eviction/triadic-scoring-policy.ts:214
  constructor(
    weights: TriadicWeights = DEFAULT_TRIADIC_WEIGHTS,
    constants: TriadicConstants = DEFAULT_TRIADIC_CONSTANTS,
    halfLifePersister: HalfLifePersister | null = null,
    neighborProvider: NearestNeighborProvider | null = null,
    evictor: Evictor | null = null,
  ) { ... }
  
  // tests/integration/eviction/evict-soft-delete.test.ts:67
  policy = new TriadicScoringPolicy(undefined, undefined, null, null, evictor);
  
  // tests/integration/forgetting/triadic-eviction.test.ts:64
  policy = new TriadicScoringPolicy(undefined, undefined, null, neighborProvider, evictor);
  ```

- **Recommended action:** Refactor to a single options-object constructor:
  ```ts
  export interface TriadicScoringPolicyOptions {
    readonly weights?: TriadicWeights;
    readonly constants?: TriadicConstants;
    readonly halfLifePersister?: HalfLifePersister | null;
    readonly neighborProvider?: NearestNeighborProvider | null;
    readonly evictor?: Evictor | null;
  }
  constructor(options: TriadicScoringPolicyOptions = {}) { ... }
  ```
Call sites become `new TriadicScoringPolicy({ evictor })` /
`new TriadicScoringPolicy({ neighborProvider, evictor })` — readable, append-only
forward, no positional shifting. Update the 8 production+test call sites in the same PR.
Add an ADR row to the plan documenting the options-object convention as the policy
for future EvictionPolicy collaborators.


### F-dom-db-2: The PG trigger `memories_reset_half_life_on_importance_update_trg` and its function live outside Drizzle's schema model (schema.ts has zero `trigger`/`function` declarations — Drizzle v0.45 does not model triggers). Consequence: on the dev workflow `npm run db:push` against a fresh DB, drizzle-kit introspects schema.ts, sees no trigger declared, and creates the schema WITHOUT the trigger. The .sql file 0004 is NOT applied by `push` — only by `migrate()`. Mixed dev sessions where someone runs `npm run db:push` to refresh schema after a pull will silently lose the trigger. The `lazy-half-life.test.ts` EC-1 invariant test only catches this if the dev remembers to apply 0004 manually via `psql -f`. Idempotent re-push will NOT drop the trigger (because push only diffs the declared schema), so the damage is bounded — but a fresh push-only database is broken for EC-1.


- **Found by:** review-v0-4b-forgetting-pipeline-domain-db-migrations
- **File:** `src/local/migrations/0004_eviction_half_life_trigger.sql` line 17
- **Plan reference:** v0-4b plan § T2.2 (EC-1 trigger absorption)
- **Domain anchor:** architecture.md § 10.2 "drizzle-kit push vs runMigrations() conflict"
- **Evidence:**

  $ grep -n "trigger\|memories_reset_half_life" src/local/schema.ts
  src/local/schema.ts:115: * v0.4a: per-scope reflection trigger counter — bumped on each remember() per ADR D4.
  # (only the COMMENT about reflection_counters — no schema-level trigger declaration)
  
  package.json db:push:
    "db:push": "node -e \"... CREATE EXTENSION vector ...\" && drizzle-kit push"
  # drizzle-kit push does NOT read .sql files — only schema.ts.

- **Recommended action:** Either (a) update the `db:push` script to also run `psql $THEOMEM_PG_URI -f src/local/migrations/0004_eviction_half_life_trigger.sql` after `drizzle-kit push` so dev environments get the trigger; OR (b) document the limitation explicitly in architecture.md § 10.2 with a callout "v0.4b adds a raw-SQL trigger; dev push workflow MUST follow up with the manual psql apply"; OR (c) collapse the trigger logic into application-level enforcement at the PgHalfLifePersister boundary (would lose the data-layer guarantee against raw-SQL UPDATE paths the migration comment promises). Option (a) is cheapest and preserves the data-layer invariant.


### F-dom-1: CapacityBasedTrigger silently drops User-scope + Session-scope memories from eviction. The COUNT + candidate SELECT both filter exclusively `WHERE agent_id = $1 AND t_invalid IS NULL`; user_id-scoped and session_id-scoped scopes are NEVER counted, NEVER selected as candidates, and therefore NEVER evicted. `scopeId: string` collapses the typed Scope discriminated union into one stringly-typed parameter without a `kind` discriminator. The same defect is reproduced in `time-based-trigger.ts` (lines 188-196) and the partial index `idx_memories_eviction_score` in migration 0003 (line 4: keyed on `agent_id`). This is a contract violation of three-tier scope (ADR-0002): a User-scope memory that should be evicted by capacity grows unbounded silently. The plan goal text repeatedly says "per-scope" / "in one scope" without a tier qualifier, and ADR D17 cross-references ADR-0006 (which is tier-uniform). Either the runtime MUST honor the three tiers (preferred — implies refactoring `scopeId: string` → typed `Scope` + scope-key-aware SQL) OR the plan MUST add an explicit ADR declaring agent-tier-only restriction at v0.4b with a roadmap note for User/Session tiers at v0.4c+.


- **Found by:** review-v0-4b-forgetting-pipeline-domain-memory-layer
- **File:** `src/local/eviction/capacity-based-trigger.ts` line 142
- **Plan reference:** plan T5.1 § Deep Dives + ADR-0002 + ADR-0010
- **Domain anchor:** architecture.md § 1 — three-tier scope User/Session/Agent (+ Repo for skills via agent_id mapping)
- **Evidence:**

  capacity-based-trigger.ts L140-160:
    const countResult = await client.query(
      `SELECT COUNT(*)::text AS count
         FROM memories
        WHERE agent_id = $1
          AND t_invalid IS NULL`,
      [scopeId],
    );
    ...
    WHERE agent_id = $1 AND t_invalid IS NULL  (candidate SELECT, same)
  
  time-based-trigger.ts L188-196: identical agent_id-only filter.
  
  migrations/0003_eviction_columns.sql L4:
    CREATE INDEX ... ON "memories" USING btree ("agent_id","last_accessed_at")
    WHERE "t_invalid" IS NULL
  
  Architecture says three tiers; impl honors only one. RepoScope works
  because it maps to agent_id internally (ADR-0010); User/Session do not.

- **Recommended action:** Either (preferred) refactor triggers to accept `Scope` (the typed discriminated union) and derive the WHERE clause via `filtersFromScope` shape — matching how `pgvector-store.search()` already composes filters — OR add an explicit ADR D19 declaring "v0.4b eviction is agent-tier-only (User/Session deferred to v0.4c)" AND constructor-validate that the caller supplied an agent-scope identifier, throwing a typed error on misuse. Bump the public-copy framing in CLAUDE.md Item 6 + docs/forgetting-evaluation.md to declare the tier restriction honestly per Inquebrável Rule 3.


### F-dom-2: TriadicScoringPolicy, CapacityBasedTrigger, TimeBasedTrigger, PgEvictor, PgNearestNeighborProvider, PgHalfLifePersister are NOT exported via `src/local/index.ts` (the public local barrel) nor via `src/index.ts`. Grep against barrels returns ZERO occurrences. Plan T8.1 acceptance explicitly requires "(a) Static caller: `TriadicScoringPolicy` referenced in `src/local/index.ts` user-facing barrel" — this is the cycle-implement Hard gate 4 pillar (a) non-negotiable requirement. The validate report claims "Pillar (a) static caller: pass 6/0" but no class is reachable through the public API; consumers using the barrel cannot construct an eviction pipeline without reaching into `src/local/eviction/*` deep paths (escape of encapsulation). Also no `evict()` method on `Memory` / `ScopedMemory` is wired in `LocalScopedMemory` — auto-eviction is detached from the public Memory facade entirely. The integration test bypasses the barrel and imports from deep paths directly, which is why validate's pillar (a) check did not catch the gap.


- **Found by:** review-v0-4b-forgetting-pipeline-domain-memory-layer
- **File:** `src/local/index.ts` line 68
- **Plan reference:** plan T8.1 § wiring triad pillar (a) + Global DoD § Wiring triad
- **Domain anchor:** architecture.md § 9 — public API surface; cycle-implement.md § Hard gate 4 (pillar a non-negotiable)
- **Evidence:**

  grep "eviction\|Triadic\|Capacity\|TimeBased\|PgEvictor"
    in src/local/index.ts + src/index.ts → ZERO HITS
  
  tests/integration/forgetting/triadic-eviction.test.ts L26-30:
    import { CapacityBasedTrigger } from '../../../src/local/eviction/capacity-based-trigger.js';
    import { PgEvictor } from '../../../src/local/eviction/pg-evictor.js';
    import { PgNearestNeighborProvider } from '...';
    import { PgvectorStore } from '../../../src/local/pgvector-store.js';
    import { TriadicScoringPolicy } from '...';
  
  LocalScopedMemory.forget (src/local/index.ts L424-444) still uses
  vectorStore.delete() — physical DELETE — does NOT delegate to
  PgEvictor and does NOT use the soft-delete path.

- **Recommended action:** Add to `src/local/index.ts`:
  export { TriadicScoringPolicy, ... } from './eviction/triadic-scoring-policy.js';
  export { CapacityBasedTrigger } from './eviction/capacity-based-trigger.js';
  export { TimeBasedTrigger } from './eviction/time-based-trigger.js';
  export { PgEvictor, type Evictor } from './eviction/pg-evictor.js';
  export { PgNearestNeighborProvider } from './eviction/pg-nearest-neighbor-provider.js';
Plus a documented wiring shape (factory or example) showing how a consumer composes them with `createLocalMemory`. Without this, pillar (a) is materially false despite the script reporting pass.


### F-dom-pg-3: `CapacityBasedTrigger` is **hard-wired to `agent_id`** at every SQL boundary:
  - COUNT query: `WHERE agent_id = $1 AND t_invalid IS NULL`
  - Candidates query: `WHERE agent_id = $1 AND t_invalid IS NULL`
  - Advisory lock key: `hashtext('eviction_' || scopeId)` where scopeId is conflated with agentId
The same pattern repeats in `TimeBasedTrigger` (`time-based-trigger.ts:188-196`) and the partial index
(`schema.ts:100-102`) is `(agent_id, last_accessed_at) WHERE t_invalid IS NULL` — also agent-only.
This **silently violates the three-tier scope contract locked in CLAUDE.md and architecture.md § 1**.
A consumer instantiating `CapacityBasedTrigger(pool, policy, 50)` and calling `.fire(userId, ...)`
will SILENTLY MISS every memory whose `agent_id IS NULL` even though the user has hit the cap.
Worse: the consumer has no way to evict User-scope or Session-scope memories at all.
This is a contract-level domain defect, not a perf concern — the public abstraction promises
tier-shape compatibility but the SQL hardcodes one tier.


- **Found by:** review-v0-4b-forgetting-pipeline-domain-pgvector-schema
- **File:** `src/local/eviction/capacity-based-trigger.ts` line 88-93 + 141-146
- **Plan reference:** Plan ADR D17 + EC-2 — capacity-based eviction supports User / Session / Agent scopes
- **Domain anchor:** CLAUDE.md § Architectural Decisions Locked — three-tier scope (User / Session / Agent)
- **Evidence:**

  capacity-based-trigger.ts:141-146:
    SELECT COUNT(*)::text AS count
      FROM memories
     WHERE agent_id = $1
       AND t_invalid IS NULL
  
  capacity-based-trigger.ts:152-159 (same pattern in candidates):
    SELECT ... FROM memories WHERE agent_id = $1 AND t_invalid IS NULL
  
  time-based-trigger.ts:188-196 (same hardcoded agent_id):
    SELECT ... FROM memories WHERE agent_id = $1 AND t_invalid IS NULL
  
  schema.ts:100-102 (partial index is agent_id-only):
    index('idx_memories_eviction_score')
      .on(table.agentId, table.lastAccessedAt)
      .where(sql`${table.tInvalid} IS NULL`),

- **Recommended action:** Pre-merge gate. Either (a) extend the trigger interface to accept a `Scope` discriminant union and
generate the WHERE clause via the existing `Filters` composition in `pgvector-store.ts` (reusing
`composeFilters`), AND extend the partial index to cover all three scope columns (likely a
multi-column index with `COALESCE(agent_id, session_id, user_id)` or three separate partials),
OR (b) document the contract narrowing explicitly in the constructor JSDoc + add a runtime
check that throws on User/Session-scope callers, AND raise a follow-up issue + roadmap row to
cover the gap before v0.4b ships to consumers. Option (a) preserves the locked three-tier
contract; option (b) honors honesty principle (extreme honesty, root rule 3) but defers the work.
The current state silently does (b) with NO defense, which is the worst option.



## MAJOR findings (13)

### F-arch-2: HalfLifePersister and NearestNeighborProvider interfaces are declared INSIDE
src/local/eviction/triadic-scoring-policy.ts (file: 81-96), which is the file of their
primary CONSUMER. Concrete impls (pg-half-life-persister.ts, pg-nearest-neighbor-provider.ts)
then re-import them via `import type { HalfLifePersister } from './triadic-scoring-policy.js'`.
This is a DIP inversion: the abstraction lives with the concrete it abstracts away from.
Sibling EvictionPolicy lives correctly at src/core/dip/eviction-policy.ts; these two should
follow the same convention.


- **Found by:** review-v0-4b-forgetting-pipeline-architecture
- **File:** `src/local/eviction/triadic-scoring-policy.ts` line 81
- **Plan reference:** T2.2 + T4.1 (collaborator DIPs)
- **Evidence:**

  ```ts
  // src/local/eviction/triadic-scoring-policy.ts:81-96
  export interface HalfLifePersister {
    persist(memoryId: string, halfLifeSeconds: number): Promise<void>;
  }
  export interface NearestNeighborProvider {
    distance(memoryId: string, agentId: string): Promise<number>;
  }
  
  // src/local/eviction/pg-half-life-persister.ts:20
  import type { HalfLifePersister } from './triadic-scoring-policy.js';
  
  // src/local/eviction/pg-nearest-neighbor-provider.ts:19
  import type { NearestNeighborProvider } from './triadic-scoring-policy.js';
  ```

- **Recommended action:** Move both interfaces into src/core/dip/eviction-policy.ts (or new sibling files
src/core/dip/half-life-persister.ts + src/core/dip/nearest-neighbor-provider.ts mirroring
the existing per-DIP file convention shown by embedder.ts / history-manager.ts / llm.ts).
Update the 3 import sites (the policy file itself + the 2 Pg impls). The plan's ADR D12
narrative ("8th DIP") already names them as DIPs; moving them to src/core/dip/ aligns
file layout with the documented contract.


### F-arch-3: CapacityBasedTrigger (lines 47-86 ScopeCandidateRow + rowToMemoryItem) and TimeBasedTrigger
(lines 53-92 ScopeCandidateRow + rowToMemoryItem) duplicate ~60 LoC each verbatim — same
interface, same row-mapping helper. They also duplicate the same candidate-fetch SQL
(SELECT id, text, hash, ... FROM memories WHERE agent_id = $1 AND t_invalid IS NULL) and
the same soft-delete SQL (UPDATE memories SET t_invalid = NOW() WHERE id = ANY($1)). When a
third trigger lands (e.g., per-user-session trigger after the scope concern in F-arch-4 is
addressed), this becomes a 3-way fork. DRY violation per architecture.md and
CLAUDE.md § PARTE II-12 (DRY — duplication of knowledge, not lines: same row-mapping rule
lives in two files).


- **Found by:** review-v0-4b-forgetting-pipeline-architecture
- **File:** `src/local/eviction/capacity-based-trigger.ts` line 47
- **Plan reference:** T5.1 + T5.2 (DRY across triggers)
- **Evidence:**

  ```ts
  // src/local/eviction/capacity-based-trigger.ts:47-86
  interface ScopeCandidateRow { readonly id: string; readonly text: string; ... }
  function rowToMemoryItem(row: ScopeCandidateRow): MemoryItem { ... }
  
  // src/local/eviction/time-based-trigger.ts:53-92  (verbatim duplicate)
  interface ScopeCandidateRow { readonly id: string; readonly text: string; ... }
  function rowToMemoryItem(row: ScopeCandidateRow): MemoryItem { ... }
  ```

- **Recommended action:** Extract a shared helper module src/local/eviction/scope-candidate.ts exporting
`ScopeCandidateRow`, `rowToMemoryItem`, and the two SQL constants
(`SCOPE_CANDIDATES_SQL`, `SOFT_DELETE_BY_IDS_SQL`). Both triggers import. Bonus: a single
`EvictionPass` helper class that takes (client, scopeId, fraction, policy, now) and runs
lock-acquire → candidate-fetch → score → soft-delete → return would also fold the two
`runEvictionPass`/`runFixedFractionPass` methods into one (they differ only in how
`fraction` is computed). Split into 2 commits: extract helper (no behavior change), then
consolidate the pass orchestration.


### F-arch-4: Both triggers hardcode `WHERE agent_id = $1` and accept `scopeId: string` — silently
restricting eviction to AGENT-scoped (and via ADR-0010, REPO-scoped) memories. The locked
3-tier scope (architecture.md § 1) covers User + Session + Agent + Repo. User-scoped and
Session-scoped memories CANNOT be evicted by these triggers and there is no compile-time
indication of this restriction — the scope type is `string`, not the discriminated `Scope`.
Either (a) the partial implementation needs an ADR documenting "v0.4b only evicts agent
scope" with a roadmap entry for the other tiers, or (b) the trigger should accept
`scope: Scope` and the SQL should branch on `scope.kind`.


- **Found by:** review-v0-4b-forgetting-pipeline-architecture
- **File:** `src/local/eviction/capacity-based-trigger.ts` line 143
- **Plan reference:** T5.1 + T5.2 (scope contract honored?)
- **Evidence:**

  ```ts
  // src/local/eviction/capacity-based-trigger.ts:143
  `SELECT COUNT(*)::text AS count FROM memories WHERE agent_id = $1 AND t_invalid IS NULL`
  // src/local/eviction/time-based-trigger.ts:193
  WHERE agent_id = $1 AND t_invalid IS NULL
  ```
  Compare: src/core/scope.ts:42 — `export type Scope = UserScope | SessionScope | AgentScope | RepoScope`
  The PgNearestNeighborProvider.distance(memoryId, agentId) signature has the same shape.

- **Recommended action:** Short term (v0.4b acceptance): add an explicit ADR row to the plan (e.g., ADR D18) +
JSDoc on both trigger constructors documenting "scope hardcoded to agent_id at v0.4b;
User/Session tier coverage tracked at roadmap Item N". Surface in CHANGELOG as a known
limitation. Long term (v0.4c or v0.5): widen the signature to
`fire(scope: Scope, now: Date)` / `TimeBasedTriggerConfig { scope: Scope }` so the
partial impl is visible at the type system level. Same for
`NearestNeighborProvider.distance(memoryId, scopeKey)` — accept the full Scope and derive
the filter key internally. Without this, a consumer wiring `Memory.user(id).remember(...)`
memories ships an eviction pipeline that silently doesn't apply to them.


### F-arch-5: None of the v0.4b classes (TriadicScoringPolicy, PgEvictor, PgHalfLifePersister,
PgNearestNeighborProvider, CapacityBasedTrigger, TimeBasedTrigger) are re-exported via
src/local/index.ts, src/index.ts, or wired into createLocalMemory(). Per
architecture.md § 9 "Public API surface" + CLAUDE.md § Locked names "subpath exports",
the v0.4b pipeline ships UNREACHABLE from any consumer who uses the public surface —
they can only be instantiated via integration tests' deep relative imports
(`../../../src/local/eviction/triadic-scoring-policy.js`). Cycle-implement wiring triad
pillar (a) static caller / (b) integration test passes via the test suite; but for an
end-consumer the public-API caller is zero.


- **Found by:** review-v0-4b-forgetting-pipeline-architecture
- **File:** `src/local/index.ts` line 1
- **Plan reference:** T8.1 (final wiring + validation)
- **Evidence:**

  ```sh
  $ grep -rEn "from '.*eviction'" src/ | grep -v __tests__
  # only internal imports inside src/local/eviction/* itself.
  $ grep -n "TriadicScoringPolicy\|PgEvictor\|CapacityBasedTrigger\|TimeBasedTrigger" \
        src/local/index.ts src/index.ts
  # no output
  ```

- **Recommended action:** Either (a) add a src/local/eviction/index.ts barrel + re-export from src/local/index.ts +
src/index.ts so consumers can `import { TriadicScoringPolicy, CapacityBasedTrigger } from
'@usetheo/memory/local'`, OR (b) extend MemoryConfig with optional eviction wiring
(`evictionPolicy?: EvictionPolicy`, `evictionTriggers?: ReadonlyArray<{ start, stop }>`)
so createLocalMemory composes the pipeline by default. Plan acceptance criteria for T8.1
lists wiring validation; per architecture.md § 9 the public surface bump requires
package.json#exports + README update too. Surface the choice to the user via ADR; current
state ships dead code from the consumer's point of view.


### F-dom-db-3: Line 2 `ADD COLUMN IF NOT EXISTS "access_count" integer DEFAULT 0 NOT NULL` is correct standalone, but the IF NOT EXISTS guard combined with `NOT NULL DEFAULT 0` is a footgun under partial-recovery scenarios. If a prior partial apply ALREADY added the column WITHOUT the default (which `IF NOT EXISTS` cannot detect), subsequent re-runs will skip silently and the column may exist as nullable. The 0003 file does NOT use a defensive `ALTER COLUMN ... SET DEFAULT 0 / SET NOT NULL` follow-up pair. PG 11+ makes the original `ADD COLUMN ... NOT NULL DEFAULT 0` non-blocking (constant-time rewrite), so the idempotency-vs-correctness tradeoff favors defensive: prefer `ALTER COLUMN access_count SET DEFAULT 0;` then `ALTER COLUMN access_count SET NOT NULL` as separate post-add statements under their own `IF NOT EXISTS`-equivalent guards, or remove `IF NOT EXISTS` and let Drizzle's journal handle re-run prevention (the journal is the idempotency layer the prior migrations 0000 + 0001 trust).


- **Found by:** review-v0-4b-forgetting-pipeline-domain-db-migrations
- **File:** `src/local/migrations/0003_eviction_columns.sql` line 2
- **Plan reference:** v0-4b plan § T0.1 (eviction columns)
- **Domain anchor:** idempotency contract for ADD COLUMN with NOT NULL DEFAULT
- **Evidence:**

  $ grep -c "IF NOT EXISTS\|IF EXISTS" src/local/migrations/000*.sql
  0000_crazy_mimic.sql:1
  0001_reflection_columns.sql:0       # <-- trusts journal
  0002_skill_columns.sql:6
  0003_eviction_columns.sql:4         # <-- belt-and-suspenders
  0004_eviction_half_life_trigger.sql:0
  # 0001 trusts the journal; 0003 mixes journal + IF NOT EXISTS. Inconsistent.

- **Recommended action:** Pick one idempotency model and apply consistently. Recommended: trust the Drizzle journal (as 0000 and 0001 do) for re-run prevention, drop the `IF NOT EXISTS` on `ADD COLUMN` statements, and add an integration test that asserts `runMigrations()` is idempotent across two calls (covers the partial-apply scenario explicitly). Mixing belt-and-suspenders adds complexity and masks the journal-corruption failure mode.


### F-dom-db-4: Zero DOWN migrations exist for 0003 + 0004 (none for 0000-0002 either, but this PR is the moment v0.4b makes the rollback story load-bearing). Drizzle does not auto-generate DOWN migrations, and the project has no `*.down.sql` convention. If a v0.4b deployment must rollback (e.g., the `memories_reset_half_life_on_importance_update_trg` trigger causes production deadlock under high write contention), the recovery path requires hand-authored SQL: `DROP TRIGGER`, `DROP FUNCTION`, drop columns (with `IF EXISTS` because 0003 used `IF NOT EXISTS`), drop the partial index, then manually delete the journal entries to allow re-apply later. This is the same gap that exists for all prior migrations, so it is not a v0.4b regression strictly — but v0.4b is the first migration that introduces a STORED PROCEDURE side effect (the trigger), which compounds the rollback cost: simple column drops are reversible; a trigger that mutates rows during normal write traffic is not.


- **Found by:** review-v0-4b-forgetting-pipeline-domain-db-migrations
- **File:** `src/local/migrations/0003_eviction_columns.sql` line N/A
- **Plan reference:** v0-4b plan § T0.1, § T2.2 — no rollback declared
- **Domain anchor:** architecture.md § 10 (build pipeline) does not address rollback
- **Evidence:**

  $ find src/local/migrations -name "*.down.sql" -o -name "down_*.sql"
  # (empty)
  $ grep -rn "DROP TRIGGER\|rollback" src/local/migrations/ docs/ 2>/dev/null
  # (empty)

- **Recommended action:** Add CHANGELOG.md or RUNBOOK.md entry under "v0.4b deployment notes" listing the manual rollback SQL for 0003 + 0004 (DROP TRIGGER, DROP FUNCTION, ALTER TABLE DROP COLUMN IF EXISTS for each column, DROP INDEX IF EXISTS for idx_memories_eviction_score) AND the journal-entry-removal procedure. Defer the broader "introduce *.down.sql convention" decision to a separate ADR; this PR just needs the v0.4b-specific runbook so on-call has a path.


### F-dom-3: ADR D17 § Consequences asserts: "forget(id) public API (v0.1) ALSO uses t_invalid UPDATE (already true) — auto-eviction is consistent with caller-driven forget." This is FALSE in the shipped runtime. `LocalScopedMemory.forget()` at src/local/index.ts:430 calls `vectorStore.delete(memoryId)`, which at the pgvector adapter (pgvector-store.ts:345-347) issues `DELETE FROM memories WHERE id = $1` — physical delete, no `t_invalid` UPDATE, no RETURNING audit trail, no `MemoryNotFound` separation between already-deleted vs missing. Caller-driven forget therefore PERMANENTLY drops the audit row, while auto-eviction (PgEvictor) keeps it. The "bi-temporal local schema" promise in ADR-0006 is half-honored: schema has the columns, forget() bypasses them. This also creates an asymmetry consumers cannot reason about: a row evicted via CapacityBasedTrigger is recoverable via raw `SELECT WHERE t_invalid IS NOT NULL`, but the same row evicted via caller's `memory.forget(id)` is gone forever.


- **Found by:** review-v0-4b-forgetting-pipeline-domain-memory-layer
- **File:** `src/local/index.ts` line 430
- **Plan reference:** ADR D17 — 'forget() public API (v0.1) ALSO uses t_invalid UPDATE (already true) — auto-eviction is consistent with caller-driven forget'
- **Domain anchor:** ADR-0006 bi-temporal local schema + ADR D17 soft-delete; architecture.md § 4 ADD-only
- **Evidence:**

  src/local/index.ts L424-444:
    async forget(memoryId: string, options?: ForgetOptions): Promise<void> {
      ...
      await this.config.vectorStore.delete(memoryId);  // ← physical
      ...
    }
  
  src/local/pgvector-store.ts L345-347:
    async delete(vectorId: string): Promise<void> {
      await this.pool.query('DELETE FROM memories WHERE id = $1', [vectorId]);
    }
  
  ADR D17 § Consequences:
    "forget(id) public API (v0.1) ALSO uses t_invalid UPDATE (already true)"
    ← contradicts the shipped code.
  
  MemoryItem.tInvalid JSDoc (core/memory-item.ts L38):
    "Set by forget(id) (soft delete)." ← also false.

- **Recommended action:** Refactor `LocalScopedMemory.forget()` to issue the same soft-delete UPDATE as `PgEvictor.evict()` — preferably by delegating to a shared `evict()` primitive on a `VectorStore` extension or by injecting `PgEvictor` into `LocalMemoryConfig`. Update the JSDoc on `MemoryItem.tInvalid` and the wording of ADR D17 § Consequences if the contract is intentionally split (caller-driven = hard delete, trigger-driven = soft delete), OR fix the implementation if the contract is what ADR D17 claims. Both options are valid; pick one and document the chosen split. Add an integration test asserting the post-state of forget() (physical absence vs t_invalid set).


### F-dom-4: The shipped index columns drift from ADR D13's declared shape and compound with F-dom-1. Plan D13 declared `(CASE WHEN t_invalid IS NULL THEN 1 ELSE 0 END, last_accessed_at)
 WHERE t_invalid IS NULL`. Shipped is
`(agent_id, last_accessed_at) WHERE t_invalid IS NULL`. The `agent_id` keying choice is reasonable in isolation (it's the only tier the runtime actually queries), but the deviation is undocumented — there is no ADR amendment, no inline migration comment explaining why D13's CASE expression was dropped. This is a silent contract drift between plan and impl. Adjacent honesty risk: the index now bakes the agent_id-only tier restriction (F-dom-1) into the schema itself, making it harder to extend to User/Session tiers later without an extra index migration.


- **Found by:** review-v0-4b-forgetting-pipeline-domain-memory-layer
- **File:** `src/local/migrations/0003_eviction_columns.sql` line 4
- **Plan reference:** ADR D13 — partial index spec '(CASE WHEN t_invalid IS NULL THEN 1 ELSE 0 END), last_accessed_at WHERE t_invalid IS NULL'
- **Domain anchor:** ADR D13 + ADR-0002 three-tier scope
- **Evidence:**

  ADR D13 (plan line 120-124):
    CREATE INDEX idx_memories_eviction_score ON memories (
      (CASE WHEN t_invalid IS NULL THEN 1 ELSE 0 END),
      last_accessed_at
    ) WHERE t_invalid IS NULL;
  
  migrations/0003_eviction_columns.sql L4:
    CREATE INDEX IF NOT EXISTS "idx_memories_eviction_score"
      ON "memories" USING btree ("agent_id","last_accessed_at")
      WHERE "t_invalid" IS NULL;
  
  No ADR row, no commit-body note in 2a1a206 explains the drift.

- **Recommended action:** Either amend ADR D13 in plan v1.3 to declare "(agent_id, last_accessed_at) WHERE t_invalid IS NULL — partial composite index optimized for the agent-tier-only eviction queries (F-dom-1)" OR restore the originally-declared CASE-based index in a follow-up migration. If F-dom-1 is fixed by adding User/Session tier support, add (user_id, last_accessed_at) and (session_id, last_accessed_at) partial indexes in the same migration.


### F-dom-5: The long-tail multiplier (blueprint D9) is the ONLY mechanism that makes v0.4b "ship the OPEN PROBLEM #1 solution." The current implementation only ENGAGES the multiplier for scopes whose memories carry `kind: 'agent'` or `kind: 'repo'` per `getNeighborScopeId` (L109-117): `user` and `session` scopes return `null`, which causes `computeProtectionMultiplier` (L304-307) to short-circuit to `MAX_PROTECTION_MULTIPLIER` (1.0 — no penalty). Combined with F-dom-1 (User/Session never reach the trigger anyway) the deficiency is not user-visible today, but the JSDoc on `NearestNeighborProvider.distance(memoryId, agentId)` bakes the tier limitation into the DIP shape — `agentId: string` instead of a generic scope key. This means even if F-dom-1 is fixed at the trigger level, the multiplier remains agent-only. The CLAUDE.md framing "OPEN PROBLEM #1 — no competitor solved this" is therefore weaker than advertised: TheMemory ships triadic + multiplier ONLY for one of three tiers. Honest framing requires either fixing the tier coverage OR scoping the claim ("v0.4b solves long-tail preservation in the agent-tier surface; User/Session tiers will land in v0.4c per ADR-X").


- **Found by:** review-v0-4b-forgetting-pipeline-domain-memory-layer
- **File:** `src/local/eviction/triadic-scoring-policy.ts` line 271
- **Plan reference:** Blueprint D9 + plan T4.2 § Deep Dives line 712
- **Domain anchor:** blueprint D9 — long-tail multiplier semantics; OPEN PROBLEM #1 claim
- **Evidence:**

  triadic-scoring-policy.ts L109-117:
    function getNeighborScopeId(scope: MemoryItem['scope']): string | null {
      if (scope.kind === 'agent') return scope.agentId;
      if (scope.kind === 'repo') return scope.repoId;
      return null;   // ← user + session collapse to null
    }
  
  Same file L302-307:
    const scopeId = getNeighborScopeId(memory.scope);
    if (scopeId === null) {
      return MAX_PROTECTION_MULTIPLIER;  // ← no protection penalty
    }
  
  NearestNeighborProvider DIP shape (L94-96):
    distance(memoryId: string, agentId: string): Promise<number>;
    ← `agentId: string` baked into the interface signature.

- **Recommended action:** (1) Either generalize `NearestNeighborProvider.distance(memoryId, scope: Scope)` to accept the typed scope union, OR keep the restriction and rename the parameter (`scopeKey: string`) plus `getNeighborScopeId` should fall back to userId/sessionId when present (the schema columns exist). (2) Adjust the CLAUDE.md Item 6 framing + docs/forgetting-evaluation.md to honestly scope the OPEN PROBLEM #1 claim to the agent tier at v0.4b, with a roadmap pointer to tier expansion.


### F-dom-6: The OTel meter is acquired at MODULE LOAD time (L47: `const meter = metrics.getMeter('@usetheo/memory');`) and the Counter is created in module scope (L48). This is the first Counter pattern in the codebase — v0.1 was Tracer-only. Two domain-honesty risks: (a) the JSDoc comment "Plan EC-4 cites src/local/telemetry.ts as the meter source; that file does not exist in v0.1. Resolved by using `metrics.getMeter` directly" acknowledges the gap honestly but the resolution diverges silently from the plan — no ADR was added for the divergence; (b) the module-scope Counter means the meter resolves at import time against whatever MeterProvider is globally registered at that moment — consumers wiring their MeterProvider AFTER importing `@usetheo/memory` get a no-op counter forever (the API spec's get-meter-then-attach behavior depends on SDK version). The `onSoftDelete` test hook works around it but production telemetry may silently no-op on common Node wiring orders.


- **Found by:** review-v0-4b-forgetting-pipeline-domain-memory-layer
- **File:** `src/local/eviction/pg-evictor.ts` line 47
- **Plan reference:** EC-4 plan reference 'src/local/telemetry.ts' + Global DoD pillar (c)
- **Domain anchor:** architecture.md § 7 module hygiene + cycle-implement.md § Hard gate 6 pillar (c)
- **Evidence:**

  pg-evictor.ts L34-50:
    import { metrics, type Counter } from '@opentelemetry/api';
    ...
    const meter = metrics.getMeter('@usetheo/memory');
    const softDeleteCounter: Counter = meter.createCounter(...);
  
  JSDoc L26-30:
    "Plan EC-4 cites src/local/telemetry.ts as the meter source; that
     file does not exist in v0.1. Resolved by using `metrics.getMeter`
     directly from @opentelemetry/api"

- **Recommended action:** (1) Add an inline ADR row to plan v1.3 documenting the EC-4 resolution (telemetry.ts deferred; getMeter inline at PgEvictor). (2) Move the meter/counter acquisition INTO the PgEvictor constructor or to lazy-init at first evict() call so consumers that register a MeterProvider after import see emissions. Pattern precedent: most OTel SDK guides recommend lazy resolution unless a global provider is guaranteed pre-import. (3) Land the missing `src/local/telemetry.ts` module that the plan promised and route both Tracer + Meter through it so the future LRU-failure counter (T8.1 plan body cites `theo.memory.lru_update_failures`) does not duplicate the inline pattern.


### F-dom-pg-1: The partial index `idx_memories_eviction_score` is **misaligned with both queries it claims to support**:
(a) Capacity COUNT query in `capacity-based-trigger.ts:141-146` is `SELECT COUNT(*) WHERE agent_id = $1 AND t_invalid IS NULL`.
    A B-tree index on `(agent_id, last_accessed_at) WHERE t_invalid IS NULL` is **technically usable** for COUNT,
    but PG planners typically prefer the existing single-column `memories_agent_id_idx` for COUNT (cheaper to scan).
    The composite is only a win when index-only scan is achievable, which requires `last_accessed_at` to be in the index
    AND `agent_id` predicate to be selective.
(b) The eviction code path never issues a `WHERE agent_id = $X ORDER BY last_accessed_at LIMIT N` query — the candidates
    query (`capacity-based-trigger.ts:152-159`) fetches ALL active rows in scope and scoring is done in-memory.
    The partial-index leading column `last_accessed_at` is therefore **never used as a B-tree sort key**.
Net: the index is half-useful (helps filter to active rows in scope) but the LRU ordering payoff justified in the
docstring/plan does not exist at the SQL level. The plan T0.1 acceptance criterion ("EXPLAIN ANALYZE verify partial
index used") was not met for the LRU dimension — only the singleton-scope verification was logged in T4.1 commit body.


- **Found by:** review-v0-4b-forgetting-pipeline-domain-pgvector-schema
- **File:** `src/local/migrations/0003_eviction_columns.sql` line 4
- **Plan reference:** Plan T0.1 (ADR D13) — partial index supports CapacityBasedTrigger scope-count + LRU-ordered eviction queries
- **Domain anchor:** schema.ts:100-102 declares the index as `(agent_id, last_accessed_at) WHERE t_invalid IS NULL`
- **Evidence:**

  schema.ts:96-102:
    // supports CapacityBasedTrigger scope-count + LRU-ordered eviction queries per plan T5.1 + T6.1.
    index('idx_memories_eviction_score')
      .on(table.agentId, table.lastAccessedAt)
      .where(sql`${table.tInvalid} IS NULL`),
  
  capacity-based-trigger.ts:152-159 (no ORDER BY last_accessed_at):
    const candidatesResult = await client.query<ScopeCandidateRow>(
      `SELECT ... FROM memories WHERE agent_id = $1 AND t_invalid IS NULL`, ...

- **Recommended action:** Either (a) drop the partial index entirely (the single-column `memories_agent_id_idx` already covers
`agent_id = $X` lookups, and the `t_invalid IS NULL` filter is selectivity-friendly on a normally
mostly-active table), OR (b) keep it and add an actual `ORDER BY last_accessed_at ASC NULLS FIRST LIMIT N`
query path to the eviction pass (push the LRU ordering into the DB instead of streaming all rows and
scoring in-memory). Option (b) is the higher-ROI change because it also fixes the implicit O(N) memory
cost of `capacity-based-trigger.ts:152` for large scopes. Either way, run EXPLAIN ANALYZE against a
seeded scope of 10k+ rows to verify the planner's actual choice; the plan T0.1 acceptance criterion
requires this evidence and the commit body acknowledges it is missing.


### F-dom-pg-2: The NEAREST_NEIGHBOR_SQL query has **three properties that may individually defeat the HNSW index**:
(a) `WITH self AS (SELECT embedding FROM memories WHERE id = $1)` is referenced inline via subquery
    `(SELECT embedding FROM self)` inside both SELECT and ORDER BY. Postgres may NOT inline the CTE
    enough to let the HNSW planner see a constant vector for `<=>`. HNSW index is only used when
    the right-hand side of `<=>` is a literal/parameter, not a subquery result.
(b) The query has TWO additional WHERE predicates (`agent_id = $2`, `id <> $1`, `t_invalid IS NULL`)
    that the HNSW index does NOT cover. PG planner often falls back to Seq Scan + filter when the
    composite predicate cardinality is low relative to total rows — exactly the case for a scope-filtered
    search.
(c) Plan T4.1 acceptance said "EXPLAIN ANALYZE verify HNSW index is used". The commit body for
    0739d26 explicitly admits: "verified only Seq Scan on empty scope was tested". This is **NOT
    equivalent verification** — Seq Scan on empty data is the planner's correct cheap-table fallback;
    it tells you NOTHING about whether HNSW is reached on a populated scope.
The combination means the long-tail multiplier (D9) likely degrades to O(N) per scored memory at
production scale, NOT the O(log N) the plan implies. At 10k memories × 100 evictions per pass,
that's 1M cosine ops vs the HNSW-expected ~5k.


- **Found by:** review-v0-4b-forgetting-pipeline-domain-pgvector-schema
- **File:** `src/local/eviction/pg-nearest-neighbor-provider.ts` line 21-30
- **Plan reference:** Plan T4.1 acceptance criterion — EXPLAIN ANALYZE verify HNSW index is used
- **Domain anchor:** schema.ts:95 `memories_embedding_hnsw_idx` declared with vector_cosine_ops
- **Evidence:**

  pg-nearest-neighbor-provider.ts:21-30:
    const NEAREST_NEIGHBOR_SQL = `WITH self AS (
        SELECT embedding FROM memories WHERE id = $1
      )
      SELECT m.embedding <=> (SELECT embedding FROM self) AS distance
        FROM memories m
       WHERE m.agent_id = $2
         AND m.id <> $1
         AND m.t_invalid IS NULL
       ORDER BY m.embedding <=> (SELECT embedding FROM self) ASC
       LIMIT 1`;
  
  Plan acceptance unmet (commit 0739d26 body): "verified only Seq Scan on empty scope was tested"

- **Recommended action:** Two-step refactor: (1) fetch the self embedding as a separate roundtrip into a literal parameter
(`SELECT embedding INTO $self_vec FROM memories WHERE id = $1`), then (2) the second query becomes
`SELECT embedding <=> $self_vec::vector AS distance FROM memories WHERE agent_id = $2 AND id <> $1
AND t_invalid IS NULL ORDER BY embedding <=> $self_vec::vector ASC LIMIT 1` — with a literal
parameter on the RHS of `<=>`, the HNSW planner has the constant it needs. THEN run EXPLAIN ANALYZE
against a seeded scope of 10k+ memories and assert the plan node is `Index Scan using
memories_embedding_hnsw_idx`. Land the EXPLAIN evidence in the T4.1 commit body or a new integration
test that grep-asserts on `EXPLAIN (FORMAT JSON)` output. The current "Seq Scan on empty scope"
evidence does NOT satisfy the plan T4.1 acceptance criterion.


### F-dom-pg-4: Two concerns with the trigger:
(a) **Concurrent UPDATE race.** The trigger fires `BEFORE UPDATE OF llm_importance_score`. A
    concurrent transaction T_A that UPDATEs `llm_importance_score = NEW1` will fire the trigger
    and set `half_life_seconds = NULL`. A second concurrent T_B that also UPDATEs
    `llm_importance_score = NEW2` AND `half_life_seconds = computedValue` (the lazy-backfill UPDATE
    from `PgHalfLifePersister`) running interleaved may produce: T_A commits with NULL → T_B's
    half_life UPDATE went through (its WHERE half_life_seconds IS NULL was true at T_B start) →
    inconsistent state where importance changed but half_life persists the OLD-importance value.
    The lazy-backfill UPDATE (`pg-half-life-persister.ts:22-25`) reads MVCC-snapshot-stale data, not
    the value AFTER the BEFORE-UPDATE-OF trigger fired. Under READ COMMITTED isolation (PG default),
    the persister's UPDATE will succeed (its WHERE is true at its snapshot), defeating the trigger's
    invariant.
(b) **Idempotency of trigger payload reset.** `NEW.half_life_seconds := NULL` runs even when the
    caller's UPDATE statement did NOT touch `half_life_seconds`. If the caller's UPDATE was
    `UPDATE memories SET llm_importance_score = $1 WHERE id = $2` with no other SET, then NEW will
    have `half_life_seconds` carrying the OLD-row's value at trigger entry, and the trigger
    overrides it to NULL. This is the intended behavior. BUT: if the caller's UPDATE is
    `UPDATE memories SET llm_importance_score = $1, half_life_seconds = $2 WHERE id = $3` — the
    trigger silently overrides the caller's explicit half_life write to NULL. No code path today
    does this, but the trigger creates an invariant that's surprising to a future caller who
    attempts an atomic dual-column UPDATE.


- **Found by:** review-v0-4b-forgetting-pipeline-domain-pgvector-schema
- **File:** `src/local/migrations/0004_eviction_half_life_trigger.sql` line 7-20
- **Plan reference:** Plan T2.2 (EC-1) — DB-layer invariant: importance update resets half_life_seconds = NULL
- **Domain anchor:** PG docs — BEFORE UPDATE OF column triggers + race window with concurrent UPDATE
- **Evidence:**

  migrations/0004_eviction_half_life_trigger.sql:9-14:
    IF NEW.llm_importance_score IS DISTINCT FROM OLD.llm_importance_score THEN
      NEW.half_life_seconds := NULL;
    END IF;
    RETURN NEW;
  
  pg-half-life-persister.ts:22-25 (race-vulnerable):
    UPDATE memories
       SET half_life_seconds = $1
     WHERE id = $2
       AND half_life_seconds IS NULL

- **Recommended action:** For (a): document the race window in the trigger SQL comment AND add an integration test that
seeds the race deterministically (T_A starts BEFORE T_B's persister UPDATE, T_A commits AFTER).
Verify the post-state matches the intended invariant. If it doesn't (likely), then either
(1) raise the isolation level on the persister UPDATE to SERIALIZABLE with retry, OR (2) make
the persister UPDATE additionally check `WHERE half_life_seconds IS NULL AND llm_importance_score
IS NOT DISTINCT FROM $expected_importance` so an interleaved importance change invalidates the
write. Option (2) is cheaper and matches the lazy-backfill semantics.
For (b): add a comment to the trigger source explicitly documenting "this trigger
OVERRIDES any caller-supplied half_life_seconds value when llm_importance_score also changes
in the same UPDATE statement" — so future maintainers don't add atomic dual-column UPDATEs that
silently lose data.



## MINOR findings (8)

### F-arch-6: TimeBasedTrigger.start() handler uses `console.warn` inside the cron callback
(`console.warn('[v0.4b TimeBasedTrigger] tick failed:', err)`), suppressed via
`eslint-disable-next-line no-console`. Per architecture.md § 7 ("No `console.log` in
production code paths. Use a structured logger interface defined in `src/core/`"), this
should route through a structured logger. Pre-existing pattern: pgvector-store.ts:277
`recordAccess` has the same shape (also disabled). The v0.4b cycle inherits the
pre-existing inconsistency rather than introducing a new defect; tracking here so the
next contact with these files cleans it (per pre-existing-references clause in
no-paper-names-in-code.md, which generalizes to "clean adjacent rot when next touched").


- **Found by:** review-v0-4b-forgetting-pipeline-architecture
- **File:** `src/local/eviction/time-based-trigger.ts` line 144
- **Plan reference:** T5.2 (logging discipline)
- **Evidence:**

  ```ts
  // src/local/eviction/time-based-trigger.ts:142-145
  this.cronJob = new Cron(this.cronExpression, () => {
    void this.tickNow(new Date()).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('[v0.4b TimeBasedTrigger] tick failed:', err);
    });
  });
  ```

- **Recommended action:** When src/core/logger.ts (or equivalent structured-logger DIP) is introduced, route
these warnings through it. Track as a follow-up in
`.claude/knowledge-base/implementations/v0-4b-forgetting-pipeline-followups.md`. Not
blocking for v0.4b merge given the pattern was inherited; flagging for visibility.


### F-arch-7: `ScoreContext.neighborDistances` is documented as a cache pre-populated by
`selectVictims()` for use by `score()`. This couples the two methods via shared mutable-
via-readonly state on the context object — a "smart" but subtle convention. A consumer
who calls `score(memory, context)` directly without going through `selectVictims()` (the
tests already do this for pure-math unit tests, lines 30-50 of scoring-math.test.ts) gets
DIFFERENT semantics: long-tail multiplier short-circuits to 1.0 instead of querying the
provider. This is documented in the JSDoc but is an undocumented protocol on the
EvictionPolicy DIP shape — implementers of a non-Triadic future policy don't have a
structural signal of this contract.


- **Found by:** review-v0-4b-forgetting-pipeline-architecture
- **File:** `src/core/dip/eviction-policy.ts` line 47
- **Plan reference:** T4.1 + T4.2 (ScoreContext cache contract)
- **Evidence:**

  ```ts
  // src/core/dip/eviction-policy.ts:46-57
  /**
   * Optional per-memory isolation-distance cache populated by
   * `selectVictims()` once per pass per blueprint D9 + T4.2 ...
   * When absent (e.g., direct `score()` calls from tests), `score()` falls
   * back to `neighborProvider.distance(...)` or skips the multiplier.
   */
  readonly neighborDistances?: ReadonlyMap<string, number>;
  ```

- **Recommended action:** Acceptable for v0.4b — single concrete impl, documented thoroughly. When a 2nd
EvictionPolicy impl lands, consider whether the cache should be inverted: either
(a) the policy returns "what context do I need" + the runtime pre-fills it (visitor
pattern), or (b) `score(memory, context)` is renamed `scoreOne` and a batch
`scoreBatch(memories, context)` becomes the primary method (the cache lives inside
scoreBatch, never on the context). Track as ADR candidate for v0.4c / cycle-discover
"eviction-policy-batch-shape".


### F-dom-db-5: `0001_reflection_columns.sql` lacks a trailing newline (`No newline at end of file` in the diff). 0002, 0003, 0004 all have trailing newlines. Minor consistency issue; not v0.4b's fault but discovered while diffing migration shapes. Some psql variants warn on missing-newline input.


- **Found by:** review-v0-4b-forgetting-pipeline-domain-db-migrations
- **File:** `src/local/migrations/0001_reflection_columns.sql` line 17
- **Plan reference:** N/A (pre-existing v0.4a defect surfaced by v0.4b review scope)
- **Domain anchor:** editorconfig discipline — trailing newline on .sql files
- **Evidence:**

  $ git diff main..HEAD -- src/local/migrations/0001_reflection_columns.sql | tail -3
  +       OR ("memories"."kind" = 'derived' AND jsonb_array_length("memories"."derived_from") >= 1));
  \ No newline at end of file

- **Recommended action:** Out of scope for v0.4b but worth a follow-up trivial commit to fix 0001 EOF. Add a pre-commit hook check for trailing-newline on `src/local/migrations/*.sql` to prevent regressions.


### F-dom-7: The JSDoc at L25-29 honestly calls out a plan-prose typo ("Plan T2.1 § Deep Dives line 479 has a sign-error typo `recency = 1 - 2^(-Δ/h)` that contradicts the adjacent RED test names"). The shipped formula `recency = 2^(-Δt/h)` matches the blueprint + the test names, which is correct. However, this is a plan defect that should be patched into the plan v1.3 in-line rather than left as a "we silently corrected" note in the source — future readers (including the SEPA agent for v0.4c) will encounter the typo first when reading the plan. Plan-source-of-truth discipline (cycle-plan.md anti-pattern #7) means the plan should not carry stale prose.


- **Found by:** review-v0-4b-forgetting-pipeline-domain-memory-layer
- **File:** `src/local/eviction/triadic-scoring-policy.ts` line 25
- **Plan reference:** plan T2.1 § Deep Dives line 479 typo acknowledgment
- **Domain anchor:** blueprint D7 HLR formula
- **Evidence:**

  triadic-scoring-policy.ts L25-29 (verbatim acknowledgment).
  Plan v1.2 line 479 (Deep Dives § recency_component) still reads
  "recency = 1 - 2^(-Δ/h)".

- **Recommended action:** Patch plan v1.2 line 479 in a v1.3 cosmetic bump to read `recency = 2^(-Δt/h)`. Remove the JSDoc workaround note from triadic-scoring-policy.ts L25-29.


### F-dom-8: The plan declared unit tests for many phases at `src/local/eviction/__tests__/{lazy-half-life,recall-bookkeeping, nearest-neighbor,multiplier-integration,capacity-trigger, time-trigger,evict-soft-delete}.test.ts` — only `scoring-math.test.ts` ships at the unit tier. The rest moved to `tests/integration/forgetting/*` (which is honest — most need real pgvector). The shape of the v0.4b test pyramid therefore inverts the testing.md § Pyramid declaration ("unit-dominant") for this domain: 1 unit test file + 3 integration test files. This is defensible given pgvector's role in the multiplier path, but should be acknowledged in plan v1.3 § Phase T7 with a brief "v0.4b test pyramid skews integration-heavy because every meaningful path touches pgvector cosine + advisory locks" note.


- **Found by:** review-v0-4b-forgetting-pipeline-domain-memory-layer
- **File:** `src/local/eviction/__tests__/scoring-math.test.ts` line 1
- **Plan reference:** plan T2.2, T3.1, T4.1, T4.2, T5.1, T5.2, T6.1 TDD declarations
- **Domain anchor:** testing.md § Pyramid — unit-dominant
- **Evidence:**

  ls src/local/eviction/__tests__/ → 1 file (scoring-math.test.ts)
  ls tests/integration/forgetting/ → 3 test files + fixtures dir
  Plan T2.2 § TDD line 565 declares lazy-half-life.test.ts (NOT
  shipped at unit tier). Same for T3.1 T4.1 T4.2 T5.1 T5.2 T6.1.

- **Recommended action:** Document the skew in plan v1.3 with a brief "v0.4b honest test pyramid" note + cross-reference D18 (which already establishes the integration-promotion pattern). No code change required.


### F-dom-9: `LocalScopedMemory.get(memoryId)` hard-codes `scope: { kind: 'user', userId: String(result.payload['user_id'] ?? '') }` regardless of what the row actually carries (agent_id / session_id). This is a v0.1 defect, NOT introduced by v0.4b, but the v0.4b code path depends on it: the TriadicScoringPolicy reads `memory.scope` to derive the nearest-neighbor scope key in `getNeighborScopeId`. If v0.4b ever broadens (per F-dom-1) to accept rows fetched via `get()`, scope misidentification will silently route an agent memory through the user-tier nearest-neighbor query (which returns 0 rows → multiplier = 1.0). Surfacing here because F-dom-5's expansion path will trip over it.


- **Found by:** review-v0-4b-forgetting-pipeline-domain-memory-layer
- **File:** `src/local/index.ts` line 460
- **Plan reference:** ADR-0002 three-tier scope
- **Domain anchor:** ADR-0002 + memory-item.ts L19-20 scope discriminated union
- **Evidence:**

  src/local/index.ts L446-462:
    async get(memoryId: string): Promise<MemoryItem | null> {
      const result = await this.config.vectorStore.get(memoryId);
      if (result === null) return null;
      return {
        ...
        scope: { kind: 'user', userId: String(result.payload['user_id'] ?? '') },
              // ↑ always user, regardless of stored agent_id/session_id
        ...
      };
    }

- **Recommended action:** Reconstruct the Scope discriminated union from the row's payload (`agent_id` if present → agent; `session_id` → session; otherwise user). Pattern already exists in `capacity-based-trigger.ts` L65-70 (`rowToMemoryItem`) — extract it to a shared helper and reuse in `get()`. Out of v0.4b scope but blocks the tier-expansion path opened by fixing F-dom-1.


### F-dom-pg-5: `pg_try_advisory_xact_lock(hashtext('eviction_' || scopeId))` reduces an arbitrary-string scopeId
to a 32-bit integer (`int4`) via `hashtext`. Collision probability across a multi-tenant deployment
with millions of scopes is non-negligible (birthday-paradox sqrt(2^32) ≈ 65536 scopes for ~50%
collision probability). When two DIFFERENT scopes hash to the same int4, the second scope's
fire() will see `locked=false` and short-circuit — silently NOT evicting when it should.
Honest mitigation: the lock is advisory-only and the consequence of a missed eviction is bounded
(next fire on that scope will catch it). But under sustained capacity pressure on the colliding
scope, this can manifest as "memories aren't being evicted as expected" with no error signal.
Auto-release on transaction commit/rollback IS correct (xact_lock is the right variant).


- **Found by:** review-v0-4b-forgetting-pipeline-domain-pgvector-schema
- **File:** `src/local/eviction/capacity-based-trigger.ts` line 118-125
- **Plan reference:** Plan EC-2 — advisory lock serializes concurrent fires on same scope
- **Domain anchor:** PG advisory-lock docs — hashtext() collision space + transaction-scoped semantics
- **Evidence:**

  capacity-based-trigger.ts:118-125:
    const lockResult = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked',
      [`eviction_${scopeId}`],
    );
  
  time-based-trigger.ts:180-187 (same pattern, same exposure):
    const lockResult = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked',
      [`eviction_${this.scopeId}`],
    );

- **Recommended action:** Use `pg_try_advisory_xact_lock(key1::int, key2::int)` 2-int form with `(hashtext($1)::int,
hashtextextended($1, 0)::int)` to get a 64-bit lock key space (collision probability becomes
negligible). OR use a dedicated lock-key table keyed on scope with an `int4 PRIMARY KEY` autoincrement,
and use that integer as the lock key. The 2-int form is cheaper to ship. Add a comment in the SQL
explaining the collision mitigation. Severity is MINOR not MAJOR because the consequence is bounded
(missed eviction on next pass catches up); promote to MAJOR if this lands in a multi-tenant
production deployment.


### F-dom-pg-6: The test uses `ctid` as a proxy for "did an UPDATE happen". Two correctness concerns:
(a) **HOT (Heap-Only Tuple) updates do NOT change ctid** under certain conditions (when no indexed
    column is updated AND there's room on the same page). The half_life_seconds UPDATE on its own
    may HOT-update — neither the (id, hash) unique nor the agent_id index nor the embedding index
    nor the partial index reference half_life_seconds. The partial index COVERS (agent_id,
    last_accessed_at) so a half_life_seconds-only update qualifies for HOT — ctid MAY be unchanged.
    If HOT fires, the test would FALSELY report "no UPDATE happened" when one did.
(b) **Autovacuum/VACUUM moves tuples.** Even when no caller UPDATE happens between two ctid reads,
    a concurrent autovacuum can move the tuple to a different ctid. Test would falsely report
    "an UPDATE happened" when one didn't.
The test comment acknowledges xmin precision concerns but does not acknowledge these ctid concerns.


- **Found by:** review-v0-4b-forgetting-pipeline-domain-pgvector-schema
- **File:** `tests/integration/eviction/lazy-half-life.test.ts` line 238-248
- **Plan reference:** Plan T2.2 — lazy backfill UPDATE is idempotent (second call must not re-UPDATE)
- **Domain anchor:** PG docs — ctid is the physical row pointer; HOT updates may NOT change ctid
- **Evidence:**

  tests/integration/eviction/lazy-half-life.test.ts:239-247:
    // Track via ctid: physical row pointer. UPDATE moves the row to a new ctid
    // under MVCC, so two ctids being equal across two calls proves no UPDATE
    // happened. More precise than xmin (which loses precision when cast to
    // Number on long-running DBs).
    const result = await pool.query<{ ctid: string }>(
      `SELECT ctid::text AS ctid FROM memories WHERE id = $1`,
      [memoryId],
    );

- **Recommended action:** Replace ctid with `xmin::text` (string compare avoids the Number-cast precision issue) OR add a
`(SELECT autovacuum_count FROM pg_stat_user_tables WHERE relname = 'memories')` snapshot around
the test so a concurrent autovacuum surfaces. Lowest-friction fix: capture `xmin::text` for
both readings and assert string-equal (strings preserve full xid precision). The current
ctid-based assertion can produce flaky tests in CI if autovacuum is active OR when HOT updates
apply. Severity is MINOR because the test is short-lived (autovacuum unlikely in the test window)
but worth fixing pre-merge to avoid future CI churn.



## INFO findings (13)

### F-arch-8: DIP boundary correctly honored. src/core/dip/eviction-policy.ts imports only from
../memory-item.js + ../scope.js (no src/local/, no src/cloud/). No paper names
(Mem0/Letta/LangMem/etc.) in the new eviction surface — no-paper-names-in-code.md
respected. The InvalidFractionError + assertValidFraction helper correctly use
Object.setPrototypeOf for ESM/CJS instanceof robustness (matches existing pattern in
src/core/errors.ts). The 8th-DIP narrative in the file's header docblock is
load-bearing (clarifies it is NEW, does NOT alter ADR-0008's locked 5).


- **Found by:** review-v0-4b-forgetting-pipeline-architecture
- **File:** `src/core/dip/eviction-policy.ts` line 1
- **Plan reference:** T1.1 (DIP boundary)
- **Evidence:**

  ```ts
  // src/core/dip/eviction-policy.ts:26-27
  import type { MemoryItem } from '../memory-item.js';
  import type { Scope } from '../scope.js';
  ```
  grep -rEn "from '(\.\./)*(local|cloud)" src/core/ → no production-code matches.

- **Recommended action:** No action — clean. Hook boundary-check.sh confirms the rule mechanically; this
finding documents the intentional state.


### F-arch-9: MemoryItem extension is honest + backward-compatible: 4 new fields
(llmImportanceScore, lastAccessedAt, accessCount, halfLifeSeconds) are ALL
`field?: T | null` — optional AND nullable. The locked-shape test-d.ts at
src/core/__tests__/memory-item.test-d.ts:7-23 was updated in the same commit to
include the new fields with the same modifiers, so any future field-shape regression
surfaces as a TypeScript compile error. JSDoc on each field cites the ADR that
introduced it (D8 / D13 / D14) so provenance survives.


- **Found by:** review-v0-4b-forgetting-pipeline-architecture
- **File:** `src/core/memory-item.ts` line 49
- **Plan reference:** T0.1 (MemoryItem extension + backward compat)
- **Evidence:**

  ```ts
  // src/core/memory-item.ts:49,58,65,72
  readonly llmImportanceScore?: number | null;
  readonly lastAccessedAt?: Date | null;
  readonly accessCount?: number;
  readonly halfLifeSeconds?: number | null;
  ```

- **Recommended action:** No action — clean. The locked test-d.ts is the contract; v0.4b honored it.


### F-arch-10: OTel counter `theo.memory.eviction.soft_deletes_total` is registered at MODULE SCOPE
(lines 47-50, executed at import time) rather than in the PgEvictor constructor. This is
acceptable per the OTel SDK contract (`metrics.getMeter` is no-op-safe until a
MeterProvider is registered) and matches the existing pattern at v0.4a. But it means the
counter is process-singleton: a test that imports pg-evictor.ts twice gets the SAME
counter, which is desired for telemetry but unexpected for test isolation. The
`onSoftDelete` callback test hook correctly separates the deterministic verification
channel from the telemetry channel — clean design.


- **Found by:** review-v0-4b-forgetting-pipeline-architecture
- **File:** `src/local/eviction/pg-evictor.ts` line 47
- **Plan reference:** T6.1 (OTel counter at module scope)
- **Evidence:**

  ```ts
  // src/local/eviction/pg-evictor.ts:45-50
  const SOFT_DELETE_COUNTER_NAME = 'theo.memory.eviction.soft_deletes_total';
  const meter = metrics.getMeter('@usetheo/memory');
  const softDeleteCounter: Counter = meter.createCounter(SOFT_DELETE_COUNTER_NAME, {
    description: 'Count of memories soft-deleted by an eviction policy (cumulative)',
  });
  ```

- **Recommended action:** No action — clean. Document in the next OTel naming-convention review whether the
module-scope vs constructor-scope pattern should be standardized; not a v0.4b concern.


### F-arch-11: Migration 0003 is purely additive (3 ADD COLUMN IF NOT EXISTS + 1 CREATE INDEX IF NOT
EXISTS), no DROP / no NOT NULL on new columns without DEFAULT, no ALTER on existing
columns. Backward compatibility preserved at the data layer. Partial index
`idx_memories_eviction_score (agent_id, last_accessed_at) WHERE t_invalid IS NULL`
matches the SELECT pattern used by CapacityBasedTrigger + TimeBasedTrigger (modulo
F-arch-4 scope-only-agent concern). Migration 0004 (half-life reset trigger) enforces
the EC-1 invariant at the data layer correctly — raw SQL UPDATE paths (e.g., /reflect
re-extraction) cannot bypass the half-life-stale guard.


- **Found by:** review-v0-4b-forgetting-pipeline-architecture
- **File:** `src/local/migrations/0003_eviction_columns.sql` line 4
- **Plan reference:** T0.1 (additive migration + partial index)
- **Evidence:**

  ```sql
  -- 0003_eviction_columns.sql
  ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "last_accessed_at" timestamp with time zone;
  ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "access_count" integer DEFAULT 0 NOT NULL;
  ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "half_life_seconds" integer;
  CREATE INDEX IF NOT EXISTS "idx_memories_eviction_score"
    ON "memories" USING btree ("agent_id","last_accessed_at") WHERE "t_invalid" IS NULL;
  ```

- **Recommended action:** No action — clean migration shape. Schema-domain reviewer covers correctness more deeply.


### F-arch-12: Both PgvectorStore.search() and PgvectorStore.keywordSearch() correctly added
`WHERE t_invalid IS NULL` (lines 234 + 297) so soft-deleted rows are excluded from
semantic + keyword recall per ADR D17. The `recordAccess` private method (lines
263-282) correctly: (a) batches the UPDATE; (b) deduplicates ids via
`SELECT DISTINCT unnest($1::uuid[])` per EC-8; (c) wraps in try/catch with console.warn
so a bookkeeping failure does NOT corrupt the recall result — matches "Fire-and-forget
telemetry" deep-dive in plan T3.1. SRP respected: recordAccess is a single-purpose
private side-effect.


- **Found by:** review-v0-4b-forgetting-pipeline-architecture
- **File:** `src/local/pgvector-store.ts` line 226
- **Plan reference:** T6.1 + T3.1 (soft-delete filter + recordAccess)
- **Evidence:**

  ```ts
  // src/local/pgvector-store.ts:229-237 + 263-282
  const sql = `SELECT ... FROM memories WHERE t_invalid IS NULL${filter.sql} ...`;
  private async recordAccess(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    try {
      await this.pool.query(`UPDATE memories SET access_count = ...
        WHERE id IN (SELECT DISTINCT unnest($1::uuid[]))`, [ids]);
    } catch (err) { console.warn(...); }
  }
  ```

- **Recommended action:** No action — clean. Same console.warn concern as F-arch-6 applies (pre-existing pattern).


### F-dom-db-6: THE GOAL test `triadic-eviction.test.ts` and `lazy-half-life.test.ts` both assume the DB schema (including columns and trigger from 0003 + 0004) is already present — `beforeAll` only opens a Pool, does not apply migrations. With the F-dom-db-1 journal gap, this means the test ONLY passes if the dev manually applied 0003 + 0004 via psql OR ran `npm run db:push` (which still misses the 0004 trigger per F-dom-db-2). The test suite cannot serve as a regression gate for the F-dom-db-1 production deployment failure because the test harness silently relies on out-of-band schema setup. This explains why CI may have been green on this PR despite the journal gap.


- **Found by:** review-v0-4b-forgetting-pipeline-domain-db-migrations
- **File:** `tests/integration/forgetting/triadic-eviction.test.ts` line 59
- **Plan reference:** v0-4b plan § T7.1 (THE GOAL TEST)
- **Domain anchor:** testing.md § Integration — "Real Postgres + pgvector via Docker"
- **Evidence:**

  $ grep -n "beforeAll\|psql\|runMigrations\|migrations/" \
      tests/integration/forgetting/triadic-eviction.test.ts \
      tests/integration/eviction/lazy-half-life.test.ts
  # only beforeAll() opening the Pool; zero migration-apply calls.

- **Recommended action:** Add a single integration test at `tests/integration/migrations.test.ts` that drops `__drizzle_migrations`, runs `runMigrations(pool)` end-to-end, and asserts every expected column + index + trigger from 0003 + 0004 exists (via `information_schema.columns` + `pg_trigger` queries). This gate would have caught F-dom-db-1 + F-dom-db-2 automatically and should be a permanent regression guard going forward, not v0.4b-specific.


### F-dom-db-7: Verified `postbuild:copy-migrations` script uses `cpSync('src/local/migrations', 'dist/local/migrations', {recursive: true})` and the `files` glob in package.json includes `"src/local/migrations/**"`. Both unconditionally capture 0003 + 0004 .sql files (and would capture the snapshots once F-dom-db-1 is fixed). No v0.4b regression on the build/publish path.


- **Found by:** review-v0-4b-forgetting-pipeline-domain-db-migrations
- **File:** `package.json` line 33
- **Plan reference:** v0-4b plan does not call out a postbuild change
- **Domain anchor:** architecture.md § 10.1 (non-.ts assets copy)
- **Evidence:**

  $ cat package.json | grep -A3 '"files"'
  "files": [
    "src/**/*.ts",
    "!src/**/__tests__/**",
    "!src/**/*.test.ts",
    "!src/**/*.test-d.ts",
    "src/local/migrations/**"     # <-- captures all migration .sql + meta/
  ]

- **Recommended action:** None for v0.4b. After F-dom-db-1 fix lands, verify `tests/integration/publish-readiness.test.ts` runs green to confirm the snapshots ship in the tarball.


### F-dom-db-8: Migration ordering is lex-sorted (Drizzle and most migration tools rely on this); the rename from `0002_eviction_columns.sql` → `0003_eviction_columns.sql` preserves the invariant after v0.6's `0002_skill_columns.sql` landed. 0004 depends on the `half_life_seconds` column added in 0003 — ordering is correct (0003 before 0004 alphabetically). No issue here, just confirming the rename did not introduce a dependency-order regression.


- **Found by:** review-v0-4b-forgetting-pipeline-domain-db-migrations
- **File:** `src/local/migrations/0003_eviction_columns.sql + 0004_eviction_half_life_trigger.sql` line N/A
- **Plan reference:** v0-4b plan rename from `0002_` → `0003_` per commit a7a40ef
- **Domain anchor:** lex-sort ordering invariant
- **Evidence:**

  $ ls src/local/migrations/*.sql
  0000_crazy_mimic.sql
  0001_reflection_columns.sql
  0002_skill_columns.sql
  0003_eviction_columns.sql
  0004_eviction_half_life_trigger.sql
  # Lex-sort matches dependency-sort: 0003 (columns) before 0004 (trigger on column).

- **Recommended action:** None.

### F-dom-10: `TriadicScoringPolicy.evict()` (L237-242) delegates to the injected `Evictor` — which is good composition — but `evict` is NOT part of the `EvictionPolicy` DIP declared at `src/core/dip/eviction-policy.ts` (the DIP shape declares only `kind`, `score`, `selectVictims`, and optional lifecycle hooks). So `policy.evict(ids)` is a public method on the impl that is INVISIBLE through the DIP — consumers typing against `EvictionPolicy` can call `score` + `selectVictims` but not `evict`. The triggers (`CapacityBasedTrigger.fire`) issue the soft-delete UPDATE inline rather than calling `policy.evict()`, so the impl method is actually dead code reachable only by cross-talk through the concrete type. INFO severity because it may be intentional staging (the DIP declared evict as future hook), but the asymmetry deserves a clarifying ADR row OR removal of the impl method to keep the DIP+impl boundary clean.


- **Found by:** review-v0-4b-forgetting-pipeline-domain-memory-layer
- **File:** `src/local/eviction/triadic-scoring-policy.ts` line 237
- **Plan reference:** ADR D17 + EvictionPolicy DIP shape
- **Domain anchor:** DIP method-count semantics (ADR-0008 spirit) + KISS
- **Evidence:**

  eviction-policy.ts L97-111 (DIP shape): no `evict` method.
  triadic-scoring-policy.ts L237-242 (extra method on the impl).
  capacity-based-trigger.ts L168-173: issues UPDATE inline; does
  NOT call `policy.evict(victimIds)`.

- **Recommended action:** Decide: either lift `evict` into the EvictionPolicy DIP (declare it as the 5th method; bump the v0.4b ADR D12 method count from 4 to 5) OR remove `evict` from TriadicScoringPolicy and route eviction strictly through the injected `Evictor` from the trigger. The current state is "half-public" which makes future refactors brittle.


### F-dom-11: The four optional v0.4a/v0.4b fields (`llmImportanceScore`, `lastAccessedAt`, `accessCount`, `halfLifeSeconds`) on `MemoryItem` are correctly typed as optional + nullable for backward compatibility, and the type-d test at `core/__tests__/memory-item.test-d.ts` is updated to lock the shape. ADD-only invariant honored: no public `update()` method. Backward-compat for v0.1/v0.4a callers is preserved at the type level. This is INFO confirming the v0.4b extension does NOT regress the Mem0-shape architecture or the ADD-only ADR.


- **Found by:** review-v0-4b-forgetting-pipeline-domain-memory-layer
- **File:** `src/core/memory-item.ts` line 49
- **Plan reference:** MemoryItem field-shape evolution
- **Domain anchor:** architecture.md § 4 + memory-item.test-d.ts
- **Evidence:**

  memory-item.ts L41-72: 4 fields added; all optional + nullable.
  memory-item.test-d.ts L8-23: shape contract test locks the
  union shape.
  No public `update()` method introduced on `Memory` or
  `ScopedMemory` — `forget()` stays the only mutation primitive,
  and `remember()` stays ADD-only.

- **Recommended action:** None. ADD-only + Mem0-shape contract preserved.


### F-dom-12: `PgvectorStore.search()` (L234) and `PgvectorStore.keywordSearch()` (L297) both add `WHERE t_invalid IS NULL`. This is NOT a regression of v0.1's bi-temporal contract: ADR-0006 locked that local v0.1 `recall()` does NOT accept `asOf` (throws `BiTemporalNotSupportedLocally`). The filter is correct and consistent with the cloud divergence path; cloud at v0.5 will be the first to honor `asOf` semantics. The audit-trail path (raw SQL `WHERE t_invalid IS NOT NULL`) still works for soft-deleted rows. INFO severity confirming concern #3 in the role contract is NOT a contract violation.


- **Found by:** review-v0-4b-forgetting-pipeline-domain-memory-layer
- **File:** `src/local/pgvector-store.ts` line 234
- **Plan reference:** ADR D17 + ADR-0006 + pgvector-store search() filter
- **Domain anchor:** ADR-0006 bi-temporal local schema
- **Evidence:**

  ADR-0006 § Decision: "Local schema (v0.1) provisions t_valid and
  t_invalid as nullable TIMESTAMPTZ columns ... The local runtime's
  recall() does NOT accept an asOf parameter at v0.1".
  src/local/index.ts L226-228: throws BiTemporalNotSupportedLocally
  on asOf.
  pgvector-store.ts L234 + L297: t_invalid IS NULL filter consistent.

- **Recommended action:** None. Bi-temporal contract intact at v0.1 boundary; soft-delete filter is a v0.4b additive concern wrapped inside that contract.


### F-dom-pg-7: `CREATE OR REPLACE TRIGGER` requires PostgreSQL >= 14. Project uses
`ankane/pgvector:v0.5.1` (per `docker-compose.yaml:19`) which bundles PG 16 — OK. Documenting
explicitly for future ops reference: if a consumer pins an older PG image (PG 13 or earlier),
the migration will fail at `CREATE OR REPLACE TRIGGER` with "syntax error at or near OR REPLACE".
No action required for current targets; raised because a runtime-supported version downgrade
would be silent until migration time.


- **Found by:** review-v0-4b-forgetting-pipeline-domain-pgvector-schema
- **File:** `src/local/migrations/0004_eviction_half_life_trigger.sql` line 17
- **Plan reference:** n/a
- **Domain anchor:** PG docs — CREATE OR REPLACE TRIGGER added in PG 14
- **Evidence:**

  migrations/0004_eviction_half_life_trigger.sql:17:
    CREATE OR REPLACE TRIGGER memories_reset_half_life_on_importance_update_trg
  
  docker-compose.yaml:19:
    image: ankane/pgvector:v0.5.1   (PG 16)

- **Recommended action:** Document the PG >= 14 requirement in the migration comment header OR in the project README's
"Local runtime requirements" section. No code change required while ankane/pgvector:v0.5.1 is
pinned. Optional follow-up: pin PG version explicitly in docker-compose.yaml comment.


### F-dom-pg-8: `recordAccess()` is `await`ed (line 246) but its error is caught and console.warn'd (line 275-281).
The caller still pays the round-trip latency cost — it's NOT fire-and-forget in the latency sense,
only in the failure-isolation sense. Plan T3.1 acknowledges this. Confirming the comment is precise:
"fire-and-forget" applies to ERROR semantics, not LATENCY semantics. Recall callers will see
`search()` latency = `vector-distance query + recordAccess UPDATE round-trip`. The UPDATE has
`SET access_count = access_count + 1, last_accessed_at = NOW()` against the partial index — the
access_count column is NOT in the partial index, so the UPDATE qualifies for HOT (no index update).
Cost is one heap page write per recall, plus the UNNEST + DISTINCT setup. Likely acceptable but
worth a P95 latency probe.


- **Found by:** review-v0-4b-forgetting-pipeline-domain-pgvector-schema
- **File:** `src/local/pgvector-store.ts` line 226-247
- **Plan reference:** Plan T3.1 § Fire-and-forget telemetry — recall results returned unchanged on UPDATE failure
- **Domain anchor:** Mem0 search pipeline — additive scoring (CLAUDE.md § 4)
- **Evidence:**

  pgvector-store.ts:243-247:
    const mapped = result.rows.map(rowToResult);
    // v0.4b T3.1 / D15: batched LRU/LFU write-back. Fire-and-forget — failures
    // log + degrade gracefully (bookkeeping is best-effort, not invariant).
    await this.recordAccess(mapped.map((r) => r.id));
    return mapped;

- **Recommended action:** Either (a) drop the `await` and let `recordAccess` run in the background (true fire-and-forget
in latency too — but Node's unhandled-promise-rejection trap requires care), OR (b) tighten
the comment to "fire-and-forget in error semantics; recall round-trip latency includes the
UPDATE cost". The current code matches (b)'s actual behavior but the comment implies (a).
No correctness defect — clarity only.



## Handoff decision

Implementation has BLOCKER and/or CRITICAL findings. Loop back to `/implement` to address.

## Audit trail

Spawned agents (their findings files live alongside this report):

- `.claude/agents/review-v0-4b-forgetting-pipeline-2026-05-30/review-v0-4b-forgetting-pipeline-architecture.md`
- `.claude/agents/review-v0-4b-forgetting-pipeline-2026-05-30/cross-validation.md`
- `.claude/agents/review-v0-4b-forgetting-pipeline-2026-05-30/review-v0-4b-forgetting-pipeline-domain-db-migrations.md`
- `.claude/agents/review-v0-4b-forgetting-pipeline-2026-05-30/review-v0-4b-forgetting-pipeline-domain-memory-layer.md`
- `.claude/agents/review-v0-4b-forgetting-pipeline-2026-05-30/review-v0-4b-forgetting-pipeline-domain-pgvector-schema.md`
- `.claude/agents/review-v0-4b-forgetting-pipeline-2026-05-30/tests.md`
- `.claude/agents/review-v0-4b-forgetting-pipeline-2026-05-30/wiring.md`

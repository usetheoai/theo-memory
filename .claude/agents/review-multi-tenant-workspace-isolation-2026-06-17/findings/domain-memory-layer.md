```yaml
agent: review-multi-tenant-workspace-isolation-domain-memory-layer
review_target: 23ce3d1~1..HEAD for plan multi-tenant-workspace-isolation
domain: memory-layer
domain_specific_patterns_checked:
  - "Three memory principles (CLAUDE.md § IMPORTANTE): relevance scoring / priority-diversity / auditability preserved under workspace_id AND-clause"
  - "Three-tier scope (User/Session/Agent) UNCHANGED partitions within a workspace (ADR D1, architecture.md § 1)"
  - "filtersFromScope tier filters correct; workspace purely additive"
  - "buildPayload + dedup hash (hashFact MD5 of normalized text) does NOT include workspace_id"
  - "ON CONFLICT composite key + memories_hash_scope_unique_idx parity (confirmation_count UPSERT, Princípio 1)"
  - "insertDerivedMemory (reflection) inherits source workspace"
  - "composeFilters additive scoring / threshold gating undisturbed by workspace_id"
  - "bi-temporal asOf / attributed_to / category compose with workspace_id"
  - "in-memory store parity (EC-9) for workspace filter"
  - "recall-cache cross-workspace hit (EC-8) — Principle 2/3 risk under T1.2 deferral"
  - "all 5 verbs (remember/recall/forget/reflect/scopes) route through workspaceBoundMemory (no partial-isolation leak)"

findings:
  - id: F-dom-mem-1
    severity: MEDIUM
    file: packages/core/src/infrastructure/db/eviction/pg-evictor.ts
    line: 39
    plan_ref: "ADR D6 + Failure scenarios table (EC-5): 'the soft-delete UPDATE carries AND workspace_id = $principal; 0 rows → 404, never touching ws-B's row'"
    domain_anchor: "CLAUDE.md Princípio 3 (auditability — every forget decision traceable/justifiable) + architecture.md § 8 (defense-in-depth)"
    summary: >
      The plan's EC-5 destructive-IDOR guard specified the soft-delete UPDATE
      itself should carry an `AND workspace_id = $principal` clause as DB-level
      defense-in-depth. The shipped implementation relies SOLELY on a single
      app-level check in LocalMemory.forget (`rowWorkspace !== this.workspaceId`
      → throw MemoryNotFound) BEFORE calling PgEvictor.evict. The evict SQL is
      `UPDATE memories SET t_invalid = NOW() WHERE id = ANY($1::uuid[]) AND
      t_invalid IS NULL` — workspace-agnostic. Functionally correct today (the
      app-check throws 404 before evict runs), but it is single-layer, not the
      belt-and-suspenders the plan promised. If a future caller reaches evict
      WITHOUT the LocalMemory.forget guard (e.g. CapacityBasedTrigger / cron
      eviction, which already bypasses the app forget path), nothing at the SQL
      layer prevents evicting a cross-workspace id supplied in a batch.
    evidence: |
      pg-evictor.ts:39-42
      ```
      const EVICT_SOFT_DELETE_SQL = `UPDATE memories
         SET t_invalid = NOW()
       WHERE id = ANY($1::uuid[])
         AND t_invalid IS NULL`;   // <-- no AND workspace_id clause
      ```
      vs plan Failure-scenarios row: "the soft-delete UPDATE carries AND workspace_id = $principal".
      The guard lives only at local-memory.ts:158-167 (app-level pre-check).
    recommended_action: >
      Either (a) document explicitly in T1.2's deferral that the DB-level
      soft-delete workspace clause is deferred WITH the eviction threading
      (eviction is the only non-forget evict caller and is itself PAUSED per the
      roadmap race-condition b2909ff), OR (b) add `AND workspace_id = $2` to the
      evict SQL when a workspace is bound. Given eviction wiring is paused and
      the forget path is guarded, (a) is acceptable for this slice — but the
      plan text claims the SQL carries the clause, so reconcile the disclosure
      (honesty Rule 3) rather than leave the plan asserting a guard the code does not have.

  - id: F-dom-mem-2
    severity: LOW
    file: packages/core/src/infrastructure/db/in-memory-store.ts
    line: 60
    plan_ref: "T1.1 AC + EC-9: 'in-memory-store.ts applies the SAME workspace_id filter ... if it defaults every row to the default workspace, that is asserted explicitly (EC-9)'"
    domain_anchor: "CLAUDE.md Princípio 2 (priority/diversity preserved); architecture.md § 4 (in-memory adapter parity for contract tests)"
    summary: >
      EC-9 required the in-memory store to apply the SAME workspace filter so a
      contract test cannot pass while integration leaks, AND that any
      default-to-'default' behavior be asserted explicitly. in-memory-store.ts
      was NOT modified in the diff. It happens to isolate correctly via its
      generic equality loop (matchesFilters: `payload[key] !== value` for the
      workspace_id key), BUT there is an asymmetry with pgvector: pgvector hoists
      an unbound insert to the column default 'default', whereas the in-memory
      insert OMITS workspace_id from the payload entirely (buildPayload only adds
      it when filters.workspace_id !== undefined). So an UNBOUND in-memory insert
      followed by a BOUND ('ws-A') recall → no match (undefined !== 'ws-A'),
      which is correct isolation but does NOT mirror pgvector's
      'default'-defaulting. The asymmetry is behaviorally safe for isolation but
      is not the explicit EC-9 parity assertion the plan demanded — there is no
      dedicated in-memory workspace-parity test in the diff.
    evidence: |
      in-memory-store.ts:85-97 generic loop matches on any filter key incl. workspace_id.
      No diff to in-memory-store.ts in 23ce3d1~1..HEAD (git diff --stat shows it untouched).
      store-isolation.test.ts targets PgvectorStore only (skips when THEOMEM_PG_URI unset).
    recommended_action: >
      Add a small in-memory workspace-parity unit/contract test (no pgvector
      dependency) asserting a ws-A recall never returns a ws-B in-memory row, and
      document the omit-vs-default asymmetry, to satisfy EC-9 explicitly. The
      isolation itself is sound; only the explicit parity assertion is missing.

  - id: F-dom-mem-3
    severity: INFO
    file: packages/core/src/infrastructure/db/recall-cache/pgvector-recall-cache-store.ts
    line: 81
    plan_ref: "T1.2 (DEFERRED) + EC-8 + Drawbacks 'Recall-cache keyed without workspace → cross-workspace cache hit' (Critical)"
    domain_anchor: "CLAUDE.md Princípio 2 (a ws-B query must not receive ws-A's prioritized set) + Princípio 3 (auditability — a cross-workspace hit is an unaudited cross-tenant read)"
    summary: >
      Confirming the deferral risk for the record. The recall_cache table gained
      the workspace_id COLUMN (migration 0016) + a (workspace_id, scope_key)
      index, but the cache store lookup is still `WHERE scope_key = $1` and
      deriveScopeKey(scope) does NOT incorporate workspace_id. With the cache
      ENABLED (opt-in createLocalMemory({ recallCache })) AND two workspaces, a
      byte-identical query sharing the same scope_key (e.g. same user_id under
      two workspaces) WOULD produce a cross-workspace cache hit — a real
      Principle 2 + Principle 3 violation. This is exactly what T1.2 defers. From
      a memory-layer view the single-workspace caveat IS sufficient: the leak
      requires BOTH multiple workspaces AND the opt-in cache. The deferral is
      honestly disclosed in the plan T1.2 block + (per plan) CHANGELOG/Roadmap.
      This finding is INFO (not a defect in the shipped scope) — it exists to
      ensure the follow-up `multi-tenant-workspace-isolation-secondary-stores`
      MUST land before the opt-in cache is ever documented as workspace-safe.
    evidence: |
      pgvector-recall-cache-store.ts:81 `WHERE scope_key = $1` (no workspace_id predicate)
      :160/187/209 `deriveScopeKey(scope)` — scope has no workspace dimension.
      Migration column+index present (0016:35,46) but UNUSED by the lookup → confirms COLUMN-only state.
    recommended_action: >
      No action this slice (correctly deferred). Verify the CHANGELOG/Roadmap
      caveat is present (cross-check with cross-validation agent) and that the
      follow-up plan blocks documenting cache as workspace-safe until
      deriveScopeKey prefixes workspace_id AND the lookup adds the clause.

positive_observations:
  - "DEDUP HASH CORRECT: hashFact(text) (pipeline.ts:418) hashes ONLY normalized text; workspace_id is NOT in the hash. buildPayload adds workspace_id to the PAYLOAD (carrier) but not the dedup key — exactly right per the review brief."
  - "EC-12 (caught DURING implementation, not in plan): the dedup UNIQUE index memories_hash_scope_unique_idx was DROP+RECREATEd with workspace_id as leading column (0016:53-55), and the ON CONFLICT clause (pgvector-store.ts:430) matches it exactly. This closes a real Princípio 1 cross-workspace confirmation_count leak (same fact, same user, two workspaces would otherwise bump workspace-A's count). Strong implementation judgment."
  - "THREE TIERS UNCHANGED (ADR D1): filtersFromScope (scoped-memory.ts) spreads `...ws` additively into every tier branch (user/session/agent/repo); the tier keys (user_id/session_id/agent_id) are byte-identical to pre-change. Workspace is purely an additional AND-clause. architecture.md § 1 three-tier lock respected — workspace is orthogonal, not a 4th tier."
  - "SCORING UNDISTURBED (Princípio 1+2): composeFilters adds workspace_id as a SQL WHERE-clause only (composed FIRST for index use). The additive scoring (semantic+bm25+entity)/max_possible, the semantic threshold gating, and MMR diversify all run in the pipeline AFTER the SQL fetch — they operate on the already-workspace-filtered candidate set and are mathematically untouched. No scoring/threshold/MMR path regressed."
  - "REFLECTION-DERIVED INHERITANCE (insertDerivedMemory): the scope arg gained workspaceId; insert writes `args.scope.workspaceId ?? 'default'`. Derived memories correctly stay in their source workspace. Threaded per plan."
  - "BI-TEMPORAL / ATTRIBUTED_TO / CATEGORY COMPOSE: search() composes composeTemporalWhere(asOf) THEN composeFilters (which now includes workspace_id) — the asOf null-safe predicate AND the workspace clause AND-combine cleanly. attributed_to/category remain payload-projected + filter keys, orthogonal to workspace_id. No interaction defect."
  - "NO PARTIAL-ISOLATION LEAK ACROSS VERBS: all 5 handlers (remember/recall/forget/reflect/scopes) consistently route through workspaceBoundMemory(c, memory). remember binds workspace BEFORE resolving the body tier (workspace from credential, tier from body — ADR D3). forget uses get() which projects workspace_id (pgvector-store.ts:580) so the cross-workspace 404 check has the data it needs."

summary_counts:
  MEDIUM: 1
  LOW: 1
  INFO: 1
  positive_observations: 7
most_important_finding: >
  F-dom-mem-1 (MEDIUM): the soft-delete (PgEvictor) UPDATE does NOT carry the
  `AND workspace_id = $principal` clause the plan's EC-5 explicitly promised.
  Isolation IS enforced today by the single app-level pre-check in
  LocalMemory.forget (throws 404 before evict), so there is no leak in the
  shipped forget path — but the DB-level defense-in-depth the plan asserts does
  not exist in code, and the cron/capacity eviction path (which bypasses the
  forget guard) has no workspace clause. Reconcile the plan disclosure (honesty)
  or add the SQL clause. No CRITICAL/HIGH memory-layer defects: the dedup hash
  correctly excludes workspace_id, EC-12 (confirmation_count cross-workspace
  leak) was caught and closed via the recreated unique index + matching ON
  CONFLICT, the three tiers are unchanged additive partitions, and the additive
  scoring / threshold / MMR pipeline is mathematically undisturbed.
```

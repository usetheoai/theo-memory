---
agent: review-multi-tenant-workspace-isolation-architecture
review_target: 23ce3d1~1..HEAD for plan multi-tenant-workspace-isolation
plan: .claude/knowledge-base/plans/multi-tenant-workspace-isolation-plan.md
summary_counts:
  BLOCKER: 0
  HIGH: 2
  MEDIUM: 3
  LOW: 1
  INFO: 3
findings:
  - id: F-arch-1
    severity: HIGH
    file: packages/core/src/domain/scope.ts
    line: 182
    plan_ref: ADR D4 (compile-time-required workspaceId) + T1.1 Acceptance Criteria "a REST-path call without workspaceId is a compile error"
    summary: >
      The D4 compile-time guarantee is NOT realized. `ScopedFilters` (the typed
      wrapper that promotes `workspace_id` to REQUIRED) is declared but never
      used on the runtime call chain. The actual REST path threads workspace via
      `filtersFromScope(scope, workspaceId?)` which returns a plain `Filters`
      (optional `workspace_id`), and `composeFilters(filters: Filters | undefined)`
      still `continue`s when `workspace_id === undefined`. "Forgetting the
      workspace" is therefore a runtime default (`?? 'default'`), NOT a TypeScript
      compile error as ADR D4 and T1.1 promise.
    evidence: |
      grep shows ScopedFilters has ZERO non-test, non-dist consumers:
        packages/core/src/domain/scope.ts:182  (declaration only)
        packages/core/src/infrastructure/db/pgvector-store.ts:181 (a COMMENT referencing it)
      composeFilters still optional-skips:
      ```ts
      function composeFilters(filters: Filters | undefined, startParamIndex: number): FilterClause {
        for (const col of ['workspace_id', 'user_id', 'session_id', 'agent_id'] as const) {
          const value = filters[col];
          if (value === undefined) { continue; }   // <- workspace_id can be absent; query unscoped
      ```
      filtersFromScope returns plain Filters, workspace_id optional:
      ```ts
      export function filtersFromScope(scope: Scope, workspaceId?: string): Filters {
        const ws = workspaceId !== undefined ? { workspace_id: workspaceId } : {};
        ...
      ```
    recommended_action: >
      Either (a) make the runtime path actually construct/consume `ScopedFilters`
      so the compiler enforces presence on the REST search/list/insert calls
      (honoring ADR D4), OR (b) downgrade ADR D4 + T1.1 in the plan/CHANGELOG to
      honestly state the guard is runtime-default (`?? 'default'`), not
      compile-time — removing the "compile error" claim. Current state ships a
      defense-in-depth default (not exploitable today) but contradicts the plan's
      headline anti-leak mechanism. Do not leave the plan claiming a compile-time
      guarantee the code does not provide (Inquebravel Rule 3).

  - id: F-arch-2
    severity: HIGH
    file: packages/api/src/server/handlers/admin-keys.ts
    line: 268
    plan_ref: T3.1 RED step ("ws-B admin cannot list ws-A keys (admin scoped to principal workspace)") + Coverage Matrix #16 ("admin keys scoped per workspace") + ADR D3
    summary: >
      Admin key-management handlers are NOT workspace-scoped, and the plan's
      admin-isolation assertion was silently dropped from the GOAL TEST. The 5
      `/v1/admin/keys/*` handlers (list/revoke/rotate/lineage/create) filter only
      by `subject` + `tenant_id='self'` — no `workspace_id` predicate. The plan
      T3.1 explicitly declared "ws-B admin cannot list ws-A keys" as a RED-step
      assertion and Coverage #16 as covered by `requireScope`/`scope-verifier.ts`,
      but `scope-verifier.ts` was NOT touched (no `workspace` reference) and
      `workspace-isolation.test.ts` contains 4 tests, none asserting admin-key
      cross-workspace isolation.
    evidence: |
      listKeysHandler (and revoke/rotate/lineage) carry no workspace filter:
      ```sql
      SELECT id, key_name, ... FROM theo_api_keys
       WHERE subject = $1 AND tenant_id = $2 AND revoked_at IS NULL
      ```
      git diff --stat shows scope-verifier.ts + admin-keys.ts UNCHANGED in the slice.
      Goal-test assertions present (4): recall-empty, create-from-binding,
      cross-ws forget 404, within-ws forget control — admin assertion absent.
    recommended_action: >
      Either (a) thread `workspace_id` into the admin-keys handlers + scope-verifier
      and add the dropped "ws-B admin cannot list ws-A keys" assertion to the goal
      test (closes Coverage #16 as the plan declared), OR (b) explicitly DEFER the
      admin-key-per-workspace scoping with an honest CHANGELOG/plan note (mirroring
      the T1.2 deferral) AND mark Coverage #16 as deferred — currently the plan
      claims #16 is covered while the code does not implement it. Note the bound
      blast radius: admin keys are issued with `tenant_id='self'`; the leak only
      materializes if two workspaces share a `subject`.

  - id: F-arch-3
    severity: MEDIUM
    file: packages/api/src/server/handlers/_body-parsing.ts
    line: 24
    plan_ref: ADR D3 ("workspace from Principal, NEVER the body") + ADR D7 (no-credential collapse)
    summary: >
      `workspaceBoundMemory` silently falls back to `DEFAULT_WORKSPACE_ID` when
      `c.get('principal')` is undefined. This is correct for the no-credential
      D7 collapse, but it also means that if the auth middleware is ever NOT
      mounted (misconfiguration / a future route bypassing `bearerAuth`), every
      request silently lands in the `default` workspace instead of failing
      closed. With multiple real workspaces configured, an unauthenticated path
      reaching a handler would read/write the `default` tenant — a fail-OPEN
      posture that conflicts with `architecture.md § 8` (fail-fast at boundaries).
    evidence: |
      ```ts
      export function workspaceBoundMemory(c: Context, memory: Memory): Memory {
        const principal = c.get('principal') as Principal | undefined;
        const workspaceId = principal?.workspaceId ?? DEFAULT_WORKSPACE_ID;  // fail-open
        return memory.withWorkspace !== undefined ? memory.withWorkspace(workspaceId) : memory;
      }
      ```
    recommended_action: >
      Acceptable as-is for the current always-mounted middleware, but add a guard
      or test asserting the handler is unreachable without the auth middleware
      (e.g. assert `principal` presence is an invariant, or log a structured
      warning when it is absent in a multi-workspace deployment). At minimum
      document that `workspaceBoundMemory`'s default-fallback assumes the auth
      middleware is always mounted ahead of it.

  - id: F-arch-4
    severity: MEDIUM
    file: packages/core/src/infrastructure/db/local-memory.ts
    line: 151
    plan_ref: T3.1 / EC-5 (cross-workspace forget → 404, other workspace row untouched)
    summary: >
      The cross-workspace forget guard reads the row's workspace from the
      DECODED payload (`existing.payload['workspace_id']`) with a `?? 'default'`
      fallback, rather than from the authoritative `workspace_id` COLUMN directly.
      It works because `rowToResult` projects the column into the payload, but it
      couples the security check to the payload-projection plumbing: if a future
      refactor stops projecting `workspace_id` into the payload (it is deleted
      from `cleanedPayload` on insert and only re-added on read), the guard
      silently defaults every row to `'default'` and the cross-workspace 404
      collapses. The isolation invariant should read the column, not a derived
      payload echo.
    evidence: |
      ```ts
      const rowWorkspace = (existing.payload['workspace_id'] as string | undefined) ?? 'default';
      if (rowWorkspace !== this.workspaceId) { throw new MemoryNotFound(...); }
      ```
      Coupling chain: pgvector-store.rowToResult re-injects workspace_id into
      payload (line ~66); if that projection regresses, the guard fails OPEN.
    recommended_action: >
      Prefer surfacing the row's `workspace_id` as a first-class field on
      VectorStoreResult (not via the payload bag) so the forget guard reads an
      authoritative value, OR add a regression test asserting the guard fails
      CLOSED (still 404s the cross-workspace row) — never defaults to a match —
      if workspace_id is absent from the payload.

  - id: F-arch-5
    severity: MEDIUM
    file: packages/core/src/infrastructure/db/pgvector-store.ts
    line: 428
    plan_ref: ADR D-LEAF / EC-12 (dedup key includes workspace_id) + Drawbacks "Recall-cache keyed without workspace"
    summary: >
      The `memories` dedup ON CONFLICT key now correctly leads with
      `workspace_id`, but the recall-cache / skill / eviction stores that share
      the same isolation requirement are DEFERRED (T1.2). The migration 0016
      adds `workspace_id` to `recall_cache` (column + index), yet the
      recall-cache store's `deriveScopeKey` does NOT yet include workspace — so
      the column exists but is not part of the cache key. This is disclosed
      honestly (CHANGELOG Known-limitation + README), but it leaves a schema in
      which a queryable leaf column is populated-but-unused, which is an easy
      future foot-gun (an operator enabling the opt-in cache in a multi-workspace
      deployment gets cross-tenant cache hits despite the column being present).
    evidence: |
      Migration adds: CREATE INDEX recall_cache_workspace_scope_idx ON recall_cache (workspace_id, scope_key)
      T1.2 deferral note: "their inserts/WHERE clauses do NOT route through
      composeFilters ... the recall-cache deriveScopeKey needs a workspace prefix"
      — i.e. column present, cache-key threading absent.
    recommended_action: >
      The deferral is honestly disclosed (good). To prevent the foot-gun, gate
      the opt-in cache/skill/eviction surfaces behind a runtime guard (or a loud
      startup warning) that REFUSES to enable them when a non-default workspace
      exists, until the follow-up `multi-tenant-workspace-isolation-secondary-stores`
      lands. A populated-but-unfiltered tenant column is more dangerous than an
      absent one because it looks safe.

  - id: F-arch-6
    severity: LOW
    file: packages/api/src/server/auth/middleware.ts
    line: 62
    plan_ref: ADR D7 (remove insecure auth-disabled override)
    summary: >
      The no-credential branch now sets the `default` Principal (good, closes the
      insecure pass-through), but the surrounding comment still reads
      "auth disabled — alpha mode" in the factory JSDoc above the function, and
      the variable is named `hoistedVerifier === null`. The behavior changed from
      pass-through to default-workspace-Principal, but the stale "auth disabled"
      vocabulary remains in the doc comment, which will mislead a future reader
      into thinking auth is bypassed.
    evidence: |
      JSDoc retained: "When `THEMEMORY_API_KEY` is `undefined` the middleware
      passes through (auth disabled — alpha mode)." — now inaccurate; the branch
      injects DEFAULT_PRINCIPAL and calls next().
    recommended_action: >
      Update the `bearerAuth` JSDoc to describe the D7 behavior (no credential →
      default-workspace Principal, not pass-through). Cosmetic but load-bearing
      for security comprehension.

  - id: F-arch-7
    severity: INFO
    file: packages/core/src/domain/principal.ts
    line: 22
    plan_ref: ADR D1 (workspace orthogonal, not a 4th tier) + architecture.md § 1 + § 3
    summary: >
      ADR D1 honored correctly. `Principal`/`Workspace` live in
      packages/core/src/domain (pure types, no I/O); the three-tier Scope union
      (UserScope/SessionScope/AgentScope/RepoScope) in scope.ts is UNCHANGED —
      workspace is added as an orthogonal `Filters.workspace_id` + a `Workspace`
      type, NOT a 5th `Scope` member. DIP direction holds: the resolving impls
      (ApiKeyAuthVerifier/BearerAuthVerifier) stay in packages/api/src/server/auth;
      no core→adapter import. The strategic-review obligation is discharged by
      the CLAUDE.md PRIORITY 0 Amendment 2026-06-17 (governance commit 0cf9104,
      verified present).
    evidence: |
      Scope union unchanged: `export type Scope = UserScope | SessionScope | AgentScope | RepoScope;`
      principal.ts imports nothing from infrastructure/; auth-verifier.ts imports
      only `type { Principal } from '../principal.js'`.
      governance commit: 0cf9104 chore(governance): re-classify ... in-scope under P0.
    recommended_action: No action — D1 + DIP are clean. Recorded as positive evidence.

  - id: F-arch-8
    severity: INFO
    file: packages/core/src/domain/dip/auth-verifier.ts
    line: 60
    plan_ref: ADR D2 (additive-then-breaking) + § 9 public surface
    summary: >
      ADR D2 sound. `resolvePrincipal?` is added as OPTIONAL on the AuthVerifier
      interface and `Memory.withWorkspace?` as OPTIONAL on the public Memory
      interface — both clean additive public-surface changes that keep the ~12
      AuthVerifier consumers and all Memory impls compiling without modification.
      `makeVerifyShim` provides the boolean default. Barrels updated, per-export
      JSDoc + @see added, exports-contract baseline bumped 41→43 with smoke
      coverage. The migration window is honestly documented and the final
      breaking removal is disclosed (CHANGELOG Deprecated + README breaking note).
    evidence: |
      `resolvePrincipal?(token: string): Promise<Principal | null>;` (optional)
      `withWorkspace?(workspaceId: string): Memory;` (optional)
      CHANGELOG § Deprecated: verify soft-deprecated; README pre-release breaking note.
    recommended_action: >
      No action on the architecture of D2. One forward caveat for /review wiring
      agent: the eventual Phase-4 removal of `verify` (promoting resolvePrincipal
      to required) is the real breaking step and is NOT in this slice — ensure it
      is tracked so the optional methods do not become permanent.

  - id: F-arch-9
    severity: INFO
    file: packages/core/src/infrastructure/db/migrations/0016_workspaces.sql
    line: 1
    plan_ref: ADR D5 (non-destructive single migration) + EC-3/6/7
    summary: >
      Migration 0016 is well-formed: idempotent (IF NOT EXISTS / ON CONFLICT DO
      NOTHING), seed-before-FK ordering correct, column default 'default' makes
      backfill metadata-only (no SET-NOT-NULL race), and the dedup unique index
      is dropped+recreated with workspace_id leading (EC-12). schema.ts parity
      kept (workspaces table + workspace_id on all 6 tables declared). One nuance:
      the migration relies on the PG column DEFAULT for backfill rather than an
      explicit UPDATE (the plan D5 step 4 described an explicit UPDATE) — this is
      a sound simplification (PG 11+ metadata default) but is a documented
      divergence from the plan's literal recipe.
    evidence: |
      `ADD COLUMN IF NOT EXISTS "workspace_id" text DEFAULT 'default' NOT NULL` on all 6 tables.
      Plan D5 step 4 said: "backfill unconditionally UPDATE <table> SET workspace_id='default'".
      Implemented via column DEFAULT instead — functionally equivalent, atomically safer.
    recommended_action: >
      No action required (the default-based backfill is superior). For the
      domain-db-migrations reviewer: confirm the migration is NOT wrapped in an
      explicit BEGIN/COMMIT in the file (D5/EC-3 claimed a single transaction) —
      runMigrations applies each statement-breakpoint segment; verify atomicity
      assumption holds under the project's migrate() runner.
---

# Architecture review — multi-tenant-workspace-isolation

## Verdict context

ADR D1 (workspace orthogonal, not a 4th tier), DIP boundaries, the additive-then-breaking
D2 evolution, and the non-destructive 0016 migration are all implemented correctly and
honestly. The strategic-review governance commit (0cf9104) and CLAUDE.md amendment exist.
The T1.2 secondary-store deferral is honestly disclosed in CHANGELOG + README.

Two HIGH findings prevent a clean architectural pass:

1. **F-arch-1** — the plan's headline anti-leak mechanism (ADR D4 "compile-time-required
   workspaceId" via `ScopedFilters`) is declared but UNUSED; the real guard is a runtime
   `?? 'default'` default. Not exploitable today (everything defaults safely) but the plan
   claims a compile-time guarantee the code does not provide.
2. **F-arch-2** — admin key-management handlers (`/v1/admin/keys/*`) are not workspace-scoped,
   and the plan's declared admin-isolation goal-test assertion (T3.1 RED + Coverage #16) was
   silently dropped. Either implement or honestly defer + re-mark Coverage #16.

Both are honesty/completeness gaps against the plan more than active security holes — the
runtime defaults safe — but they leave the plan's stated contract diverging from the code.

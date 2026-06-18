```yaml
agent: review-multi-tenant-workspace-isolation-domain-api-design
review_target: 23ce3d1~1..HEAD for plan multi-tenant-workspace-isolation
domain: api-design + security (IDOR / cross-workspace leak)
domain_specific_patterns_checked:
  - "D3: workspace from Principal (ctx) NEVER from body"
  - "D4: compile-time-required workspaceId (ScopedFilters)"
  - "EC-2: revoked/expired key verbatim predicate -> null -> 401"
  - "EC-4: body workspaceId rejected via .strict() -> 400"
  - "EC-5: forget cross-workspace -> 404 + other ws row untouched"
  - "EC-12: dedup unique index leads with workspace_id"
  - "composeFilters: workspace_id always composed when bound"
  - "D7: no-credential collapse to default-workspace Principal"
  - "reflect path (recallConsolidationCandidates + insertDerivedMemory) workspace threading"
  - "in-memory store parity (EC-9)"
  - "GOAL TEST proves the IDOR matrix"

findings:
  - id: F-dom-api-1
    severity: HIGH
    file: packages/core/src/infrastructure/db/pgvector-store.ts
    line: 787-826
    plan_ref: ADR D-LEAF (every directly-queried path workspace-filtered) + Drawbacks "Silent leak if any store path skips workspace_id = Critical" + Q3 (thread workspace now to avoid half-isolated system)
    domain_anchor: CLAUDE.md Princípio 3 (auditable) + plan Goal (cross-workspace access impossible)
    summary: >
      recallConsolidationCandidates() — the SQL the reflect({conflictResolution})
      consolidation path uses to pull candidate rows for LLM merge — filters by
      user_id / session_id / agent_id ONLY. It does NOT add a workspace_id clause,
      even though the bound filters carry workspace_id. A reflect() in workspace
      ws-A on a user shared by ws-A and ws-B pulls BOTH workspaces' extracted rows
      into the same consolidation cluster, then persistConsolidations() can
      soft-delete (t_invalid=NOW()) a ws-B row as "rejected". This is a
      cross-workspace READ leak (ws-B text enters the ws-A LLM prompt) AND a
      destructive cross-workspace write (ws-B row tombstoned). It bypasses the
      composeFilters workspace clause because it builds its own WHERE.
    evidence: |
      ```ts
      const where: string[] = [
        "kind = 'extracted'",
        't_invalid IS NULL',
        '(t_valid IS NULL OR t_valid <= NOW())',
      ];
      const params: unknown[] = [];
      if (filters.user_id !== undefined) { ... where.push(`user_id = $...`); }
      if (filters.session_id !== undefined) { ... }
      if (filters.agent_id !== undefined) { ... }
      // NO `if (filters.workspace_id !== undefined)` clause.
      ```
      Bound filters DO carry workspace_id (filtersFromScope merges it), but this
      method drops it on the floor. The persistConsolidations UPDATE
      (`UPDATE memories SET t_invalid = NOW() WHERE id = ANY($1::uuid[])`) is also
      not workspace-scoped, so a rejected cross-workspace id is tombstoned.
    recommended_action: >
      Add `if (filters.workspace_id !== undefined) { params.push(filters.workspace_id);
      where.push(`workspace_id = $${params.length}`); }` to recallConsolidationCandidates,
      mirroring the user_id branch. Add an integration assertion: reflect in ws-A
      with a user shared across ws-A/ws-B does NOT consolidate or tombstone any
      ws-B row. Note: T1.2 deferral covers cache/skill/eviction but NOT the
      reflect-on-memories consolidation path, which runs on the PRIMARY memories
      table and is therefore in-scope for this slice.

  - id: F-dom-api-2
    severity: HIGH
    file: packages/core/src/infrastructure/db/reflect-orchestrator.ts
    line: 203-213
    plan_ref: ADR D-LEAF + Drawbacks (silent leak if store path skips workspace_id) + Q3
    domain_anchor: plan Goal (every datum belongs to exactly one workspace)
    summary: >
      Reflect-derived memories are written with the WRONG workspace. The reflect
      orchestrator computes `scopeToCounterTuple(scope)` which yields only
      `{ userId, sessionId, agentId }` — NO workspaceId — and passes it as the
      `scope` to insertDerivedMemory(). insertDerivedMemory then defaults
      `args.scope.workspaceId ?? 'default'` to 'default'. So a reflect() in a
      ws-A-bound memory persists its derived/consolidated memories into the
      'default' workspace, not ws-A. The provenance is mis-tenanted: a ws-A
      consolidation surfaces in the 'default' workspace's recall, and ws-A loses
      its own derived rows.
    evidence: |
      ```ts
      // reflect-orchestrator.ts
      const counterTuple = scopeToCounterTuple(scope); // {userId,sessionId,agentId} only
      const id = await storeWithDerived.insertDerivedMemory({ ..., scope: counterTuple });
      // scopeToCounterTuple has no workspace dimension (Scope union has no workspaceId).
      // pgvector-store.insertDerivedMemory:719 -> args.scope.workspaceId ?? 'default'
      ```
      The bound `filters.workspace_id` is available in the orchestrator deps
      (`deps.filters`) but is never threaded into the insertDerivedMemory scope.
    recommended_action: >
      Thread the bound workspace_id from `deps.filters.workspace_id` into the
      insertDerivedMemory scope (e.g. `scope: { ...counterTuple,
      workspaceId: filters.workspace_id }`). Add an assertion: a ws-A reflect's
      derived rows carry workspace_id = 'ws-a'. Pairs with F-dom-api-1 (same
      reflect path).

  - id: F-dom-api-3
    severity: HIGH
    file: packages/core/src/domain/scope.ts
    line: 174-182
    plan_ref: ADR D4 (compile-time-required workspaceId) + Coverage Matrix #6 + T1.1 AC "typecheck: a REST-path call without workspaceId is a compile error"
    domain_anchor: plan D4 Rationale ("turns 'forgot the workspace' into a TypeScript compile error")
    summary: >
      The D4 compile-time guard is DEAD CODE. `ScopedFilters` (Filters &
      { workspace_id: string }) is defined but referenced by NOTHING outside a
      JSDoc comment and the type's own definition — no handler, store signature,
      or composeFilters parameter is typed as ScopedFilters. The REST path builds
      its scope through `workspaceBoundMemory()` + `resolveScope()` returning a
      plain `Memory`/`ScopedMemory`; `filtersFromScope` returns a plain `Filters`
      with `workspace_id?` OPTIONAL. So "forgot the workspace" is NOT a compile
      error — it silently produces an unscoped (cross-workspace) query, exactly
      the hole D4 existed to close. The plan's headline anti-leak invariant is
      unimplemented; isolation rests entirely on the runtime `workspaceBoundMemory`
      default-fallback instead.
    evidence: |
      ```
      grep -rn "ScopedFilters" packages/ tests/ --include="*.ts" | grep -v "\.test\."
      -> only scope.ts (definition) + a JSDoc mention in pgvector-store.ts:181
         "the REST path always supplies it via ScopedFilters" — but it does NOT.
      ```
      composeFilters(filters: Filters | undefined, ...) — still optional.
      withWorkspace?(): Memory — OPTIONAL on the interface; workspaceBoundMemory
      returns `memory` UNCHANGED when withWorkspace === undefined.
    recommended_action: >
      Either (a) genuinely wire ScopedFilters onto the REST-facing scope-building
      path so omitting workspaceId is a compile error (the plan's stated design),
      OR (b) honestly downgrade D4 in the plan + CHANGELOG to "runtime-bound
      workspace via workspaceBoundMemory, compile guard deferred" and add a
      runtime assertion that the REST path NEVER calls the store with an
      undefined workspace. Do not leave the plan claiming a compile-time guarantee
      that the type system does not enforce (Inquebrável Rule 3).

  - id: F-dom-api-4
    severity: HIGH
    file: tests/integration/auth/workspace-isolation.test.ts
    line: 41-126
    plan_ref: THE GOAL TEST (T3.1) — "create derives workspace from principal; a body workspaceId field -> 400 (EC-4); ws-B admin cannot list ws-A keys; middleware injects Principal"
    domain_anchor: plan Goal Test spec + EC-4 + D3 (workspace from Principal not body) + admin-per-workspace
    summary: >
      THE GOAL TEST proves isolation only through the SDK `base.withWorkspace('ws-a')`
      seam — it NEVER exercises the HTTP request path (middleware -> Principal ->
      handler -> workspaceBoundMemory). Consequently it does NOT prove the three
      security properties that live in the HTTP layer and are the actual IDOR
      surface: (1) a forged body `workspaceId` is rejected/ignored (EC-4 / D3) —
      no test posts a body with workspaceId; (2) the middleware injects the right
      Principal so a ws-B credential cannot read ws-A (the Principal resolution
      is only unit-tested for resolvePrincipal in isolation, never end-to-end
      through a handler); (3) admin keys are scoped per workspace (the plan's
      "ws-B admin cannot list ws-A keys" assertion is entirely absent). The test
      validates the store seam, not the credential->workspace IDOR matrix the
      plan promised.
    evidence: |
      The test calls `base.withWorkspace!('ws-a')` directly (SDK). There is no
      `app.request('/v1/recall', { headers: { Authorization: 'Bearer ...' },
      body: JSON.stringify({ ..., workspaceId: 'ws-a' }) })` anywhere. The
      `!` non-null assertion on withWorkspace also silently bypasses the OPTIONAL
      interface method (F-dom-api-3). EC-4's promised 400-on-body-workspaceId and
      the admin-per-workspace assertion (Coverage Matrix #16) have zero coverage.
    recommended_action: >
      Add HTTP-level goal-test cases via the Hono app + bearerAuth middleware with
      two seeded theo_api_keys (one per workspace): (a) ws-B Bearer recall of a
      ws-A user -> empty; (b) POST body containing `workspaceId: 'ws-a'` under a
      ws-B key -> 400 unrecognized_keys (proves .strict() + D3); (c) ws-B forget
      of a ws-A id -> 404; (d) ws-B admin list -> only ws-B keys. Without these
      the IDOR matrix is asserted at the wrong boundary.

  - id: F-dom-api-5
    severity: MEDIUM
    file: packages/api/src/server/handlers/_body-parsing.ts
    line: 29-33
    plan_ref: ADR D7 (no-credential -> default-workspace Principal) + D4 (no silent unscoped query)
    domain_anchor: plan Drawbacks (silent leak if a path skips workspace_id)
    summary: >
      workspaceBoundMemory silently falls back to DEFAULT_WORKSPACE_ID whenever
      `c.get('principal')` is undefined OR `memory.withWorkspace` is undefined.
      In production the middleware always sets a Principal, but this double
      fallback means a future wiring regression (handler mounted without the auth
      middleware, or a Memory impl lacking withWorkspace) degrades SILENTLY to
      the 'default' workspace instead of failing closed. For a security boundary,
      a missing Principal on a handler that should be authenticated should be a
      500/401 (fail-closed), not a silent collapse to 'default' that could merge
      a real tenant's writes into the default workspace.
    evidence: |
      ```ts
      const principal = c.get('principal') as Principal | undefined;
      const workspaceId = principal?.workspaceId ?? DEFAULT_WORKSPACE_ID;
      return memory.withWorkspace !== undefined ? memory.withWorkspace(workspaceId) : memory;
      ```
      Two silent fallbacks on a security path. The `?? DEFAULT_WORKSPACE_ID` masks
      a missing-middleware misconfiguration.
    recommended_action: >
      Keep the no-credential default-Principal at the MIDDLEWARE (D7), but in the
      handler treat an ABSENT principal as a programmer/wiring error
      (assert/throw 500) rather than collapsing to 'default'. The default-workspace
      decision belongs in middleware (where "no credential configured" is known),
      not in a per-handler `?? DEFAULT_WORKSPACE_ID` that cannot distinguish
      "intentionally keyless" from "middleware not mounted".

  - id: F-dom-api-6
    severity: MEDIUM
    file: packages/core/src/infrastructure/db/in-memory-store.ts
    line: 108-130
    plan_ref: EC-9 (in-memory store parity) + T1.1 AC "in-memory-store applies the SAME workspace_id filter so contract tests cannot pass while integration leaks"
    domain_anchor: plan EC-9
    summary: >
      The in-memory store's matchesFilters generic loop DOES filter by
      workspace_id when it is present in BOTH the filters AND the row payload
      (line 86-96). But the in-memory insert (line 121) stores the payload
      verbatim WITHOUT hoisting/guaranteeing a workspace_id, and unlike the
      pgvector path there is no DEFAULT 'default'. So an in-memory row written
      WITHOUT a workspace_id in its payload (any unbound SDK/unit caller) will
      MATCH a workspace-scoped query for ANY workspace? No — it is excluded
      (payload['workspace_id'] is undefined !== 'ws-a'). The real divergence is
      the inverse: in-memory does NOT default-fill workspace_id to 'default' on
      insert, so an unbound write is invisible to a 'default'-scoped read, whereas
      pgvector defaults it to 'default' and IS visible. Contract tests and
      integration tests therefore have DIFFERENT default-workspace semantics —
      exactly the EC-9 divergence the AC warned against.
    evidence: |
      pgvector insertBatch: `const workspaceId = (payload['workspace_id'] ...) ?? 'default'`
      in-memory insert: `this.rows.set(id, { vector, payload, ... })` — no default fill.
      EC-9 AC: "If in-memory defaults every row to the default workspace, document
      that explicitly." Neither the default-fill NOR the documentation is present.
    recommended_action: >
      Either default-fill workspace_id='default' in in-memory insert to match
      pgvector (preferred — keeps contract/integration semantics identical), OR
      add the explicit EC-9 divergence note + a contract test asserting the
      chosen behavior. Add a `test_in_memory_store_workspace_filter` per the
      plan's EC-9 SHOULD-TEST.

  - id: F-dom-api-7
    severity: LOW
    file: packages/core/src/infrastructure/db/pgvector-store.ts
    line: 530-549
    plan_ref: ADR D-LEAF (every directly-queried path)
    domain_anchor: plan Goal (no cross-workspace mutation)
    summary: >
      recordAccess() issues `UPDATE memories SET access_count = access_count + 1,
      last_accessed_at = NOW() WHERE id IN (SELECT DISTINCT unnest($1::uuid[]))`
      with NO workspace_id clause. This is low-severity because the ids it bumps
      come from the just-returned (already workspace-filtered) search results, so
      it cannot touch a foreign-workspace row in practice. Flagged for
      defense-in-depth: it is a memories-table write with no tenant clause, and a
      future refactor that feeds it ids from elsewhere would silently cross
      tenants. Belt-and-suspenders only.
    evidence: |
      The `ids` arg is `mapped.map((r) => r.id)` from the workspace-scoped search,
      so today it is safe. The UPDATE itself carries no tenant guard.
    recommended_action: >
      Optional: add `AND workspace_id = $2` when a bound workspace is available,
      or document that recordAccess relies on caller-provided workspace-scoped
      ids. Not a blocker.

verified_correct:
  - "EC-2 verbatim predicate: SELECT_PRINCIPAL_BY_HASH_SQL WHERE clause is BYTE-IDENTICAL to SELECT_ACTIVE_BY_HASH_SQL (revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()) AND tenant_id = 'self'). A revoked/expired key resolves to no row -> null Principal -> 401. CORRECT."
  - "EC-4 .strict(): RememberBody/RecallBody/ReflectBody/ForgetBody all .strict() — a body workspaceId WOULD 400 unrecognized_keys. Schema CORRECT (but untested at HTTP layer — see F-dom-api-4)."
  - "EC-5 forget cross-workspace: local-memory.ts:155-162 compares projected payload workspace_id to bound workspaceId, throws MemoryNotFound (-> 404 in forget.ts:42-43, NOT 403) without soft-deleting; get() projection includes workspace_id (pgvector-store.ts:580). Goal test asserts ws-A row stays t_invalid IS NULL. CORRECT."
  - "EC-12 dedup index: ON CONFLICT (workspace_id, hash, COALESCE(user_id,''), ...) leads with workspace_id; migration 0016 DROPs+RECREATEs memories_hash_scope_unique_idx with workspace_id leading. Same fact in two workspaces = two rows. CORRECT."
  - "composeFilters (pgvector-store.ts:182): workspace_id composed FIRST in the scope loop; present whenever filters.workspace_id is set. search/keywordSearch/list all route through composeFilters. The 4-verb primary path is workspace-filtered when bound. CORRECT for the primary path."
  - "D7 no-credential collapse: middleware.ts:63-71 sets DEFAULT_PRINCIPAL (default workspace) instead of pass-through. The insecure auth-disabled mode is removed. CORRECT (but see F-dom-api-5 for the handler-side fallback)."
  - "Migration 0016: DEFAULT 'default' NOT NULL avoids the plan's backfill-then-NOT-NULL race entirely (a cleaner solution than the D5 multi-step recipe); ON CONFLICT DO NOTHING idempotent seed (EC-6/EC-7); FK after seed. Not wrapped in explicit BEGIN/COMMIT but drizzle runMigrations wraps each migration transactionally. ACCEPTABLE."

t1_2_deferral_assessment: >
  The T1.2 deferral of recall-cache / skill-store / eviction is ACCEPTABLE as a
  security matter ONLY for those three opt-in surfaces: they are gated behind
  createLocalMemory({ recallCache }) / Memory.skills(repoId) / paused eviction,
  and the column default 'default' means a single-workspace deployment has no
  leak. The documented caveat (multi-workspace requires the follow-up before the
  opt-in surfaces are workspace-safe) is honest. HOWEVER, the deferral does NOT
  cover the reflect()-on-memories consolidation path (F-dom-api-1 / F-dom-api-2),
  which runs on the PRIMARY memories table via the always-on reflect() verb and
  is therefore IN-SCOPE for this slice and currently leaks. The deferral wording
  must not be read as covering reflect consolidation.

summary:
  blocker: 0
  high: 4
  medium: 2
  low: 1
  most_important: >
    F-dom-api-1 + F-dom-api-2 (the reflect consolidation path) are the single
    most important security gap: recallConsolidationCandidates() and the
    insertDerivedMemory scope drop workspace_id on the PRIMARY memories table,
    so reflect({conflictResolution}) in ws-A can READ ws-B's extracted rows into
    the LLM merge prompt AND tombstone (t_invalid) a ws-B row — a cross-workspace
    read+destructive IDOR on an always-on verb that the T1.2 deferral does NOT
    cover. Closely paired: F-dom-api-3 (the D4 compile-time guard ScopedFilters
    is dead code — isolation rests on a runtime fallback, not the promised type
    guarantee) and F-dom-api-4 (THE GOAL TEST proves isolation only through the
    SDK seam, never the HTTP credential->Principal path, so the actual IDOR
    surface — forged body workspaceId, cross-workspace Bearer, admin-per-workspace
    — is untested).
```

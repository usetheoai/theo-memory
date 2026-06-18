agent: review-multi-tenant-workspace-isolation-wiring
review_target: 23ce3d1~1..HEAD for plan multi-tenant-workspace-isolation
plan: .claude/knowledge-base/plans/multi-tenant-workspace-isolation-plan.md
date: 2026-06-17

summary: |
  The PRIMARY workspace-isolation chain is genuinely wired END-TO-END, not orphaned.
  Verified the full trace for the 4-verb REST path:

    workspaceBoundMemory(c, memory)            [_body-parsing.ts:29]   ← called by ALL 5
      → memory.withWorkspace(workspaceId)      [local-memory.ts:72]    scoped handlers
      → new LocalMemory(..., workspaceId)
      → filtersFromScope(scope, this.workspaceId) [scoped-memory.ts:83] merges workspace_id
      → this.filters.workspace_id
          ├─(recall) runRetrievalPipeline → store.search → composeFilters [pgvector-store.ts:182]
          │           emits `workspace_id = $` FIRST → WHERE clause. Isolation at the query layer. ✔
          └─(remember) runExtractionPipeline → buildPayload [extraction/pipeline.ts:71]
                      writes payload['workspace_id'] → insertBatch hoist [pgvector-store.ts:372,405]
                      → workspace_id column + ON CONFLICT(workspace_id,...) [pgvector-store.ts:428-430]. ✔

  The 5 scoped handlers (remember/recall/reflect/forget/scopes) ALL call workspaceBoundMemory
  (grep-confirmed). The forget 404 chain is fully wired: rowToResult projects workspace_id
  [pgvector-store.ts:66-69] → LocalMemory.get returns it in metadata [local-memory.ts:220] →
  LocalMemory.forget compares this.workspaceId vs row workspace [local-memory.ts:155-162] →
  throws MemoryNotFound → forgetHandler maps → 404 [forget.ts:42-43]. The soft-delete is
  workspace-scoped so a cross-workspace forget never touches the other row (EC-5). ✔

  Middleware injects Principal on all 3 paths (no-cred default, valid token, 401-on-invalid)
  [middleware.ts:69,95-103]. ApiKeyAuthVerifier.resolvePrincipal SELECTs workspace_id+scopes
  [api-key-verifier.ts:65-66,116-140]. In-memory store parity holds: matchesFilters generic
  loop [in-memory-store.ts:86-96] includes workspace_id (not in the skip-list), and buildPayload
  writes it on the in-memory insert path too — EC-9 satisfied at the filter level. ✔

  `withWorkspace` is the genuine seam (NOT an orphan) — 5 production callers via workspaceBoundMemory.

  The wiring DEFECTS are: (1) a dead exported error class, (2) an orphan type that makes the
  plan's headline D4 "compile-time-required workspaceId" anti-leak guard DECORATIVE (it gates
  nothing), and (3) an undisclosed MCP-path workspace bypass that contradicts the README's
  blanket "every query is scoped by workspace" claim.

triad_revalidation:
  total_new_symbols: 5   # Principal, Workspace, DEFAULT_WORKSPACE_ID, ScopedFilters, WorkspaceMismatch (+ withWorkspace method, resolvePrincipal method)
  pillar_a_honest_pass: 3 / 5   # withWorkspace/resolvePrincipal/DEFAULT_WORKSPACE_ID/Principal/Workspace have real callers; ScopedFilters + WorkspaceMismatch do NOT
  pillar_b_honest_pass: 5 / 5   # goal test workspace-isolation.test.ts exercises the real seam against pgvector
  pillar_c_observed: n/a        # this slice ships no new OTel metric (isolation is a correctness property; existing spans unchanged)

findings:
  - id: F-wire-1
    severity: MEDIUM
    file: packages/core/src/domain/errors.ts
    line: 368
    plan_ref: Coverage Matrix row 5 "WorkspaceMismatch typed error -> 404 (T0.1 + T3.1)"
    summary: >
      WorkspaceMismatch is exported from the public barrel but is NEVER thrown anywhere in
      production code — a dead public export. The cross-workspace 404 path throws MemoryNotFound
      (forget.ts:42 / local-memory.ts:158), not WorkspaceMismatch. The Coverage Matrix claims
      T3.1 wires WorkspaceMismatch -> 404; the implementation diverged to reuse MemoryNotFound.
    evidence: |
      grep 'new WorkspaceMismatch|throw.*WorkspaceMismatch' packages/ --include='*.ts'  → 0 hits.
      forget guard: local-memory.ts:158 throws `new MemoryNotFound(...cross-workspace forget -> 404...)`.
      WorkspaceMismatch is only: declared (errors.ts:368), re-exported (domain/index.ts:127),
      and absent from every contract/exports test (not in exports-contract.test.ts nor
      full-public-surface.test.ts — the export-statement count was unaffected because it joined
      an existing multi-symbol re-export line).
      `/code-quality` `dead_public_export` (cycle-code-quality.md severity rubric) would FAIL_HARD here.
    recommended_action: >
      Either (a) wire WorkspaceMismatch into the cross-workspace 404 path (throw it where
      local-memory.ts currently throws MemoryNotFound, and map it -> 404 in the forget handler),
      OR (b) remove the export + the Coverage Matrix row-5 claim if MemoryNotFound is the
      deliberate design (D6 says the row is "invisible" → 404 on miss, which semantically IS
      MemoryNotFound). Disclose the divergence honestly per Inquebrável Rule 3 either way.

  - id: F-wire-2
    severity: HIGH
    file: packages/core/src/domain/scope.ts
    line: 182
    plan_ref: ADR D4 "Compile-time-required workspaceId on the server scoping path" + AC T1.1 "typecheck a REST-path call without workspaceId is a compile error"
    summary: >
      `ScopedFilters = Filters & { readonly workspace_id: string }` is declared and referenced
      in 2 JSDoc comments but is NEVER used as a parameter/return type in any function signature.
      The plan's HEADLINE anti-leak mechanism (D4: "forgetting the workspace is a TypeScript
      COMPILE ERROR") is therefore DECORATIVE — it gates nothing. The actual threading uses an
      OPTIONAL `workspaceId?: string` on LocalMemory + `filtersFromScope(scope, workspaceId?)`,
      so a server path that forgets to call `withWorkspace` compiles fine and silently falls
      back to the 'default' workspace (store column DEFAULT 'default' + middleware DEFAULT_PRINCIPAL).
      The leak does not occur TODAY because workspaceBoundMemory always binds, but the compile-time
      guarantee the plan sold as the primary guard (D4: "the compiler guarantee trick") is not real.
    evidence: |
      grep ': ScopedFilters|<ScopedFilters>|as ScopedFilters' packages/ --include='*.ts' (non-comment) → 0 hits.
      ScopedFilters appears only at scope.ts:182 (decl) + pgvector-store.ts:181 (comment) + scope.ts:167 (comment).
      LocalMemory.workspaceId is `string | undefined` (local-memory.ts:62); withWorkspace returns Memory
      (not a workspace-required view type). composeFilters accepts `Filters | undefined` and skips
      workspace_id when absent (pgvector-store.ts:182-186) — `composeFilters(undefined)` STILL returns an
      UNSCOPED query, exactly the "silent-leak hole" D4 claimed to close.
    recommended_action: >
      Either (a) make the server scoping path actually consume ScopedFilters (typed handler →
      store signature requiring `workspace_id`), so the compile-time guard is real per D4; OR
      (b) downgrade the plan/ADR claim honestly: state that isolation is enforced by the
      runtime `withWorkspace` binding + the IDOR test matrix, NOT by a compile error, and remove
      the orphan type. The current state ships the type as security theater. Runtime isolation
      DOES hold (verified) — the issue is the false compile-time-guarantee claim.

  - id: F-wire-3
    severity: HIGH
    file: packages/mcp/src/tools/recall-handler.ts
    line: 40
    plan_ref: Unresolved Q2 "Does the MCP/CLI path need the Principal too? Default REST first; MCP/CLI inherit the env->default bridge"
    summary: >
      The MCP server path builds scoped memory and SKIPS the workspace binding entirely — no
      withWorkspace, no Principal. Every MCP remember/recall/forget lands in the 'default'
      workspace regardless of any per-key workspace. This matches the plan's Q2 deferral
      (REST-first), BUT the README's consumer-facing claim is BLANKET — "every API key resolves
      to a workspace ... every query is scoped by it" — which is REST-ONLY in reality. The MCP
      transport (a shipped, documented surface) is silently outside the isolation boundary.
    evidence: |
      grep 'withWorkspace|principal|Principal|workspace' packages/mcp/src/ → 0 hits.
      MCP handlers call memoryFactory().user(...)/forget(...) directly (recall-handler.ts:40,
      forget-handler.ts:63) — no workspace seam.
      README.md:155 (Security section) states unconditionally "every query is scoped by it";
      README.md:157 discloses ONLY the cache/skill/eviction deferral, NOT the MCP-path bypass.
      CHANGELOG [Unreleased] line 19 (Known limitation) also covers only cache/skill/eviction.
    recommended_action: >
      Disclose the MCP-path scoping deferral explicitly in the README Security section + the
      CHANGELOG Known-limitation block (mirror the cache/skill/eviction disclosure): MCP/CLI
      requests currently resolve to the 'default' workspace; multi-workspace isolation is
      REST-only this slice; do not expose the MCP server to multiple tenants until the
      follow-up binds the Principal. This is an honesty/disclosure gap (Inquebrável Rule 3),
      not a runtime regression for single-tenant MCP use.

  - id: F-wire-4
    severity: LOW
    file: packages/core/src/domain/extraction/pipeline.ts
    line: 83
    plan_ref: ADR D3 "workspace_id comes from the Principal, NEVER the request body"
    summary: >
      In buildPayload, the Principal-derived `workspace_id` is written FIRST (line 71-72) then
      the caller-supplied `metadata` is spread (line 83-86). If `metadata` contained a
      `workspace_id` key it would OVERRIDE the Principal's, contradicting D3's "never from the
      caller" invariant. Today this is unreachable from REST (the `.strict()` body schema rejects
      unknown keys → EC-4), but the SDK `RememberOptions.metadata` path has no such guard, so a
      direct SDK caller could smuggle a foreign workspace_id into a workspace-bound memory.
    evidence: |
      extraction/pipeline.ts:71-72 writes out['workspace_id']=filters.workspace_id;
      lines 83-86 then `for (const [k,v] of Object.entries(metadata)) out[k]=v;` — last-write-wins,
      metadata can clobber workspace_id. No test asserts metadata cannot override workspace_id.
    recommended_action: >
      Re-assert the Principal workspace_id AFTER the metadata spread (or delete metadata['workspace_id']
      before the loop, mirroring how the store insert delete-hoists scope columns). Add a unit
      assertion that `remember(text, { metadata: { workspace_id: 'forged' } })` on a ws-A-bound
      memory persists workspace_id='ws-a'. Defense-in-depth for the SDK path; REST is already guarded.

  - id: F-wire-5
    severity: LOW
    file: packages/core/src/infrastructure/db/local-memory.ts
    line: 208
    plan_ref: forget chain (get -> workspace compare) + D6 by-id 404
    summary: >
      LocalMemory.get() does NOT filter by workspace — it returns ANY row by id regardless of
      the bound workspace (it has no workspace guard; the guard lives only in forget). This is
      fine for the forget path (forget reads get() then compares + throws), but get() is ALSO a
      public method on the Memory contract; a workspace-bound caller doing memory.get(crossWsId)
      receives the other workspace's full payload. No REST GET-by-single-id handler exposes this
      today (scopes.ts lists via getAll which IS workspace-filtered), so it is not reachable from
      the API surface — but it is a latent cross-workspace read on the public SDK get().
    evidence: |
      local-memory.ts:208-224 get() calls vectorStore.get(memoryId) with NO workspace filter
      and returns the row unconditionally. The workspace comparison exists ONLY in forget
      (lines 155-162), which calls get() then guards. get() itself is unguarded.
    recommended_action: >
      When this.workspaceId is set, have get() return null for a row whose payload workspace_id
      mismatches (same guard forget uses), so the public get() honors the binding. Low severity:
      no API handler currently calls a workspace-bound get() by arbitrary id, but closing it
      removes a latent SDK-level cross-workspace read and keeps the contract consistent.

integration_with_existing_flows:
  rest_path: WIRED — entry (Hono route in app.ts) → bearerAuth middleware (Principal) → handler → workspaceBoundMemory → withWorkspace → store. Reachable + exercised by goal test.
  mcp_path: NOT WIRED for workspace (F-wire-3) — reachable entry, but bypasses the workspace seam (lands in default).
  in_memory_parity: WIRED — matchesFilters honors workspace_id generically (EC-9 holds at filter level).

dead_exports:
  - WorkspaceMismatch (F-wire-1) — exported, never thrown.
  - ScopedFilters (F-wire-2) — exported type, never used in a signature.

boundary_respect: OK — Principal/Workspace types live in packages/core/src/domain (no I/O); resolving impls in packages/api/src/server/auth. No cross-tier import violation observed in the diff.

concurrent_safety: OK — migration 0016 is single-transaction (D5/EC-3, out of wiring scope but noted); the ON CONFLICT(workspace_id,...) upsert is atomic; no new read-modify-write race introduced by the workspace threading.

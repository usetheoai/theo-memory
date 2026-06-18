---
agent: review-integration-suite-stabilization-domain-cli-tooling
review_target: bef52f7~1..HEAD for plan integration-suite-stabilization
domain: cli-tooling
domain_specific_patterns_checked:
  - "themory CLI verb surface (remember/recall/forget/reflect/mcp/server/migrate/health/keys) registered in packages/cli/src/cli.ts"
  - "Item 18 EAGER port-bind discipline (ADR D8 migrate-before-bind) in run-server.ts"
  - "fail-fast scope validation BEFORE Memory-factory warm-up (F-dom-cli-2)"
  - "stale-vs-regression honesty triage (D2) on each weakened assertion"
  - "README ↔ actual CLI/MCP surface consistency (P0 sub-goal 3)"
  - "CHANGELOG warm-up documentation discipline (Inquebravel Rule 6)"
  - "workspace-reorg path drift packages/cli → packages/agent-core"
findings:
  - id: F-dom-cli-1
    severity: INFO
    file: tests/integration/cli/verbs-cli-fixes.test.ts
    line: 132-170
    plan_ref: D2 — Bucket B stale-vs-regression triage; F-dom-cli-2
    domain_anchor: run-remember.ts:37-39 (validateScopeOpts BEFORE createAgentToolsMemory)
    summary: >
      test 3's switch from an ABSOLUTE 2000ms budget to a RELATIVE overhead
      assertion (overheadMs = fail.elapsedMs - `--help`.baseline < 1500ms) is a
      ROBUST and HONEST regression proof, not a blind weakening. Verified the
      product invariant it guards: `run-remember.ts:37` calls
      `validateScopeOpts(opts)` (which emits the `exactly one required` stderr)
      BEFORE `run-remember.ts:39` `createAgentToolsMemory()` (the ~2-5s
      embedder+LLM warm-up). `--help` dispatches through commander with NO verb
      handler (cli.ts) so it pays only node+commander+dotenv cold-start — the
      exact baseline. If a regression moved validation AFTER the factory, the
      fixed 2-5s warm-up would push overheadMs well past the 1500ms floor on any
      machine speed. The test ALSO still asserts `status === 2` AND
      `stderr matches /exactly one required/`, so a silent no-validation
      regression cannot false-pass. This is a better signal than the prior
      absolute budget (which false-failed at 3174ms in-suite per the comment).
    evidence: |
      run-remember.ts:
        37  validateScopeOpts(opts);                       // emits "exactly one required", exit 2
        39  const [memory, dispose] = await createAgentToolsMemory();  // ~2-5s warm-up
      test 3 asserts: status===2 AND /exactly one required/ AND (elapsed - helpBaseline) < 1500ms
    recommended_action: >
      None required. Optionally document that the 1500ms floor assumes the
      factory warm-up is >= 2000ms (its documented 2-5s lower bound) so a
      future embedder that warms in < 1500ms would not silently defeat the
      guard — but this is a theoretical edge, not a defect.

  - id: F-dom-cli-2
    severity: LOW
    file: tests/integration/cli-consolidated.test.ts
    line: 238-256
    plan_ref: D2 — flaky-timing fix; CLAUDE.md Item 18 (eager bind)
    domain_anchor: run-server.ts:118-129 (runMigrations) precedes :229 (serve/bind) precedes :233 (EADDRINUSE handler)
    summary: >
      The EADDRINUSE internal SIGKILL guard bumped 8000ms → 13000ms (test
      timeout 15000 → 20000) is LEGITIMATE accommodation of cold-start under
      suite load, NOT masking a slow-exit/hang regression — but the in-test
      comment claiming "eager bind ... EADDRINUSE-exit cycle" is slightly
      imprecise about the boot order and is worth a note. Actual order in
      run-server.ts: `runMigrations()` (line 119-129) runs BEFORE `serve()`
      binds the port (line 229) per ADR D8 migrate-before-bind; the
      `listener.on('error', EADDRINUSE → exit 1)` handler (line 233-242) only
      fires after the bind attempt. Because the spawned server now targets an
      isolated DB CLONED from the already-migrated `themem_template`,
      `runMigrations` on it is a near-no-op (all 15 migrations already applied),
      so the 13s headroom covers node + dotenvx env injection + bind attempt,
      not a slow migration. The guard is still BELOW the 20000ms test timeout,
      so a genuine HANG (no exit) is still caught as `code === null !== 1`. No
      hang/slow-exit regression is masked: the product correctly exits 1 on
      EADDRINUSE; the prior 8s guard SIGKILL'd a process that was already
      exiting 1 at ~8089ms in-suite.
    evidence: |
      run-server.ts boot order:
        119  if (!shouldSkipMigrations()) await runMigrations(pool, {embeddingDim: 384});  // before bind
        229  const listener = serve({ fetch: app.fetch, port, hostname: host }, ...);       // bind
        233  listener.on('error', err => { if (err.code==='EADDRINUSE') { ...; process.exit(1); }});
      Isolated DB is cloned from migrated themem_template → runMigrations ~no-op on the clone.
    recommended_action: >
      Acceptable as-is (timeout headroom is generous but safe — still < test
      timeout). Optional: tighten the comment to say "cold-start + dotenvx +
      near-no-op migrate + bind + EADDRINUSE-exit" so the boot order (migrate
      precedes bind per ADR D8) is not misread as a pure eager-bind path.

  - id: F-dom-cli-3
    severity: INFO
    file: tests/integration/cli/verbs-cli-fixes.test.ts
    line: 244-258
    plan_ref: D2 — stale-assertion triage (Inquebravel Rule 6)
    domain_anchor: CHANGELOG.md:5 ([Unreleased]) + :31 (warm-up under Changed) + :105 (released)
    summary: >
      test 8's relaxation from "warm-up caveat present INSIDE the [Unreleased]
      window" to "[Unreleased] header still exists AND warm-up documented
      ANYWHERE in CHANGELOG" is SOUND stale-assertion triage. Verified: the
      v0.3.0 release correctly moved the verbs-as-CLI warm-up entry out of
      [Unreleased] into the released section per Keep-a-Changelog discipline;
      the durable operator contract is "the warm-up cost is documented", not
      "pinned to [Unreleased] forever". CHANGELOG.md still carries [Unreleased]
      (line 5) and the warm-up phrasing appears at line 31 (current [Unreleased]
      § Changed) AND line 105 (released). The relaxed assertion still fails if
      BOTH the header is dropped OR the warm-up text disappears entirely, so it
      retains its guard value. Not a blind weakening.
    evidence: |
      CHANGELOG.md:5    ## [Unreleased]
      CHANGELOG.md:31   - **CLI/MCP warm-up cost documented** ... ~2-5s cold-start ...
      CHANGELOG.md:105  - **CLI cold-start cost** ... ~2-5s warm-up ...
    recommended_action: None required.

  - id: F-dom-cli-4
    severity: INFO
    file: tests/integration/p0-audit/run-server-stub-removal.test.ts
    line: 32-68
    plan_ref: D2 — reorg-path triage (packages/cli → packages/agent-core)
    domain_anchor: run-server.ts:38 imports from @usetheo/memory-agent-core; agent-tools-memory.ts now at packages/agent-core/src
    summary: >
      Two correct stale-path + stale-shape fixes. (a) AGENT_TOOLS_MEMORY_PATH
      retargeted packages/cli → packages/agent-core — matches the actual reorg
      (complete-workspace-publish-topology T4 / ADR D3 extracted the shared
      helper to the agent-core leaf; run-server.ts:38 imports from
      @usetheo/memory-agent-core). (b) tests 3/4 relaxed from `import\b.*\bSymbol\b`
      to plain `\bSymbol\b` because the import became a LAZY dynamic
      `await Promise.all([import('@usetheo/memory/embedders/local')])`, so the
      symbol and the `import(` keyword land on different lines. The relaxed
      regex still proves the symbol is referenced in the single-source-of-truth
      file; this is honest reorg-drift triage, not a weakening of intent.
    evidence: |
      run-server.ts:36-38  import { ..., wireMemoryFromPool } from '@usetheo/memory-agent-core';
      agent-tools-memory.ts lazy dynamic import splits LocalTransformerEmbedder symbol from import( keyword.
    recommended_action: None required.

  - id: F-dom-cli-5
    severity: INFO
    file: tests/integration/p0-audit/exports-root.test.ts
    line: 87-96
    plan_ref: D2 — reorg baseline (root barrel 8 → 9 exports)
    domain_anchor: complete-workspace-publish-topology unmasked decision — root barrel ships 9 vs T0.1 baseline 8 (API-owner decision)
    summary: >
      test 1 baseline raised 8 → 9 root export statements. This is the
      API-owner-accepted root-barrel widening already documented in CLAUDE.md
      (§ Hardening candidates — "root barrel ships 9 exports vs T0.1 baseline 8
      — API-owner decision") and cross-referenced to full-public-surface.test.ts
      9-export baseline. Consistent with the rest of the suite. NOTE the loop
      below (`for (let i = 0; i < 8; i++)`) still iterates only the first 8
      blocks for JSDoc/@see checks — the 9th export's JSDoc is not asserted by
      this loop. Minor coverage gap, not a regression.
    evidence: |
      exports-root.test.ts:90  expect(blocks.length).toBe(9);
      exports-root.test.ts:93  for (let i = 0; i < 8; i++) {   // 9th block JSDoc not exercised
    recommended_action: >
      Optional follow-up: extend the JSDoc/@see loop bound to blocks.length so
      the 9th export's documentation is also exercised (P0 sub-goal 1 — all
      public exports JSDoc'd). Not blocking for this plan's scope.

  - id: F-dom-cli-6
    severity: INFO
    file: tests/integration/docker-compose-prod.test.ts
    line: 55-60
    plan_ref: D2 — reorg triage (default registry GHCR → Docker Hub)
    domain_anchor: docker-compose.prod.yaml:36 image default `usetheo/themory:${VERSION:-0.2.0}`; README.md docker section
    summary: >
      test 43 relaxed the resolved-image regex from `ghcr\.io/usetheo/themory:`
      to `usetheo/themory:` because the compose default flipped to Docker Hub
      (`${THEMORY_IMAGE:-usetheo/themory:0.2.0}` at docker-compose.prod.yaml:36),
      with GHCR documented as the alternative. Verified the product matches the
      test AND the README: README docker run example uses `usetheo/themory:0.2.0`
      and notes "Also available from GHCR: docker pull ghcr.io/usetheo/themory:0.2.0".
      The relaxed regex `usetheo/themory:\S+` still matches the GHCR form
      (substring), so it does not falsely reject either registry — honest triage.
    evidence: |
      docker-compose.prod.yaml:36  image: ${THEMORY_IMAGE:-usetheo/themory:${VERSION:-0.2.0}}
      README.md (docker)           docker run ... usetheo/themory:0.2.0 ; "Also available from GHCR"
    recommended_action: None required.

  - id: F-dom-cli-7
    severity: INFO
    file: tests/integration/dogfood/claude-code-bridge-roundtrip.test.ts
    line: 22-33
    plan_ref: D3 — LLM-gated tests skip cleanly without a key
    domain_anchor: adapters-or-local-e2e-smoke.test.ts:44 exemplar (gate on OPENROUTER_KEY === '')
    summary: >
      Correct Bucket C fix. The describe now additionally gates on HAS_LLM_KEY
      (OPENROUTER_KEY ?? OPENROUTER_API_KEY) because the spawned `themory mcp`
      boots OpenAILLM and performs a LIVE extraction call — a keyless run would
      401-fail. Mirrors the established `describe.skipIf` convention (D3) and the
      OPENROUTER_KEY exemplar. Behavior preserved under a key; clean skip
      without. Honest skip-vs-fail, no assertion weakened.
    evidence: |
      HAS_LLM_KEY = (OPENROUTER_KEY ?? OPENROUTER_API_KEY ?? '') !== '';
      describe.skipIf(ROOT_PG_URI==='' || !existsSync(CLI_PATH) || !HAS_LLM_KEY)
    recommended_action: None required.

  - id: F-dom-cli-8
    severity: LOW
    file: tests/integration/p0-audit-fixes/post-install-bin.test.ts
    line: 103-117
    plan_ref: D2 — stale-vs-regression triage; CLAUDE.md complete-workspace-publish-topology ADR D1-a/D2-a
    domain_anchor: published package is packages/core (src-only files allow-list); CLI ships via Docker not npm
    summary: >
      Whole `describe` switched from `describe.skipIf(...)` to `describe.skip(...)`
      with a rationale: the sentinel asserted the pre-reorg single-package model
      (npm tarball ships dist CLI + dist/local/migrations) but post-reorg the
      published package is packages/core (src-only, no dist) and the CLI ships
      via Docker (ADR D1-a src-only + D2-a no-npm-bin). The rationale is honest
      and aligns with CLAUDE.md's documented unmasked decisions. HOWEVER:
      (1) the plan's own § "If Validation Fails" + Global DoD require that
      pre-existing out-of-scope skips be LOGGED in the PR description, not just
      a code comment — confirm that disclosure exists. (2) The skip removes the
      regression guard that the CLI/migrations actually reach a consumer; per
      the comment the production migrate path is now covered only by
      dim-change.test.ts + the dist-boot fix — verify those genuinely cover the
      post-install consumer path (they exercise migrations against an isolated
      DB, but NOT the published-tarball-resolution path the skipped test owned).
      A permanently-skipped sentinel is invisible technical debt
      (rules/testing.md anti-pattern) unless a tracking follow-up exists.
    evidence: |
      - describe.skipIf(!DIST_EXISTS || !NPM_AVAILABLE || !TAR_AVAILABLE)(
      + describe.skip(  // pre-reorg single-package model obsolete; CLI via Docker, not npm
    recommended_action: >
      Confirm the publish-topology follow-up (complete-workspace-publish-topology)
      tracks restoring an equivalent pack-contract sentinel for the NEW
      packages/core publish shape (so the post-install consumer path is not left
      permanently unguarded), and that the PR description logs this skip per the
      plan's "pre-existing out-of-scope issues are logged in the PR description"
      DoD. No product regression — but a guard was retired without a documented
      replacement.

  - id: F-dom-cli-9
    severity: INFO
    file: tests/integration/agent-tools/env-driven-transport-selection.test.ts
    line: 47-55
    plan_ref: D2 — reorg-path triage
    domain_anchor: vi.mock target packages/cli/src → packages/agent-core/src (helper extracted to agent-core leaf)
    summary: >
      vi.mock + importActual targets retargeted packages/cli/src/agent-tools-memory.js
      → packages/agent-core/src/agent-tools-memory.js, matching the reorg that
      moved wireMemoryFromPool to the agent-core leaf. The mocked symbol
      (wireMemoryFromPool) is the same; only the module path changed. Correct
      mechanical reorg fix; transport-selection behavior assertions unchanged.
    evidence: |
      - vi.mock('../../../packages/cli/src/agent-tools-memory.js', ...)
      + vi.mock('../../../packages/agent-core/src/agent-tools-memory.js', ...)
    recommended_action: None required.

  - id: F-dom-cli-10
    severity: INFO
    file: README.md
    line: 152-230
    plan_ref: D2 — README P0 operational restore (commit 2b9958c); P0 sub-goal 3
    domain_anchor: cli.ts:151-386 (all verbs registered); .mcp.json.example present; docker-compose.prod.yaml:36
    summary: >
      The restored README P0 sections are CONSISTENT with the actual surface the
      tests assert. Verified: (a) "## Agent loops via MCP" references
      .mcp.json.example which EXISTS at repo root; tools list (remember/recall/
      forget/reflect) + transports (stdio default, streamable-HTTP when
      THEMEMORY_API_KEY set) match the MCP server. (b) OPENAI_BASE_URL /
      OpenRouter note matches run-server.ts:132 provider wiring. (c) Docker
      `--entrypoint /nodejs/bin/node ... cli.js migrate` override matches the
      shell-less distroless image + cli.ts migrate verb. (d) "## CLI verbs"
      lists remember/recall/forget/reflect — all four ARE registered in
      cli.ts:296/324/367/386, and the keys/mcp/server/migrate/health verbs in
      the "## CLI" block match cli.ts:151-296. (e) Default image usetheo/themory:0.2.0
      matches docker-compose default + test 43. No drift between README and the
      asserted CLI/MCP surface.
    evidence: |
      cli.ts: .command('mcp'|'server'|'migrate'|'health'|'keys'|'remember'|'recall'|'forget'|'reflect')
      .mcp.json.example present (991 bytes)
      docker-compose.prod.yaml:36 image default usetheo/themory:0.2.0
    recommended_action: None required.
---

# Domain Review — cli-tooling for integration-suite-stabilization

## Summary

Reviewed the CLI/server-test surface of the `integration-suite-stabilization`
diff (`bef52f7~1..HEAD`). The two headline timing concerns and every weakened
assertion check out as **honest stale-vs-regression triage** (plan D2/D3), not
blind greening. No BLOCKER, no HIGH.

### Verdict on the two timing questions posed

1. **test 3 (relative overhead vs `--help` baseline)** — ROBUST and honest. The
   product invariant it guards (`validateScopeOpts` runs BEFORE the ~2-5s
   `createAgentToolsMemory` warm-up, `run-remember.ts:37` vs `:39`) is real;
   `--help` is a clean cold-start baseline; and the test still asserts
   `status===2` + `/exactly one required/`, so a no-validation regression cannot
   false-pass. Better signal than the prior brittle absolute 2000ms budget.

2. **test 40 (EADDRINUSE 8s→13s guard)** — legitimately accommodates cold-start
   under suite load, does NOT mask a slow-exit/hang. Boot order in
   `run-server.ts` is migrate (no-op on the clone) → bind → EADDRINUSE-exit-1;
   the 13s guard is still below the 20s test timeout so a genuine hang is caught
   as `code===null !== 1`. Only nit: the in-test comment slightly mischaracterizes
   the order as a pure eager-bind path (migrations precede bind per ADR D8).

### Most important finding

**F-dom-cli-8 (LOW)** — `post-install-bin.test.ts` was switched to a permanent
`describe.skip`. The rationale (pre-reorg npm-tarball model obsolete; CLI ships
via Docker) is honest and matches CLAUDE.md's documented decisions, but it
**retires a consumer-path regression guard without a documented replacement**.
Recommend confirming (a) the PR description logs this out-of-scope skip per the
plan's Global DoD, and (b) the publish-topology follow-up tracks an equivalent
pack-contract sentinel for the new `packages/core` publish shape — otherwise the
post-install consumer path is left permanently unguarded (rules/testing.md
"permanently-skipped test = invisible debt").

### Counts

| Severity | Count |
|---|---|
| BLOCKER | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 2 (F-dom-cli-2, F-dom-cli-8) |
| INFO | 8 |

README ↔ CLI/MCP surface: **consistent** (F-dom-cli-10). All four verbs +
mcp/server/migrate/health/keys registered; `.mcp.json.example` present; default
Docker image matches compose + test.

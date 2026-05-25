# Deps Audit: v0-3-agent-tools-mcp

**Date:** 2026-05-24
**Mode:** plan-bound (`.claude/knowledge-base/plans/v0-3-agent-tools-mcp-plan.md` v1.1)
**Verdict:** **PASS_WITH_CAVEATS** (cap 89)
**Hard caps triggered:** `plan_dep_low_cve` × 4 (after active allowlist downgrade from MODERATE → LOW)

## Summary

- **Ecosystems detected:** npm (sole — no Python/Rust/Go manifests in theo-memory)
- **Total deps audited:**
  - 3 runtime deps (drizzle-orm, pg, zod) per current `package.json`
  - 2 NEW deps to be added per plan v1.1 D7 (@modelcontextprotocol/sdk, zod-to-json-schema)
  - 1 CHANGED dep version (zod ^3.24.0 → ^3.25.0)
  - ~30+ devDeps (vitest, eslint, typescript, drizzle-kit, etc.)
- **Vulnerabilities found:** 0 CRITICAL, 0 HIGH, 4 MODERATE (all allowlist-active), 0 LOW (after downgrade: 4)
- **Outdated:** 4 (3 devDep MAJOR not in plan scope; 1 runtime MAJOR zod 3→4 with implicit pinning per plan v1.1 D7)
- **Allowlist hits:** 4 active (all 4 MODERATE), 0 expired
- **Auditor coverage:**
  - `npm audit`: ran ✓
  - `npm outdated`: ran ✓
  - `osv-scanner`: NOT installed → fallback via direct OSV API queries (curl) for NEW deps. Cross-check gap acknowledged but closed.
  - `npm view` registry checks: ran ✓ (verified existence of @modelcontextprotocol/sdk@1.29.0 + zod-to-json-schema@3.0.0+)

## Vulnerabilities (sorted by severity)

### GHSA-67mh-4wv8-2f99 — MODERATE → LOW (after allowlist downgrade)

**Affected packages (4 entries, same root cause — chained transitively):**
- `esbuild` <=0.24.2
- `@esbuild-kit/core-utils` (any version — deprecated, merged into tsx upstream)
- `@esbuild-kit/esm-loader` (any version — deprecated)
- `drizzle-kit` ^0.31.0 (surface manifestation)

**Source:** [GitHub Advisory GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) — "esbuild enables any website to send any requests to the development server and read the response"

**Fixed in:** No upstream patch for the `@esbuild-kit` chain (deprecated). Future: drizzle-kit must migrate to `tsx` (tracked at https://github.com/drizzle-team/drizzle-orm/issues).

**Allowlist status (active):** YES — entries in `.claude/rules/deps-audit-allowlist.txt` lines 1-4, sunset **2026-08-23** (91 days remaining from today). Per allowlist rule: "Active entry (today ≤ SUNSET-DATE): /deps-audit downgrades the finding by one severity level" → MODERATE downgraded to **LOW**.

**Rationale (from allowlist):** "MODERATE dev-server-request-leak chained from drizzle-kit ^0.31.0's deprecated @esbuild-kit/esm-loader (merged into tsx upstream). v0.1 usage of drizzle-kit is CLI-only (db:push/db:generate); no esbuild dev-server is spun up. Production bundle does not include esbuild or drizzle-kit (devDep). Fix requires drizzle-kit upstream to migrate to tsx."

**Diff suggestion:** OMITTED — fix is upstream-dependent. Re-audit at sunset (2026-08-23); escalate if no fix.

**Plan reference:** v0.3 plan does NOT introduce or interact with this chain. Inherited from v0.1.

## Outdated (non-vulnerable)

### npm: zod@3.25.76 → 4.4.3 (MAJOR)

**Plan reference:** v1.1 D7 declares CHANGED row `zod: ^3.24.0 → ^3.25.0` with rationale "Satisfies @modelcontextprotocol/sdk peer-dep (^3.25 || ^4.0)". Plan intentionally stays on zod 3 — implicit pinning rationale ("v0.1's existing zod usage in src/core/ validators is forward-compatible. Patch-level change within zod's stable major; no API breakage").

**Diff suggestion:** OMITTED for MAJOR. zod 4.x is recent (≤ 6 months); v0.3 plan deliberately stays on stable 3.x. Re-evaluate at v0.4+ when zod 4 has wider ecosystem adoption. NOT flagged as `plan_dep_major_outdated_unpinned` cap because plan v1.1 D7 + Dependencies "Changed" row provides explicit justification.

### npm devDeps MAJOR-outdated (out of plan scope)

| Package | Current | Latest | Type |
|---|---|---|---|
| @types/node | 20.19.41 | 25.9.1 | devDep |
| eslint | 9.39.4 | 10.4.0 | devDep |
| typescript | 5.9.3 | 6.0.3 | devDep |

Plan v0.3 does NOT declare these in `## Dependencies` (out of plan scope — v0.1 infrastructure). No plan-confidence cap triggered. Tracked as soft observation for future v0.4+ tooling upgrades.

## Plan validation (Mode 2)

| Plan dep | Section | Plan version | Registry exists? | Audit clean at version? | Rule 9 OK? | License | Verdict |
|---|---|---|---|---|---|---|---|
| pg | Existing | ^8.13.0 | yes (manifest+lockfile match) | yes | n/a | MIT | OK |
| drizzle-orm | Existing | ^0.45.0 | yes | yes | n/a | Apache-2.0 | OK |
| vitest | Existing (dev) | ^4.0.0 | yes | yes | n/a | MIT | OK |
| vitest-mock-extended | Existing (dev) | ^4.0.0 | yes | yes | n/a | MIT | OK |
| zod | Changed (^3.24→^3.25) | ^3.25.0 | yes (3.25.76 lockfile) | yes (zero CVE per OSV) | n/a | MIT | OK — see note below |
| @modelcontextprotocol/sdk | **NEW** | ^1.29.0 | yes (1.29.0 confirmed via `npm view`) | yes (zero CVE per OSV @1.29.0) | yes (3 alternatives evaluated + rejected: handroll JSON-RPC + mcp-framework + fastmcp Node port; rationale per plan D7) | MIT | OK |
| zod-to-json-schema | **NEW** | ^3.x | yes (3.0.0+ confirmed via `npm view`) | yes (zero CVE per OSV @3.0.2) | yes (3 alternatives evaluated + rejected: handroll JSON-Schema literals + zod-to-openapi + @anatine/zod-to-openapi; rationale per plan D7) | **ISC** ← note | OK |

### Notes

- **zod CHANGED row**: package.json currently declares `^3.24.0` but lockfile resolved to `3.25.76` (range resolution). Plan v1.1 bumps the declared range to `^3.25.0` — explicit alignment with SDK peer-dep. Manifest update happens at T0.1 (already in plan); no audit impact.
- **zod-to-json-schema license**: ISC (not MIT). ISC is permissive-equivalent to MIT (both pass FSF + OSI tests); compatible with TheMemory's MIT license per `dogfood-golden-rule.md` no license-conflict gate. Documented for transparency.

## Recommended next steps

1. **Apply T0.1 of plan v1.1** to update `package.json` (bump zod + add 2 NEW deps). Plan is already authored — `/implement` will execute.
2. After `npm install` lands T0.1, re-run `/deps-audit v0-3-agent-tools-mcp` to confirm verdict holds with the actual installed transitive tree (current audit is forward-looking based on `npm view` queries + OSV API checks; actual install may surface unexpected transitive vulns).
3. Proceed to `/plan-confidence v0-3-agent-tools-mcp` per cycle-plan v1.1 § Chain. Expected cap: **89** (PASS_WITH_CAVEATS) due to inherited 4 LOW (downgraded from MODERATE) — same posture as v0.1's audit. Score should land in SHIPPABLE_WITH_CAVEATS band (70-89).

## Verdict explanation

**PASS_WITH_CAVEATS** with cap 89 — the worst finding is 4 LOW (downgraded from MODERATE via active allowlist). No new exposure introduced by v0.3 deps. NEW deps both have zero known CVE at their declared versions; Rule 9 evaluation present with explicit rejected alternatives.

Per `deps-audit-golden-rule.md § Severity rubric`:
- Worst finding: CVE LOW (after downgrade) → cap 89 → verdict `PASS_WITH_CAVEATS`
- Plan structure: complete (`## Dependencies` present, versions pinned, Rule 9 evaluated for both NEW rows)
- All `auditor_unavailable_*` mitigated: `osv-scanner` not installed but cross-checked via direct OSV API queries for NEW deps (no untestable HIGH/CRIT exposure)

## Cross-references

- Plan: `.claude/knowledge-base/plans/v0-3-agent-tools-mcp-plan.md` (v1.1)
- Edge-case review: `.claude/knowledge-base/reviews/v0-3-agent-tools-mcp-edge-cases-2026-05-24.md`
- Allowlist: `.claude/rules/deps-audit-allowlist.txt` (4 active entries, sunset 2026-08-23)
- Golden rule: `.claude/rules/deps-audit-golden-rule.md`
- Cycle: `.claude/rules/cycle-plan.md` v1.1 § Chain

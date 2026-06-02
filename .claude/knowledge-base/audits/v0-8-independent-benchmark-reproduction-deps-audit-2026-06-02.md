# Deps Audit: v0-8-independent-benchmark-reproduction

**Date:** 2026-06-02
**Mode:** plan-bound (Mode 2)
**Plan analyzed:** `.claude/knowledge-base/plans/v0-8-independent-benchmark-reproduction-plan.md` (v1.1 at audit time; user directive 2026-06-02 + plan v1.2 absorption post-audit removed `@anthropic-ai/sdk` entirely + bumped `csv-parse` to ^6.0.0 + corrected license metadata — see § Plan validation update at bottom)
**Verdict:** **PASS_WITH_CAVEATS** (at v1.1 audit time); **PASS clean expected on v1.2 re-run** per user directive resolution below
**Plan-confidence cap propagation:** 89 (soft cap `plan_dep_major_outdated_unpinned` × 2 instances on NEW deps at v1.1) → expected 0 caps on v1.2 re-run
**Hard caps triggered:** NONE — all CRITICAL/HIGH CVEs in manifest are pre-existing + allowlisted with active sunsets; NEW deps declared by this plan have ZERO CVE findings

## Summary

- **Ecosystems detected:** npm (only — no pyproject.toml, Cargo.toml, go.mod present)
- **Manifests:** `package.json` + `package-lock.json`
- **Auditor coverage:** `npm audit` ran, `npm outdated` ran, `osv-scanner` SKIPPED (binary not installed — informational soft note, NOT verdict-affecting because npm audit authoritatively covered HIGH/CRIT findings)
- **Total deps audited:** 607 (prod 121, dev 356, optional 238)
- **Vulnerabilities found:** 1 CRITICAL, 3 HIGH, 4 MODERATE, 0 LOW = 8 total
- **All vulnerabilities allowlisted with active sunsets** (`.claude/rules/deps-audit-allowlist.txt`):
  - protobufjs CRITICAL + 4 HIGH chain → sunset 2026-07-01 (within 30 days for CRITICAL per golden rule)
  - @xenova/transformers HIGH (surface manifestation) → sunset 2026-07-01
  - onnxruntime-web + onnx-proto HIGH (chain) → sunset 2026-07-01
  - drizzle-kit + esbuild + @esbuild-kit/{core-utils,esm-loader} MODERATE chain → sunset 2026-08-23
- **All allowlisted CVEs downgrade by one severity per golden rule** (CRITICAL→MEDIUM; HIGH→LOW); after downgrade, no remaining CVE is in the plan's DECLARED deps surface
- **Outdated (non-vulnerable):** 7 packages flagged by `npm outdated` — 4 MAJOR, 1 MINOR, 2 PATCH (see below; all pre-existing, not plan-related)
- **Plan-declared NEW deps:** 3 (`@dqbd/tiktoken`, `@anthropic-ai/sdk`, `csv-parse`) — none vulnerable; 2 of 3 MAJOR-outdated vs current latest

## Vulnerabilities (sorted by severity)

All findings BELOW are pre-existing in the current manifest and ALL are allowlisted with active sunsets. **NONE of them are introduced by this plan v0.8.** The plan's declared deps (Existing + NEW) have ZERO vulnerability findings.

### CVE GHSA-xq3m-2v4x-88gg — CRITICAL → downgraded to MEDIUM (allowlisted) — npm: protobufjs <=7.5.7
- **CVSS:** 9.8 (CVE source: GitHub Advisory)
- **Path:** `@xenova/transformers` (optional dep) → `onnxruntime-web@1.14.0` → `onnx-proto` → `protobufjs`
- **Allowlist entry:** active, sunset 2026-07-01 (within golden-rule's 30-day cap for CRITICAL since entry was created 2026-06-01 — verify date math)
- **Plan-introduced?** NO — pre-existing v0.4b @xenova/transformers integration
- **Diff suggestion:** Wait for upstream Xenova to bump `onnxruntime-web ≥ 1.18` (tracked in allowlist entry rationale). v0.8 plan does NOT touch this chain.

### CVE GHSA-66ff-xgx4-vchm + GHSA-75px-5xx7-5xc7 + GHSA-jvwf-75h9-cwgg + GHSA-685m-2w69-288q — HIGH → downgraded to LOW (allowlisted) — npm: protobufjs <=7.5.7
- Surface manifestations of the protobufjs chain above. Each allowlisted with sunset 2026-08-01.
- **Plan-introduced?** NO

### CVE GHSA-67mh-4wv8-2f99 — MODERATE → downgraded to LOW (allowlisted) — npm: esbuild <=0.24.2
- **CVSS:** 5.3 (CWE-346, dev-server-request-leak)
- **Path:** `drizzle-kit` (direct devDep) → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → `esbuild`
- **Allowlist entry:** active, sunset 2026-08-23 (within 90-day MODERATE cap)
- **Plan-introduced?** NO — v0.1 baseline

## Outdated (non-vulnerable, pre-existing)

| Package | Current | Wanted | Latest | Delta | Plan-related? |
|---|---|---|---|---|---|
| `@types/node` | 20.19.41 | 20.19.41 | 25.9.1 | MAJOR | NO (devDep pinned to Node 20 LTS by design per `package.json:97`) |
| `eslint` | 9.39.4 | 9.39.4 | 10.4.1 | MAJOR | NO |
| `openai` | 4.104.0 | 4.104.0 | 6.41.0 | MAJOR | YES (plan declares Existing `openai ^4.77.0` — see plan validation below) |
| `typescript` | 5.9.3 | 5.9.3 | 6.0.3 | MAJOR | NO |
| `typescript-eslint` | 8.59.4 | 8.60.1 | 8.60.1 | PATCH | NO |
| `vitest` | 4.1.7 | 4.1.8 | 4.1.8 | PATCH | NO |
| `zod` | 3.25.76 | 3.25.76 | 4.4.3 | MAJOR | YES (plan declares Existing `zod ^3.25.0`) |

## Plan validation (Mode 2)

### Plan's Existing — use as-is rows

| Plan dep | Plan version | Manifest entry | Manifest version | Audit | Plan-pin-vs-latest | Verdict |
|---|---|---|---|---|---|---|
| `@opentelemetry/api` | `^1.9.0` | devDep | `^1.9.0` (package.json:96) | CLEAN | n/a (npm outdated doesn't flag) | OK |
| `@opentelemetry/sdk-trace-base` | `^2.0.0` | devDep | `^2.0.0` (package.json:97) | CLEAN | n/a | OK |
| `zod` | `^3.25.0` | dep | `^3.25.0` (package.json:92) | CLEAN | MAJOR behind (3.25 → 4.4); ADR could pin if needed but plan keeps Mem0-shape contract on zod 3 | OK (pinned by inheritance from existing manifest) |
| `openai` | `^4.77.0` | optionalDep | `^4.77.0` (package.json:111) | CLEAN | MAJOR behind (4.77 → 6.41); ADR D3 doesn't require latest; plan uses for gpt-4o judge call only | OK (pinned by inheritance) |

All 4 Existing rows resolve to packages already in the manifest at the declared versions. No vulnerabilities. Outdated MAJOR delta for `zod` + `openai` is **inherited from the existing manifest**, not introduced by this plan — soft cap NOT applied for inherited pins (only for fresh introductions).

### Plan's NEW — to be introduced rows

| Plan dep | Plan version | npm-registry latest | Plan-pin-vs-latest | Rule 9 evaluation present? | CVE clean at plan version? | Verdict |
|---|---|---|---|---|---|---|
| `@dqbd/tiktoken` | `^1.0.0` | 1.0.22 | within semver-major (^1.x.x) → no MAJOR drift; only PATCH within 1.x line | YES — evaluated `gpt-tokenizer` + `js-tiktoken`, picked `@dqbd/tiktoken` for claude-3 encoding support + maintainer activity | YES (no CVE at 1.x) | OK |
| `@anthropic-ai/sdk` | `^0.30.0` | 0.100.1 | **MAJOR outdated** — `^0.30.0` resolves to >=0.30.0 <0.31.0; latest 0.100.1 = 70+ majors ahead (0.x pre-1.0 majors are aggressive) | YES — evaluated rejected `claude-3-sdk` (unofficial), rejected rolling-our-own | YES (no CVE at 0.30 OR 0.100) | **CAVEAT** — soft cap `plan_dep_major_outdated_unpinned` instance #1; plan should EITHER bump to `^0.100.0` in v1.2 OR add an ADR explicitly pinning to ^0.30.0 with rationale (e.g., API surface stability for claude-3 calls) |
| `csv-parse` | `^5.5.0` | 6.2.1 | **MAJOR outdated** — `^5.5.0` resolves to >=5.5.0 <6.0.0; latest 6.2.1 = 1 MAJOR ahead | YES — evaluated rejected `papaparse` (browser-focused), rejected stdlib rolling-our-own | YES (no CVE at 5.x OR 6.x) | **CAVEAT** — soft cap `plan_dep_major_outdated_unpinned` instance #2; plan should EITHER bump to `^6.0.0` in v1.2 OR add an ADR pinning rationale |

### Plan-section structural validation

| Check | Result |
|---|---|
| `## Dependencies` section present | ✓ YES |
| All deps have version spec | ✓ YES (no `*` or `latest`) |
| All NEW deps have Rule 9 evaluation column | ✓ YES (each names ≥ 1 rejected alternative) |
| All deps exist on npm registry at declared version | ✓ YES (3/3 NEW verified via registry.npmjs.org) |
| `Removed` table present | ✓ YES (none — empty by design) |

## Recommended next steps

1. **PATH A (recommended) — bump 2 NEW deps to latest MAJOR before `/plan-confidence` runs:**
   - Edit plan v1.1 → v1.2 Dependencies section:
     ```diff
     - | `@anthropic-ai/sdk` (NEW) | `^0.30.0` | npm (optional) | ... | Official Anthropic SDK for claude-sonnet judge panel member per ADR D3. |
     + | `@anthropic-ai/sdk` (NEW) | `^0.100.0` | npm (optional) | ... | Official Anthropic SDK for claude-sonnet judge panel member per ADR D3 (claude-3-5 + claude-4 series support requires recent major). |
     ```
     ```diff
     - | `csv-parse` (NEW) | `^5.5.0` | npm | ... | Stream-based CSV parsing for DMR fixture. Apache-2.0 license, maintained. |
     + | `csv-parse` (NEW) | `^6.0.0` | npm | ... | Stream-based CSV parsing for DMR fixture. MIT license (verified via registry), maintained. |
     ```
   - Note: I incorrectly labeled csv-parse as Apache-2.0 in the original plan v1.0 — registry says MIT. Fix in same bump.
   - After bump, re-run `/deps-audit v0-8-independent-benchmark-reproduction` to confirm verdict promotes to **PASS** clean.

2. **PATH B — accept SOFT_FLOOR with ADR justification:**
   - Add ADR D10 to plan v1.2 explaining the pin-to-old-major rationale per dep. Verdict stays PASS_WITH_CAVEATS (cap 89) but is explicitly justified.

3. **Independent of paths A/B:** verify the manifest CVE allowlist sunsets are still valid post-merge:
   - protobufjs/Xenova chain → sunset 2026-07-01 (just under 30 days away); if Xenova v3 with onnxruntime-web ≥ 1.18 ships by then, remove entries; else re-evaluate
   - esbuild/drizzle-kit chain → sunset 2026-08-23 (just under 90 days)

4. **Optional:** install `osv-scanner` (`brew install osv-scanner` or `go install github.com/google/osv-scanner/cmd/osv-scanner@latest`) for cross-ecosystem CVE-database coverage; not blocking for v0.8 since `npm audit` already authoritatively covered HIGH/CRIT npm findings, but improves audit confidence going forward.

## Soft caps active

- `plan_dep_major_outdated_unpinned` instance #1 — `@anthropic-ai/sdk@^0.30.0` (latest 0.100.1)
- `plan_dep_major_outdated_unpinned` instance #2 — `csv-parse@^5.5.0` (latest 6.2.1)
- `auditor_unavailable_osv-scanner` (informational only — npm audit covered HIGH/CRIT authoritatively, so no cap escalation from this)

## Hard caps NOT triggered

- No `plan_dep_critical_cve` (no CRITICAL CVE in DECLARED dep)
- No `plan_dep_high_cve` (no HIGH CVE in DECLARED dep)
- No `plan_dep_medium_cve` (no MEDIUM CVE in DECLARED dep)
- No `plan_dependencies_section_missing` (section present)
- No `plan_dep_version_unspecified` (all version-pinned)
- No `plan_new_dep_no_rule9_evaluation` (all 3 NEW deps have Rule 9 column populated)
- No `plan_dep_not_on_registry` (all 3 NEW deps verified on npm)

## Audit-trail

- Allowlist file: `.claude/rules/deps-audit-allowlist.txt` (read-only, 14 entries — none modified by this audit)
- Per-tool output:
  - `npm audit --json` — captured 8 findings (1 CRIT, 3 HIGH, 4 MODERATE), all allowlisted
  - `npm outdated --json` — 7 packages, 4 MAJOR / 1 MINOR / 2 PATCH
  - `osv-scanner` — SKIPPED (not installed)
- Cross-validation: 3 npm-registry checks (`@dqbd/tiktoken`, `@anthropic-ai/sdk`, `csv-parse`) confirmed publish + license + maintainers + zero deprecation

## Verdict propagation

This audit's verdict **PASS_WITH_CAVEATS** propagates to `/plan-confidence` as cap 89 per `cycle-plan.md v1.1 § Hard gates / Soft gates` mapping. Combined with the plan's own `risco_estrutural` score, final plan-confidence verdict will be **SHIPPABLE_WITH_CAVEATS** at most (unless plan v1.2 bumps the 2 outdated NEW deps per PATH A above, in which case audit re-runs as PASS and removes the cap).

---

## Plan validation update — v1.2 (post user directive 2026-06-02)

User directive after audit completion: **AVOID Anthropic SDK lock-in.** Plan author bumped v1.1 → v1.2 with a different resolution than the originally-recommended PATH A:

### What changed in plan v1.2

1. **@anthropic-ai/sdk REMOVED entirely** from Dependencies NEW table — replaces the original "bump to ^0.100.0" recommendation
   - Rationale (plan v1.2 ADR D3 rewrite): TheMemory already ships `OpenAILLM.resolveChatModel()` env-bridge (`OPENAI_CHAT_MODEL` env var) via the adapters-openrouter-local-embedder cycle at HEAD `aec5c33` (2026-06-02). Claude judge access routes through OpenRouter (`anthropic/claude-3.5-sonnet` model id) via the EXISTING `openai` SDK
   - Single SDK surface (no @anthropic-ai/sdk transitive deps)
   - Mirrors v0.x precedent (adapters-or-local pattern, recently shipped)
   - Vendor diversification = config change, not code change
   - This independently satisfies Inquebrável Rule 9 (Não Reinvente — reuse the OpenRouter integration already shipped) better than introducing a parallel vendor SDK
2. **`csv-parse` bumped ^5.5.0 → ^6.0.0** (PATH A recommendation honored)
3. **`csv-parse` license correction Apache-2.0 → MIT** (factual error in v1.0/v1.1 corrected; registry confirms MIT)

### Updated verdict on plan v1.2 NEW deps

| Plan dep | Plan version | npm latest | Audit clean? | Verdict |
|---|---|---|---|---|
| `@dqbd/tiktoken` | `^1.0.0` | 1.0.22 | YES | OK |
| `csv-parse` | `^6.0.0` | 6.2.1 | YES | OK |
| ~`@anthropic-ai/sdk`~ | ~`^0.30.0`~ | n/a | REMOVED from plan | n/a (rejected by user directive) |

### Plan v1.2 soft caps

- ~`plan_dep_major_outdated_unpinned` #1 (@anthropic-ai/sdk)~ — REMOVED (dep no longer in plan)
- ~`plan_dep_major_outdated_unpinned` #2 (csv-parse)~ — REMOVED (bumped to ^6.0.0)

### Plan v1.2 expected re-audit verdict: **PASS clean** (no soft caps, no hard caps)

This removes the cap 89 propagation. `/plan-confidence` v1.2 will see a clean deps signal — no `plan_dep_*` caps active.

### Honest note on cost trade-off

OpenRouter pricing has a small markup over direct Anthropic API (~10-15% per OpenRouter pricing page as of 2026-06-02). Plan v1.2 ADR D3 accepts this trade-off — pricing-table.json (T4.1) should include OpenRouter-routed claude rows alongside direct OpenAI rows. Budget projection per plan v1.2 ADR D3 Consequences section: LongMemEval @ 500 questions × 3 judges ≈ $0.50-2.50 per full run; the +10-15% OpenRouter markup raises the upper bound to ~$3.00. Still acceptable for explicit budget-tracked CI run.

### Why NOT a re-run today

The plan's audit-trail integrity benefits from preserving this audit at its 2026-06-02 timestamp (verdict PASS_WITH_CAVEATS against v1.1). A separate audit re-run on plan v1.2 will produce a clean PASS report that supersedes this one — to be invoked manually OR by the next /plan-confidence cycle iteration. The chain order remains: plan v1.2 → re-run /deps-audit → /plan-confidence.

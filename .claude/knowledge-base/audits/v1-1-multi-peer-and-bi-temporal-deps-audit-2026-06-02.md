# Deps Audit: v1-1-multi-peer-and-bi-temporal

**Date:** 2026-06-02 (re-audit after plan v1.1 → v1.2 patch)
**Mode:** plan-bound:v1-1-multi-peer-and-bi-temporal
**Verdict:** **PASS_WITH_CAVEATS** (cap 89, SHIPPABLE_WITH_CAVEATS band)
**Hard caps triggered:** `plan_dep_low_cve` (allowlisted MODERATE drizzle-kit chain downgraded to LOW)

## Re-audit context

First-pass audit at 2026-06-02 returned INVALID_PLAN_DEPS (cap 49) with 4× `plan_dep_version_unspecified` because Existing rows used `(current)` placeholders. Plan owner accepted the 5-minute fix path; plan bumped v1.1 → v1.2 with explicit pins + new ADR D7 (zod ^3.25.0 pin). This re-audit verifies the fix.

## Summary

- **Ecosystems detected:** npm (TypeScript-only)
- **Auditor coverage:** { `npm audit`: ran; `npm outdated`: ran; `osv-scanner`: SKIPPED — binary not installed }
- **Total deps audited:** 4 plan-declared direct deps
- **Vulnerabilities found (raw):** 1 CRITICAL + 3 HIGH + 4 MODERATE (= 8 total) — transitive across whole repo
- **Vulnerabilities found (post-allowlist downgrade, all entries within sunset):** 0 CRITICAL + 1 HIGH + 4 MODERATE + 3 LOW — none of the CRITICAL/HIGH are plan-declared deps
- **Outdated direct deps (plan-declared):** zod 3.25.76 → 4.4.3 (MAJOR) — NOW pinned per ADR D7
- **Allowlist hits:** 14 active (none expired)
- **Plan structural compliance:** ✓ PASS — all 4 Existing rows carry explicit semver pins

---

## Plan validation (Mode 2 — re-audit)

| Plan dep | Section | Plan-declared version | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|---|
| drizzle-orm | Existing | `^0.45.0` ✓ | yes | yes (0 CVEs) | n/a | OK |
| drizzle-kit | Existing | `^0.31.0` ✓ | yes | 1 MODERATE allowlisted → LOW after downgrade | n/a | PASS_WITH_CAVEATS (`plan_dep_low_cve`) |
| pg | Existing | `^8.13.0` ✓ | yes | yes (0 CVEs) | n/a | OK |
| zod | Existing | `^3.25.0` ✓ | yes (`3.25.76` within range) | yes (0 CVEs); MAJOR outdated NOW pinned via ADR D7 | n/a | OK |
| (none) | NEW | — | — | n/a | n/a | OK |
| (none) | Removed | — | — | n/a | n/a | OK |

**Soft signals cleared since v1.1:**
- `plan_dep_version_unspecified` × 4 → **CLEARED** (explicit pins applied)
- `plan_dep_major_outdated_unpinned` (zod) → **CLEARED** (ADR D7 documents the pin intent)

**Soft signal remaining (acceptable):**
- `plan_dep_low_cve` (drizzle-kit allowlisted MODERATE → LOW) → caps verdict at 89. Acceptable per allowlist sunset 2026-08-23 (82 days remaining) + devDep-only usage (CLI db:push/db:generate; no dev-server invocation in our pipeline).

---

## Vulnerabilities (sorted by severity, post-allowlist downgrade)

### Anti-pattern #3 disclosure: every CRITICAL/HIGH listed even when allowlisted

Same findings as the first-pass audit (same lockfile + same allowlist + same sunsets). Plan v1.2 changes do NOT alter any vulnerability surface — only the plan-spec compliance flags changed.

#### CRITICAL → MEDIUM (downgraded; allowlisted, sunset 2026-07-01)

##### GHSA-xq3m-2v4x-88gg — protobufjs `<=7.5.7` (transitive via @xenova/transformers ^2.17.2 → onnxruntime-web@1.14.0 → onnx-proto)

- **Risk envelope:** protobufjs parser invoked ONLY at model warmup (one-time .onnx download from huggingface.co/Xenova CDN); runtime inference doesn't route user input through it.
- **Plan reference:** NOT plan-declared; flagged for disclosure per `deps-audit/SKILL.md § Anti-pattern #3`. Unchanged by v1.1/v1.2 plan.

#### HIGH → MEDIUM (downgraded; all 3 active-allowlisted)

##### Protobufjs HIGH chain (GHSA-66ff-xgx4-vchm + GHSA-75px-5xx7-5xc7 + GHSA-jvwf-75h9-cwgg + GHSA-685m-2w69-288q)

- Same transitive chain + risk envelope as the CRITICAL above. Sunset 2026-08-01.
- **Plan reference:** NOT plan-declared.

#### MODERATE → LOW (downgraded; 4 entries; from drizzle-kit chain)

##### GHSA-67mh-4wv8-2f99 — esbuild `<=0.24.2` + @esbuild-kit/{core-utils,esm-loader} + drizzle-kit `^0.31.0`

- **Plan reference:** `drizzle-kit ^0.31.0` IS plan-declared (v1.2 Existing row + cited in the Why column with allowlist sunset). After allowlist downgrade: MODERATE → LOW → `plan_dep_low_cve` → soft cap 89. **This is the remaining signal capping the v1.2 verdict at SHIPPABLE_WITH_CAVEATS.**
- **Allowlist sunset:** 2026-08-23 (82 days remaining as of today). devDep-only; CLI usage; no dev-server invocation.

---

## Outdated (non-vulnerable)

### npm: zod 3.25.76 → 4.4.3 (MAJOR)

- **Plan reference:** Plan v1.2 explicitly pins to `^3.25.0` per ADR D7. The major-bump-without-ADR soft signal that fired in v1.1 is now **CLEARED** — the ADR documents the intentional pin + deferral rationale.
- **Sunset discipline (ADR D7):** review at v1.2 milestone kickoff whether the pin remains justified or the migration becomes load-bearing.

### Other plan-declared deps — no outdated findings

- drizzle-orm: up-to-date.
- drizzle-kit: up-to-date within allowlisted range.
- pg: up-to-date.

---

## Verdict explanation

`PASS_WITH_CAVEATS` per `.claude/rules/deps-audit-golden-rule.md § Severity rubric`:

- 1× `plan_dep_low_cve` (drizzle-kit allowlisted MODERATE → LOW after downgrade) → cap 89
- 0× CRITICAL/HIGH on plan-declared deps
- 0× `plan_dep_version_unspecified` (cleared)
- 0× `plan_dep_major_outdated_unpinned` (cleared via ADR D7)
- 0× `plan_new_dep_no_rule9_evaluation` (no new deps)
- 0× `plan_dep_not_on_registry` (all 4 deps verified on npm)

`/plan-confidence` consumption: this audit caps `/plan-confidence` at 89. The plan can reach `SHIPPABLE_WITH_CAVEATS` (the realistic ceiling per cycle-plan ADR D8) but cannot reach `SHIPPABLE` (90+) while the drizzle-kit allowlist sunset is active. This is the project-wide constraint shared with every plan touching drizzle-kit until 2026-08-23 (when the upstream tsx migration lands OR the allowlist sunset triggers re-evaluation).

---

## Recommended next steps

1. ✅ DONE — plan v1.1 → v1.2 patch applied with explicit version pins + ADR D7.
2. ✅ DONE — re-audit confirms PASS_WITH_CAVEATS.
3. → NEXT — invoke `/plan-confidence v1-1-multi-peer-and-bi-temporal` to obtain the structural score against M2 rubric.

---

## Audit-trail metadata

- Script versions: `npm audit` runtime via `npm ^10.x` against `package-lock.json` at HEAD.
- `osv-scanner` not installed in runtime — gap surfaced honestly per anti-pattern #5.
- Plan source: `.claude/knowledge-base/plans/v1-1-multi-peer-and-bi-temporal-plan.md` v1.2 (2026-06-02).
- Allowlist source: `.claude/rules/deps-audit-allowlist.txt` (14 active entries verified; 0 expired).
- First-pass audit (v1.1, INVALID_PLAN_DEPS verdict) superseded by THIS re-audit (v1.2, PASS_WITH_CAVEATS verdict).

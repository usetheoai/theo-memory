# Deps Audit: examples-theokit-chat-migration

**Date:** 2026-06-05
**Mode:** plan-bound (slug: `examples-theokit-chat-migration`)
**Plan version audited:** v1.1 (post-edge-case-absorption, 2026-06-05)
**Verdict:** PASS_WITH_CAVEATS
**Plan-confidence cap:** 89 (band: SHIPPABLE_WITH_CAVEATS)
**Hard caps triggered:** none
**Soft caps triggered:** `soft_floor_missing_rule9_inline` (Rule 9 evaluation for `@tailwindcss/vite` absorbed by EC-6 inline, not in the `## Dependencies` § NEW table)

---

## Summary

| Metric | Pre-migration (current `examples/chat-with-memory/`) | Post-migration (sandbox simulation) | Delta |
|---|---|---|---|
| Total deps audited | 781 | 204 | **−577** |
| CRITICAL | 0 | 0 | 0 |
| HIGH | 0 | 0 | 0 |
| MODERATE | 2 (postcss/next chain — allowlisted) | 0 | **−2** |
| LOW | 0 | 0 | 0 |

**Net effect on examples/chat-with-memory:** vulnerability surface CLEAN-CUT to zero; transitive blast radius reduced by 73.9%. The 2 MODERATE entries (postcss XSS + next chain, allowlisted to 2026-08-29) disappear when `next ^15.5.18` is removed.

**Root-package (theo-memory SDK) audit unchanged:** CRITICAL=1 / HIGH=3 / MODERATE=4 (protobufjs chain via @xenova/transformers + esbuild chain via drizzle-kit + postcss chain via next-in-examples-chat-with-memory). All within sunset. The protobufjs chain CONTINUES post-migration because `@usetheo/memory` still depends on optionalDependencies `@xenova/transformers` for `LocalTransformerEmbedder`; the postcss chain transitively goes away in examples/ only.

---

## Empirical audit data (root `npm audit --json`)

```json
{
  "vulnerabilities": {
    "info": 0, "low": 0, "moderate": 4, "high": 3, "critical": 1, "total": 8
  },
  "dependencies": { "prod": 73, "dev": 219, "optional": 138, "total": 426 }
}
```

Identical signature to 5 prior 2026-06-04 audits (`adapters-openai-cycle-2`, `adapters-openrouter-local-embedder`, `f-t4-1-2-eviction-race-debug`, `p0-api-sdk-mcp-correctness-audit`, `principles-alignment-hardening`). Same protobufjs CRITICAL + 3 HIGH cascade + 4 MODERATE — all allowlisted within sunset (see `.claude/rules/deps-audit-allowlist.txt`, 14 active entries).

## Empirical audit data (`examples/chat-with-memory/` pre-migration)

```json
{
  "vulnerabilities": {
    "info": 0, "low": 0, "moderate": 2, "high": 0, "critical": 0, "total": 2
  },
  "dependencies_audited": 781
}
```

The 2 MODERATE are surface manifestations of the postcss/next chain. Allowlist entries cover them with sunset 2026-08-29.

## Empirical audit data (post-migration simulation: `theokit@^0.2.4` + `@theokit/sdk@^1.5.0` + `@tailwindcss/vite@^4.3.0` + react/react-dom@^19.0.0)

```json
{
  "vulnerabilities": {
    "info": 0, "low": 0, "moderate": 0, "high": 0, "critical": 0, "total": 0
  },
  "dependencies_audited": 204
}
```

Sandbox at `/tmp/deps-audit-sandbox-theokit/` (lock-file-only install, no node_modules execution). Clean state.

---

## Plan validation (`## Dependencies` cross-reference)

The plan declares dependencies in two scopes:

1. **theo-memory root** — kept as-is (commander, vitest, typescript). NOT modified by this plan.
2. **examples/chat-with-memory/package.json** — the migration target. Existing/New/Removed below.

### Existing — kept as-is

| Package | Version | Ecosystem | Plan section | Manifest match | Audit clean? | Verdict |
|---|---|---|---|---|---|---|
| react | ^19.0.0 | npm | (implicit — required by theokit) | yes | yes | OK |
| react-dom | ^19.0.0 | npm | (implicit) | yes | yes | OK |
| pg | ^8.13.1 | npm | (implicit — kept for direct demo writes) | yes | yes | OK |
| @usetheo/memory | file:../.. | npm | workspace-link, kept | yes | n/a (local) | OK |

### NEW — to be introduced

| Package | Version | Ecosystem | Rule 9 OK? | Rejected alternatives documented? | Audit clean? | Verdict |
|---|---|---|---|---|---|---|
| theokit | ^0.2.4 | npm | YES | 4 alternatives: keep Next.js, Astro/Remix/SvelteKit, custom Vite scaffold, raw HTML | yes (0 vulns at ^0.2.4) | OK |
| @tailwindcss/vite | ^4.3.0 | npm | **PARTIAL** (absorbed by EC-6 inline; no Rule 9 column in `## Dependencies § NEW` table) | implicit — Tailwind v4 is the ecosystem standard via Vite plugin; alternatives like UnoCSS/Mantine not enumerated | yes (0 vulns) | OK with **`soft_floor_missing_rule9_inline`** caveat |

**Rule 9 honesty caveat on `@tailwindcss/vite`:** the EC-6 absorption note in the plan header references "added per EC-6" but did not add an explicit Rule 9 column in the Dependencies NEW table with rejected alternatives. The dep is low-risk (de-facto standard for Tailwind v4 + Vite, 0 vulns, mature) — but the gap should be closed in plan v1.2 OR justified as "ecosystem standard; no Rule 9 column required when picking the official plugin for the framework already chosen". Recommendation: add a one-line ADR D8 note "EC-6 absorption: @tailwindcss/vite picked because it is the official Tailwind v4 Vite plugin; UnoCSS / Mantine / inline-styles rejected as scope creep vs the Tailwind continuity goal."

### Bumped — alias rename (NOT a major bump)

| Package | From | To | Ecosystem | Note |
|---|---|---|---|---|
| @usetheo/sdk → @theokit/sdk | 1.3.0 | ^1.5.0 | npm | Per CLAUDE.md (sibling theokit-tools/theokit), `@usetheo/sdk` and `@theokit/sdk` are published as aliases of the same package at 1.5.0. Audit clean. Verdict OK. |

### Removed — net subtraction

| Package | Last version | Why removed | Verification |
|---|---|---|---|
| next | ^15.5.18 | Demo migrates from Next.js App Router to TheoKit's defineRoute/defineAgentEndpoint. | postcss + next allowlist entries become unreferenced in examples/ — entries STAY in `.claude/rules/deps-audit-allowlist.txt` until 2026-08-29 sunset for audit hygiene (no early-delete; another plan may need them). |
| eslint-config-next | ^15.5.18 | Companion of next. | OK. |
| openai | ^4.77.0 | Replaced by `@theokit/sdk`'s `Agent.prompt` runtime LLM client. User directive 2026-06-02: "Não quero lock-in SDK Anthropic" — also applies here as "não recriar lock-in OpenAI SDK quando o framework já tem cliente próprio". | OK. |
| @tailwindcss/postcss | ^4.1.0 | Replaced by `@tailwindcss/vite` (Tailwind v4 via Vite-plugin vs PostCSS-plugin). | OK. |
| postcss | ^8.5.10 | Devs need for PostCSS pipeline; Vite + @tailwindcss/vite plugin runs Tailwind without PostCSS round-trip. | OK. |
| tailwindcss | ^4.1.0 | Stays implicitly (peer of @tailwindcss/vite). The standalone `tailwindcss` entry can be removed because the Vite plugin pulls it in. | OK. |

---

## Allowlist hygiene

| Allowlist entry | Pre-migration status | Post-migration status | Action |
|---|---|---|---|
| `npm\|postcss\|<8.5.10\|GHSA-qx2v-qp2m-jg93` (sunset 2026-08-29) | active, surfaces in examples/ | stale wrt examples/ only (root pkg never had it) | KEEP — sunset still binds future cycles; do NOT delete early per allowlist hygiene rules |
| `npm\|next\|^15.5.18\|GHSA-qx2v-qp2m-jg93` (sunset 2026-08-29) | active | stale wrt examples/ only | KEEP — same rationale |
| All protobufjs / esbuild / drizzle-kit / xenova entries | active | active (root SDK still uses xenova; drizzle-kit still in devDeps) | NO CHANGE |

No new allowlist entries needed.

---

## Recommended next steps

1. **Apply the migration via `/implement examples-theokit-chat-migration`** — the deps surface is empirically validated as a NET IMPROVEMENT (2 MODERATE → 0; 781 → 204 deps in examples/).
2. **Close the `soft_floor_missing_rule9_inline` caveat:**
   - Option A (low burden): add one-line ADR D8 note to plan v1.2 documenting `@tailwindcss/vite` ecosystem-standard justification.
   - Option B (higher burden): expand the `## Dependencies § NEW` table to include a Rule 9 column for `@tailwindcss/vite`.
   - Recommendation: Option A — simpler and honest; the caveat is a documentation honesty gap, not a security or correctness gap.
3. **Re-run `/deps-audit examples-theokit-chat-migration` post-implement** to verify the on-disk lockfile state matches the sandbox simulation (lockfile drift is the only realistic source of divergence).
4. **Proceed to `/plan-confidence examples-theokit-chat-migration`** — the structural M2 rubric will determine the floor; this audit's cap is 89.

---

## Auditor coverage

| Auditor | Status | Note |
|---|---|---|
| `npm audit` (root) | RAN | 8 vulns; identical to 5 prior 2026-06-04 baselines |
| `npm audit` (examples/chat-with-memory/) | RAN | 2 MODERATE; pre-migration baseline |
| `npm audit` (sandbox `/tmp/deps-audit-sandbox-theokit/`) | RAN | 0 vulns; post-migration projection |
| `osv-scanner` | SKIPPED — binary not installed | informational only; not capping verdict because `npm audit` covered the relevant ecosystem with no CVE matches outside the allowlist |
| `pip-audit` / `cargo audit` / `govulncheck` | n/a — no Python/Rust/Go deps in scope | OK |

`auditor_unavailable_osv-scanner` is INFORMATIONAL (not a soft cap) because npm audit's GitHub Advisory data covers the surface examined; osv-scanner would provide cross-validation but its absence does not LEAVE A KNOWN GAP for the deps in the plan.

---

## Verdict rationale

- No CRITICAL/HIGH CVEs on declared deps at declared versions (all 8 root-pkg CVEs are pre-existing-and-allowlisted-within-sunset; not introduced by this plan).
- Migration STRICTLY IMPROVES the examples/ vulnerability surface (2 MODERATE → 0).
- Plan declares versions explicitly (no `*` or `latest`).
- 1 Rule 9 evaluation table OK (`theokit ^0.2.4`).
- 1 Rule 9 evaluation gap (`@tailwindcss/vite ^4.3.0`) — soft cap, easily closable.

**Final verdict: PASS_WITH_CAVEATS (cap 89).**

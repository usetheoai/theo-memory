# Review: fix-lint-brace-expansion (#138)

**Date:** 2026-07-25 · **Reviewer:** 1 adversarial dependency-security agent + orchestrator. **Verdict:** READY_TO_MERGE.

Independently verified (commands re-run, not just read):
- `npm run lint` → exit 0 (config loads, 0 violations, no `expand is not a function`).
- `npm test` → 1377 passed / 3 skipped; `npm run typecheck` → exit 0.
- `brace-expansion@1.1.16` reachable ONLY via `minimatch@3.1.5`, whose every consumer is a **devDependency** (eslint core, @eslint/config-array, @eslint/eslintrc, eslint-plugin-import, ts-prune→ts-morph). No workspace runtime package pulls it → **production CVE (GHSA-mh99-v99m-4gvg) genuinely cleared** (all shipped paths on 5.0.8).
- Allowlist entry well-formed; 90-day sunset (2026-10-23) at the ceiling; HIGH exemption backed by ADR-0024.
- Lockfile delta minimal + surprise-free (adds the 1.x transitive chain, flips minimatch@3's dep; nothing else shifted).

LOW findings (fixed): F1 — ADR "exactly one path" understated a 2nd dev-only path (ts-prune→ts-morph→minimatch@3); reworded to name both. F2 — override is edge-scoped not dev-scoped; ADR now documents the latent revisit + the sunset guard. Neither reintroduces a prod CVE.

Handoff: READY_TO_MERGE → `/release` (ad-hoc hotfix, no roadmap milestone — ROADMAP already M0–M22 complete). Closes #138.

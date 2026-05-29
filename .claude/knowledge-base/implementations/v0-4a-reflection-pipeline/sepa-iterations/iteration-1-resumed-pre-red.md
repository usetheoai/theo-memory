# SEPA — Iteration 1 (RESUMED post-Fix#1) / Task T0.1 / Phase pre-RED

Resumed after Fix #1 unblocked T0.1 (vitest config extension committed bfafdbd).

## Plan recap
- Add `croner ^10.0.1` to dependencies + npm install + verify the existing RED test passes.

## Findings
- [CRITICAL] Verify RED test asserts `import('croner')` resolves AND exports `Cron` class — not just "no throw"; otherwise GREEN passes on empty module shim. **ALREADY VERIFIED** — test asserts `new Cron(...)` + `.stop()` method existence.
- [CRITICAL] Edit package.json `dependencies` (NOT `devDependencies`) — croner ships at runtime per ADR D10.
- [CRITICAL] Pin EXACTLY `"croner": "^10.0.1"` — verbatim per ADR D10.
- [CRITICAL] Run `npm audit --production` post-install; HIGH/CRITICAL = Stop Condition #5.
- [MAJOR] Confirm `npm install` doesn't touch unrelated lockfile entries; isolated croner subtree only.
- [MAJOR] After GREEN, re-run full `npm test` to confirm zero regression on v0.1 baseline.
- [MAJOR] Commit shape: `feat(deps): add croner ^10.0.1 for sleep-time reflection scheduler (T0.1)`.
- [MAJOR] Do NOT proceed to T0.2+ in this iteration — atomic per task.

## Recommended action
- Edit package.json with caret pin in dependencies. Run npm install. Verify RED → GREEN. Run npm audit. Run full npm test. Commit atomically with package.json + package-lock.json + tests/unit/deps/croner-import.test.ts.

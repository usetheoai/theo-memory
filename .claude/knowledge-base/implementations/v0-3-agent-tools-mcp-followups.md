# Followups — v0-3-agent-tools-mcp

Out-of-scope improvements logged during /implement halt-loop. NOT included in current commit per cycle-implement v1.2 anti-pattern: "NEVER scope-creep mid-task".

## Logged at T0.2 (iteration 2)

- **F-T0.2-1 — `package.json#files` allow-list needs `dist/**` for bin entry tarball inclusion.** T0.2 declares `bin: { "themory-mcp": "./dist/agent-tools/cli.js" }` but `package.json#files` does NOT yet include `dist/**`. `npm pack` does NOT validate bin file existence at pack time (only at consumer install time). Fix in T6.1: add `"dist/**"` to allow-list AND wire `"prepack": "npm run build"` script so published tarball always contains current dist artifacts. SEPA pre-RED MAJOR flag from iter 2.
- **F-T0.2-2 — Add bin-target-in-tarball test row to `tests/integration/publish-readiness.test.ts`.** Mirror the F1 followup pattern that iterates `pkg.exports` and asserts backing source exists; do the same for `pkg.bin` (every bin target's path resolves under the packed tarball OR is documented as a build artifact). Lands at T6.1 alongside F-T0.2-1. SEPA pre-RED MINOR flag from iter 2.

## Logged at T1.1 (iteration 3)

- **F-T1.1-1 — iter-2 SEPA pre-RED brief not persisted on disk.** The iter-2 SEPA pre-RED advisory was rich (1 CRITICAL + multiple MAJOR/MINOR findings on the build pipeline + tripwire regex tightening + EC-1 absorption depth) but was only kept in the halt-loop transcript. Future iterations MUST `Write` the iteration-N-pre-red.md immediately after each pre-RED Agent call, before proceeding to RED phase, to close the audit-trail gap. iter-3 backfilled both pre-red + pre-commit briefs at the cost of slightly larger commit.

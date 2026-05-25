# Followups — v0-3-agent-tools-mcp

Out-of-scope improvements logged during /implement halt-loop. NOT included in current commit per cycle-implement v1.2 anti-pattern: "NEVER scope-creep mid-task".

## Logged at T0.2 (iteration 2)

- **F-T0.2-1 — `package.json#files` allow-list needs `dist/**` for bin entry tarball inclusion.** T0.2 declares `bin: { "themory-mcp": "./dist/agent-tools/cli.js" }` but `package.json#files` does NOT yet include `dist/**`. `npm pack` does NOT validate bin file existence at pack time (only at consumer install time). Fix in T6.1: add `"dist/**"` to allow-list AND wire `"prepack": "npm run build"` script so published tarball always contains current dist artifacts. SEPA pre-RED MAJOR flag from iter 2.
- **F-T0.2-2 — Add bin-target-in-tarball test row to `tests/integration/publish-readiness.test.ts`.** Mirror the F1 followup pattern that iterates `pkg.exports` and asserts backing source exists; do the same for `pkg.bin` (every bin target's path resolves under the packed tarball OR is documented as a build artifact). Lands at T6.1 alongside F-T0.2-1. SEPA pre-RED MINOR flag from iter 2.

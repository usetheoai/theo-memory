# SEPA — Iteration 1 / Task T0.1 / Phase pre-RED

**Date:** 2026-06-01
**Mode:** TIGHT
**Subagent type:** general-purpose (fallback per cycle-implement.md v1.5)

## Plan recap
- Add `"openai": "^4.77.0"` to root `package.json#optionalDependencies` (NOT `dependencies`/`peerDependencies`); RED asserts `npm ls openai` returns 0 pre-install, GREEN asserts 1+ post-install.

## Findings
- INFO — `^4.77.0` pin correct per plan v1.1 ADR D2 (bumped from v1.0 `^4.50.0` to match demo's exact pin; deps-audit verdict PASS_WITH_CAVEATS, ZERO CVE at any 4.x).
- INFO — `optionalDependencies` tier correct per ADR D2: (A) `dependencies` REJECTED (forces stub-only consumers to pay install cost); (B) `peerDependencies` REJECTED (awkward DX); matches v0.6.1 `natural` precedent.
- INFO — T0.1 has NO EC pre-flight (unlike T1.2/EC-4 DIP-shape gate and T3.1/EC-1 demo importer grep). Acceptance criteria are the only gate.
- MAJOR — Acceptance criterion #2 EXPLICITLY requires verifying `tsconfig.contract.json` + `tsconfig.build.json` ALREADY include `src/embedders/**/*.ts` + `src/llms/**/*.ts` (per PR #25 widening). Plan says "no edit needed" but MAIN SESSION MUST `Read` both tsconfig files and `grep -E 'embedders|llms' tsconfig.contract.json tsconfig.build.json` to confirm BEFORE COMMIT. If absent, T1.1/T1.2 GREEN will fail at typecheck.
- MINOR — Verify no stale `package-lock.json` drift after `npm install`; lockfile must be staged in the same commit as `package.json` edit.

## Recommended action
- Proceed with RED (`npm ls openai` returns 0 in root). After GREEN (`npm install` + `npm ls openai` shows `^4.77.0`), BEFORE COMMIT run: `grep -E "embedders|llms" tsconfig.contract.json tsconfig.build.json` to satisfy acceptance criterion #2. Stage `package.json` + `package-lock.json` together. Commit message exactly: `chore(deps)(adapters-cycle-2): add openai SDK as optionalDependencies (T0.1 / ADR D2)`. No sole-authorship-trailer policy violation.

# SEPA — Iteration 1 / Task T0.1 / Phase pre-RED

## Plan recap
- Add `croner ^10.0.1` to `package.json:dependencies` + regenerate lockfile; RED test asserts `Cron(...)` from `croner` exposes `.stop()` per plan T0.1 + ADR D10.

## Findings
- [CRITICAL] — `tests/unit/deps/` directory does NOT exist yet. The RED file path `tests/unit/deps/croner-import.test.ts` requires creating the directory. Ensure the RED phase creates the dir AND the file in the same step; do not commit an orphan dir.
- [MAJOR] — RED MUST fail BEFORE `package.json` is edited (Inquebrável Rule 5 + cycle-implement Hard Gate #2). Run the test FIRST against the untouched `package.json` — vitest/tsc will fail on `import { Cron } from 'croner'` (module not resolvable). Confirm the failure mode is "Cannot find module 'croner'" — NOT a syntax error or unrelated failure. If the test passes prematurely (e.g., croner sneaked in via transitive), halt + investigate.
- [MAJOR] — Per ADR D10, the pin is exactly `^10.0.1` (caret, NOT `~` and NOT `=`). DoD grep `grep '"croner":' package.json | grep '\^10.0.1'` is the inquebrável check.
- [MAJOR] — `croner` MUST land in `"dependencies"` (RUNTIME), NOT `"devDependencies"`. Plan D10 + § Dependencies row are explicit: `SleepTimeReflectionPolicy` is public-facing in `@usetheo/memory/local`; consumers need it at runtime.
- [MINOR] — RED assertion should target the PUBLIC API surface T3.1 will use: `new Cron('* * * * *', { paused: true })` + `.stop()` method existence.
- [INFO] — Post-GREEN, run `npm install` (NOT `npm ci`); regenerate lockfile. Stage BOTH `package.json` AND `package-lock.json` in same commit. `npm audit` post-install MUST be clean.

## Recommended action
- Write `tests/unit/deps/croner-import.test.ts` with `import { Cron } from 'croner'` + `expect(typeof new Cron('* * * * *', { paused: true }).stop).toBe('function')`. Create the `tests/unit/deps/` dir. Run `npm test -- tests/unit/deps/croner-import.test.ts` and CONFIRM the failure message is "Cannot find module 'croner'". Do NOT proceed to GREEN until this exact RED failure mode is observed.

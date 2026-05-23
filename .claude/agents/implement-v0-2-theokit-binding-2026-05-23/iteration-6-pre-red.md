# SEPA — Iteration 6 / Task T2.3 / Phase pre-RED

## Critical findings
- `.github/workflows/` DOES NOT EXIST. Plan's "or equivalent" → use npm script `publish:check` (KISS; no CI infra fabrication).
- Hook validate-command.sh regex `npm[[:space:]]+(publish|unpublish)` blocks bare `npm publish` but NOT `npm run publish:check` (run+space+publish:check doesn't match regex).
- package.json `files` allow-list already correctly excludes test files (lines 27-29) — exclusion test should pass on first run as regression guard.

## Revised 3 RED tests
1. test_package_json_is_publishable (private absent; files includes src/**/*.ts + migrations)
2. test_publish_check_script_exits_zero (`npm run publish:check` exit 0; script body is the dry-run command — hook only sees the RUN invocation)
3. test_packed_tarball_excludes_test_artifacts (`npm pack --dry-run --json`; parse JSON; assert no __tests__/.test/.test-d entries)

## Commit framing
- `chore(publish): enable publish-readiness gate (T2.3)` — explicit framing as gate enablement, not production-ready claim.
- v1.0 production claim still gated by /dogfood per CLAUDE.md.

## Proceed to RED.

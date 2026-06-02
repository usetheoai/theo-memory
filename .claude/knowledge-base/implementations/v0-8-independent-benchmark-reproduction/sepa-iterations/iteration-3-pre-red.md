# SEPA Pre-RED Brief — iteration 3, T2.1, MODE=TIGHT

**Task:** T2.1 Fixture downloader + 3 loaders
**Verdict:** PROCEED to RED

## Critical pre-GREEN check
- **`tsx` NOT in package.json** — only `jiti` (Vitest loader). Plan declared `tsx benchmarks/scripts/download-fixtures.ts` but adding `tsx` would introduce a NEW dep not in plan v1.2 Dependencies section (audited by /deps-audit at PASS_WITH_CAVEATS).
- **Drift-T2.1-1 (documented):** write downloader as `benchmarks/scripts/download-fixtures.mjs` (plain JS, Node 20+ native fetch). EC-6 intent (cross-platform, no wget) fully preserved — `.mjs` runs with bare `node` on macOS/Linux/Windows. Operational tooling doesn't need TS for a ~50-LoC fetch-and-save script.

## Order
1. Sample fixtures at `tests/fixtures/benchmarks/{longmemeval,locomo,dmr}-sample.json`
2. RED loader tests: `src/benchmarks/fixtures/__tests__/loader.test.ts`
3. GREEN: 3 loaders (longmemeval / locomo / dmr) + normalizeLongMemEvalAnswer
4. Downloader `.mjs` + idempotency
5. README.md + .gitignore + package.json npm script

## Verified URLs (from snapshots)
- LongMemEval: 3 HF URLs at `xiaowu0162/longmemeval-cleaned`
- LoCoMo: snap-research GH raw `main/data/locomo10.json` (CC-BY-NC-SA per ADR D4)
- DMR: derive at T7.2; T2.1 just parses derived JSON

## EC absorptions
- EC-1: normalizeLongMemEvalAnswer with 4 branches (string/number/{text}/fallback-stringify)
- EC-6: Native Node 20+ fetch (no wget); `.mjs` drift documented above
- EC-8: HEAD-Content-Length size match → skip; else re-download with warning

## Risks acknowledged
- LongMemEval 3GB → tests mock fetch
- DMR loader minimal (T7.2 widens schema)
- LoCoMo CC-BY-NC-SA banner in console + README

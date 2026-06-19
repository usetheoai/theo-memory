# Review: dashboard-phase2a-attribution-asof

**Date:** 2026-06-19
**Reviewers (independent parallel agents):** 3 (architecture+wiring, test-quality, cross-validation+semantics)
**Slices reviewed:** theo-cloud `927ce89..aec4041` (gateway + dashboard) + theo-memory `ed481fd`,`3ebe8e9` (metrics/entities fix + tests + plan)
**Verdict:** READY_TO_MERGE (with one documented re-validation caveat)

## Summary

3 independent adversarial reviewers audited Phase 2A (attribution-write `attributedTo` + bi-temporal recall `asOf`). Architecture+wiring and test-quality returned CLEAN_OR_MINOR. Cross-validation surfaced 1 HIGH + 3 MEDIUM — all **plan↔reality reconciliation + in-repo disclosure** gaps (NOT code defects); the code itself was found clean (no fabricated symbols, no TODO/FIXME, accurate CHANGELOGs, real edge-case tests, wiring triad complete). The critical honesty check PASSED: the metadata fix is genuinely proven by the unit test (the fixture uses the real `getAll()` metadata contract and FAILS against the old handler). All HIGH/MEDIUM findings were resolved before this verdict.

## Findings + resolutions

| ID | Sev | Summary | Resolution |
|---|---|---|---|
| F-xval-4 | HIGH | The patched-image e2e caveat (clean rebuild blocked by sharp CDN) was disclosed to the user but NOT recorded in any repo artifact. | **RESOLVED** `aec4041`/`3ebe8e9` — recorded in the theo-cloud CHANGELOG entry + the plan Global DoD. |
| F-xval-1 | MEDIUM | Plan Goal/ADR D1/DoD still claimed "wiring-only, NO theo-memory change" but `ed481fd` changed theo-memory. | **RESOLVED** `3ebe8e9` — plan § Reality reconciliation discloses the cross-repo metadata fix; DoD line corrected. |
| F-xval-2 | MEDIUM | The `infer:false`-when-peer semantic was not in the plan contract. | **RESOLVED** `3ebe8e9` — added ADR D4 (decision + owner sign-off + verbatim consequence + rejected alternatives). |
| F-xval-3 / F-correct-8 | MEDIUM/LOW | Dashboard user not told attributing → verbatim storage (no fact extraction). | **RESOLVED** `aec4041` — Playground peer field helper text: "Stores the fact verbatim (skips auto fact-extraction)." |
| F-test-2 | LOW | No test locked the `peerOf` empty-string-in-metadata guard. | **RESOLVED** `3ebe8e9` — added test (empty-string metadata.attributed_to excluded from entity_count); 169/169. |

### Accepted caveats (LOW — do not block; documented)

- **F-arch-3 (LOW)** — `peerOf()` is duplicated verbatim in `metrics.ts` + `entities.ts` (DRY). Deferred: only 2 sites (Regola di 3 not met), ~6 trivial lines, and extracting it would require re-transpiling + regenerating the patched e2e image for no behavior change. Follow-up: extract to a shared `attributed-peer.ts` on the next theo-memory touch.
- **F-test-3 (LOW)** — the attribution e2e proves persistence for one subject but does not assert cross-subject isolation of the new entities path. Mitigation: isolation is structurally guaranteed by the SAME auth-derived-subject handler path that `TestMemoryE2E_GatewayProxyRoundTrip` already proves isolated for list/forget. Follow-up: add a beta-subject entities assertion on the next e2e run.
- **Clean-rebuild re-validation** — the green `make e2e` ran against `themory-e2e:patched` (transient sharp CDN blocked a clean rebuild). The fix is in source + unit-proven (169/169). Re-run a clean `make e2e` when the CDN recovers.

## Coverage Matrix verification (cross-validation agent)

| Row | Real? | Evidence |
|---|---|---|
| attribution-write (`attributedTo`) | YES | client+handler+Playground; unit (threaded + infer:false w/ peer, infer unset w/o) + vitest + e2e (entities contains peer). Requires ADR D4 infer:false + ed481fd metadata fix |
| bi-temporal recall (`asOf`) | YES | client+handler+Playground datetime-local→RFC3339; vitest EC-1 exact value + e2e |
| `asOf` RFC3339 → 400 | YES | handler `time.Parse(time.RFC3339)`→400 (ADR D2); unit (client not called) + e2e |
| e2e proof | YES (patched-image caveat) | round-trip green on `themory-e2e:patched`; unit-proven; clean rebuild deferred |
| READY_TO_MERGE | YES | this review (3 agents); all HIGH/MEDIUM resolved |

## Quality gates
- theo-cloud: `go build` + `go vet` + `go test ./... -race` GREEN; dashboard memory 23/23 + `tsc -b` clean.
- theo-memory: `pnpm --filter @usetheo/memory-api test` 169/169 GREEN; lint clean (`tsc --noEmit` TS2209 is a PRE-EXISTING export-map config artifact, confirmed at parent commit).
- e2e: `make e2e` PASS (against `themory-e2e:patched`; clean-rebuild re-validation deferred per the documented caveat).

## Honesty (Inquebrável Rule 3)
Two real plan-vs-reality divergences (theo-memory metadata fix `ed481fd`; `infer:false`-when-peer semantic `a163546`) were disclosed in commits + CHANGELOGs + (now) the plan, and owner-approved. No fabricated values. The patched-image e2e validation is now recorded in-repo. The verbatim-storage consequence is surfaced to the dashboard user.

## Verdict: READY_TO_MERGE
0 BLOCKER. 0 unresolved HIGH (F-xval-4 disclosed in-repo). 0 unresolved MEDIUM (plan reconciled + ADR D4 + UX hint). 2 LOW accepted with documented follow-ups + 1 clean-rebuild re-validation caveat. The merge `develop → main` is a human decision (Inquebrável Rule 4).

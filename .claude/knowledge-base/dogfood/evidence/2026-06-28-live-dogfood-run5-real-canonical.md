---
scenario: dashboard-memory-journey
date: 2026-06-28
status: running
operator: claude-code
outcome: fail
summary: "REAL canonical bring-up (make memory-up, themory-host, REAL OpenAI) — browser remember/recall PASS with real semantic scores 0.492/0.490; but SEC-77-PA [CRIT] = 422 not 403 → run FAIL. Root cause: provisioning over-scopes the broker platform-admin key with data scopes (issue usetheodev/theo-workspace#5). themory #77 guard is correct (read-only key → 403)."
build_under_test: "themory image b42b65078cd0 (#77) via make memory-up → themory-host on REAL OpenAI (text-embedding-3-small); edge :8090; data plane :18081"
---

# 2026-06-28 — Live dogfood run 5 (REAL canonical, no mock)

Re-run on the **canonical** real path demanded by the operator: `make up` + `make memory-up`
(real OpenAI, `themory-host`, **no mock container**), driven through the real edge and via
Chrome DevTools MCP. This run **supersedes run 4's mock-backed security batch**: run 4
asserted the SEC rows against the MOCK container (a narrowly-scoped key); this run asserts
them against the credential the **canonical bring-up actually mints**.

## Verdict: FAIL

A `SEC-77-*` row failed on the real system. Per the skill stop conditions, an authz-hole row
failing makes the run `FAIL` regardless of how many journeys pass — "a leak or an authz hole
is never partial."

**The failure is NOT in theo-memory's #77 fix** (the data-plane guard is correct — proven by
the read-only key returning 403). It is in the **provisioning layer**: `dev/memory-up.sh:68`
and `dev/provision-model-b.sh:32` (+ `theo-workspace/dev/` copies) mint the broker's
platform-admin credential with full data scopes, re-opening the least-privilege gap #77
closed. Tracked: **usetheodev/theo-workspace#5**.

## Browser (Chrome MCP) — REAL, PASS

| id | journey | result | evidence |
|---|---|---|---|
| UX-PLG-1 | Playground remember | PASS | "Stored 2 memory(ies)" — real GPT extraction of 2 structured facts; network `POST …/v1/memory/remember` → 201 |
| UX-PLG-2 | Playground recall | PASS | query "which database do I prefer and what is the deploy code" → both facts returned at cosine **0.492 / 0.490** (real semantic discrimination; vs mock ~0.16); network recall → 200 |

These two rows prove the **real** customer path (browser → Traefik `:8090` → ForwardAuth →
Model B broker → `themory-host` on real OpenAI) works end-to-end with genuine embeddings.

## HTTP security + isolation batch — REAL data plane (:18081)

| id | probe | observed | want | result |
|---|---|---|---|---|
| API-SEC-77-W | read-only key → POST /v1/remember | 403 | 403 | PASS |
| **API-SEC-77-PA** | **platform-admin key → POST /v1/remember** | **422** | **403** | **FAIL** |
| API-SEC-77-R | read-only key → POST /v1/remember (write) | 422 | !403 | PASS |
| API-KEY-ESC | customer key stripped at edge | 403 | 403 | PASS |
| API-AUTH-NEG | no auth → edge | 401 | 401 | PASS |
| XISO-1 | tenant B reads tenant A | 0 rows | 0 | PASS |
| XISO-2 | tenant A reads own | ≥1 row | ≥1 | PASS |

`SEC-77-W = 403` proves the #77 `requireScopeOnPrincipal('memory:write')` guard fires. The
platform-admin getting **422** means the request reached the body-validation handler — i.e.
the scope guard **passed**, because the canonically-minted platform-admin key genuinely
carries `memory:write`. Over-scoped minting credential, not a guard bug.

## Regression note (vs baseline.json from run 4)

`API-SEC-77-PA` was `pass` in the run-4 baseline. That baseline was measured against the
**MOCK container** (`container on mock-openai`), whose platform-admin key was narrowly scoped.
The real canonical provisioning over-grants, so the same row is now `fail`. This is a
**test/provisioning divergence that masked the hole** — the hermetic `make e2e-edge`
(`tests/e2e/run.sh`) also mints narrowly, which is why CI is green.

Per the skill rule "never write the baseline on a half-run", `baseline.json` is **left
unchanged** this run (CLI/SDK/MCP modalities were not re-driven on the real backend this
session — they were proven on mock in run 4). The SEC-77-PA regression is recorded here in
evidence, to be reflected in the baseline once the fix in #5 lands and the row is re-asserted
green on the real path.

## Build under test

- theo-memory image `b42b65078cd0` (#77) — confirmed the running themory.
- Brought up via `make up` then `make memory-up` → `themory-host`, **REAL** OpenAI
  (`text-embedding-3-small`), no mock.
- Edge `:8090` (Traefik + ForwardAuth), data plane `:18081`.

## Repro

1. `cd theo-workspace && make up && make memory-up` (requires `OPENAI_API_KEY` in the skill `.env`).
2. Browser: dashboard → Memory → Playground → Remember a fact, then Recall — observe real scores.
3. Security: extract `THEMORY_PLATFORM_ADMIN_KEY` from the theo-cloud container env into a shell var (never echo it); `curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:18081/v1/remember -H "Authorization: Bearer $PA" -H 'Content-Type: application/json' -d '{"user":"u","content":"x"}'` → **422** (bug; want 403).
4. Control: mint a `memory:read`-only key, same call → **403** (guard works).

## Follow-up

- **usetheodev/theo-workspace#5** — narrow all Model-B platform-admin mints to
  `["memory:platform-admin","memory:admin"]`; add a canonical-provisioning regression
  assertion to `make e2e-edge` so the test path matches the bring-up path.
- Re-run this dogfood after the fix; expect `SEC-77-PA → 403 PASS`, then update baseline.

_No secrets (keys/tokens/cookies) were printed in this evidence; the platform-admin key value was never echoed._

---

## Post-fix verification (same day) — SEC-77-PA now GREEN

The fix landed in all four provisioning scripts (platform-admin minted as
`["memory:platform-admin","memory:admin"]` — no data scopes). Re-ran the canonical bring-up
(`make memory-up` re-minted the live key narrow + recreated theo-cloud) on the same #77 build
(`themory-e2e:latest` = `b42b65078cd0`), REAL OpenAI, `:18081`, then re-probed:

| Probe | Got | Want | Result |
|---|---|---|---|
| platform-admin → POST /v1/remember | **403** | 403 | PASS (was 422) |
| read-only → POST /v1/remember | 403 | 403 | PASS |
| write-scoped → POST /v1/remember | 422 (body validation, not scope denial) | ≠403 | PASS |
| no auth → POST /v1/remember | 401 | 401 | PASS |

Least-privilege invariant (`theo-data/CLAUDE.md` #4) restored: the broker's minting credential
is 403 on every data verb. **usetheodev/theo-workspace#5 verified + closed.**

**Net verdict after fix:** the `dashboard-memory-journey` security/isolation contract is GREEN
on the real canonical path. Residual follow-up (non-blocking): wire the canonical-provisioning
regression assertion into `make e2e-edge` so CI mirrors the bring-up path.

---
scenario: dashboard-memory-journey
date: 2026-06-28
status: running
operator: claude-code
outcome: partial
summary: "browser breadth (9/9 memory tabs) + http + security(#77) + isolation ALL PASS live on the #77 build; mcp/cli/sdk SKIPPED (host dist not wired); 0 regressions"
build_under_test: themory-e2e:latest=b42b65078cd0 (#77); LLM=mock-openai (mock path; canonical real-OpenAI path now unblocked via .env)
---

# 2026-06-28 — Live dogfood run 2 (dashboard-memory-journey)

> Sibling of the LOCKED anchor `claude-code-auto-memory`. Real user-facing flow
> (browser → edge → theo-cloud → theo-memory) + data-plane security/isolation.

## Phase 0
- `.env` loaded (OPENAI_API_KEY present — canonical `make memory-up` now possible). Stack
  already healthy on the mock path (themory `:18081` 200, image b42b #77); ran against it.
- cli/sdk modalities SKIPPED — no `themory` on host PATH, `@usetheo/memory` not resolvable.

## Results — browser (9/9 memory tabs PASS)
| id | tab | evidence |
|---|---|---|
| UX-AUTH-1 | session | logged in; `/sessions/whoami` 200 |
| UX-OVW-1 | Overview | KPIs render; `/v1/dashboard/memory/metrics` 200 |
| UX-MEM-1 | Memories | list renders real memories (canary + DOGFOOD-UI); `/list` 200 |
| UX-EPI-1 | Episodes | temporal log + as-of replay; `/episodes` 200 |
| UX-PLG-1/2 | Playground | remember 201 + recall 200 (run 1) |
| UX-ENT-1 | Entities | real extracted entities (broker/PostgreSQL/edge/hardened…) by scope |
| UX-GRF-1 | Graph | force-directed view: 9 entities · 0 relations |
| UX-SKL-1 | Skills | renders (empty state — none authored) |
| UX-EXP-1 | Exports | renders (Create export + empty state) |
| UX-WHK-1 | Webhooks | renders (Add webhook + empty state) |

## Results — http + security(#77) + isolation (7/7 PASS, re-run this session)
| id | outcome | evidence |
|---|---|---|
| API-REM-1 | pass | tenant-A remember → 201 |
| API-SEC-77-W | **pass** | read-only key → /v1/remember → 403 |
| API-SEC-77-PA | **pass** | platform-admin key → /v1/remember → 403 |
| API-SEC-77-R | **pass** | read-only key → /v1/recall → 422 (not 403) |
| API-KEY-ESC | **pass** | read-only mints platform-admin → 403 (anti-escalation) |
| API-AUTH-NEG | pass | no bearer → 401 |
| API-REM-NEG | pass | malformed → 422 |
| XISO-1 | **pass** | tenant-B recall of A's canary → 0 (no leak) |
| XISO-2 | **pass** | tenant-A recalls own → 1 |

## SKIPPED (honest)
- mcp / cli / sdk — host dist not wired (`npm run build` + node-linker=hoisted needed); covered by `make e2e` + the published image.

## Regressions vs baseline
- none — all rows that ran before still PASS (run 1 → run 2). Baseline updated with the browser-tab rows.

## Observations (dogfood signal)
- Graph shows 9 entities · 0 relations — entity extraction fired, relation/edge extraction did not for these simple facts (expected; worth a fixture with a relation).
- engine/* dashboard calls 502 (engine not in this stack) — known, out of the memory flow.
- LLM = mock-openai this run; the real-OpenAI canonical path is now unblocked via the skill .env.

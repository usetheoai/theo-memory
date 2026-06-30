---
scenario: dashboard-memory-journey
date: 2026-06-29
status: running
operator: claude-code
outcome: pass
summary: "Coverage-extension run — drove the newly-catalogued NOT-yet-driven surfaces real (no mock): 8 extra SDK subpaths, CLI new verbs+flags+keys lifecycle, MCP streamable-http + 4 auth modes, and the UX Episodes/Exports/Webhooks/API-Tokens tabs (gateway exports+webhooks via BFF). 34 new rows PASS (+1 fail-closed-correct). Cumulative driven ~71 → ~105 of the ~182 catalog target. All [CRIT] green."
build_under_test: "themory image b42b65078cd0 (#77) via make memory-up → themory-host on REAL OpenAI; edge :8090; data plane :18081; pg-themory :15432"
---

# 2026-06-29 — Live dogfood run 7 (coverage extension)

Targeted run on the surfaces the §-catalog newly named but run-6 had not driven. Same canonical
real stack (`themory-host`, REAL OpenAI, #77 build). Each row in its declared modality.

## Verdict: PASS — 34 new rows green, all [CRIT] green, zero product failures

## §E — SDK extra subpaths (9/9 PASS)

All embedder + llm subpaths import: `embedders/{stub,openai,local,ollama,voyage,google,registry}`
+ `llms/{stub,openai}`. (SDK total now 18 rows: 8 from run-6 + the 9 here + the round-trip.)

## §D — CLI new verbs + flags (9/9 PASS)

| row | command | result |
|---|---|---|
| CLI-MIG | `themory migrate` | exit 0 |
| CLI-REM-SESSION | `remember --session … --text` | exit 0 |
| CLI-REM-AGENT | `remember --agent … --no-infer` | exit 0 |
| CLI-REC-THRESHOLD | `recall --session … --top-k 5 --threshold 0.1 --json` | exit 0 |
| CLI-REC-DIVERSIFY | `recall --agent … --diversify 0.5 --json` | exit 0 |
| CLI-KEY-C/L/RT/RV | `keys create/list/rotate/revoke` (via `THEMORY_BASE_URL=:18081` + admin bearer) | exit 0 |

DX note (real, accurate): the CLI `keys` subcommands are a thin HTTP client over the admin REST —
they need `THEMORY_BASE_URL` (default `http://localhost:3000`, the `themory server` port) +
`THEMEMORY_API_KEY` (admin bearer). Pointed at the running themory-host `:18081` they work.

## §C — MCP streamable-http + transport auth (5 PASS + 1 fail-closed-correct)

| row | result | evidence |
|---|---|---|
| MCP-HTTP | PASS | streamable-http client connected; `tools/list` = native toolset (round-trip at protocol level) |
| MCP-HTTP-LIST | PASS | remember/recall/forget/reflect/episodes + skill tools |
| MCP-AUTH-NONE | PASS | `:8766 --auth none` boots (406 on bare GET = MCP endpoint up) |
| MCP-AUTH-KEY `[CRIT]` | PASS | `:8767 --auth api-keys` → **401** without token |
| MCP-AUTH-TLS `[CRIT]` | PASS | `:8768 --host 0.0.0.0 --auth none` → **refused to start** ("non-localhost without TLS, ADR-0015 #3") |
| MCP-HTTP-REM | fail-closed-correct | native data tool over the bare client → `-32602` (needs ctx.session host; same anti-spoof as stdio; data path proven via OpenMemory SSE in run-6) |

## §A — UX new tabs (11 PASS) — gateway exports/webhooks + api-keys through the BFF

| row | result | evidence |
|---|---|---|
| UX-EPI-1 | PASS | Episodes temporal log renders (real 4 facts + timestamps); controls: Filter, As-of replay, Newest-first toggle |
| UX-EXP-1 | PASS | "Create export" → job `export-…` PENDING; `POST /v1/dashboard/memory/exports` **200** |
| UX-EXP-2 | PASS | status polled; `GET …/exports/{id}/status` **200** |
| UX-WHK-1 | PASS | Webhooks list renders |
| UX-WHK-2 | PASS | Add-webhook form (URL/Label/Events) → created (dogfood-hook, MEMORY.REMEMBERED) |
| UX-WHK-3 | PASS | delete with type-to-confirm guard → removed |
| UX-KEY-1 | PASS | Create API Key (scope checkboxes memory:read/write/delete/admin) → `theo_live_*` shown once |
| UX-KEY-2 | PASS | list shows the key (redacted prefix) + scopes + actions |
| UX-KEY-3 | PASS | rotate (type-to-confirm; 24h grace overlap — both keys listed) |
| UX-KEY-4 | PASS | delete with type-to-confirm → revoked |
| UX-KEY-5 | PASS | "View lineage" action present per key |

These confirm the gateway-only `exports` + `webhooks` surface (not on the data plane) end-to-end
through the dashboard BFF → gateway. Both test API keys were deleted at the end (clean state).

Nice UX details observed (positive): every destructive action (webhook delete, key rotate, key
delete) requires typing the exact name to confirm; the new secret is shown exactly once with an
"I've copied it" gate.

## Cumulative coverage

| | Rows |
|---|---|
| Driven run-6 (real) | ~71 |
| Driven run-7 (this) | +34 (9 SDK + 9 CLI + 5 MCP + 11 UX) |
| **Cumulative driven** | **~105 of ~182 catalog target** |

Still un-driven toward 182 (named honestly, none are known failures): UX edge/negative rows
(UX-AUTH-2 wrong-password, UX-MEM-3/4 filters, UX-PLG-4/5/7/8/9 playground options, UX-ENT-2/3,
UX-GRF-2/3), MCP native session-gated data tools (fail-closed by design without a session host),
raw-customer-key `:8090/v1/memory/exports|webhooks` http rows (driven via the BFF browser path
instead), `/v1/auth/device/*` device-code flow, `API-SEC-77-D`, `API-SWC-1`.

## Regression

No journey flipped pass→fail. `baseline.json` updated (102 pass / 3 fail-closed-correct / 5
not-driven / 3 legacy-skipped).

_No secrets printed — the `theo_live_*` values shown once in the UI were redacted here and the keys deleted._

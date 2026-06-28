---
scenario: dashboard-memory-journey
date: {{YYYY-MM-DD}}
status: running
operator: {{operator-name}}
outcome: {{pass | partial | fail}}
summary: {{one line — e.g. "14/16 journeys pass; 0 regressions; SEC-77 + ISO all green"}}
build_under_test: {{themory image id / git sha}}
---

# {{YYYY-MM-DD}} — Live dogfood run (dashboard-memory-journey)

> Sibling scenario of the LOCKED anchor `claude-code-auto-memory`. This evidence covers the
> real user-facing journey (browser → edge → theo-cloud → theo-memory), NOT the MCP anchor.

## Build under test

- themory image: `{{image-id}}` (rebuilt fresh this run: {{yes/no}})
- edge: `:8090` (theo-workspace Traefik) · data plane: `:18081` (host)
- Model B platform-admin: provisioned {{yes/no}}

## Results

| ID | Type | Outcome | Evidence |
|---|---|---|---|
| M-AUTH-1 | journey | {{pass/fail}} | {{screenshot / `/sessions/whoami` 200}} |
| M-WRITE-1 | journey | {{pass/fail}} | {{`POST …/remember` 201 + toast}} |
| M-READ-1 | journey | {{pass/fail}} | {{recall returned canary, score X}} |
| ... | ... | ... | ... |
| ISO-1 | isolation | {{pass/fail}} | {{user-2 recall of user-1 canary → empty}} |
| SEC-77-1 | security | {{pass/fail}} | {{read-only key → /remember → 403}} |
| SEC-77-2 | security | {{pass/fail}} | {{platform-admin → /remember → 403}} |

## Regressions vs baseline

- {{none — or list journey ids that flipped pass→fail}}

## DX pains / observations (honest)

- {{anything that worked but felt wrong — the dogfood signal}}

## Reproduction

```bash
# exact commands + the journey nonce used this run
```

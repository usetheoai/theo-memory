# Dogfood driver — API surface (includes the `themory` CLI verbs — Q2)

> Tells Claude Code how to execute each J-API-* / J-CLI-* journey from
> `knowledge-base/dogfood/journeys.md` AS A HUMAN (real `curl` + the `themory` bin) and record one
> evidence file per journey (frontmatter per `dogfood-golden-rule.md § 5`). `oracle_result` =
> HTTP status + body shape (or CLI exit + stdout shape). **Secrets redacted** to `theo_live_` /
> `sk-or-` + ≤4 chars (EC-2) — evidence records key PREFIXES only, never a full key.

## Preconditions

- `themory server` up (`:18081`) against a real pgvector; a minted `theo_live_*` data key for a
  workspace + scope (via the admin bootstrap). The `themory` bin built.

## On failure (EC-8 — every journey)

Oracle command/path unresolvable at run time → write `outcome: fail reason=oracle_unresolvable`,
never a silent skip. A red journey is a finding.

## Per-journey protocol

| Journey | Steps (human) | Oracle (`oracle_result`) |
|---|---|---|
| J-API-1 | `curl POST /v1/{remember,recall,forget,reflect}` with bearer | each 200 + body shape per verb; record status + shape |
| J-API-2 | `GET /v1/scopes/:type/:id/{memories,entities,graph,episodes,metrics}` for a seeded scope | 200 + non-empty projection; record counts |
| J-API-3 | send a `theo_live_*` key, then a non-`theo_live_` token, then no header | `theo_live_*`→200; missing→401 (fail-closed); non-`theo_live_`→OIDC path; record the 3 statuses |
| J-API-4 | admin `POST/GET/rotate/revoke /v1/admin/keys/*` + `/v1/members` RBAC | each lifecycle op 2xx; under-scope → 403; record statuses (KEY PREFIXES only — EC-2) |
| J-API-5 | `GET /v1/health` during warm-up then after | 503 `warming_up` then 200; record both |
| J-API-6 | `GET /graph` default then `?includeSuperseded=true`; `GET /entities` | default hides superseded; toggle surfaces it with `active` flag; entity `summary` non-empty; record edge/active + summary text |
| J-API-7 | run `themory {remember,recall,forget,reflect,keys,health}` | each verb exit 0 + expected stdout shape; record exit codes |

## Evidence template

```yaml
---
journey: J-API-<N>
date: <today>
operator: claude-code
outcome: pass | partial | fail
oracle_result: "<HTTP status + body shape / CLI exit + stdout shape; key PREFIXES only>"
summary: <one line>
---
```

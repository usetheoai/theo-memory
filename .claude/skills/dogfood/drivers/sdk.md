# Dogfood driver — SDK surface

> Tells Claude Code how to execute each J-SDK-* journey from `knowledge-base/dogfood/journeys.md`
> AS A HUMAN and record one evidence file per journey under `knowledge-base/dogfood/evidence/`
> (frontmatter per `dogfood-golden-rule.md § 5`: `journey/date/operator/outcome/oracle_result/summary`).
> `oracle_result` = the machine-observable proof (suite exit code + key assertion value). Secrets
> redacted to `theo_live_`/`sk-or-` + ≤4 chars (EC-2).

## Preconditions

- `THEOMEM_PG_URI` points at a real `ankane/pgvector:v0.5.1`.
- `npm run build` done (integration suites import the built `@usetheo/memory`).

## Oracle preference order (per journey)

existing integration suite > REST round-trip > ad-hoc SDK snippet. Every oracle asserts
**structure/behaviour** (row present, cosine > threshold, active flag), never LLM wording
(recall extraction is non-deterministic).

## On failure (EC-8 — every journey)

If a journey's oracle command/path does not resolve at run time (suite renamed/deleted), write
`outcome: fail reason=oracle_unresolvable` — NEVER skip silently. A red journey is a finding, not
a plan failure; record it honestly so the audit (`run_journey_audit.py`) reports INSUFFICIENT.

## Per-journey protocol

| Journey | Steps (human) | Oracle (`oracle_result`) |
|---|---|---|
| J-SDK-1 | remember a fact then recall it (user scope) | run a `remember→recall` integration test / snippet; record exit 0 + the recalled item in top-k |
| J-SDK-2 | remember into user/session/agent tiers; recall each | assert a recall in one tier does NOT return another tier's rows; record the per-tier counts |
| J-SDK-3 | `forget(id)` (soft) then `forget(id, {hard:true})` | soft: `t_invalid` set (row hidden); hard: row + entity FK gone; record both row states |
| J-SDK-4 | seed ≥50 memories then `reflect()` | run `tests/integration/reflection`; record exit 0 + ≥1 derived row's `derivedFrom` |
| J-SDK-5 | `skills(repo).add` two equivalent skills then consolidate | 2 → 1 derived with both source ids in `derivedFrom`; record the derived hash |
| J-SDK-6 | remember relational facts; read entities + graph (+asOf) | run `tests/integration/entities`; record exit 0 + a hop-2 traversal honoring `t_invalid`/asOf |
| J-SDK-7 | write + list an episode under a scope | record the episode id returned + its presence in the scope listing |
| J-SDK-8 | remember, supersede, `recall({asOf})` a past instant | record the recalled state valid at `asOf` (the pre-supersession value) |
| J-SDK-9 | remember with `attributedTo` two peers; recall filtered | record the per-peer recall counts (filter isolates the peer) |
| J-SDK-10 | fill capacity; verify eviction + long-tail survival | run `tests/integration/{eviction,forgetting}`; record exit 0 + rare-isolated survives ≥5 LRU |
| J-SDK-11 | reflect over contradicting episodic facts | run `tests/integration/distillation`; record exit 0 + the conflict resolution kept/rejected ids |
| J-SDK-12 | recall the same query twice (near-duplicate) | run the cache path; record the 2nd query served from cache (hit metric > 0) |

## Evidence template (per journey)

```yaml
---
journey: J-SDK-<N>
date: <today>
operator: claude-code
outcome: pass | partial | fail
oracle_result: "<exit code + key assertion value>"
summary: <one line>
---
```

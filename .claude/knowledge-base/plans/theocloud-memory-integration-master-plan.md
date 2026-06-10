---
slug: theocloud-memory-integration-master
created_at: 2026-06-10
goal: "Close all 11 TheoCloud ↔ TheMemory integration gaps identified post-v0.2.0 RED TEAM, measured by dashboard CRUD functional + Docker image current + theo-cloud released to main."
---

# Master Plan: TheoCloud ↔ TheMemory Integration Completion

> **Version 1.0** — index of 3 sub-plans covering 11 integration gaps. Created 2026-06-10 after the v0.2.0 release + 107-scenario RED TEAM validation surfaced what's shipped vs what's missing.

## Purpose

This is NOT an implementation plan — it is an **index** that tracks ordering, dependencies, and status of 3 sub-plans. Each sub-plan follows the full cycle-plan chain independently (`/to-plan` → `/edge-case-plan` → `/deps-audit` → `/plan-confidence` → `/implement` → `/review`).

## Execution order (strict — each plan's output is the next plan's pre-condition)

```
Plan A (release + Docker + ops docs)
  ↓ unblocks production deploy
Plan B (dashboard CRUD + UX)
  ↓ unblocks operator-facing memory management
Plan C (analytics + BFF extensions)
  ↓ completes the dashboard integration surface
```

## Sub-plans

### Plan A — `theocloud-release-and-docker-rebuild`

| Field | Value |
|---|---|
| **Slug** | `theocloud-release-and-docker-rebuild` |
| **Scope** | #1 theo-cloud PR develop→main + #7 Docker image rebuild + #9 key rotation doc |
| **Repos** | theo-cloud (PR + CI) + theo-memory (Docker) |
| **Estimated effort** | 1-2h |
| **Goal (SMART)** | "Cut theo-cloud release PR with 5 commits (BFF category, CSP, F7, date-range, RED TEAM docs), rebuild + push `ghcr.io/usetheo/themory:0.2.0` Docker image with rate-limit + CORS + category, and document API key rotation procedure, measured by `docker pull ghcr.io/usetheo/themory:0.2.0` succeeding + theo-cloud PR merged." |
| **Items covered** | #1, #7, #9 |
| **Status** | `NOT_STARTED` |
| **Plan file** | `knowledge-base/plans/theocloud-release-and-docker-rebuild-plan.md` |

### Plan B — `dashboard-memory-crud-and-ux`

| Field | Value |
|---|---|
| **Slug** | `dashboard-memory-crud-and-ux` |
| **Scope** | #2 remember UI + #3 recall UI + #4 reflect trigger + #10 pagination + #11 sort |
| **Repos** | theo-cloud (dashboard React + BFF Go proxy) |
| **Estimated effort** | 4-8h |
| **Goal (SMART)** | "Ship dashboard CRUD for memories (remember form + semantic recall search + reflect trigger button) plus pagination controls and sortable columns on the memories table, measured by RED TEAM re-run of S1-S4 scenarios passing via browser E2E." |
| **Items covered** | #2, #3, #4, #10, #11 |
| **Depends on** | Plan A (theo-cloud must be on `main` with the BFF fixes before adding new dashboard features) |
| **Status** | `NOT_STARTED` |
| **Plan file** | `knowledge-base/plans/dashboard-memory-crud-and-ux-plan.md` |

### Plan C — `dashboard-memory-analytics`

| Field | Value |
|---|---|
| **Slug** | `dashboard-memory-analytics` |
| **Scope** | #5 metrics/analytics page + #6 entities category column + #8 BFF remember proxy |
| **Repos** | theo-cloud (BFF Go + dashboard) + theo-memory (metrics endpoint if needed) |
| **Estimated effort** | 3-5h |
| **Goal (SMART)** | "Ship dashboard analytics (real metric counters, entity category aggregation) and BFF remember proxy so the dashboard can write memories directly, measured by metrics page showing non-zero counters + entities page showing category column + POST /v1/dashboard/memory/remember returning 201." |
| **Items covered** | #5, #6, #8 |
| **Depends on** | Plan B (dashboard CRUD must exist before wiring the BFF remember proxy through it) |
| **Status** | `NOT_STARTED` |
| **Plan file** | `knowledge-base/plans/dashboard-memory-analytics-plan.md` |

## Items ↔ Plans mapping (Coverage Matrix)

| # | Item | Plan | Task(s) |
|---|---|---|---|
| 1 | theo-cloud release PR develop→main | A | T1.1 |
| 2 | Dashboard remember UI | B | T1.1 |
| 3 | Dashboard recall UI | B | T2.1 |
| 4 | Dashboard reflect trigger | B | T3.1 |
| 5 | Metrics/analytics page | C | T1.1 |
| 6 | Entities category column | C | T2.1 |
| 7 | Docker image rebuild (v0.2.0) | A | T2.1 |
| 8 | BFF remember proxy | C | T3.1 |
| 9 | BFF key rotation doc | A | T3.1 |
| 10 | Pagination UI | B | T4.1 |
| 11 | Sort by column | B | T4.2 |

**Coverage: 11/11 items mapped (100%)**

## Cadence discipline

For EACH sub-plan, the chain is:

```
/to-plan {slug}
  → /edge-case-plan {slug}
  → /deps-audit {slug}
  → /plan-confidence {slug}
  → (optional /plan-improve if score < 70)
  → /implement {slug}
  → /code-quality {slug}
  → /review {slug}
  → /release (if applicable)
```

**NEVER skip a step.** If context resets between sessions, read THIS file first to find the current sub-plan + its status, then resume at the last incomplete step.

## Status tracker (update after each sub-plan completes)

| Plan | /to-plan | /edge-case | /deps-audit | /plan-confidence | /implement | /review | /release | Status |
|---|---|---|---|---|---|---|---|---|
| A | done (f6af16f) | done (3 MUST FIX absorbed → v1.1) | done (PASS — 0 new deps) | done (89 SHIPPABLE_WITH_CAVEATS) | - | - | - | /plan-confidence DONE; next: /implement |
| B | - | - | - | - | - | - | - | NOT_STARTED |
| C | - | - | - | - | - | - | - | NOT_STARTED |

## How to resume after a session break

1. Read THIS file (`knowledge-base/plans/theocloud-memory-integration-master-plan.md`)
2. Check the Status tracker above — find the first `NOT_STARTED` or `IN_PROGRESS` plan
3. Read the sub-plan's file (`knowledge-base/plans/{slug}-plan.md`)
4. Resume at the last incomplete step in the cadence chain
5. After the sub-plan completes, update the Status tracker in THIS file and move to the next plan

## Honest scope note

This master plan covers the **TheoCloud integration surface only**. It does NOT cover:
- `/dogfood` anchor scenario (separate track per CLAUDE.md § PRIORITY 0)
- Xenova/protobufjs CVE upgrade (task #87, separate cycle)
- 103 pre-existing integration test failures (dim mismatch + pack manifest; separate hygiene cycle)
- CLI `health --deep` wiring bug (RED TEAM finding; separate fix)
- v1.0 production-ready gate (blocked on /dogfood)

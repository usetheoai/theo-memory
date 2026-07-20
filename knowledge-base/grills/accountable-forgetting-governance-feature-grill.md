---
slug: accountable-forgetting-governance
generated_by: roadmap-feature
milestone_id: M4
date: 2026-07-20
status: completed
---

# Feature grill — M4 accountable-forgetting governance (S3)

## Q1 — What is this feature and why now?

**Answer (user chose: full trio):** M4 = the governance + operator-surface layer that turns
"accountable forgetting" from a technical wedge into a governed, demoable product:
(a) **per-tenant retention/opt-out policy** for `recall_traces` (bounds unbounded table
growth — the load-bearing piece that makes it safe to enable in prod + makes "governed
per-tenant" honest); (b) **MCP tool** (`explain_recall` / `why_dropped`) so an agent can
query the negative-space; (c) **dashboard view** where an operator SEES what was dropped
and why. **Why now:** S1 (write) + S2 (read REST) shipped ad-hoc (v0.35.0 pending) — the
raw capability exists but is neither governed (cost-unbounded) nor surfaced (not demoable),
so the differentiator is a technical wedge, not a moat. HONEST CAVEAT (roadmap-feature
recommended against this scope): the dashboard lives in theo-cloud (cross-repo, like M3),
so M4 spans 2 repos and will likely decompose into phases at /to-plan (possible NEEDS_SPLIT).

## Q2 — Dependencies

**Answer:** Hard dep = the ad-hoc recall-trace surface S1 (write) + S2 (read REST), shipped
in v0.35.0. Soft dep = M3 [x] (the theo-cloud dashboard infra the accountable-forgetting
view reuses). None of M0-M2 (orthogonal context-graph track) is a dependency.

## Q3 — Definition of Done (full trio)

**Answer:**
1. `RecallTraceRetentionPolicy` DIP + per-workspace config (max-age / opt-out) + a sweep;
   integration test: traces older than the retention window are swept; an opted-out
   workspace writes 0 rows.
2. MCP tool `explain_recall` registered, workspace-scoped, MCP round-trip test (recall_id → drops).
3. [theo-cloud, CROSS-REPO] dashboard view lists recent recall_ids + drills into the drops; e2e/dogfood.
4. CHANGELOG `[Unreleased]` + README/docs updated.
5. Retention default is safe (opt-out = tracing off; no unbounded growth by default).

## Q4 — Top 2 new risks

**Answer:**
1. Cross-repo — the dashboard lives in theo-cloud → cycle-release (single-repo) can't verify
   the view; risk of marking M4 done with the dashboard lagging. Mitigate: split DoD (theo-memory
   pieces gate the flip; dashboard tracked cross-repo).
2. Retention sweep correctness under multi-tenancy — a DELETE FROM recall_traces must be
   workspace-scoped + race-safe or it could delete another tenant's traces / leave orphans.
   Mitigate: workspace-scoped DELETE + race-aware test; opt-out fail-closed.

## Step 5 — SOTA delta

No new peers. Existing references (REDACTED / REDACTED / openmemory) already cover the competitive
landscape; retention is a standard TTL-sweep pattern, MCP mirrors the shipped MCP surface,
dashboard mirrors M3 (theo-cloud). Catalog untouched.

---
status: completed

---
slug: crossval-recall-identity-fixes
generated_by: roadmap-feature
milestone_id: M28
date: 2026-07-27
status: completed
---

# Feature grill — crossval-recall-identity-fixes (M28)

## Q1 — What / why now
Live cross-validation theo-memory vs mem0 (official mem0 MCP + theo-memory MCP, same 8-fact/5-query
dataset, 2026-07-27) surfaced 2 concrete gaps where mem0 edged theo-memory: (1) recall precision@1
4/5 vs mem0 5/5 — query "profissão do **usuário**" returned the café fact at top-1 (lexical trap: the
speaker is normalized to `user`, so a PT query with "usuário" matches facts literally containing
"usuário" over the speaker fact) — issue #157; (2) the theo-memory MCP writes under a fixed
`claude-code` identity, so memories written via MCP are invisible in the authenticated user's
dashboard (MCP identity ≠ dashboard identity).

## Q2 — Dependencies
M15 (entity boost — the lexical/entity boost that causes the #157 top-1 inversion) + M8
(`(workspace,user)` isolation / Principal resolution the MCP-identity fix reuses). Both `[x]`.

## Q3 — Definition of Done
User chose **both findings**. MCP identity: **resolve user from credential + `claude-code` fallback**
(non-destructive). 4-bullet DoD in ROADMAP.md § M28, anchored on the A/B regression test.

## Q4 — Top new risks
R1 speaker-alias over-matching (a `user`↔`usuário`↔`você` expansion could hurt other queries) → the
A/B regression (5 queries) guards precision@1 before/after. R2 MCP identity change breaks consumers
pinned to `claude-code` → default resolved-user WITH fallback; integration test both paths.

## Step 3 — Out-of-scope cross-check
No overlap (out-of-scope = Graph-DB backend, wrapping competitors, eager summaries). Feature is
recall/identity correctness.

## Step 5 — SOTA delta
None. mem0 already cloned; the A/B regression IS the parity guard.

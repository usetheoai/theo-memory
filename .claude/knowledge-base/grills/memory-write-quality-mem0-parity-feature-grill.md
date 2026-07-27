---
slug: memory-write-quality-mem0-parity
generated_by: roadmap-feature
milestone_id: M27
date: 2026-07-27
status: completed
---

# Feature grill — memory-write-quality-mem0-parity (M27)

## Q1 — What is this feature and why NOW?

Trigger: dogfood of the deployed dashboard (session `93959d08…`) showed the Claude Code
kit storing, as if they were durable facts: 400-word transcript dumps of the assistant's
own narration, assistant questions ("Quer que eu prossiga…?"), and first-person
conversational voice ("Minha recomendação:", "Se você quer minha leitura:"). The v0.51.0
release fixed WHO the memory belongs to (attribution); this fixes WHAT/HOW — the content
that becomes memory. North-star declared by the user: "deixe o sistema próximo do Mem0"
(mem0 is the SOTA reference for write-distillation behavior; already cloned at
`knowledge-base/references/mem0`; the user is logged into mem0 and authorized live study).

## Q2 — Dependencies (which milestones must be [x] first)?

M14 (kit recall parity — the write source where pollution enters) + M21 (LLM-stage eval —
measures distillation quality objectively). Both already `[x]` → M27 starts immediately.

## Q3 — Definition of Done

User chose **Option C** (write-path root fix + one-shot cleanup of existing pollution +
dashboard attribution surface). Fact-gate is **default-ON** on the kit `infer:true` path;
`infer:false` verbatim path unchanged. 5-bullet DoD captured in ROADMAP.md § M27.

## Q4 — Top new risks

R1 over-filtering (false negatives — gate drops legit conversationally-phrased facts) →
mitig via M21 recall measurement + config-overridable threshold. R2 mem0-parity is
subjective → define the concrete metric up front (single-third-person-fact ratio judged by
the eval LLM, within X% of mem0 on the same transcript). R3 one-shot cleanup data loss →
dry-run + soft-delete (`t_invalid`, reversible) + per-item audit events.

## Step 3 — Out-of-scope cross-check

Keyword overlap detected: feature mentions "mem0"; out-of-scope item "Wrapping mem0 as a
backend or data-adapter". User decision: **Continue anyway** — `out_of_scope_overlap_false_positive:
"Wrapping mem0 as a backend or data-adapter"`. mem0 is used as a SOTA REFERENCE for
write-distillation behavior (study only), NOT wrapped as a backend or added as an SDK dep.
The out-of-scope item remains intact.

## Step 5 — SOTA delta

None. mem0 is already a cloned peer at `knowledge-base/references/mem0`. No new peer added.

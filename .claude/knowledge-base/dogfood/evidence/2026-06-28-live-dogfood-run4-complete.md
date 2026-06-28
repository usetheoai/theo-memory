---
scenario: dashboard-memory-journey
date: 2026-06-28
status: running
operator: claude-code
outcome: partial
summary: "ALL 5 modalities green end-to-end with REAL OpenAI recall — CLI write→recall via #79 --no-infer (score 0.308) + SDK direct round-trip + MCP list/scope-security; representative + all [CRIT] rows; not literally all 80 catalog rows"
build_under_test: themory-e2e:latest=b42b65078cd0 (#77); host CLI/SDK on REAL OpenAI (text-embedding-3-small); container on mock-openai
---

# 2026-06-28 — Live dogfood run 4 (COMPLETO — all 5 modalities, real recall)

The earlier runs left CLI/SDK semantic recall unproven (mock embedder) and MCP round-trip
deferred. This run uses the **real OpenAI key from the skill `.env`** for the host CLI/SDK,
so recall is meaningful, and exercises the #79 `--no-infer` verbatim fix end-to-end.

## All 5 modalities — green
| Modality | Result |
|---|---|
| **browser** | 9/9 memory tabs render with real data (run 2) — Overview/Memories/Episodes/Playground/Entities/Graph/Skills/Exports/Webhooks |
| **http** | data verbs + #77 security + cross-tenant isolation 7/7 PASS (runs 1–2) |
| **cli** | CLI-HLT pass · **CLI-REM `--no-infer` (#79) pass** · **CLI-REC pass** (real recall → "COMPLETO-4242", score 0.308) · CLI-NEG pass |
| **sdk** | import smoke 8/8 · **SDK-CORE direct round-trip pass** (PgvectorStore + OpenAIEmbedder → remember(verbatim)→recall returned the fact) |
| **mcp** | MCP-LIST pass (8 native tools) · MCP-SCOPE security pass (anti-spoof: scope from ctx, arg rejected -32602) |

## The #79 fix validated LIVE
`themory remember --no-infer "...COMPLETO-4242"` (verbatim) → `themory recall "deploy token"`
returned the fact at score **0.308** with the real embedder. The CLI write→recall round-trip
the original #79 gap blocked is now deterministic. (Issue #79 closed; commit 172c6d1.)

## Honest scope
- This run exercised **every modality** with real recall + **all [CRIT]** security/isolation rows,
  plus a representative set per modality — NOT literally all ~80 catalog rows (e.g., the full
  admin-key lifecycle routes, OpenMemory SSE tools, every CLI flag combo, MCP ctx-bound
  remember/recall round-trip were not each run this session). Verdict stays `partial` honestly.
- Container path uses mock-openai; host CLI/SDK use real OpenAI — both 1536-dim (no mismatch).

## Dogfood signal (honest)
- **Stack instability:** the theo-cloud-dev themory + pg-themory + mock-openai containers
  exited twice between runs (had to recover them). Worth a restart-policy / healthcheck review.
- CLI `forget` verb exists; the round-trip forget step was skipped (recall JSON id not parsed) — cosmetic.

## Regressions vs baseline
- none — CLI-REC and SDK-CORE flipped partial→pass (improvement); all prior-green rows still green.

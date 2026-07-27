# Review: M28 — crossval-recall-identity-fixes

**Date:** 2026-07-27
**Verdict:** READY_TO_MERGE

## Change under review
Recall #157 fix (theo-memory): `retrieval/speaker-alias.ts` — a speaker-referring query
(usuário/você/user) appends the `user` token to the BM25 keyword search + entity match (NOT the
semantic embed) so the speaker's own facts (stored under `user`) are reachable.

## Correctness + risk
- **Over-filtering (R1):** conservative trigger set (only unambiguous `usuário`/`voce`/`user`, whole-word,
  accent-tolerant); non-speaker queries are byte-identical (unit-proven). The other 4 A/B queries are
  guarded by the live regression (`docs/benchmarks/m28-recall-crossval-vs-mem0.md`) — P@1 must stay 5/5
  post-deploy for all 5.
- **Scope:** LEXICAL-only — the semantic embed stays on the original query, so the alias never distorts
  meaning, only reachability.
- **No index desync / layering clean:** speaker-alias is a pure domain helper; `pipeline.ts` gains only
  an import + 2 inline call-site swaps (stays 300 LoC).

## Identity half (honest scope)
NO theo-memory work — the MCP already prefers the edge-resolved user over the env default, proven by
`server-scope-merge.test.ts`. The deployed gap is the theo-cloud gateway (issue usetheodev/theo-cloud#256),
a cross-repo companion. Documented, not silently dropped.

## Gates
Unit 5/5 · retrieval suite 72/72 · full core 1076/1076 · typecheck + lint clean.

## Handoff
READY_TO_MERGE — the recall fix is self-contained + unit-proven; the empirical P@1 = 5/5 is the live
A/B regression run immediately post-deploy (the release-gate evidence). Identity is theo-cloud#256.

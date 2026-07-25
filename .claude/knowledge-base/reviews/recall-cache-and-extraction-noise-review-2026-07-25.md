# Review: recall-cache concurrency + extraction noise (#132, #111)

**Date:** 2026-07-25
**Reviewer:** 1 adversarial code agent (traced both fixes + all callers)
**Verdict:** READY_TO_MERGE (after fixes) — #132 had a HIGH (fixed), #111 a LOW (fixed).

## #132 — bounded SERIALIZABLE retry + fail-soft cache write

- **Retry mechanics — CORRECT.** 8 attempts / 7 retries on `40001`, then throw; `finally` releases
  the client on every path (success/throw/continue) — no connection leak. Pool default max=10; the 8
  attempts are SEQUENTIAL per writer (connect→release→reconnect), so peak checkouts = concurrent
  writers, not ×8 — the bound is safe, no circuit-breaker needed. `Math.random()` jitter is the
  textbook use (de-sync is the goal); bounded ~21ms/attempt.
- **HIGH (FIXED) — the fail-soft claim was false.** The reviewer showed `scoped-retrieval.ts` called
  `cache.set()` UNGUARDED, so retry exhaustion (or any error) rejected the whole `recall()` even
  though results were already computed. FIXED: `cache.set()` now wrapped in try/catch emitting the new
  `recall_cache_write_failed` event and returning the results — a genuine write-behind, which also
  fixes a PRE-EXISTING recall-break-on-cache-failure. New event + count sentinel updated; comment
  corrected to describe the guard.
- Regression: 6 concurrent set()s end exactly at cap with zero rejections, reliably green 10/10.

## #111 — extraction noise filter

- **READY_TO_MERGE.** The `FUNCTION_WORDS` gate ("every token is a closed-class function word → noise")
  is pure/total; multi-token logic is safe (`de Souza`/`para Deus` kept; `o de`/`para o` dropped). The
  single-token collisions (a proper noun that IS a function word) are a deliberate, correct
  precision-over-recall tradeoff — exempting them would resurface the exact #111 target `Não`.
- **LOW (FIXED)** — dropped the genuinely ambiguous `como` (Como the city) and `mais` from the set,
  honoring the filter's stated "excludes ambiguous words" principle. `startsWith('redacted')` prefix
  match is the correct shape for the `REDACTEDhighentropy` scrub residue.

## Quality gates
- Full contract suite 1365 pass, 0 fail; typecheck 0 errors; `/code-quality` PASS cap 100.
- cache + production-path integration 35 pass vs real pgvector; recall-cache lru 6-concurrent 10/10 reliable.

## Handoff
READY_TO_MERGE → `/release`. The one HIGH (false fail-soft claim) is fixed by making the cache write
genuinely best-effort; the LOW ambiguity is resolved.

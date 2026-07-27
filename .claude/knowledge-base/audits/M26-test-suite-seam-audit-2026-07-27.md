# M26 — Test-suite seam audit (coverage seams)

**Date:** 2026-07-27
**Motivation:** the attribution bug (assistant summary stored `attributed_to='user'`) passed a 100%-green
suite because the seam — `RememberOptions.attributedTo` × `infer:true` — was tested on neither side of
the interaction, and no real-consumer end-to-end exercised the kit hook → REST → store path. This audit
systematizes finding that class: untested feature interactions, false-green, and missing real-consumer tests.

## Seam map — capture hooks (the write/read sources)

| Hook | Direction | Pure builder (testable)? | Unit test | Real-consumer (payload→REST→store) | Status |
|---|---|---|---|---|---|
| `theo-remember` (Stop) | WRITE `/v1/remember` | `buildRememberPayload` ✓ | 4/4 | `tests/integration/kit-attribution-write.test.ts` ✓ | covered |
| `theo-precompact` (PreCompact) | WRITE `/v1/remember` | **was inline (untestable)** → extracted `buildPrecompactPayload` | **added 4/4** | shared `/v1/remember`→store path (proven by kit-attribution-write) | **CLOSED (this audit)** |
| `theo-onboard` | WRITE `/v1/remember` | ✓ | 6/6 | shared path | covered |
| `theo-tool-context` | READ `/v1/recall` | ✓ | 6/6 | — | covered |
| `theo-prompt-recall` | READ `/v1/recall` | ✓ | 8/8 | — | covered |
| `theo-promote` | write (promotion) | ✓ | via `theo-manifest.test.mjs` | — | covered |
| `theo-block-memory-write` | guard | ✓ | 5/5 | — | covered |

## Feature-interaction seams (state/attribution across infer:true/false)

| Seam | Was tested? | Now |
|---|---|---|
| `attributedTo` × `infer:true` (the original bug) | NO (each side siloed) | CLOSED by M27: `extraction-attribution.test.ts` (symmetric + loop-wide) + `kit-attribution-write.test.ts` (real store) |
| `infer:false` verbatim NOT gated/extracted | NO | CLOSED by M27: `extraction-fact-quality.test.ts` "infer:false stores a question verbatim" |
| PreCompact flush × attribution/infer | NO (hook untestable) | CLOSED: `theo-precompact.test.mjs` — sets `infer:true` explicitly; a MIXED transcript keeps per-fact multi-peer attribution (NO forced single origin — the correct behavior, distinct from the assistant-only Stop hook) |

## Defects found + fixed

1. **`theo-precompact` was an untestable, untested WRITE hook** — `main()` ran inline at module load
   (no `import.meta.url` guard), so it could not even be imported for a test without hanging on stdin;
   the payload logic had no pure builder. **Same class as the attribution bug** (a write hook whose
   behavior no test exercised). Fixed: extracted `buildPrecompactPayload`, added the load guard, 4 tests.
2. **`theo-precompact` carried the same stale "server stores infer=false verbatim" comment** the Stop hook
   had (M27 T3.1). Fixed: it now sets `infer: true` explicitly. Left attribution to the LLM per-fact guess
   (correct — a precompact tail is a mixed user+assistant transcript, not an assistant-only summary).

## Verdict

The write-hook seam class is closed: every capture hook that writes now has a pure, testable builder + a
test; the shared `/v1/remember` → extraction → store path is integration-proven (kit-attribution-write);
the attribution × infer seams are covered on both sides. The one honestly-scoped residual is that
`theo-precompact` reuses the shared real-store integration rather than a dedicated one (its DELTA — no
attributedTo, transcript tail, infer:true — is unit-proven; the REST→store path it shares is proven).

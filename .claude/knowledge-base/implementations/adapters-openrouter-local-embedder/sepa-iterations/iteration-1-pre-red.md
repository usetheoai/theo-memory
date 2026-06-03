# SEPA — Iteration 1 / Task T0.1 / Phase pre-RED

## Plan recap
- Add optional `embeddingDim?: number` to `LocalMemoryConfig`; probe + pre-flight `Number.isInteger` guard enforce the configured dim (default `MAX_EMBEDDING_DIM`); `EmbeddingMismatch` message interpolates the configured dim.

## Findings
- **[CRITICAL] — Error-class mismatch between plan tasks (3) and (4):** Plan § Tasks #3 says pre-flight `> MAX_EMBEDDING_DIM` throws "immediately with explicit message"; Deep Dive § Upper bound check says throw `EmbeddingMismatch`; Deep Dive § Integer-only guard says throw `InvalidScope`. Recommend: `InvalidScope` for ALL pre-flight failures (NaN, float, Infinity, ≤0, > MAX) — matches Deep Dive composite guard literal `throw new InvalidScope(...)`. The literal-received-value (`String(received)`) requirement is satisfied either way. Pick ONE class uniformly; do not mix `EmbeddingMismatch` (probe-only, post-call) with `InvalidScope` (pre-flight).
- **[MAJOR] — `EmbeddingMismatch` constructor signature is `(expectedDim: number, actualDim: number)` (errors.ts:32)** — Plan T0.1 Task #4 says "interpolate the configured dim". The current message already does `expected ${expectedDim}, got ${actualDim}`. The change is to pass `effectiveDim` (configured) as `expectedDim` at the call site in `probeEmbedder` (index.ts:660-665) — NOT modify the error class signature. Avoid widening the error class signature.
- **[MAJOR] — `probeEmbedder` is a free function with no config access** (index.ts:660). Pass `effectiveDim` as second arg to `probeEmbedder` to minimize diff.
- **[MAJOR] — Pre-flight guard placement:** must run BEFORE `probeEmbedder` AND BEFORE `vectorStore.initialize()` to truly fail fast.
- **INFO — Files-to-edit verified:** all 3 exist at declared paths. RED tests reachable via `src/local/__tests__/factory.test.ts`.
- **INFO — EC-1 absorption is correct in plan text:** `Number.isInteger` named explicitly; `String(received)` named explicitly. No deviation.

## Recommended action
- Use `InvalidScope` for ALL 5 pre-flight cases (NaN, float, Infinity, ≤0, > MAX). Use `EmbeddingMismatch` only for the post-probe path (configured dim valid but embedder returned different length).
- Pass `effectiveDim` into `probeEmbedder(embedder, effectiveDim)` to preserve helper signature minimally.
- All assertion regexes use the literal received value (`/got NaN/`, `/got 384\.5/`, etc.) to test the `String(received)` requirement.

## Decision applied by main session

ACCEPTED SEPA recommendation. Will apply:
- `InvalidScope` for all 5 pre-flight cases (uniform error class for config validation)
- `EmbeddingMismatch` stays as-is at the probe-result-vs-configured-dim mismatch path; pass `effectiveDim` as `expectedDim` argument
- Pre-flight guard placed at the top of `createLocalMemory` before `vectorStore.initialize()` and probe
- All RED tests assert error message regex includes `String(received)` literal

agent_id_session_continuation: a78b53a6b27485f8c

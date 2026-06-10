# Phase 3 — Maturity Findings Report

**Date:** 2026-06-10
**Agent:** maturity-detective (Phase 3 code_review sub-pass)
**Target:** `src/` (165 production TypeScript files, excluding `__tests__/`)
**Total findings:** 18 (2 medium, 16 low)

---

## Summary

The codebase demonstrates strong engineering discipline overall: 13 DIP
interfaces, consistent JSDoc with `@see` cross-references, typed error
classes, OTel instrumentation, and explicit edge-case absorption comments.
The patterns below are not defects but maturity signals that compound
over time. None are blocking.

| Category | Count | Severity |
|---|---|---|
| Duplicate code blocks | 1 | medium |
| Unsafe `any` casts | 1 | medium |
| Magic literals in IR/ML parameters | 6 | low |
| Vague variable names | 6 | low |
| Silent catch/swallow | 2 | low |
| WHAT-not-WHY comments | 2 | low |

---

## Medium Findings

### M-1. Duplicate `resolvePort()` / `resolveHost()` across two CLI entry points

**Files:**
- `src/agent-tools/run-server.ts:73-90`
- `src/agent-tools/run-mcp-server.ts:154-171`

**Pattern:** `resolvePort(opt?: number)` is duplicated almost verbatim
(8 LOC each). The only difference is the env var name (`PORT` vs
`THEOMEM_MCP_HTTP_PORT`). `resolveHost()` is similarly duplicated (different
defaults: `0.0.0.0` vs `127.0.0.1`).

**Principle:** DRY (Hunt & Thomas) -- each piece of knowledge has one
authoritative representation. The port-validation logic (range check,
env fallback, error message format) is the same knowledge duplicated.

**Remediation:** Extract a shared helper
`resolvePort(opt, envKey, defaultPort)` into `agent-tools/port-resolver.ts`
or similar. The CLI layer (`cli.ts`) already has `parseIntInRange` -- these
could converge.

### M-2. `as any` cast in production rate-limiter

**File:** `src/server/middleware/rate-limit.ts:85`

```typescript
const addr = (c.req.raw as any)?.[Symbol.for('hono/conninfo')]?.remote?.address as string | undefined;
```

**Principle:** architecture.md section 7 states "No `any`. If you must
escape the type system, use `unknown` with a runtime assertion." The
eslint-disable comment acknowledges the issue inline but does not resolve it.

**Remediation:** Use Hono's official `getConnInfo()` helper from
`hono/conninfo` (typed), or cast to `unknown` and narrow with runtime
checks.

---

## Low Findings — Magic Literals

### L-1. `0.001` spread-attenuation constant (`scoring.ts:50`)

```typescript
const spread = 1 / (1 + 0.001 * Math.pow(numLinked - 1, 2));
```

Tuned IR parameter without a named constant. Extract to
`SPREAD_ATTENUATION_FACTOR`.

### L-2. `0.1` + `2.9` half-life formula (`triadic-scoring-policy.ts:191`)

```typescript
return Math.floor(halfLifeBaseSeconds * (0.1 + 2.9 * importance));
```

The file already defines `MIN_PROTECTION_MULTIPLIER = 0.1` for a different
formula (line 85), creating potential confusion. Extract
`HALF_LIFE_MIN_FACTOR` and `HALF_LIFE_IMPORTANCE_SCALE`.

### L-3. Sigmoid params as bare numbers (`scoring.ts:22-26`)

```typescript
return { steepness: 0.5, midpoint: 4 };  // short query
return { steepness: 0.3, midpoint: 8 };  // long query
```

Define `SHORT_QUERY_SIGMOID` and `LONG_QUERY_SIGMOID` as named constants.

### L-4. `65_535` port max repeated 4 times across two files

Port validation logic uses `> 65_535` in 4 conditionals across
`run-server.ts` and `run-mcp-server.ts`. Define `MAX_TCP_PORT = 65_535`.

### L-5. Inconsistent naming discipline for IR constants

`consolidate.ts` defines `DEFAULT_CLUSTER_THRESHOLD = 0.85` (named).
`scoring.ts` defines `ENTITY_BOOST_WEIGHT = 0.5` (named) but leaves
sigmoid params as bare literals. Apply consistent discipline.

---

## Low Findings — Vague Variable Names

All below violate Clean Code Ch.2 (intention-revealing names) in scopes
larger than 10 LOC.

| # | Variable | File:Line | Scope | Suggested Rename |
|---|---|---|---|---|
| L-6 | `obj` | `extraction/pipeline.ts:318` | 30+ LOC | `parsedExtractionResponse` |
| L-7 | `obj` | `llm-judged-merge.ts:65` | 12 LOC | `partialConsolidation` |
| L-8 | `obj` | `json-extractor.ts:41` | 8 LOC | `judgeResponse` |
| L-9 | `output` | `embedders/local.ts:104,113` | 10 LOC | `embeddingTensor` |
| L-10 | `result` | `single-judge.ts:59` | 20 LOC | `llmResponse` |
| L-11 | `result` | `additive-weighted-scoring.ts:106` | 10 LOC | `normalizedScores` |

---

## Low Findings — Silent Catch/Swallow

### L-12. Per-row persist fallback (`extraction/pipeline.ts:249-251`)

```typescript
} catch {
  // Log + skip; do not poison the batch
}
```

The comment says "Log" but no logging occurs. The OTel tracer is in scope
(`tracer` parameter). Emit `persist_row_failed` event.

### L-13. History persist (`extraction/pipeline.ts:484-486`)

```typescript
} catch {
  // Silent swallow per the upstream pattern
}
```

Non-blocking by design (correct), but the error is lost entirely. Emit
a non-blocking OTel event for observability.

---

## Low Findings — WHAT-not-WHY Comments

### L-14. `// Run policy hook` (`local/index.ts:678`)

Paraphrases the next line. Delete or explain WHY the hook exists.

### L-15. `// Execute reflection LLM call` (`local/index.ts:718`)

Paraphrases `executeReflection()`. Self-documenting function name makes
the comment redundant. Delete or replace with phase-level context.

---

## Positive Observations (not findings)

The maturity scan found several patterns that demonstrate strong
engineering discipline worth preserving:

1. **Consistent use of named constants** in many modules
   (`DEFAULT_CLUSTER_CAP`, `DEFAULT_THRESHOLD`, `ENTITY_BOOST_WEIGHT`,
   `MAX_OVERFLOW_FRACTION`). The magic-literal findings are exceptions
   to a generally good practice.

2. **Zero TODO/FIXME/HACK comments** in production code. Unusual for a
   codebase of this size.

3. **Typed error classes** throughout (`InvalidScope`, `MemoryNotFound`,
   `InvalidWeightsError`, etc.) -- no generic `Error('something broke')`.

4. **No verbose boolean returns** detected. The codebase uses direct
   boolean expressions consistently.

5. **`as any` usage is minimal** (1 production site, the rest in tests).
   The architecture.md "no any" rule is largely honored.

6. **No `range(len())` equivalent** -- iteration patterns use `for...of`
   or index loops appropriately.

---

## Methodology

Scans performed:

- Vague variable names: regex scan for `data|result|info|obj|item|temp|
  tmp|val|value|output|flag` on assignment, filtered to production files,
  then manual scope-size verification (>10 LOC threshold).
- Magic literals: regex for numeric comparisons with decimals and multi-
  digit integers, manual filtering for IR/ML tuning parameters vs
  standard protocol values.
- `as any` casts: regex for `as any` in production code.
- Silent catch: regex for `catch` + context peek for empty/pass blocks.
- WHAT comments: regex for verb-leading comments matching common patterns.
- Duplication: manual comparison of structurally similar modules flagged
  by the port-validation pattern.

All findings carry `severity_source=heuristic`, `category=maturity`,
`blocking=false` per the maturity-detective protocol.

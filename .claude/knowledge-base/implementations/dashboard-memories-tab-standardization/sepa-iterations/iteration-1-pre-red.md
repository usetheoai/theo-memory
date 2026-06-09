# SEPA — Iteration 1 / Task T1.1 / Phase pre-RED

## Plan recap
- T1.1 extends `VectorStoreResult` interface at `src/core/dip/vector-store.ts` with optional `createdAt?: Date` field + creates type-level test file `src/core/dip/__tests__/vector-store.test-d.ts` with `expectTypeOf` + negative-type assertion. Backward-compatible additive change per ADR D1.

## Findings (TIGHT — MAJOR only)

- [MAJOR] **Negative-type RED test pattern in the plan uses `as any` which bypasses TypeScript** — `assertType<VectorStoreResult>({id:'x', payload:{}, createdAt: '2026-01-01' as any})` will GREEN trivially because `as any` widens the type to `any` before the assignment check. The test does NOT prove "rejects string in createdAt field". Canonical Vitest pattern for negative type tests is the `// @ts-expect-error` directive comment immediately above the offending line, which forces `tsc` to FAIL the file unless the next line genuinely errors. Correct shape:
  ```ts
  // @ts-expect-error createdAt must be Date, not string
  assertType<VectorStoreResult>({id:'x', payload:{}, createdAt: '2026-01-01'})
  ```

- [MAJOR] **`readonly` modifier consistency with existing interface fields** — current `VectorStoreResult` declares `readonly id`, `readonly payload`, `readonly score?`. The new field should be `readonly createdAt?: Date` for convention consistency.

- [INFO] **Top-level field placement** — confirm RED test sets `createdAt` at the OBJECT root, NOT inside `payload` (payload's typed record does not accept Date).

## Recommended action
- Write the RED test with the `// @ts-expect-error` pattern for the negative case (NOT `as any`).
- Declare the new field as `readonly createdAt?: Date` to match existing `readonly` convention.
- Verify `expectTypeOf` is imported from `'vitest'` (the project uses vitest).

## Confidence
- HIGH on all three findings (Vitest docs + plan-internal convention + ADR D1 unambiguous).

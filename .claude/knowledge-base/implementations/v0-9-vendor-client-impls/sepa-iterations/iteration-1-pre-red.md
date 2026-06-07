# SEPA — Iteration 1 / Task T0.1 / Phase Pre-RED (MODE=TIGHT)

## Plan recap
- T0.1 writes failing sentinel tests in 3 adapter.test.ts files that reference renamed `scopeKey:string` against still-unrenamed `Mem0VendorClient`/`ZepVendorClient`/`LettaVendorClient` interfaces, producing 3 DISTINCT TS errors — proving the gate detects per-vendor naming drift (defense vs EC-1 single-grep-replace).

## Findings
- [CRITICAL] EC-1 vigilance — Test bodies MUST instantiate `Stub{Mem0,Zep,Letta}Client implements {Mem0,Zep,Letta}VendorClient` with `add(scopeKey: string, text: string)` signatures. If all 3 stubs only rename `userId`→`scopeKey` mechanically, the RED still triggers (interfaces mismatch), but the 3 errors will NOT be "distinct per vendor". Each stub MUST target its OWN vendor interface (not copy-paste of one).
- [CRITICAL] Files-to-edit allowlist: ONLY the 3 `__tests__/adapter.test.ts` files. DO NOT touch `adapter.ts` (that's T0.2 GREEN) nor `vendor-client.ts` interface declarations (also T0.2). Editing interface files in T0.1 collapses RED→GREEN and breaks TDD shape.
- [MAJOR] EC-2 awareness (forward-looking) — Even though synthesize() is T0.3, if T0.1 stubs include `synthesize()` method bodies, use `throw new Error('not implemented in stub')` — DO NOT preemptively reference `VendorSynthesizeUnsupportedError` (doesn't exist yet; would inflate RED errors beyond the expected 3).
- [MAJOR] no-paper-names — Stub class names like `StubMem0Client` ARE allowed in tests (vendor-product identifiers tied to the SDK, not paper names). But JSDoc comments / test `describe` strings MUST NOT cite the source paper.
- [MAJOR] TDD shape verification — Expected post-edit state: `npm run typecheck` reports EXACTLY 3 distinct interface-mismatch errors (one per file). If typecheck shows 1 error OR 6+ errors, RED is malformed.
- [INFO] `searches` array shape — internal stub property, may rename or stay; only the interface method PARAMETER name drives the TS error.

## Recommended action
- Edit ONLY the 3 allowlisted test files. In each, ensure the local `Stub{Vendor}Client implements {Vendor}VendorClient` declares `add(scopeKey: string, text: string)` and `search(scopeKey: string, query: string, topK: number)`. Run `npm run typecheck` and verify exactly 3 distinct error locations (one per vendor file). If count ≠ 3, halt and surface to SEPA before proceeding to T0.2.

# SEPA pre-COMMIT — iteration 3 — T1.3 (MODE=VERBOSE) — security core

VERDICT: CLEAR TO COMMIT (0 CRITICAL/MAJOR).
- INV-3 disposal: airtight — every post-isolate path transits finally `isolate?.dispose()` (no leak); pre-isolate denials create no isolate (t.count()==0). Proven vs REAL addon via dispose-counting Proxy loader.
- INV-4: only `import type` (erased) + lazy `()=>import('isolated-vm')`; addon in optionalDependencies; barrel addon-free.
- INV-5/D4: only identifier-validated arg KEYS reach wrapInvocation; VALUES via setSync/ExternalCopy — no source-concat. Injection key test denied pre-isolate.
- DEC-2 honest: isolate = primary boundary; pre-scan = audit/defense (bypass yields undefined, not escape). JSDoc does not overclaim.
- SOLID/Clean: #deny DRYs emit+throw (dispose in caller finally — right separation); pure helpers; CC<10; 187 LoC.
2 non-blocking follow-ups APPLIED this commit: (1) ToolInvocationDeniedReason JSDoc discloses tool-call-cap reserved seam (Rule 3 + pre-empts code-quality); (2) CHANGELOG Added entry. 15/15 tests, 1052 contract suite, tsc/eslint clean. SHA 1419f02. Full brief: agent a1c86da50949f9d74.

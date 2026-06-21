# SEPA pre-RED — iteration 3 — T1.3 (MODE=VERBOSE) — executor core

3 CRITICAL locks (recorded in plan T1.3 Deep Dives DEC-1..DEC-7):
- DEC-1 sync isolated-vm API (createContextSync/compileScriptSync/runSync/setSync/dispose); execute() async wrapper. Disclose deviation from plan async pseudo-code in commit body.
- DEC-2 node/fs denial = source pre-scan (regex tokens before isolate; isolate is PRIMARY guarantee, pre-scan is AUDIT/DEFENSE layer making reasons reachable + deterministic, Princípio 3).
- DEC-3 output-cap deny-only v1 (Buffer.byteLength(JSON.stringify),utf8); truncated=false reserved.
- DEC-4 arg-key identifier guard (/^[A-Za-z_$][\w$]*$/) → non-cloneable-args (D4 injection surface, keys land in source).
- DEC-5 no named function → unsupported-language (least-bad reused literal).
- DEC-6 constructor seam {tracer?, loadIsolatedVm?: ()=>Promise<typeof import('isolated-vm')>}; type-query erased (barrel addon-free); tests inject loader (EC-3) + vi.spyOn(Isolate.prototype.dispose) + fake recording tracer.
- DEC-7 #deny(isolate,reason,detail) helper = emit event + dispose-if-present + throw (DRY triad). tool-call-cap = Q3 seam, unreachable v1, covered by direct unit test of the cap helper (no dead branch).

Dispose asymmetry: pre-isolate denials (empty-code, unsupported-language, unsupported-async, node-binding, fs-access, invalid-arg-key, timeout<=0) → NO dispose; post-isolate (non-cloneable-args, timeout, non-cloneable-result, output-cap) → dispose. Tests assert.

non-cloneable-args detection: try/catch around new ivm.ExternalCopy(value) (structured-clone is the oracle; catches functions/symbols/circular). benign wrapInvocation: strip /^\s*export\s+/m, parse /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, append `;NAME(argNames);`, runSync copy:true → add(2,3)=5.

Extract module-private wrapInvocation/copyOrDeny/capOutput + #deny; CC≤10; ≤500 LoC; direct unit test of wrapInvocation (fast, inverted-pyramid + 100% cov). No paper names in src/**.

Full brief: agent ae713ae075be1df64 (227k tokens).

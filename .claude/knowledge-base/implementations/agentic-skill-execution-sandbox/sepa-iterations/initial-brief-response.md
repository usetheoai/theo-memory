# SEPA initial brief — agentic-skill-execution-sandbox (2026-06-21)

Highest-risk tasks: T1.3 (executor core — every escape vector), T2.2 (the on/off gate — default-OFF = no-RCE), T1.4 (bundle-isolation — EC-47 for ALL consumers).

5 CRITICAL invariants: INV-1 Slice-1-no-wire (no execute() in any consumer until T1.3+T1.4 GREEN); INV-2 default-OFF (`createLocalMemory(pool)` → execute throws `SkillExecutionNotConfiguredError`); INV-3 every malicious test asserts denial + `tool_invocation_denied` event + `isolate.dispose()`; INV-4 no static isolated-vm import in default barrel (dynamic in infra only); INV-5 D4 args via `context.global.set` never string-concatenated.

T1.3 first-RED gotchas: EC-1 wrapInvocation (strip `export`, append `;NAME(...args)`, `copy:true` — benign must return 5 not undefined; parse NAME, don't hardcode); EC-3 lazy-import try/catch → `SkillExecutorUnavailableError` (distinct, not a denial, not raw); 6 guards each = {denial test + OTel event + dispose}; cheap denials (EC-2 empty-code, Q2 unsupported-language, EC-5 bounds) BEFORE isolate; reason union exhaustive over 10 literals.

DECISION LOCKED (this brief): EC-4 async → **deny `'unsupported-async'` in v1** (recommended; await-via-promise:true deferred to follow-up). Locked into the plan before T1.1.

Pre-T1.1 verdict: PROCEED.

Full brief: agent a943535ae03e54183 (subagent_tokens 223636).

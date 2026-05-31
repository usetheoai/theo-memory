# SEPA iter 1 pre-RED T0.1 — MODE=TIGHT

CRITICAL: 0 · MAJOR: 4 (all confirmations of plan + gotchas) · MINOR: 0

Key items:
- Mirror `_themory_demo_singleton` byte-for-byte (prefix `_themory_demo_`, type `Map<string, number> | undefined`, `// eslint-disable-next-line no-var` directive).
- `declare global` block at top of `theomemory-plugin.ts` (NOT `lib/memory.ts` — concern split).
- Use `??=` lazy-init shape mirroring `getSingleton()`.
- REFLECTION_THRESHOLD const stays — HMR re-derives identically from env.
- Public surface (`rememberTurn` signature, `ReflectionEvent`) untouched.

Confirmation: ADR D2 + D3 apply; main session retains authority.

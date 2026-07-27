# Review: M26 — test-suite seam audit

**Date:** 2026-07-27
**Verdict:** READY_TO_MERGE

Audit milestone (no new feature). Deliverable = the seam map + closing the one untested WRITE capture
hook. `theo-precompact` (a `/v1/remember` write hook) was inline/untestable (main() at module load, no
import.meta.url guard) — the SAME class of gap as the attribution bug that motivated M26. Fixed:
extracted `buildPrecompactPayload` + load guard + 4 RED→GREEN tests + explicit `infer:true`. All 7 kit
hook test files green (37 tests); no core/api/eval regression (change confined to docs/claude-code-kit).
Seam map + the attribution×infer interaction coverage documented in
`.claude/knowledge-base/audits/M26-test-suite-seam-audit-2026-07-27.md`. Honestly-scoped residual:
precompact reuses the shared real-store integration (its delta is unit-proven).

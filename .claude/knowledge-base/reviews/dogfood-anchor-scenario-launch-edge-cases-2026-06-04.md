# Edge Case Review — dogfood-anchor-scenario-launch

Data: 2026-06-04
Tasks analisadas: 14 (T0.1, T0.2, T0.3, T1.1, T1.2, T2.1, T2.2, T3.1, T4.1, T4.2, T4.3, T5.1, T6.1 + Phase A→B transition pseudo-task)
Edge cases encontrados: 13 (MUST FIX: 3, SHOULD TEST: 6, DOCUMENT: 4)

## MUST FIX

### EC-1: Bridge MUST distinguish "TheMemory unreachable" vs "TheMemory returned empty" at the typed-error level

- **Task afetada:** T1.1 (bridge module)
- **Família:** Boundary / Format
- **Cenário:** `themory mcp` stdio process not running (docker container down, binary not found, MCP handshake timeout). Bridge calls `bridgeRecall(query, ctx)`. Per ADR D5 "degradation events ... are logged". Plan does NOT say what `bridgeRecall` RETURNS to the consumer (skill/hook). If the bridge returns `[]` silently, the consumer (skill OR hook) treats it as "no memories found" — same response shape as a legitimate empty recall. Claude Code then operates AS IF no relevant memory exists. **Data loss in dogfood mode** — the very thing the manifest's `running` semantic requires to SURFACE ("if TheMemory falls over, real memory is lost") becomes silent.
- **Impacto:** Honest dogfood signal eliminated. `soft_no_pains_logged` cap fires (no degradation surfaced), evidence files lack DX pain content, audit verdict downgrades to WITH_CAVEATS eternally. Production-readiness claim never legitimately unblocks.
- **Fix sugerido:** Add to T1.1 contract: bridge functions throw typed `MCPUnreachable` (extends `Error`) when stdio process unavailable / handshake fails / response timeout. Return empty array ONLY when MCP responded successfully with empty result. Consumer (skill + hook) MUST catch the typed error and surface to user (skill renders "TheMemory unreachable, see degradation log"; hook script exits non-zero per existing T1.2 spec). Add ADR D1 paragraph: "Bridge throws typed `MCPUnreachable` on transport failure; returns empty array on successful empty-response. Two distinct contracts."

### EC-2: MCP stdio connection lifecycle is undefined — per-invocation handshake vs persistent connection

- **Task afetada:** T1.1 (bridge module), affects T1.2 (hook script) latency budget
- **Família:** Resource / Timing
- **Cenário:** Plan does not specify whether bridge spawns `themory mcp` per CALL (handshake every time) or maintains a persistent stdio session across calls. Per-call: every Claude Code memory operation pays ~500ms-2s of process spawn + handshake + tear-down. Persistent: connection management overhead + edge cases (zombie process if Claude Code crashes mid-session, stale stdio after pgvector restart). Without a decision, T1.1 implementation can land EITHER choice and the consumer's UX expectation drifts.
- **Impacto:** Per-call adds 30-day-cumulative latency that may push the user to disable the hook ("memory is too slow") → silent fallback to FS-only → `running` semantic violated → cap `anchor_not_running` re-fires. Persistent without lifecycle management leaks processes → degraded dev environment over the 30-day soak.
- **Fix sugerido:** Add ADR D1 paragraph fixing the choice. Recommended: **per-invocation** for v1.0 of the bridge (simpler; Claude Code session lifecycle is the natural connection scope; pay the spawn cost). Document the latency budget (e.g., "p95 ≤ 2s per bridge call accepted; if measured higher in T2.1 smoke test, plan amends to persistent before T3.1"). T1.1 contract test asserts per-invocation behavior.

### EC-3: Project slug detection mechanism is undefined — bridge has no source for `sanitizedSlug`

- **Task afetada:** T1.1 (bridge module)
- **Família:** Input
- **Cenário:** ADR D2 specifies the sanitization formula but the bridge needs a SOURCE for the raw project slug. Three options exist: (a) `process.cwd()` derived (e.g., `path.basename(process.cwd())` — works when bridge invoked from project root); (b) env var `THEMEMORY_DOGFOOD_PROJECT_SLUG` (explicit, configurable per project); (c) hook script passes it as arg (project-scope hook knows the project). Without a fixed choice, the bridge can't be implemented and tests have no canonical fixture.
- **Impacto:** Bridge ships with ad-hoc slug detection that may resolve to wrong scope (e.g., cwd is parent of project when Claude Code is invoked from subdir) → memories land at wrong userId → recall returns nothing → `running` semantic violated → degradation logs not actionable.
- **Fix sugerido:** Add ADR D2 paragraph: bridge accepts slug as REQUIRED argument from caller (hook script + skill BOTH pass it explicitly). Hook script reads project slug from `${CLAUDE_PROJECT_DIR}` env (already injected by Claude Code per project-scope hook convention) and passes to bridge. Skill SKILL.md instructs Claude to discover slug from environment then pass explicitly. Fallback to `process.cwd()` only when explicit arg absent; emit warning log.

## SHOULD TEST

### EC-4: settings.json global scoping — hook MUST self-bail on non-theo-memory projects

- **Task afetada:** T1.2 (Claude Code wiring)
- **Teste sugerido:** `test_hook_self_bails_outside_theo_memory` — invoke hook script with `CLAUDE_PROJECT_DIR=/some/other/project`; assert hook exits 0 immediately with skip log; assert NO MCP call attempted. Reason: `~/.claude/settings.json` is user-global; hook entry fires for EVERY Claude Code project. Without self-bail, every user project tries to spawn `themory mcp` against this project's pgvector → noise + spurious degradation logs.

### EC-5: Verify Claude Code auto-memory writes ACTUALLY route through the Write tool (PostToolUse hook target)

- **Task afetada:** T1.2 (hook wiring) — pre-condition validation
- **Teste sugerido:** `test_auto_memory_save_invokes_write_tool` — manual integration: enable Claude Code session, observe a memory-save event (per auto-memory CLAUDE.md instructions: "write to it directly with the Write tool"), inspect transcript JSONL to confirm the save invoked the `Write` tool (not an internal mechanism). If TRUE, hook on PostToolUse + Write catches it as ADR D1 assumes. If FALSE, ADR D1's hook-mirror path is structurally broken and the plan needs amendment before T1.2 lands. Recommended to run this verification at T0 BEFORE bridge implementation.

### EC-6: Phase B execution driver is undefined — T4.* tasks have no concrete trigger

- **Task afetada:** T4.1, T4.2, T4.3 (calendar-locked evidence checkpoints)
- **Teste sugerido:** `test_phase_b_calendar_checkpoints_have_concrete_driver` — plan amendment in T0.3 ADR D3 selects ONE concrete mechanism: (a) `cron-loop` skill scheduling reminder posts; (b) project-CLAUDE.md inline calendar entries the user manually triggers via `/dogfood log-evidence`; (c) GitHub Issue with 30-day milestone. Without ONE concrete driver, T4.* lands as TBD and 30-day soak silently no-ops. Test asserts: T4.1, T4.2, T4.3 each cite the chosen mechanism by name + Plan ADR D3 paragraph amends.

### EC-7: Degradation log filename collision when 2 Claude Code sessions degrade simultaneously

- **Task afetada:** T1.1 (bridge degradation log path)
- **Teste sugerido:** `test_concurrent_degradation_writes_no_collision` — simulate 2 concurrent `bridgeRemember` calls with MCP unreachable; assert both produce distinct degradation files (NOT clobbering). Fix: filename pattern includes millisecond timestamp + PID: `{YYYY-MM-DD}-{HHmmss}-{ms}-pid{pid}-{event}.md`.

### EC-8: Bridge MUST `mkdir -p` `.claude/knowledge-base/dogfood/degradations/` before first write

- **Task afetada:** T1.1 (bridge module)
- **Teste sugerido:** `test_degradation_log_dir_created_on_first_write` — invoke bridge with degradation dir DELETED; assert dir created; assert file written. Without mkdir, first degradation silently throws ENOENT and the audit trail is empty (worst case: degradation IS the only DX pain signal and it's lost).

### EC-9: Empty / whitespace-only content skip — auto-memory saves of blank scratchpad

- **Task afetada:** T1.1 (bridge module — `bridgeRemember` guard)
- **Teste sugerido:** `test_bridge_remember_skips_empty_content` — call `bridgeRemember('', ctx)` + `bridgeRemember('   \n  ', ctx)`; assert MCP call NOT made; assert returns sentinel `{ skipped: true, reason: 'empty_content' }` (or similar). Without guard: TheMemory's `remember()` extracts nothing from empty text → returns empty draft → `extraction_zero_facts` event fires → degradation log + cycle noise. Auto-memory writes blank files routinely (placeholder saves).

## DOCUMENT

### EC-10: `~/.claude/settings.json` is user-global AND requires Claude Code RESTART to pick up MCP server registration

- **Risco aceito:** Inquebrável Rule 1 requires user authority for `~/.claude/settings.json` edits. After editing, Claude Code MUST be restarted for MCP server registration to take effect. T1.2 acceptance criteria "user has applied settings.json edit" implies (but does not state) the restart. Plan needs explicit note: "applying the settings.json edit requires restarting Claude Code; first-time wiring includes one restart". The restart itself is trivial; the documentation gap is what fails honest disclosure.

### EC-11: Pre-30-day `/dogfood audit` verdict is EXPECTED EVIDENCE_INSUFFICIENT — not a regression

- **Risco aceito:** During the 30-day soak (days +0 through +29 after first evidence), `/dogfood audit` returns `EVIDENCE_INSUFFICIENT` with soft cap `soft_sustained_lt_30d` firing. This is the expected steady state — NOT a failure. Plan T5.1 explicitly runs the audit at day +30+ when the soft cap clears. Reviewers consuming intermediate `/dogfood audit` output during the soak may interpret EVIDENCE_INSUFFICIENT as cycle failure. Document expected interim states in plan + manifest § Decision log so reviewers and future cycles do not panic.

### EC-12: Evidence file `date:` frontmatter is human-authoritative — gaming risk exists

- **Risco aceito:** The `/dogfood` audit reads `date:` from frontmatter, not file `mtime` or git timestamp. A user could backdate evidence files to artificially satisfy the 30-day window. Per Inquebrável Rule 3 (extreme honesty), the human user is the gatekeeper; gaming this would be self-deception. Per `dogfood-golden-rule.md` Anti-pattern 5, fabricating evidence is forbidden. Document in evidence-file template: "the date frontmatter must reflect WHEN the dogfood event ACTUALLY happened, not when the file was authored — backdating defeats the cycle's purpose; no automated check enforces this."

### EC-13: pgvector container must survive 30 days; existing `docker-compose.yaml` `pgdata` named volume IS sufficient — document the dependency

- **Risco aceito:** If `themem_pgvector` container is `docker-compose down`-ed mid-soak, the dogfood pipeline silently breaks (bridge degradation log fires + skill recall returns empty). The existing `docker-compose.yaml` declares `pgdata` named volume so the DB state persists across `compose up/down`. Plan documents the dependency in T1.2 acceptance: "the `themem_pgvector` container MUST be `up` continuously during the 30-day soak; `compose down` events should be logged as known degradations in the evidence files, not silently fixed". No code-level mitigation; pure operational discipline.

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 (ADR D1) | 2 | 2 (EC-1, EC-2) | 0 | 0 |
| T0.2 (ADR D2) | 1 | 1 (EC-3) | 0 | 0 |
| T0.3 (ADR D3) | 1 | 0 | 1 (EC-6) | 0 |
| T1.1 (bridge) | 4 | 0 | 3 (EC-7, EC-8, EC-9) | 0 |
| T1.2 (wiring) | 3 | 0 | 2 (EC-4, EC-5) | 1 (EC-10) |
| T4.* (calendar) | 1 | 0 | 0 | 1 (EC-11) |
| T2.2/T3.1/T4.* (evidence files) | 1 | 0 | 0 | 1 (EC-12) |
| T1.2 + soak window | 1 | 0 | 0 | 1 (EC-13) |

**Veredicto:** PLANO PRECISA DE AJUSTE

Justificativa do veredicto:
- **3 MUST FIX** todos no Phase T0 / T1.1: ADR D1 + ADR D2 + bridge contract. São decisões load-bearing que se não absorvidas tornam T1.1 não-implementável (bridge sem contrato de erro, sem source de slug, sem lifecycle definido). 
- **6 SHOULD TEST** distribuídos por T1.1, T1.2, T4.*. Cada um é um teste curto (1 it() block) cobrindo um risco real.
- **4 DOCUMENT** são operational disclosures que evitam confusão downstream sem requerer código.

Próximo passo do cycle-plan chain (per cycle-plan.md):
1. Absorber os 3 MUST FIX no plano (v1.0 → v1.1) + 6 SHOULD TEST inline em TDD blocks + 4 DOCUMENT como notas
2. Re-rodar `/edge-case-plan` para confirmar 0 MUST FIX residuais (não é mandatório mas é honest discipline)
3. `/deps-audit dogfood-anchor-scenario-launch` (esperado PASS — nenhum dep novo)
4. `/plan-confidence dogfood-anchor-scenario-launch` (target ≥ SHIPPABLE_WITH_CAVEATS)
5. `/implement dogfood-anchor-scenario-launch` (Phase A) → IMPLEMENTATION_COMPLETE em ~1-2 semanas
6. Phase B calendar-lock 30 dias
7. `/review dogfood-anchor-scenario-launch` + PR develop → main

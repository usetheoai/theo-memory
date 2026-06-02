---
name: implement-v0-8-independent-benchmark-reproduction-sepa-knowledge
description: USE THIS SKILL when the SEPA agent for /implement v0-8 (benchmark reproduction halt-loop) needs to (a) recap plan-specific context (ADRs D1-D9 + EC-1..EC-14 absorptions), (b) refresh community knowledge via WebSearch (LongMemEval/LoCoMo/DMR benchmark methodology, OTel TS best practices, multi-judge LLM eval, tiktoken pricing tables, OpenRouter API for claude judges), or (c) cross-reference plan sections via grep. Frozen plan-specific context + dynamic WebSearch + grep refresh. ALWAYS invoke when SEPA reasons about benchmark methodology, multi-judge panel design, OTel instrumentation patterns, or vendor SDK choices.
allowed-tools: Read, Glob, Grep, WebSearch, WebFetch
model: opus
---

# SEPA Knowledge Skill — v0-8-independent-benchmark-reproduction

This skill is the SEPA's hydrated context layer for the v0.8 implementation halt-loop. The SEPA invokes this skill when reasoning needs (a) plan-specific recall, (b) community-knowledge refresh via WebSearch, (c) cross-referencing across plan + ADRs + edge-cases.

## Plan-specific context (frozen at /implement start 2026-06-02)

### Goal (verbatim from plan v1.2)

> Enable v1.0 to make a defensible "production-ready" claim by reproducing LongMemEval + LoCoMo + DMR against 4 memory systems (TheMemory v0.7 / Mem0 v3 / Zep / Letta) on identical fixtures, measured by `docs/benchmarks/v0.8.md` existing with all 12 (4 adapter × 3 benchmark) matrix cells populated AND `tests/e2e/benchmarks/matrix-publication.test.ts` PASSING against the live published artifact.

### ADR table (D1-D9 inherited + plan-specific)

| ADR | Decision summary | Source |
|---|---|---|
| D1 | OWN runner; ADOPT only metric primitives | inherited from blueprint D1 |
| D2 | LongMemEval PRIMARY > LoCoMo SECONDARY > DMR TERTIARY | inherited from blueprint D2 |
| D3 | Multi-judge panel; OpenRouter for claude (NO @anthropic-ai/sdk per user directive 2026-06-02) | plan v1.2 rewrite |
| D4 | Download-at-install; NO fixture committed | inherited from blueprint D4 |
| D5 | BenchmarkAdapter in `src/core/dip/`; impls in `src/benchmarks/` | plan-specific |
| D6 | BenchmarkAdapter NOT inherits MemoryStore (ISP+SRP) | plan-specific |
| D7 | tiktoken + pricing-table.json; cost/session not cost/run | plan-specific |
| D8 | OTel histogram spans for P95 | plan-specific |
| D9 | Skip BERTScore/SBERT default; opt-in via `--include-semantic` | plan-specific |

### Edge-case absorptions (EC-1 through EC-14)

| EC | Task | Absorption mechanism |
|---|---|---|
| EC-1 | T1.2 | json-extractor.ts + SingleJudge returns `JudgeLabel \| null` |
| EC-2 | T4.1 | All-judges-fail policy: 3 null → 60s pause → 1 retry → partial-persist + non-zero exit |
| EC-3 | T4.1 | PricingTableMiss typed error; runner persists `pricing_table_miss: true, cost: NaN` |
| EC-4 | T5.1 + T7.1 + T7.2 | `vitest.benchmark.config.ts` NEW with 60-min testTimeout |
| EC-5 | T0.1 + T3.1 | `BenchmarkCorpusItem.speaker?` + `BenchmarkQuery.expectedSpeakers?` + scopedUserId |
| EC-6 | T2.1 | TypeScript downloader (Node 20+ fetch); NO bash wget |
| EC-7 | T1.1 TDD | BLEU empty-string handling tests |
| EC-8 | T2.1 TDD | Idempotent downloader test |
| EC-9 | T4.1 TDD | Runner partial-results persistence test (Q250 throw, 0..249 saved) |
| EC-10 | T1.2 TDD | InterJudgeAgreement returns null+warning when N=1 |
| EC-11 | T4.1 TDD | cost-tracker returns 0.00 (not NaN) on zero-token case |
| EC-12 | T8.2 TDD | matrix-publication parser tolerates whitespace + cell-alignment |
| EC-13 | T4.1 inline | pricing-table.json carries `fetched_at` + 30-day sunset reminder |
| EC-14 | T6.x inline | skip-clean already-established via `describe.skipIf` precedent |

### Project rules consumed (per plan compliance check)

- `architecture.md` (DIP § 3, naming § 6, hygiene § 7)
- `testing.md` (TDD + pyramid)
- `no-paper-names-in-code.md`
- `dogfood-golden-rule.md` (independent gate)
- `plan-confidence-golden-rule.md`
- `cycle-implement.md` v1.5 (SEPA discipline + Inquebrável anti-patterns)
- `token-budget.md` (v0.8 estimate 200-400k)

## Mode A — Plan-context recap (cheapest)

When SEPA asks: "recap plan T{X.Y}" → respond with:
- Task objective
- Files-to-edit declared
- Deep Dives content
- TDD block
- Acceptance Criteria
- Related ADRs + ECs

Source: plan v1.2 sections.

## Mode B — Community knowledge WebSearch refresh

When SEPA asks community-knowledge questions, ALWAYS WebSearch (NEVER cite from training data — Inquebrável Rule 3 + cycle-discover.md v1.1 anti-pattern #10). Common questions:

| Question | WebSearch query candidates | Snapshot destination |
|---|---|---|
| Current OTel TS BatchSpanProcessor + in-memory exporter pattern 2026 | `"OpenTelemetry TypeScript BatchSpanProcessor InMemorySpanExporter 2026"` | `.claude/knowledge-base/discoveries/snapshots/v0-8-benchmark-methodology/otel-ts-current.md` (if absent) |
| RAGAS / DeepEval current LLM-judge prompting best practice 2026 | `"LLM as judge prompt 2026 calibration"` | snapshots dir |
| OpenRouter Claude API current model ids + pricing markup | `"OpenRouter anthropic claude pricing 2026"` | snapshots dir |
| tiktoken JS port @dqbd/tiktoken claude-3 encoding | `"@dqbd/tiktoken claude-3 encoding npm"` | snapshots dir |

Allowlist domains for WebFetch (per `.claude/rules/discover-web-allowlist.txt`): `arxiv.org`, `github.com`, `npmjs.com`, `huggingface.co`, `openrouter.ai` (if allowlisted — verify; if not, add ADR before fetching), `docs.langchain.com`, `python.langchain.com`, `developer.nvidia.com`, plus the 11 already-allowlisted ecosystem domains.

## Mode C — Cross-reference grep

When SEPA asks: "does task T{X.Y} cite ADR D{Z}?" → grep the plan + recently-written code for the citation pattern.

## Invocation contract

The SEPA invokes this skill via the `Skill` tool with prompts like:
- "Mode A: recap T1.2 LLM-judge orchestrator"
- "Mode B: WebSearch current 2026 best practice for InMemorySpanExporter in TS"
- "Mode C: grep plan for D6 citations vs current diff under src/core/dip/"

This skill responds with:
- For Mode A: verbatim plan sections
- For Mode B: WebSearch results + WebFetch + snapshot path
- For Mode C: grep output + interpretation

## Honesty discipline

- NEVER cite from training data for community-knowledge questions
- ALWAYS snapshot WebFetched URLs to `.claude/knowledge-base/discoveries/snapshots/v0-8-benchmark-methodology/` before citing
- ALWAYS verify allowlist before WebFetching off-list domain
- If you don't know, say "INSUFFICIENT CONTEXT" — Inquebrável Rule 3

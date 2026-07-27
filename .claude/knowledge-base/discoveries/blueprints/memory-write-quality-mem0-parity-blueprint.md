---
slug: memory-write-quality-mem0-parity
milestone_id: M27
kind: discovery-blueprint
date: 2026-07-27
status: SHIPPABLE
sources: [mem0 (knowledge-base/references/mem0), our extraction write-path, our claude-code kit hook]
---

# Blueprint: Memory write quality — durable-fact distillation (mem0 parity) · M27

## Context

Dogfood of the deployed dashboard (session `93959d08…`, 2026-07-27) showed the Claude Code
kit storing, as if they were durable facts: (a) a 400-word transcript dump of the assistant's
own reasoning (`Ciclo PLAN do M3 rodando. Passei ao agente quatro travas…`), (b) assistant
questions (`Quer que eu prossiga…?`), (c) first-person conversational voice (`Minha
recomendação:`, `Se você quer minha leitura:`). v0.51.0 fixed WHO the memory belongs to
(attribution); this milestone fixes WHAT/HOW — the content that becomes memory.

Root cause — three layers, all confirmed in code:

1. **Write source pollutes at origin.** The kit Stop-hook sends the RAW last assistant message
   (up to a 400-word narration) as `text` with `attributedTo:'assistant'`, and does NOT set
   `infer` (`docs/claude-code-kit/hooks/theo-remember.mjs` — `buildRememberPayload`). A stale
   comment there claims *"the server stores infer=false verbatim"* — false (see layer 3).
2. **Extraction prompt has NO fact-quality discipline.** Our `SYSTEM_PROMPT`
   (`packages/core/src/domain/extraction/prompt.ts`) is strong on entities/relations/language
   but says only *"output JSON with new facts to persist"* — zero few-shot, no atomicity rule,
   no third-person/declarative rule, no "drop greetings/questions/dialogue" rule. So the LLM
   keeps interrogatives and emits ONE mega-"fact" from a 400-word narration.
3. **`infer` default is extraction, not verbatim.** `runExtractionPipeline`
   (`packages/core/src/domain/extraction/pipeline.ts:73`) branches to the verbatim path ONLY on
   `options?.infer === false`; `undefined` → extraction. So kit writes ARE extracted — the dumps
   are an extraction-quality failure, not a verbatim store.

## Objective

Bring WHAT becomes memory to mem0-grade quality: every stored item from the `infer:true` path is
an atomic, declarative, standalone, third-person durable fact; greetings/questions/dialogue yield
nothing; multi-fact narration is split into atomic facts. Measured by the M21 eval harness
(single-third-person-fact ratio) reaching parity with mem0 on the same input transcript — not
asserted. The `infer:false` verbatim contract stays byte-identical.

## Coverage Corner 1 — Integration Tests

- mem0 tests its extraction prompt shape directly:
  `knowledge-base/references/mem0/tests/configs/test_prompts.py` and end-to-end add/extract in
  `knowledge-base/references/mem0/tests/test_memory.py`. Facts-are-`[]`-for-chit-chat is asserted
  at the prompt level.
- Our test obligation (RED-first, per `rules/testing.md` §3): an interrogative turn
  (`"Quer que eu prossiga…?"`) is NOT stored; a multi-fact narration is SPLIT into ≥2 atomic
  third-person facts, not one mega-item; a greeting yields zero rows. Unit against the extraction
  pipeline with a stub LLM + integration against real `ankane/pgvector:v0.5.1` (consumer path
  `POST /v1/remember` → extraction → stored rows), mirroring `tests/integration/kit-attribution-write.test.ts`.
- Real-consumer e2e: the kit Stop-hook payload (`buildRememberPayload`) → `/v1/remember` → stored
  rows assert atomic-fact shape (no item ends in `?`; no item is a multi-paragraph dump).

## Coverage Corner 2 — Dependencies

- No new runtime dependency. The fix is a prompt rewrite + a deterministic backstop filter (pure
  TS) + a cleanup CLI subcommand + a dashboard column. mem0 adds no library for this
  (`knowledge-base/references/mem0/mem0/configs/prompts.py` is plain string composition).
  Parsimony ladder rung 4/5: reuse installed `zod` + the existing extraction pipeline; no dep added.
- The measurement substrate — the eval harness `@usetheo/memory-eval` (M21) — already exists at
  `packages/eval/src/stages/extraction`.

## Coverage Corner 3 — Tools

- Measurement tool: the M21 eval harness extraction stage (`packages/eval/src/stages/extraction`)
  scores fact-quality parity vs mem0 on the same transcript — the DoD's objective metric.
- Parse-robustness reference: mem0's `normalize_facts`
  (`knowledge-base/references/mem0/mem0/memory/utils.py`) — adopt the "coerce object-shaped fact
  back to string" defensiveness in our response resolution.
- Existing gates reused: `check_tdd_shape.py`, `run_validation.py`, `/code-quality`, `/review`.

## Coverage Corner 4 — Techniques

The technique ported from mem0 (prompt discipline), adapted to our graph-aware extractor:

1. Add a durable-fact contract to `SYSTEM_PROMPT`: a fact is ATOMIC (one idea), DECLARATIVE (not a
   question), STANDALONE, THIRD-PERSON (subject named, never "I/my recommendation"); SPLIT
   multi-fact input into multiple atomic facts.
2. Add few-shot examples (mem0-style,
   `knowledge-base/references/mem0/mem0/configs/prompts.py`) to `memory: []` for a greeting → `[]`,
   a question → `[]`, a first-person recommendation → the third-person fact, a 3-fact narration →
   3 atomic facts. Entities/relations behavior unchanged.
3. Deterministic backstop gate (default-ON for `infer:true`) dropping still-interrogative /
   first-person-conversational items; typed `MEMORY_EVENTS` audit event per drop (Princípio 3).
   `infer:false` verbatim path untouched.
4. One-shot cleanup over polluted sessions: re-extract stored dump/dialogue rows OR soft-delete
   (`t_invalid`, reversible), dry-run first, per-item audit event, never hard-delete.
5. Surface `attributed_to` (WHO) in the dashboard memories table (core + REST
   `/v1/dashboard/memory/list` + gateway + UI).

## Cross-cutting Comparison

| Dimension | mem0 (`configs/prompts.py`) | ours today (`extraction/prompt.ts`) | M27 target |
|---|---|---|---|
| Fact definition | 7 explicit categories | "facts to persist" (undefined) | atomic/declarative/standalone/3rd-person contract |
| Non-facts | few-shot `[]` (greeting, generic) | none → keeps questions/chit-chat | few-shot `[]` for greeting/question |
| Atomicity | one fact per string | one mega-fact from narration | SPLIT into atomic facts |
| Source (WHO) | "user messages only; PENALIZED for assistant" | attribution (v0.51.0) only | attribution + drop conversational meta |
| Parse robustness | `normalize_facts` coerces object→string | zod strict | keep zod + coerce fallback |
| Measurement | prompt-shape unit tests | none for fact quality | M21 eval parity metric |

## ADRs

### D1 — Fix at the extraction prompt, not by wrapping mem0

Port mem0's prompt DISCIPLINE (studied), adding no mem0 SDK dep and no vendor datastore; the
out-of-scope item "Wrapping mem0 as a backend/data-adapter" stands. **Alternatives rejected:**
(a) wrap mem0's Python extractor — cross-runtime + vendor lock, violates the locked out-of-scope;
(b) do nothing at the prompt and only add a deterministic gate — a regex net cannot SPLIT a
400-word narration into atomic facts, only the LLM can, so the prompt MUST carry the discipline;
the gate is a backstop.

### D2 — Deterministic gate is a BACKSTOP, default-ON only on the `infer:true` path

`infer:false` is an explicit verbatim contract (ADR-0001 escape hatch) and MUST stay
byte-identical. **Alternative rejected:** gate on both paths — breaks the verbatim guarantee callers
rely on.

### D3 — Cleanup is soft-delete / re-distill, never hard-delete

Reversibility + per-item audit events satisfy Princípio 3. **Alternative rejected:** hard-delete the
dumps — irreversible, and risks losing a legitimate fact buried inside a dump.

### D4 — Parity closes on the M21 eval, not a subjective judgement

DoD closes on a measured single-third-person-fact ratio within a declared margin of mem0 on the same
transcript. **Alternative rejected:** "looks better" manual review — non-reproducible, the exact
failure this line of work corrects.

## Recommendations

1. **Primary leverage = the prompt.** Rewrite `SYSTEM_PROMPT` (`packages/core/src/domain/extraction/prompt.ts`)
   with the durable-fact contract + few-shot; this alone fixes the mega-dump and most questions. Keep
   the language/accent + entities/relations blocks intact (do not let few-shot bias to English).
2. **Backstop gate** in a small new module (do NOT grow the 458-LoC `pipeline.ts`), default-ON for
   `infer:true`, audit event per drop.
3. **Cleanup CLI** (`themory memory cleanup` or a script) — dry-run → soft-delete/re-distill.
4. **Dashboard `attributed_to`** column — core count exists; expose via REST + gateway + UI.
5. **Benchmark** with the M21 eval extraction stage before/after; the DoD metric is the number it
   reports, run ≥ 3× for variance.

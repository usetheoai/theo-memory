# SEPA Pre-RED Brief — iteration 4, T1.2, MODE=VERBOSE

**Task:** T1.2 LLM-judge orchestrator
**Verdict:** PROCEED to RED

## ADR D3 verified clean
- `grep -rn "@anthropic-ai/sdk" src/` returns ZERO source imports
- 6 doc-string hits reference `'anthropic/claude-3.5-sonnet'` model id (OpenRouter path) — invariant safe

## Design decisions locked
1. **Hybrid Option A**: LlmJudgePanel takes `LLM[]` (pre-constructed by caller). LlmFactory helper deferred to T4.1.
2. **EC-10 liberal interpretation**: `computeAgreement` returns `InterJudgeAgreement | null`; when N<2 valid labels → return shape with `warning` field (preserves audit trail); null reserved for unrecoverable cases. RED tests aligned to liberal shape.
3. **EC-1 two-pass extraction**:
   - Try `JSON.parse(rawResponse.trim())` (bare)
   - On fail: strip markdown fences `/```(?:json)?\n?([\s\S]*?)```/` + retry parse
   - On fail: balanced-brace scan for first `{...}` containing `"label"`
   - On fail: return null
4. **Case normalization**: judge label compared case-insensitive; only `'CORRECT'|'WRONG'` accepted
5. **TestLlm fixture** at `_test-llm.ts` (underscore convention from T2.1)
6. **ADR D3 regression guard** test: 6th test file `no-anthropic-sdk.test.ts` (additive, not in plan TDD list)

## Type contracts
```ts
type JudgeLabel = 'CORRECT' | 'WRONG';
interface JudgeOutcome { label, reasoning, rawResponse, model }
interface InterJudgeAgreement { percentAgreement, kappa, validJudgeCount, warning? }
interface PanelResult { outcomes: (JudgeOutcome|null)[], aggregateLabel: JudgeLabel|null, agreement: InterJudgeAgreement|null }
interface JudgeConfig { name, llm: LLM, promptTemplate? }
```

## RED test ordering (per testing.md § TDD)
1. judge-prompt.test.ts
2. json-extractor.test.ts (EC-1 paths: bare/fenced/prose-prefix/prose-suffix/malformed/wrong-field/case-insensitive)
3. inter-judge-agreement.test.ts (EC-10: N=1, N=2 agree, N=2 disagree, N=3 with 1 null)
4. single-judge.test.ts (TestLlm + json-extractor; CORRECT/WRONG/null paths)
5. judge-panel.test.ts (2-3 TestLlms; aggregation + raw response persistence)
6. no-anthropic-sdk.test.ts (ADR D3 regression guard)

## Wiring deferred
- (a) static caller: ADR-DEFER-WIRING-A T4.1 runner integration
- (b) integration test: ADR-DEFER-WIRING-B T4.1
- (c) runtime metric: n/a

## Plan deviations to track
- LlmFactory helper deferred to T4.1 (T1.2 ships exactly the 5 plan files + 1 regression-guard test)

## Anti-Mem0 judge prompt (verbatim from plan Deep Dives)
"Evaluate the generated answer against the gold answer for the given question.
Return a JSON object with two fields:
- label: 'CORRECT' if the generated answer conveys the same information as the gold answer (allowing reasonable paraphrase + format variation); 'WRONG' otherwise
- reasoning: one-sentence justification for the label
Be calibrated, not lenient. If the generated answer is partially correct or evasive, return WRONG."

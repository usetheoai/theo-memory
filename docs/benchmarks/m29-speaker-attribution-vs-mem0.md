# M29 — Write-side speaker attribution (#160): A/B vs mem0

**Date:** 2026-07-27
**Defect:** the extraction prompt hardcoded the first-person speaker as the entity `user`, so the
ASSISTANT's own statements were stored under the `user` node — ignoring the authoritative
`attributedTo:'assistant'` the kit's Stop hook sends. Dogfound live (session 105358a8): 64% of stored
facts read "user <verb>" for actions the assistant performed.

**Community reference (parity target):** mem0 (`.claude/knowledge-base/references/mem0`).
`parse_messages` (utils.py:61) role-labels every line; `ADDITIVE_EXTRACTION_PROMPT` mandates "No
Meta-Extraction" + `attributed_to` per fact + "Attribute correctly"; `AGENT_CONTEXT_SUFFIX`
(configs/prompts.py:947) frames agent actions as "Agent recommended [X]". Empirical A/B this session:
mem0 stored "**Assistant** evaluated…" while theo-memory stored "**user** analisou…" for the SAME actions.

## Method

- Real LLM: `openai/gpt-4o-mini` via OpenRouter (`max_tokens` capped for the run).
- Real code path: `runExtractionPipeline` with the M29 prompt (`generateAdditiveExtractionPrompt`
  now derives the speaker token from `attributedTo`).
- Transcript: one assistant-authored identity turn — "I work as a data scientist at Shopify. I have a
  dog named Max. I prefer TypeScript over Python." (identity statements reliably name the speaker entity;
  recommendations are passive-ised by the M27 durable-fact discipline and carry no speaker node).
- Metric: **speaker-node attribution** = count of `entities`/`relations` nodes equal to the speaker
  token. Pre-fix expects `user`; post-fix expects `assistant`.
- **PRE-FIX** = default speaker (no `attributedTo` → `user`, i.e. the currently-deployed behavior).
- **POST-FIX** = `attributedTo:'assistant'`.
- 3 runs per mode.

## Result

| Mode | speaker-node `user` | speaker-node `assistant` | correct-attribution |
|---|---|---|---|
| PRE-FIX (default) | 17 | 0 | 0 / 17 = **0.00** |
| POST-FIX (`attributedTo:'assistant'`) | 0 | 12 | 12 / 12 = **1.00** |

Representative run 1:

- **PRE-FIX** relations: `user -[works as]-> data scientist`, `user -[works at]-> Shopify`,
  `user -[has a dog named]-> Max`, `user -[prefers]-> TypeScript`.
- **POST-FIX** relations: `assistant -[trabalha como]-> cientista de dados`, `assistant -[tem]-> Max`,
  `assistant -[prefere]-> TypeScript`.

## Conclusion

The assistant-attribution ratio moves **0.00 → 1.00** with real-LLM extraction: the assistant's
first-person statements now attach to the `assistant` speaker node instead of `user`, matching mem0's
`AGENT_CONTEXT_SUFFIX` discipline. The default / user-attributed path is unchanged (pre-fix already
produces the correct `user` node — no regression). This closes the write/recall attribution pair left
open after M27 (fact quality) and M28 (recall #157).

**Caveat (orthogonal):** one post-fix run emitted PT relationship labels for an EN input — a
pre-existing language-guard variance, independent of the speaker-attribution fix (the speaker token was
still correctly `assistant`). Not in M29 scope.

## Reproduction

`runExtractionPipeline(assistantTurn, filters, deps, { attributedTo: 'assistant' })` vs the same call
without options, counting speaker-token nodes in the LLM `entities`/`relations`. Unit + integration
coverage: `packages/core/src/domain/extraction/prompt-speaker.test.ts` +
`packages/core/src/domain/extraction-speaker-attribution.test.ts`.

# Edge Case Review — entity-extraction-noise-filter

Date: 2026-06-23
Tasks analyzed: 4 (T1.1, T2.1, T2.2, T3.1)
Edge cases found: 5 (MUST FIX: 2, SHOULD TEST: 2, DOCUMENT: 1)

The plan is a pure deterministic predicate + a chokepoint filter — low I/O risk, no concurrency. The real risk is **precision killing recall**: the verb-led-2-word-compound rule (rule c) as written would false-drop legitimate noun compounds. Two MUST FIX close that.

## MUST FIX

### EC-1: verb-led-compound rule drops capitalized PROPER compounds (recall regression)
- **Affected task:** T1.1 (the `isEntityNoise` rule c)
- **Family:** Input / Format
- **Scenario:** the plan's Deep Dive rule (c) says "token[0] ∈ COMMON_BASE_VERB AND **not capitalized-proper**", but the Pseudo-code drops that guard and tests only the lowercased token. So `"Love Island"` (TV show), `"Watch Dogs"` (game), `"Read Only"` → lowercased token[0] ∈ verbs → **DROPPED**. These are real entities.
- **Impact:** legitimate proper-noun compounds beginning with a verb-homograph are silently deleted from the graph — the exact recall failure the plan promises NOT to introduce (Goal: "precision, not recall").
- **Suggested fix:** implement the Deep-Dive guard the pseudo-code omitted: in rule (c), skip the drop when the ORIGINAL (pre-lowercase) `tokens[0]` starts with an uppercase letter (`/^\p{Lu}/u`). Add `"Love Island"` to the keep-set test.

### EC-2: COMMON_BASE_VERB includes action verbs that head legitimate noun compounds
- **Affected task:** T1.1 (the COMMON_BASE_VERB set)
- **Family:** Input
- **Scenario:** the proposed set `{love, like, want, need, hate, enjoy, read, watch, play, make, take, get, see, know, think, feel}` includes action verbs that are ALSO noun-compound modifiers: `"watch list"`, `"read me"` (README), `"play station"`, `"make file"` (Makefile), `"think tank"`, `"feel good"`, `"take out"`. All lowercase → all DROPPED.
- **Impact:** broad recall regression on common lowercase compounds.
- **Suggested fix:** narrow COMMON_BASE_VERB to **perception/desire/cognition** verbs only — `{love, like, want, need, hate, enjoy, prefer, dislike}` — and REMOVE the action verbs (read/watch/play/make/take/get/see/think/feel). This still drops the observed noise `"love science"` (love ∈ set) while keeping `"watch list"`, `"think tank"`, `"read me"`. Add `"watch list"` + `"think tank"` to the keep-set test.

## SHOULD TEST

### EC-3: possessive generic role (`user's`, `users'`)
- **Affected task:** T1.1
- **Suggested test:** `it("possessive generic role")` — decide + assert: `isEntityNoise("user's")`. Recommendation: KEEP (low harm; a possessive surface is rare from the LLM and dropping it adds apostrophe-normalization complexity — KISS). Just pin the behavior with a test so it is not accidentally "fixed" later.

### EC-4: GOAL test reachability without a real key — noise must actually reach `upsertNodes`
- **Affected task:** T3.1
- **Suggested test:** ensure the integration test deterministically injects the noise INTO the node source it exercises — i.e. either (a) a real LLM run (`OPENAI_API_KEY` present) that is asserted to have produced ≥1 noise token, OR (b) the `infer:false`/compromise path fed the dogfood sentence so `CompromiseEntityExtractor` emits the noise, OR (c) a queued LLM whose `llmEntities` explicitly includes `["Dune","Frank Herbert","user","love science","I'm"]`. Without this, the test could pass vacuously (no noise ever generated → nothing to filter). Assert BOTH include AND exclude sets are non-trivially exercised.

## DOCUMENT

### EC-5: standalone generic-role homograph that is also a brand (`People` magazine, `Apple` n/a)
- **Accepted risk:** a LONE token `"People"` → lowercased `"people"` ∈ GENERIC_ROLE → dropped, even though *People* (magazine) exists. Accepted: standalone generic-role words are noise ~99% of the time; the branded case almost always appears as a 2-word phrase (`"People magazine"` → token[0] `"people"` ∉ COMMON_BASE_VERB → kept). Per D2's precision-bias and KISS, not worth a brand allowlist. Note it in the plan so a reviewer does not flag it as a miss.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 4 | 2 | 1 | 1 |
| T2.1 | 0 | 0 | 0 | 0 |
| T2.2 | 0 | 0 | 0 | 0 |
| T3.1 | 1 | 0 | 1 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT (2 MUST FIX — both narrow the verb-led rule to protect recall; both are ≤3-line code changes + test additions, no new module, no abstraction).

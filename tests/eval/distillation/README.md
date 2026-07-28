# v0.7 Distillation Evaluation

Reproducible eval harness for the `ConflictResolutionPolicy` DIP and its three
built-in implementations (Noop / LastWriteWins / LlmJudgedMerge per ADR D2).
Mirrors the v0.4b `T7.3` shape at `tests/eval/forgetting/run.ts`.

## What this measures

For each policy, computes against the 50 hand-authored gold-set fixtures
(`source: "hand"` per ADR D4 hybrid path):

- **Precision** — fraction of extracted facts that match an expected fact
- **Recall** — fraction of expected facts matched by an extracted fact
- **Conflict-Resolution Accuracy** — fraction of contradiction-pair fixtures
  where both kept + rejected actually align with the labels
- **Runtime** — wall-clock per policy

Matching uses `entityOverlapJaccard >= 0.5` rather than BLEU (BLEU is too
strict on short distillation facts; see `metrics.ts` header for the
EC-10 honest correction).

## Pre-conditions (EC-11)

The harness here is **LLM-free** and runs in ~50ms. The full pre-conditions
apply only when wiring through to the real OpenAI calls (T3.3 GOAL TEST):

1. **pgvector container running on port 5432**

   ```bash
   npm run compose:up
   ```

2. **`THEOMEM_PG_URI` env var pointing at the container**

   ```bash
   export THEOMEM_PG_URI=postgresql://themem:themem@localhost:5432/themem
   ```

3. **`OPENAI_API_KEY` in `.env.local` (for LlmJudgedMerge path)**

   ```bash
   echo 'OPENAI_API_KEY=sk-...' >> .env.local
   ```

4. **Migrations applied to the container**

   ```bash
   npm run db:push
   ```

5. **Cost disclosure**

   The harness in `run.ts` is LLM-free (~$0). The integration GOAL TEST that
   exercises OpenAI for the LlmJudgedMerge policy costs ~$0.50 per full
   200-fixture × 3-policy run with gpt-4o-mini at current rates.

## Reproducing

```bash
npm run eval:distillation
```

Outputs to `tests/eval/distillation.md` (matrix view).

## Architectural note (T3.2 ↔ T3.3 split)

The eval HARNESS here is intentionally LLM-free so CI cost stays at zero. The
honest LLM-measured quality signal lives at:

- `tests/integration/distillation/the-goal-test.test.ts` (T3.3)

T3.2 validates harness correctness + matrix render shape. T3.3 validates
real pipeline quality against pgvector + OpenAI. Both consume the same gold
set (`tests/fixtures/distillation/`) via the shared loader.

## Related

- Metrics: `metrics.ts`
- Gold set: `tests/fixtures/distillation/`
- v0.4b precedent: `tests/eval/forgetting/`

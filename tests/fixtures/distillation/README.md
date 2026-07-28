# Distillation gold-set fixtures

200 episodes spanning 5 categories, used by:

- `tests/unit/distillation/gold-set-shape.test.ts` — shape / scale / Zod validation
- `tests/integration/distillation/the-goal-test.test.ts` (T3.3) — precision / recall / conflict-resolution accuracy thresholds
- `tests/eval/distillation/run.ts` (T3.2 — `npm run eval:distillation`) — full eval matrix

## Hybrid composition (ADR D4 path; user decision 2026-06-01)

| Source | Count | Categories | T3.3 quality signal |
|---|---|---|---|
| **Hand-authored** (`source: "hand"`) | 50 | 10 per category | YES — measured |
| **Procedural seed** (`source: "procedural-seed"`) | 150 | 40+40+15+15+40 | Shape only — NOT measured |

The hand-authored subset (50 episodes / 10 per category) carries real semantic diversity: a person's coffee preference change, a relocation, a vendor switch, a multi-fact onboarding intro, a contradiction-pair where the previously-stored job title is now stale. THE GOAL TEST (T3.3) computes precision / recall **only over the hand-authored subset** — that is the honest quality signal.

The procedural subset (150 episodes) is generated deterministically by a one-off generator (removed; fixtures are committed) using a seeded LCG. Same input parameters → byte-identical outputs (`make` semantics). The procedural fixtures stress the pipeline at scale (200-row Zod load + loader perf) but their `expectedFacts` are templated from the same rules the LLM extraction pipeline would need to discover — measuring precision / recall over them would be self-referential.

## Schema (Zod-validated by `loader.ts`)

```ts
interface GoldSetFixture {
  id: string;                  // kebab-case, file-derived
  category: 'single-fact' | 'multi-fact' | 'contradiction-pair' | 'entity-overlap' | 'simulated-dialog';
  source: 'hand' | 'procedural-seed';
  episodeText: string;         // the raw episode the LLM must extract from
  expectedFacts: Array<{
    text: string;              // ground-truth fact text
    attributedTo?: string;     // 'user' for hand-authored; absent for procedural
    linkedToIds?: string[];    // entity-link references (optional)
  }>;
  expectedConflictPair?: {     // present for contradiction-pair category
    kept: string;              // expected to survive consolidation
    rejected: string;          // expected to be rejected by the policy
  };
}
```

## Methodology citation

Hand-authored episodes draw from natural-life conversations (coffee, job, relocation, pet care, learning plans). The 5-category split — single-fact, multi-fact, contradiction-pair, entity-overlap, simulated-dialog — mirrors the categorical taxonomy from prior memory-benchmark work surveyed during the v0.7 discovery cycle.

## Regenerating procedural fixtures

```bash
node a one-off generator (removed; fixtures are committed)
```

The script is idempotent: existing JSON files are NOT overwritten. To force a regeneration, delete the target files first.

## Known limitations (ADR-DEFER)

- **Procedural fixtures are NOT semantic ground truth.** They exercise the loader + schema + pipeline scale, but their `expectedFacts` cannot validate extraction quality. THE GOAL TEST (T3.3) skips them.
- **Hand-authored subset is 50 episodes (10/category)** vs ADR D4's ideal of 50 hand + 150 LLM-simulated-and-human-verified. The full 200-episode authoring is deferred to a v0.7.1 cycle (estimated ~25-40h human labor + LLM API costs). Drop-in compatible with the loader contract.
- **Expected-fact extraction is text-string match.** Semantic equivalence (e.g., "lives in São Paulo" vs "based in SP, Brazil") is intentionally NOT collapsed by the loader — that judgment belongs to the extraction pipeline + scoring metric in `tests/eval/distillation/metrics.ts` (T3.2).

## Related

- Loader: `loader.ts`
- Generator: a one-off generator (removed; fixtures are committed)

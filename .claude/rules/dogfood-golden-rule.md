# Dogfood Golden Rule

Locked contract that `/dogfood` reads to evaluate whether a project may legitimately claim `production-ready` / `v1.0`. **This file is a template — each project edits the marked sections to declare its own anchor scenario.**

Without this file, `/dogfood` emits `EVIDENCE_INSUFFICIENT` with flag `golden_rule_missing`.

## § 1 — Anchor scenario (PER-PROJECT — EDIT THIS)

The anchor scenario is the single use case that, if you cannot dogfood it, you cannot claim production-ready. Pick one. Be specific.

**Slug:** `<anchor-slug>` (kebab-case identifier referenced in the manifest)

**Description:** Replace this paragraph with a concrete user-visible scenario in which your team — not synthetic load — exercises the product end-to-end on infrastructure you actually own. The scenario should be uncomfortable: the kind of thing that proves the product works when its creators depend on it, not just when synthetic benchmarks do.

**Why this scenario:** Why is THIS the scenario that, if it works, justifies the v1.0 claim? Tie it to the product's primary promise.

## § 2 — Status vocabulary (LOCKED — do not change without ADR)

The `Status` field in `knowledge-base/dogfood/manifest.md` MUST take one of these values:

| Status | Meaning |
|---|---|
| `planned` | Anchor is identified but no implementation work has started. |
| `wired` | Implementation lands; the anchor is invoked at least once in CI or a manual smoke. |
| `running` | The anchor is **actively used by the team on real infrastructure**. This is the bar for v1.0. |
| `paused` | Was `running`; explicitly stopped for a documented reason. NOT a degradation of `running`. |
| `abandoned` | Anchor is no longer pursued. Requires ADR to set. |

`/dogfood` accepts `running` as the only value satisfying hard cap #2 (`anchor_not_running`).

## § 3 — Hard caps (LOCKED)

In order; first failure short-circuits to `EVIDENCE_INSUFFICIENT`.

| # | Check | Flag |
|---|---|---|
| 1 | Manifest contains a section identifiable by `Slug` or anchor header | `anchor_missing` |
| 2 | `Status` matches the running value declared in § 2 | `anchor_not_running` |
| 3 | Every journey in the journey catalog (§ 9) — ALL flagged `anchor: true` per Q1 — has ≥1 evidence file whose join key (`journey:` OR legacy `scenario:` via the anchor's `aliases:`) matches, with `outcome: pass` | `no_anchor_evidence` |
| 4 | The most recent matching evidence file (by frontmatter `date:`) for each anchor journey is within the freshness threshold below | `anchor_evidence_stale` |
| 5 | No `outcome: pass` evidence file has an empty/absent `oracle_result:` field (EC-3 — blocks a hallucinated self-reported green) | `outcome_pass_requires_oracle_result` |
| 6 | No evidence body contains a full-secret literal `theo_live_[A-Za-z0-9_-]{20,}` / `sk-or-v1-[A-Za-z0-9]{20,}` (EC-2 — the documented ≤4-char prefix is allowed) | `evidence_contains_secret` |
| 7 | The journey catalog declares ≥1 journey and ≥1 `anchor: true` per surface (EC-7 — a catalog with zero anchors does NOT vacuously pass) | `no_anchor_journeys` |

**Freshness threshold (PER-PROJECT — EDIT THIS):** `30 days` by default (Q3). Reduce for fast-moving products; never raise without ADR.

## § 4 — Soft caps (PER-PROJECT — EDIT OR EXTEND)

Soft caps cap the verdict at `EVIDENCE_WITH_CAVEATS`. They fire when hard caps pass but evidence is thin.

| Soft cap | Default | Rationale |
|---|---|---|
| Total evidence count for the anchor | ≥ 3 | Single evidence point is not a trend. |
| Failure stories present | ≥ 1 | A dogfood without failures is theatre. |
| Evidence from ≥ 2 different operators | recommended | Avoid "the one person who knows how" syndrome. |

## § 5 — Evidence file frontmatter (LOCKED)

Every file under `knowledge-base/dogfood/evidence/` MUST have YAML frontmatter:

```yaml
---
journey: <J-SURFACE-N>  # catalog id (§ 9). Legacy `scenario: <slug>` is also accepted (EC-1),
                        #   matched against the anchor journey's `aliases:` list.
date: YYYY-MM-DD        # local date of the dogfood run
operator: <name>        # who ran it (human or "claude-code" for a driven journey)
outcome: pass | partial | fail
oracle_result: <verbatim machine observation>   # REQUIRED when outcome==pass (EC-3):
                        #   suite exit code / HTTP status+shape / Chrome evaluate_script return.
                        #   A `pass` with empty/absent oracle_result is INVALID (hard cap #5).
summary: <one line>
---
```

Missing any field → evidence file ignored by hard cap #3. A `pass` without a non-empty
`oracle_result:` fails hard cap #5 (no hallucinated green). Evidence bodies MUST redact
secrets (EC-2): drivers write at most `theo_live_` / `sk-or-` + 4 chars; a full-secret
literal fails hard cap #6.

## § 9 — Journey catalog (LOCKED contract; catalog content is PER-PROJECT)

Per [ADR-0019](../knowledge-base/adrs/ADR-0019-dogfood-unified-journey-suite.md) (Q1 owner
directive 2026-07-11), `/dogfood` is a **runner+gate**: it drives every catalogued user
journey across the four product surfaces (SDK · API · MCP · UI) as a human and records one
evidence file per journey. The machine-readable catalog is the Source of Truth at
`knowledge-base/dogfood/journeys.md` — one row per journey (`id | surface | title | anchor |
oracle`) plus a per-journey steps block. **EVERY journey is `anchor: true`** — a red or
missing anchor journey forces `EVIDENCE_INSUFFICIENT` (hard caps #3–#7). The legacy anchor
scenario `claude-code-auto-memory` is preserved as one anchor journey via its `aliases:`
(no silent swap). Verdict tokens (§ 1) and Status vocabulary (§ 2) are unchanged.

## § 6 — When this rule may change

Per `cycle-rule-schema.md § Golden Rule Change Protocol`, plus one extra requirement:
sign-off from at least one operator who has logged anchor evidence. Rule-specific
deviations:

- Changing the anchor slug = abandoning the previous anchor (requires ADR).
- Loosening the freshness threshold = downgrading the gate (requires ADR).
- Adding a new `Status` value or new hard cap = expanding the contract (requires ADR).

## § 7 — Failure modes the rule guards against

- "Production-ready" claim backed only by synthetic benchmarks.
- Silently swapping the anchor when the original becomes inconvenient.
- Aging evidence (dogfood worked 6 months ago; nothing since).
- Single-operator knowledge (only one person can actually run the anchor).
- Dogfood theatre — checking the box without using the product.

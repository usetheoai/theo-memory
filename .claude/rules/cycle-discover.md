---
cycle: discover
phases:
  - discover-plan
  - discover-edge-cases
  - discover-execute
  - discover-confidence
  - discover-improve
  - skill-writer
  - skill-validator
  - skill-register
trigger: when a question about .claude/knowledge-base/references/ (Mem0, Letta, LangMem) AND/OR external prior art (papers, RFCs, vendor docs, engineering blogs, dependency-candidate libs) needs a blueprint-shaped answer
output: technical blueprint at .claude/knowledge-base/discoveries/blueprints/{slug}-blueprint.md + URL snapshots at .claude/knowledge-base/discoveries/snapshots/{slug}/{sha256}.md AND (optionally) a generated patterns skill at .claude/skills/{slug}-patterns/
---

# Cycle: Discover

> **INQUEBRÁVEL — 95% Confidence Gate**
>
> NÃO FAÇA NADA SE NÃO TIVER 95% DE CONFIANÇA.
> SEMPRE QUE PRECISAR DE UMA DECISÃO DO USUÁRIO, APRESENTE
> OPÇÕES PARA ELE ESCOLHER.
>
> Ver `/home/paulo/.claude/CLAUDE.md` § 1 (Confiança de 95%).

Source of truth for the deep-research investigation cycle over `.claude/knowledge-base/references/` **and external prior art on the open web**. Every phase below has its own SKILL.md, but the contract — chain order, anti-patterns, gates, stop conditions, rollback — lives here. SKILL.md files point HERE, not the other way around.

## Purpose

Convert a question about a reference project (Mem0 / Letta / LangMem) **and/or the state of the art outside the monorepo** into:

1. A **discovery plan** declaring what to investigate (Coverage Matrix of **5 corners**: tests / deps / tools / techniques / **prior_art**)
2. A **technical blueprint** populated by deep-research over `.claude/knowledge-base/references/` (local) AND over external prior art (papers, RFCs, vendor docs, engineering blogs, dependency-candidate libs per Inquebrável Rule 9 "Não Reinvente a Roda") using halt-loop iteration
3. (Optional) A **generated patterns skill** that distills the blueprint's load-bearing knowledge into a first-class skill consumed by `/to-plan`

The `prior_art` corner exists because investigating only `.claude/knowledge-base/references/` (Mem0 / Letta / LangMem) leaves three honesty gaps closed by external research: (a) **Rule 9 compliance** — before committing to in-house impl, check if a mature lib already solves it; (b) **state-of-the-art grounding** — academic papers (Generative Agents, MemGPT, etc.) describe constraints the three clones don't surface; (c) **competitor delta** — vendor docs (Pinecone, Qdrant, Weaviate, OpenAI Memory) reveal feature parity gaps and design choices made in production.

## Trigger conditions

Invoke this cycle when:

- A specific question about a reference project needs a structured answer beyond `Read + Grep`
- A side-by-side comparison between Mem0 / Letta / LangMem is needed
- A blueprint is required to inform a future `/to-plan` invocation (cycle-plan)
- **State-of-the-art lookup is required** — e.g., "what does Generative Agents 2023 say about reflection scoring?" or "how does Pinecone's metadata-filter pricing compare to ours?"
- **Rule 9 dependency evaluation is required** — before deciding to implement X in-house, check if a mature lib already resolves it (e.g., BM25 lib vs handrolling, embedding-batch lib vs custom)

Do NOT invoke when:

- The question is text-shaped (file content, README, raw config) — use direct `Read` + `Grep`
- The reference project clone in `.claude/knowledge-base/references/` is missing or stale AND no prior_art questions are in scope
- A prior blueprint at `.claude/knowledge-base/discoveries/blueprints/` already covers the question
- The web question can be answered by a single canonical URL fetch (e.g., reading one RFC) — use `WebFetch` directly without a cycle

## Chain (inquebrável)

```
/discover-plan {topic-slug}
  ↓ declares 5-corner Coverage Matrix (incl. prior_art) + per-question source: .claude/knowledge-base/references/{project} OR web
  ↓ produces .claude/knowledge-base/discoveries/plans/{slug}-plan.md
/discover-edge-cases {slug}
  ↓ incorporates MUST FIX entries; bumps plan version 1.0 → 1.1
/discover-execute {slug}
  ↓ halt-loop iterates over BOTH:
  ↓   (a) .claude/knowledge-base/references/ via Read + Grep + ast-grep
  ↓   (b) external prior art via WebSearch + WebFetch (allowlisted domains only)
  ↓ for every URL cited, writes snapshot at
  ↓   .claude/knowledge-base/discoveries/snapshots/{slug}/{sha256}.md
  ↓ populates blueprint with mixed citations (local paths + URLs + snapshot hashes)
  ↓ emits <promise>BLUEPRINT_COMPLETE</promise> when all halt conditions met
/discover-confidence {slug}
  ↓ scores blueprint structurally (M2: research_coverage + reference_citations + completeness + smells)
  ↓ reference_citations now validates BOTH:
  ↓   (a) .claude/knowledge-base/references/{...}  → Path.exists()
  ↓   (b) https://{...}     → 3-layer check: allowlist domain + snapshot exists + hash matches
  ↓                          (optional WebFetch HTTP 200 as soft cap)
  ↓ if verdict < SHIPPABLE_WITH_CAVEATS:
/discover-improve {slug}
  ↓ halt-loop refines (Phase A deterministic + Phase B LLM)
  ↓ Phase A marks broken URLs with <!-- BLOCKED: url-fabricated --> or <!-- BLOCKED: snapshot-missing -->
/discover-confidence {slug}    [re-score]
  ↓ if verdict ≥ SHIPPABLE_WITH_CAVEATS:
[skill distillation tail — optional, human-invoked]
/skill-writer {slug}
  ↓ produces .claude/skills/generated/{slug}-patterns/SKILL.md
/skill-validator {slug}-patterns
  ↓ if verdict == PASS:
/skill-register {slug}-patterns
  ↓ moves to .claude/skills/{slug}-patterns/, writes audit
DONE — /to-plan now discovers via Step 0 frontmatter scan
```

The cycle is **inquebrável as a contract**, not as a runtime orchestration. Today each phase is **human-invoked** sequentially — there is no orchestrator that auto-advances `/discover-plan` → `/discover-edge-cases` → `/discover-execute` → `/discover-confidence` → `/discover-improve`, and the skill-distillation tail (`/skill-writer → /skill-validator → /skill-register`) is also fully manual. Treat the chain as the recommended order; auto-orchestration is a future enhancement tracked in roadmap.

A `/discover-plan` invocation is NOT considered complete until either:

1. Final `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS (with or without skill distillation), OR
2. An honest BLOCKED report is produced (halt-loop exhausted, fabricated citation found, etc.)

## Phase contracts

Each phase has a SKILL.md with full operational detail. The contract below is the minimum each phase MUST honor.

| Phase | Input | Output | Success criterion |
|---|---|---|---|
| `discover-plan` | `{topic-slug}` + `.claude/rules/` + `.claude/knowledge-base/references/{project}/` top-level + prior reports in `docs/exploration-reports/` + **web allowlist** (`.claude/rules/discover-web-allowlist.txt`) | `plans/{slug}-plan.md` v1.0 with 10 mandatory sections, 6-12 research questions (5-10 local + 1-3 prior_art), Coverage Matrix 100% across 5 corners | All five corners (tests/deps/tools/techniques/prior_art) mapped OR ADR-deferred. Prior_art questions explicitly declare candidate sources (paper IDs, RFC numbers, vendor URLs, dependency-candidate libs) |
| `discover-edge-cases` | `plans/{slug}-plan.md` | Report inline (or saved); plan may be bumped v1.0 → v1.1 with MUST FIX absorbed | Veredict OK or NEEDS ADJUSTMENT delivered honestly |
| `discover-execute` | Plan v1.x + `.claude/knowledge-base/references/{project}/` (read-only) + WebSearch/WebFetch tools + allowlist | `blueprints/{slug}-blueprint.md` populated; `.progress-{slug}.json` audit trail; URL snapshots at `snapshots/{slug}/{sha256}.md` | `<promise>BLUEPRINT_COMPLETE</promise>` emitted (or honest BLOCKED report). Every cited URL has a corresponding snapshot file |
| `discover-confidence` | Blueprint .md + snapshots dir + allowlist | JSON score report + verdict (SHIPPABLE / SHIPPABLE_WITH_CAVEATS / NON_SHIPPABLE / INVALID) | Hard caps audited (incl. URL allowlist + snapshot integrity); soft caps surfaced (incl. URL unreachable) |
| `discover-improve` | Blueprint + previous confidence verdict | Patched blueprint + diff | Verdict ≥ target (default SHIPPABLE_WITH_CAVEATS) OR honest exhaustion. Broken URLs replaced or marked BLOCKED |
| `skill-writer` | Blueprint + verdict ≥ SHIPPABLE_WITH_CAVEATS | `generated/{slug}-patterns/SKILL.md` + `.source-blueprint` marker | Candidate written without fabrication; URL citations preserved with snapshot hash |
| `skill-validator` | Candidate skill at `generated/{name}/` | JSON report + verdict (PASS / NEEDS_REVIEW / REJECT) | 5 deterministic checks executed |
| `skill-register` | Validated candidate (PASS) | Promoted skill + audit at `reviews/skill-register-*.md` | Move + audit + (rare) settings.json patch atomic |

## Hard gates (cannot advance — BLOCK the cycle)

1. **`/discover-confidence` verdict INVALID** — any Coverage corner empty (incl. `prior_art`) OR fabricated citation (local OR web). Cycle MUST loop back to `/discover-execute` (or further upstream to `/discover-plan`) to fix structural defect. NO advance to `/skill-writer`.
2. **`/skill-validator` verdict REJECT** — at least one FAIL. `/skill-register` REFUSES. Human MUST either delete the candidate OR fix and re-validate.
3. **Path declared in plan does NOT exist** — `Path.exists()` false. `/discover-execute` marks that question BLOCKED; never invents alternatives.
4. **Blueprint citation fabricated** — `/discover-confidence` will cap at 49. `/discover-improve` Phase A marks fabricated citations with `<!-- BLOCKED: path not found -->` rather than inventing replacements.
5. **URL cited from a non-allowlisted domain** — every web citation MUST come from a domain in `.claude/rules/discover-web-allowlist.txt` (arXiv, RFC editor, W3C, IETF, GitHub, official vendor docs, npmjs, PyPI, etc.). Off-allowlist URL caps confidence at 49 with stable identifier `domain_not_in_allowlist`. Human adds domain to allowlist (with rationale) OR removes the citation.
6. **URL snapshot missing or hash mismatch** — every URL cited MUST have a corresponding file at `snapshots/{slug}/{sha256}.md` where `sha256` is computed over `{url}\n---\n{fetched-content}`. Missing file or mismatched hash caps confidence at 49 with stable identifier `snapshot_missing_or_corrupt`. `/discover-execute` MUST write the snapshot at the same iteration the URL is cited; this is non-negotiable.
7. **Prior_art question without explicit Rule 9 verdict** — when a prior_art question evaluates a dependency-candidate lib (e.g., "should we use lib X for BM25?"), the blueprint MUST record one of: `ADOPT`, `REJECT (with rationale)`, `DEFER (with revisit date)`. Silent omission is fabrication. Caps at 49 with stable identifier `rule9_verdict_missing`.

## Soft gates (advance, but require human review)

1. **`/discover-confidence` verdict NON_SHIPPABLE** — score 50-69, no hard cap. Halt-loop in `/discover-improve` runs; if no convergence, surface to human.
2. **`/discover-confidence` soft cap `soft_floor_*`** — at most SHIPPABLE_WITH_CAVEATS. Skill distillation tail still runs but candidate skill gets careful review.
3. **`/skill-validator` verdict NEEDS_REVIEW** — at least one WARN, no FAIL. Skill stays in `generated/`; human edits SKILL.md, re-runs `/skill-validator`. `/skill-register` refuses until PASS.
4. **URL unreachable at confidence-check time** — WebFetch returns non-200 OR times out for a URL whose snapshot is valid. Caps at 70 (`soft_floor_url_unreachable`) because network is flaky and penalizing transient outages is unjust — the snapshot is the source of truth. Human reviews; if vendor moved the URL, citation should be updated AND a new snapshot written.
5. **Vendor blog citation older than 18 months** — blogs drift fast (deprecated APIs, retracted claims). Caps at 89 (`soft_floor_stale_blog_citation`) unless an ADR explicitly justifies keeping it. Does NOT apply to academic papers (arXiv) or RFCs — those age gracefully.
6. **Dependency-candidate lib evaluated as ADOPT but no version pinned** — blueprint says "use lib X" but doesn't pin version or note semver range. Caps at 89 (`soft_floor_unpinned_dep_candidate`). Reason: Rule 9 adoption without version is half-honest; the lib's API may change.

## Stop conditions (cycle aborts honestly — NOT a failure)

1. **`/discover-execute` halt-loop exhausted** — max iterations OR time budget. Emit promise WITH honest blocked-questions report. Blueprint is partial; `/discover-confidence` will reflect that.
2. **Fase A returns empty after 3 retries with different query variants** — mark that question BLOCKED with reason "Fase A exhausted — no hotspots". DO NOT pad with unrelated hotspots from another question's scope. Applies to BOTH local (`Grep`/`ast-grep`) and web (`WebSearch`) query variants.
3. **Per-project time budget exhausted** — mark remaining questions for that project as BLOCKED with reason "budget exhausted". DO NOT continue silently.
4. **Coverage corner deferred via ADR in plan** — corner is intentionally empty; this is honest, not failure. Confidence will cap at SHIPPABLE_WITH_CAVEATS (not INVALID). Applies equally to `prior_art` corner — explicit `<!-- DEFER-CORNER: prior_art | {reason} -->` marker is honest deferral.
5. **WebSearch returns zero results after 3 query variants** — mark prior_art question BLOCKED with reason "WebSearch exhausted — no candidates". DO NOT cite URLs that the search engine never returned.
6. **WebFetch consistently fails (>2 retries, non-network errors)** — URL is dead OR vendor blocks bot access. Mark BLOCKED with reason "url-unfetchable"; do NOT fabricate snapshot content from training data.
7. **Web budget exhausted** — separate per-cycle budget tracked in `.progress-{slug}.json` (suggested: max 20 WebSearch + 30 WebFetch per cycle, configurable per discovery plan). When hit, remaining prior_art questions BLOCKED; cycle continues with local work.

## Anti-patterns (NEVER do these — violates the contract)

1. **NEVER skip `/discover-edge-cases`** — Coverage Matrix flaws found here are 10x cheaper than during `/discover-execute`.
2. **NEVER run `/discover-execute` with an unincorporated MUST FIX** — fix the plan v1.0 → v1.1 first.
3. **NEVER run `/skill-writer` when blueprint verdict is INVALID or NON_SHIPPABLE** — propagates defect downstream into a first-class skill.
4. **NEVER fabricate a `.claude/knowledge-base/references/` citation** — every path in plan, blueprint, generated skill MUST exist. Confidence will catch it; better to mark BLOCKED honestly.
5. **NEVER modify anything inside `.claude/knowledge-base/references/`** — read-only zone, enforced by `.claude/hooks/boundary-check.sh`. No `npm install`, no `pip install`, no edits.
6. **NEVER use `cd` into `.claude/knowledge-base/references/`** — investigate from project root with full paths.
7. **NEVER promote a NEEDS_REVIEW skill without human edit + re-validation returning PASS** — `/skill-register` refuses on principle.
8. **NEVER auto-overwrite an existing generated or first-class skill with same name** — `/skill-writer` aborts; human resolves manually.
9. **NEVER cite a URL without writing the snapshot** — the snapshot is what the blueprint asserts as truth; the live URL is volatile. Snapshot-first, cite second. If WebFetch failed, the URL CANNOT be cited; mark BLOCKED.
10. **NEVER fabricate a URL from training-data recall** — the LLM may "remember" `https://arxiv.org/abs/2304.03442` for Generative Agents (Park et al.). It MUST still be validated via WebSearch → WebFetch → snapshot. Memory-only citations are fabrication, regardless of how plausible they look.
11. **NEVER cite a URL outside the allowlist** — adding a new domain requires an inline rationale in `.claude/rules/discover-web-allowlist.txt` (one-line "added because X for {slug} at {date}"). Drive-by domain additions defeat the audit purpose.
12. **NEVER skip Rule 9 evaluation when implementing a non-trivial primitive** — every plan task that says "we'll implement X" where X is BM25, embedding batch, vector store driver, retry-backoff, etc. MUST have a corresponding prior_art question that lists candidate libs + ADOPT/REJECT verdict with rationale. Surfacing "we checked nothing, just built it" is a cycle failure.
13. **NEVER trust a vendor blog as a contract** — vendor docs change without notice; blogs get rewritten. Cite vendor blogs for design inspiration only, never as the authoritative spec. RFCs and SDK source code are authoritative; blogs are commentary.
14. **NEVER cite a paper without an arXiv ID, DOI, or stable conference URL** — "Park et al. 2023" alone is not a citation. The snapshot must be of a canonical landing page (arXiv abs page, ACL Anthology, NeurIPS proceedings).

## Rollback

| Artifact | Rollback procedure |
|---|---|
| Discovery plan in `plans/{slug}-plan.md` | Delete file; no further state to revert |
| Blueprint in `blueprints/{slug}-blueprint.md` | Delete file + `.progress-{slug}.json`; no further state to revert |
| Confidence report in `reviews/{slug}-confidence-*.md` | Delete file |
| Improve patches | `git diff` against the working tree; revert via standard git workflow |
| Generated skill in `generated/{name}/` | `find .claude/skills/generated/{name} -delete` (since deny rule blocks `rm -rf`) |
| Registered skill (first-class) | `mv .claude/skills/{name}/ .claude/skills/generated/{name}/` + delete audit at `reviews/skill-register-*.md` |
| URL snapshots in `snapshots/{slug}/` | `find .claude/knowledge-base/discoveries/snapshots/{slug} -delete`. Snapshots are commit-tracked (audit trail); deletion is reversible via `git checkout` of the affected files in another branch (NOT on `main`, per Rule 4). |
| Allowlist additions in `discover-web-allowlist.txt` | Standard git revert of the line addition. Audit trail of WHY a domain was added lives in the line's inline comment. |

`.claude/knowledge-base/references/` is read-only by hook enforcement — there is nothing to rollback there.

## Cross-references

- Phase SKILL.md (in chain order): `discover-plan/`, `discover-edge-cases/`, `discover-execute/`, `discover-confidence/`, `discover-improve/`, `skill-writer/`, `skill-validator/`, `skill-register/`
- Templates: `discover-plan/templates/discovery-plan-template.md`, `discover-execute/templates/blueprint-template.md`, `skill-writer/templates/generated-skill-template.md`
- Rubrics: `discover-confidence/templates/rubric-blueprint.md`
- Project rules consumed: `architecture.md` (DIP), `testing.md` (TDD pyramid), `public-copy.md` (positioning anchors), **`/home/paulo/.claude/CLAUDE.md` § 9 (Não Reinvente a Roda)** — drives the dependency-candidate evaluation in `prior_art`.
- Tools used for web research: built-in `WebSearch` + `WebFetch` (deferred — loaded via `ToolSearch` when the cycle starts a prior_art phase).
- Allowlist: `.claude/rules/discover-web-allowlist.txt` (line-per-domain with inline rationale; commit-tracked).
- Snapshots dir: `.claude/knowledge-base/discoveries/snapshots/{slug}/{sha256}.md` (commit-tracked audit trail of every URL cited).
- Companion cycle: `cycle-plan.md` consumes outputs of this cycle when patterns skills are registered.
- Token budget: `token-budget.md` — note that web research increases `/discover-execute` cost (suggested: +30k tokens per active prior_art question due to WebFetch overhead).

## Versioning

This cycle rule is **v1.1** as of 2026-05-22. Changes that ADD phases or hard gates are minor version bumps. Changes that REMOVE phases or soften hard gates are major version bumps requiring strategic review.

### Change log

| Version | Date | Change | Rationale |
|---|---|---|---|
| v1.0 | 2026-05-21 | Initial cycle rule, 4-corner Coverage Matrix, `.claude/knowledge-base/references/`-only scope. | Baseline contract for the discover cycle. |
| v1.1 | 2026-05-22 | Added 5th Coverage Matrix corner `prior_art`; expanded inputs to include WebSearch/WebFetch; added 3 hard gates (allowlist, snapshot, Rule 9 verdict); added 3 soft gates (URL unreachable, stale blog, unpinned dep); added 6 anti-patterns; new rollback rows; new cross-references for allowlist + snapshots dir. Strategic review required for golden rules downstream (see below). | User directive 2026-05-22: "Revise nosso ciclo de discover ele deve incluir pesquisar na web (deep research)". Decisions captured via AskUserQuestion: 5º corner separado (prior_art); URL fabrication enforcement via combined allowlist + snapshot + WebFetch; sources include papers + RFCs + vendor docs + engineering blogs + dependency-candidate libs (Rule 9). |

### Downstream changes required (NOT yet shipped — follow-up work)

This cycle rule extension is a **contract extension**, not a softening. Per the locked policy in `discover-plan-golden-rule.md` and `discover-blueprint-golden-rule.md` (§ When this rule may change), extensions follow the same process as softenings but with lower burden. The following files MUST be updated in a follow-up PR/cycle to align with v1.1:

1. `.claude/rules/discover-plan-golden-rule.md` — expand Coverage Matrix from 4 to 5 corners (add `empty_corner_prior_art` stable identifier); expand "fabricated citation" rule to include URL (`fabricated_url_citation`); add allowlist + snapshot stable identifiers.
2. `.claude/rules/discover-blueprint-golden-rule.md` — same expansions, applied to blueprint shape.
3. `.claude/rules/discover-plan-thresholds.txt` (and `discover-blueprint-thresholds.txt`) — bump sunset date; cite this v1.1 entry as the ADR.
4. `.claude/rules/discover-web-allowlist.txt` — NEW FILE. Seed with: `arxiv.org`, `www.rfc-editor.org`, `www.w3.org`, `datatracker.ietf.org`, `github.com`, `npmjs.com`, `pypi.org`, `docs.pinecone.io`, `docs.weaviate.io`, `qdrant.tech`, `platform.openai.com`, `docs.anthropic.com`, `mem0.ai`, `letta.com`, `langchain.com`. Each line carries inline rationale.
5. `.claude/skills/discover-plan/SKILL.md` + template — declare prior_art questions in plan; require source field (`.claude/knowledge-base/references/{project}` OR `web`).
6. `.claude/skills/discover-execute/SKILL.md` + halt-loop prompt — wire WebSearch/WebFetch into Fase A/B; snapshot-write before citation.
7. `.claude/skills/discover-confidence/scripts/check_reference_citations.py` — extend to handle URL citations (allowlist + snapshot validation + optional WebFetch HTTP 200).
8. `.claude/skills/discover-confidence/scripts/check_research_coverage.py` — recognize the 5th corner.
9. `.claude/skills/discover-improve/` — Phase A handles URL fabrication markers + snapshot regeneration.
10. `.claude/rules/token-budget.md` — bump `/discover-execute` estimate band by +30k per active prior_art question.
11. `.gitignore` — confirm `snapshots/` IS committed (NOT gitignored). Allowlist IS committed.

This file is the contract; the 11 downstream items are the implementation. The contract is normative even if any single downstream file lags.

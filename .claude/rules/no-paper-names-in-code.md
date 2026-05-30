# No paper or marketing names in code

> **INQUEBRÁVEL — 95% Confidence Gate**
>
> NÃO FAÇA NADA SE NÃO TIVER 95% DE CONFIANÇA.
> SEMPRE QUE PRECISAR DE UMA DECISÃO DO USUÁRIO, APRESENTE
> OPÇÕES PARA ELE ESCOLHER.
>
> Ver `/home/paulo/.claude/CLAUDE.md` § 1 (Confiança de 95%).

Source of truth for the naming hygiene policy across the code-and-test surface of TheMemory. Promoted from session memory `no_paper_names_in_code.md` to a first-class project rule per v0.6.1 T5.2 (F-arch-10).

## The rule

Research-paper and marketing names — `Voyager`, `Mem0`, `Letta`, `LangMem`, `MemGPT`, `Generative Agents`, `CoALA`, `ProcMEM`, vendor product names, etc. — SHALL NOT appear in:

- `src/**` production code: JSDoc, inline comments, identifiers, error messages, log strings, structured event names.
- `src/**/__tests__/**` and `tests/**` test files: `describe` / `it` / `test` names, fixture file names, fixture variable names, inline comments.

These references ARE allowed and expected in:

- `.claude/knowledge-base/plans/**` — the plan IS the citation surface.
- `.claude/knowledge-base/discoveries/blueprints/**` — the blueprint cites prior art directly.
- `.claude/knowledge-base/adrs/**` — ADRs cite the papers that motivated a decision.
- `.claude/knowledge-base/reviews/**` — review reports cite the source they reviewed against.
- `README.md`, `CHANGELOG.md`, public-facing copy — when consciously citing prior art for the consumer's benefit.

## Why

Paper and marketing names in code create two failure modes:

1. **Confusion.** A reader sees `"Voyager-style supersession"` in a JSDoc and assumes the code matches the paper line-by-line. It usually doesn't — we adapt patterns, not transplant them. The reader builds a wrong mental model and either (a) finds discrepancies that look like bugs but are deliberate divergences, or (b) refactors toward the paper at the cost of the actual contract we shipped.

2. **Bias.** Naming a function `consolidate_voyager_skills` biases every future change toward "preserve Voyager-paper semantics" instead of "preserve THE contract we declared". The contract we declared lives in the plan + ADRs; that's where the citation belongs.

Neutral wording — `supersession chain`, `code-as-skill payload`, `consolidation orchestrator`, `4-phase Orient-Gather-Consolidate-Report` — describes what the code DOES without claiming what it IS.

## How to apply

1. **JSDoc and comments**: describe the BEHAVIOR or the SHAPE, not the inspiration. `"4-phase consolidation orchestrator"` is right; `"Voyager-style consolidate"` is wrong.
2. **Citations stay in `@see` references to knowledge-base docs**, not paper names. `@see .claude/knowledge-base/plans/voyager-skill-library-plan.md § T3.1` is right (filesystem coordinate); `@see Voyager paper § 3.2` is wrong.
3. **Runtime error messages cite the task ID**, not the slug or paper. `Error: insertDerivedSkillAtomic: INSERT returned no rows (T3.1)` is right; `Error: Voyager skill library T3.1 failed` is wrong.
4. **Test names describe behavior**, not the source. `test('forget removes the skill so subsequent recall does not return it')` is right; `test('Voyager-style forget')` is wrong.
5. **File paths in `@see` references** to existing knowledge-base files are filesystem coordinates, not concept names — they are OK and encouraged for traceability.

## Pre-existing references

References that predate this rule get cleaned up **opportunistically** when those files are next touched — not as scope-creep on the current task. Examples discovered during the v0.6 cycle (will be cleaned when the surrounding code is edited):

- `src/agent-tools/server.ts:34` — "Voyager-style skill library lands v0.6"
- other historical artifacts in already-shipped JSDoc blocks

When the file is next edited for a primary task, the cleanup ships in the same commit per the [audit-trail rotation policy](./audit-trail-rotation.md) — the surrounding diff is the natural place to clean adjacent rot.

## Anti-patterns

1. **Adding a `// per Voyager paper` comment to defend an implementation choice** — the ADR is the place for that. Cite the ADR; the ADR cites the paper.
2. **Naming a class `MemGPTBlock` / `LettaCounter` / etc.** — pick a name that describes the role in OUR system. The pattern's origin lives in the blueprint.
3. **Putting `Mem0-compatible` in a runtime error** — consumers reading the error don't care about Mem0; they care what broke.
4. **Adding paper names to enums or string-literal types** — `kind: 'voyager-skill'` ships the paper name forever; `kind: 'skill'` ships intent.

## When this rule may change

Only via explicit ADR signed by the project owner. Any PR that softens enforcement — adding a paper-name allowlist, exempting a subset of files, etc. — MUST cite the ADR justifying the change and update this rule in the same PR.

## Related

- Session-memory source: `/home/paulo/.claude/projects/-home-paulo-Projetos-usetheo-theo-memory/memory/no_paper_names_in_code.md` (kept as the user-personal cache).
- Cited by: `src/core/dip/skill-representation-strategy.ts` JSDoc (the DIP where the rule first surfaced during v0.6 T1.2).
- Cycle rules referencing this convention: `cycle-implement.md` (cited as Inviolable Rule in halt-loop driver prompts).
- Plan absorbing this rule: `.claude/knowledge-base/plans/voyager-skill-library-fixes-v0-6-1-plan.md § T5.2 / F-arch-10`.

## Log of changes

| Date | Change | Rationale |
|---|---|---|
| 2026-05-30 | Rule promoted from session memory to first-class project rule. Original session memory stays as user-personal cache. | v0.6.1 T5.2 / F-arch-10 absorption: review found that the policy was load-bearing during /implement but lived only in session-memory, making it invisible to ADRs and code reviewers without session context. Promotion makes it citable. |

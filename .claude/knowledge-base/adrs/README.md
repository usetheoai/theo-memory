# ADR Index — TheMemory v0.0

Architecture Decision Records (MADR 3.0 shape) that lock the load-bearing design choices for `@usetheo/memory`. Each ADR is a derivative artifact of the source plan; the plan is the contract, the ADRs are the durable rationale catalogue for v0.1+ consumers.

| # | Title | Resolves | Reversibility |
|---|---|---|---|
| [ADR-0001](ADR-0001-mem0-shape-architecture.md) | Mem0-shape architecture (adopt the proven write/search pipeline) | CLAUDE.md § Architectural Decisions Locked #1 | Partial — public verbs hard to undo; architecture choices reversible per item |
| [ADR-0002](ADR-0002-three-tier-scope.md) | Three-tier scope (User / Session / Agent) via scoped sub-objects | CLAUDE.md § Locked names + § Architectural Decisions Locked #2 | Hard — public sub-object API is load-bearing for type narrowing |
| [ADR-0003](ADR-0003-add-only-public-api.md) | ADD-only public API (no `update()` method) | Open question Q2 + Locked Decision #4 | Hard — undoing introduces silent semantic-merge behavior change |
| [ADR-0004](ADR-0004-api-verbs.md) | API verbs (`remember / recall / forget / reflect` + parity helpers) | CLAUDE.md § Locked names | Effectively NO post-v1.0 |
| ADR-0005 | Reflection trigger: explicit-only in v0.0, policy interface declared | Open question Q3 | To be filed by T1.2 |
| ADR-0006 | Bi-temporal columns: schema-yes-in-local, query-API-no-until-v0.5 | Open question Q4 | To be filed by T1.2 |
| ADR-0007 | Entity store: opt-out via constructor flag `entityBoost: boolean` | Open question Q5 | To be filed by T1.2 |
| ADR-0008 | DIP interfaces (VectorStore 11, LLM 2, Embedder 2, HistoryManager 4+3) | Roadmap Item 1 acceptance | To be filed by T1.2 |
| ADR-0009 | Cloud auth: `THEOKIT_API_KEY` reuse with optional `apiKey` override | Open question Q6 | To be filed by T1.2 |

## Conventions

- File format: MADR 3.0 (Status, Context, Decision, Consequences with Positive/Negative/Reversibility, Alternatives, References).
- File naming: `ADR-NNNN-{kebab-case-slug}.md`. ADR numbers are immutable once accepted; superseded ADRs update the Status field but keep the number.
- Cross-references via repo-relative paths.
- Every ADR cites at least one verifiable `referencia/` path (when applicable) — `/discover-confidence` checks via `Path.exists()`.
- No emoji (per architecture.md + Inquebrável Rule).
- ADRs do NOT introduce file paths inside Decision sections — file paths belong in implementation plans, not architecture decisions.

## Lifecycle

1. New ADRs are drafted as part of a `/to-plan` task that introduces the load-bearing decision.
2. The plan ships the ADR file as a task deliverable (T1.1 ships D1-D4; T1.2 ships D5-D9 at v0.0).
3. Reviewers (`/review`'s architecture-reviewer agent) audit the ADR for MADR completeness + cross-link integrity.
4. Superseding an ADR requires a NEW ADR (e.g., ADR-0010) that sets the old one's Status to `Superseded by ADR-0010` and explains why.

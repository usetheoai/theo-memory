---
paths:
  - "README.md"
  - "PITCH.md"
  - "docs/marketing/**/*.md"
---

# Public Copy Rules — @usetheo/memory

> **INQUEBRÁVEL — 95% Confidence Gate**
>
> NÃO FAÇA NADA SE NÃO TIVER 95% DE CONFIANÇA.
> SEMPRE QUE PRECISAR DE UMA DECISÃO DO USUÁRIO, APRESENTE
> OPÇÕES PARA ELE ESCOLHER.
>
> Ver `/home/paulo/.claude/CLAUDE.md` § 1 (Confiança de 95%).

Scoped to **public-facing copy only** (`README.md` HERO/BODY, `PITCH.md`, marketing surfaces). Internal docs (`CLAUDE.md`, `docs/exploration-reports/*`, `docs/agentic-memory-landscape.md`, source code, CHANGELOG when created) stay technical-direct and are exempt from these rules.

The operational voice guide is locked in [`../../theokit/CLAUDE.md`](../../theokit/CLAUDE.md) and applies to TheMemory by explicit extension (root strategic review 2026-05-21). This file enumerates the concrete checks that ALSO apply to TheMemory specifically.

## 1. Voice — aspirational, outcome-first

- HERO talks outcomes ("remembers what your agent learned, across sessions, automatically").
- HERO never names internals: no `Postgres`, `pgvector`, `Qdrant`, `vector engine`, `embedding model`. Those go in DEEP DIVE only (`## How it works`, `## Architecture`, `## Foundation`).
- BODY can name TheoKit, TheoCloud, the ecosystem — those are user-facing surfaces.
- DEEP DIVE (`## How it works` and lower) can be technical-direct.

## 2. Locked positioning anchors

Every public copy edit must preserve these anchors. If one breaks, surface the conflict before publishing.

| Anchor | Banned alternative |
|---|---|
| **"Mem0-shape architecture"** (inspired, not cloned) | "Mem0-clone", "Mem0 clone", "fork of Mem0" |
| **"Native managed memory of TheoCloud, optimized for TheoKit"** | "wrapper around Mem0", "Mem0 wrapper", "wrapper for X" |
| **"Pre-release"** until v1.0 with reproduced benchmarks | "production-ready", "production-grade", "battle-tested" |
| **MIT-licensed** (explicit exception) | "Apache-2.0" associated with TheMemory in any sentence |
| **"Memory store"** / **"managed memory"** in HERO/BODY | `Qdrant`, `pgvector`, `vector engine`, `vector store engine` outside DEEP DIVE |
| **"Lock-in is a feature, owned explicitly"** | Apologetic framing of the TheoKit + TheoCloud coupling |
| **Three tiers: User / Session / Agent** | Renaming or collapsing the trio in HERO/BODY |
| **"Two runtimes — local + cloud"** | Implying TheMemory is cloud-only or local-only |

## 3. Cross-reference checks

| Document | What to verify when editing |
|---|---|
| `../CLAUDE.md` § Voice and Tone | TheMemory adopted the aspirational voice on 2026-05-21. Rules apply. |
| `../CLAUDE.md` § Architectural Decisions Locked | The four root overrides must not be silently revised in copy. |
| `../README.md § Status` | Must stay "Pre-release" — canonical status declaration. |
| Root `../../CLAUDE.md § Cross-Project Rule 9` | Cloud abstraction — user-facing copy says `memory store`, never internals. |
| Root `../../CLAUDE.md § Product Hierarchy` | TheMemory is a "Community auxiliary (OSS auxiliary)", "Pre-release". Do not contradict. |

## 4. Quantitative-claim hygiene

- Never publish a benchmark number on public copy without a reproducible artifact + a link to the artifact in the same paragraph. The TheoCloud pattern is `theo/deploy-evidence.jsonl`; TheMemory's equivalent will live at `docs/benchmarks/` (planned v1.0).
- Comparative claims against named players (Mem0, Letta, Zep) require a side-by-side benchmark in `docs/benchmarks/` first. Until then, frame as positioning ("optimized for TheoKit"), never as performance ("faster than X").

## 5. Headlines and taglines

The root `CLAUDE.md § Locked Narrative` table holds the ecosystem-level locked narrative ("Build AI Agents and Apps faster with Theo" + "Chat. Build. Deploy."). TheMemory's own README HERO must align with that narrative — it does not introduce a separate locked tagline. When writing TheMemory copy that references the ecosystem trio, use the exact phrase "Chat. Build. Deploy."

## 6. Pre-release honesty in copy

The README's `Status` section is the canonical declaration. Never weaken it without a PR-level decision. Specifically:

- No "production-ready" / "production-grade" badges in README.
- No "battle-tested" claim until v1.0 with reproduced benchmarks.
- No comparative performance claims (latency, recall@k) until `docs/benchmarks/` exists with independent reproduction.
- The pre-release status is OK to say plainly. Don't dress it up — the audience is developers, and pre-release is a recognized stage.

## 7. Banned words enforcement

The PostToolUse hook `.claude/hooks/public-copy-lint.sh` warns on the banned terms above. It is **warn-first** (CLAUDE.md decision 2026-05-21) — output is advisory, never blocks the edit. Address each warning or document explicitly why it's intentional in the PR description.

## Reference

- Operational voice guide: [`../../theokit/CLAUDE.md`](../../theokit/CLAUDE.md) (the canonical document — TheMemory follows it by extension).
- Locked narrative: root [`../../CLAUDE.md § Locked Narrative`](../../CLAUDE.md).
- TheMemory positioning: [`../CLAUDE.md § Locked names`](../CLAUDE.md) + § Architectural Decisions Locked.

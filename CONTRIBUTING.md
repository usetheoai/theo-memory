# Contributing to Theo Memory

Thanks for considering a contribution. This project is **pre-release** — the contract is still
being locked, so this is a good moment for feedback that changes the shape of things, not just
the details.

## Getting set up

The repo is a **pnpm workspace**. `npm install` will not wire the packages correctly.

```bash
git clone https://github.com/usetheoai/theo-memory.git
cd theo-memory
corepack enable                 # pins pnpm@10.34.1 from package.json#packageManager
pnpm install
docker compose up -d pgvector   # Postgres 16 + pgvector, the only external dependency
pnpm test                       # contract + unit suite, no database required
```

Node 20 or newer is required (`engines` is enforced — `.npmrc` sets `engine-strict=true`).

## The test tiers

| Command | What it runs | Needs |
|---|---|---|
| `pnpm test` | Contract + unit suite | nothing |
| `pnpm run test:integration` | Real Postgres + pgvector | `docker compose up -d pgvector` |
| `pnpm run test:e2e` | Built artifact end-to-end | a build (runs automatically) |
| `pnpm run lint` / `pnpm run typecheck` | ESLint / `tsc --noEmit` | nothing |

A few integration tests are **key-gated** — they call a real LLM and skip cleanly when
`OPENAI_API_KEY` is unset. You do not need a key to contribute.

## What we ask of a pull request

- **A failing test first.** Every bug fix starts with a test that reproduces it; every feature
  starts with a test that describes it. A PR with no test is a PR we cannot verify.
- **One concern per PR.** If the description needs the word "and", it is probably two PRs.
- **A CHANGELOG entry** under `## [Unreleased]`, in the right category, written for the person
  who *consumes* the change rather than the person who wrote it. Reference the issue or PR
  number.
- **Honest caveats.** If something works only under certain conditions, say so in the PR and in
  the changelog. We would much rather ship a documented limitation than an undocumented one.
- **Green gates.** `pnpm run lint`, `pnpm run typecheck`, and `pnpm test` must pass. CI runs
  them on every PR against `develop` and `main`.

## Branching

Open pull requests against `develop`. `main` only receives release merges.

## Design decisions

Anything that changes a public API, a storage shape, or a retrieval behavior deserves a short
rationale in the PR description: what you considered, and why you picked this. If a decision
turns out to be load-bearing, we record it as an ADR in `docs/`.

The three principles at the top of `CLAUDE.md` — weighted relevance, priority over volume, and
auditability — are the tie-breakers when a design question is genuinely close. A change that
makes a write, ignore, or eviction decision *less* observable will be pushed back on.

## Reporting bugs

Open an issue with: what you expected, what happened, the smallest reproduction you can manage,
and your versions (Node, Postgres, pgvector, package). Logs and the failing assertion help more
than a description of them.

For anything with a security impact, do **not** open a public issue — see [SECURITY.md](./SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](./LICENSE), the same license that covers the project.

# OSS readiness — audit and residual risk

**Audit date:** 2026-07-28 · **Branch:** `workspace` · **Method:** `loop-check-licence` full mode
(mention scan over every tracked file + every commit message), plus gitleaks, plus a manual sweep
for secrets, internal hosts, personal data and dangling references.

**Revised 2026-07-28 (same day), after a second pass that scanned historical blob content** —
the surface the first pass never read. The revision corrected three claims below and the history
was subsequently rewritten. Both the original findings and the corrections are kept, because the
first pass being wrong is itself the most useful thing in this document.

This document exists so that whoever presses "make public" knows exactly what was cleaned, what
was deliberately kept, and what could not be fixed without violating the project's own rules.

---

## Verdict

**LOW_RISK. The tree is clean and the history was rewritten on 2026-07-28.**

The exposure this document originally described as unresolved has been remediated. What follows
records both what was found and where the first pass was wrong, because the correction is the
part worth reading.

| Claim in the first pass | Status |
|---|---|
| "The working tree carries **zero** mentions of a competitor or reference project" | **Was false.** `CLAUDE.md` and `CHANGELOG.md` carried 10. The scan's built-in watchlist simply did not contain those names — see § How the first pass missed it. |
| "The git history carries **43 mentions across 44 commits**" | **Undercounted.** 43 was the commit-*message* total. Historical blob *content* held roughly 2050 further lines, never scanned. |
| "the dev host's IP address appears in 9 commits from `e75a2cd`" | **False for this repository.** `e75a2cd` is not a commit here, and a full IPv4 inventory over every reachable blob returns only loopback, `0.0.0.0`, the documentation address `1.2.3.4`, a `9.9.9.9` test fixture, three Blacksmith runner addresses quoted in a comment about GitHub IP allow-lists, and the Docker bridge. **There is no dev-host IP in this history.** |
| "cleaning it requires a history rewrite, which is prohibited by Rule 4" | Accurate as a constraint on the assistant. The owner authorised the rewrite explicitly and it was carried out — see § What the rewrite did. |

One exposure the first pass never looked for was found by the second: **developer absolute
paths**. `/home/<account>` appeared across the history while the tree was clean. No project name
is involved, so a watchlist could not have caught it.

---

## What was measured

| Surface | Before | After first pass | After rewrite |
|---|---|---|---|
| Competitor mentions in tracked files | 253 | 10 (reported as 0) | **0** |
| `openmemory` in tracked files (kept — shipped feature) | 146 | 134 | 134 |
| Competitor mentions in commit messages | 43 | 43 (unchanged) | **0** |
| Competitor mentions in **historical blob content** | ~2050 | not scanned | **0** |
| Secrets (gitleaks, full tree) | 0 | 0 | 0 |
| Developer absolute paths in tracked files | 11 | **0** | 0 |
| Developer absolute paths in **history** | not scanned | not scanned | **0** |
| Dev-host IP anywhere in history | — | claimed 9 commits | **never existed** |
| Dangling references to `.claude/` internal docs | 72 | **0** | 0 |

Licence compatibility was not at issue: no reference project is vendored, no third-party code was
found copied, and the project's own licence (Apache-2.0) matches the licence of every project that
was studied as prior art.

---

## What was removed, and why

### Comparative benchmark reports (4 files)

`docs/benchmarks/` shipped four head-to-head reports naming a competitor in the filename and in
the numbers. They were removed. Two reasons, and the second matters more than the first:

1. The project ships **no comparative claim** by policy (ADR-0020 dropped that gate precisely
   because the benchmark feature was removed in v0.35.0). Publishing "we scored X, they scored Y"
   contradicts the discipline the rest of the repo follows.
2. The numbers could not survive scrutiny. One report was a **partial run — 139 of 500 examples**,
   stopped when an API key hit its credit limit. Another compared a `gpt-4o-mini` run against a
   competitor's published figure produced on a different model. Neither is a defensible public
   claim, and a claim that cannot be defended is worse than no claim.

The generator that produced them (`packages/eval/scripts/aggregate-longmemeval.py`) was rewritten
to emit TheMemory's own measurement only — otherwise the next run would recreate the report.

The project's own LongMemEval measurements (M21–M24) survive in `docs/benchmarks/`, now stating
plainly that they are not comparable to any published leaderboard figure.

### The README comparison table

`## How it compares` scored TheMemory against three named projects. It was replaced by
`## What's distinctive`, which describes this project's own capabilities.

The removed table was, in fairness, an honest one — sourced per project, explicitly marked as a
capability rather than performance comparison, and inviting corrections. It was removed because
grading competitors in your own README is positioning rather than documentation, and because a
table asserting what *another* project lacks ages badly and without warning.

### The competitive superiority matrix in `CLAUDE.md`

A table mapping each roadmap item to "a specific competitor weakness", with funding amounts and a
column literally headed **"Our attack"**. Internal strategy, not something to publish. Removed
entirely; the "Honesty discipline" subsection underneath it was kept and promoted.

An earlier partial cleanup had stripped the competitor *names* from this table but left the
sentences, producing text like `**** ($24M)` and `— 's headline feature`. Those scars are gone.

### The ADR record — an honest loss

ADR-0001 through ADR-0015 were authored in the untracked working directory and **were never
committed**, so they no longer exist anywhere. They were already gone before this audit began;
nothing here destroyed them. ADR-0016 onward were recoverable from git history and now live in
[`docs/adrs/`](adrs/) as tracked files. `CLAUDE.md` links the recovered ones and cites the rest as
plain text rather than as dead links — the summaries in `CLAUDE.md` and the Roadmap are now the
only record of those decisions.

### The reference-clones section in `CLAUDE.md`

Described three `--depth 1` clones under `.claude/knowledge-base/references/` used for design
study. The clones were gitignored and never entered git; the section described a directory that no
longer exists.

---

## What was deliberately kept

**`openmemory` — 134 mentions, all intentional.** This is not a leak. It is the name of a
third-party MCP tool surface that TheMemory implements for interoperability
(`themory mcp --compat openmemory`, Roadmap Item 26), so that clients already wired to that
surface work against this server unchanged. The flag is a locked name; removing the term would
break the feature and every consumer depending on it. Naming another project in order to
interoperate with it is nominative use, and it is the correct thing to do here.

---

## What was fixed along the way

Two of these would have broken for an external contributor on their first day:

- **`tests/integration/publish-readiness.test.ts` and `tests/integration/agent-tools/public-paths.test.ts`**
  resolved npm from a hardcoded path inside one developer's nvm install. Both suites `skipIf` on
  that path, so they did not fail — they **silently never ran**, for anyone else and on CI. That
  included the publish-readiness gate, which is a stated P0 quality gate. npm is now resolved from
  `PATH`.
- **`packages/eval/src/stages/e2e-qa/run.ts`** hardcoded the LongMemEval dataset path inside a
  gitignored reference clone under `.claude/`. Now `E2E_QA_DATASET`, defaulting outside the tree,
  with a clean SKIP and a message that says how to point it somewhere real.

Also fixed: `@see` pointers into a private sibling repository via absolute developer paths; a
README quickstart telling contributors to run `npm install` in a pnpm workspace; a README link to
a `CONTRIBUTING.md` that did not exist; a test writing output into a stray root-level
`knowledge-base/` directory; stale `usetheodev/` issue references after the org transfer.

Added: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`. `LICENSE` (Apache-2.0) and `NOTICE`
were already present and correct.

---

## How the first pass missed it

Two independent gaps, and they compounded.

**The watchlist did not contain the names.** The mention scan matched against a built-in list of
22 competitor terms. The seven that this project actually cited — the reference project studied in
a cross-validation run and its organisation, plus five vector-store, graph-database and NLP
libraries named as evaluated alternatives — were not among them. The scan looked for names this
project never used and reported zero. The failure was in the list, not the scanner.

**Only the working tree and commit messages were read.** A file deleted or rewritten years ago
still ships with the repository; cloning is all anyone needs to read it. Scanning tracked files
answers "what does the tree say today", not "what does this repository contain".

Together they produced the worst possible outcome: a clean bill of health, and a proposed
remediation (`git filter-repo --replace-message`) that touches commit messages and never touches
file content — so it would have passed while removing almost nothing.

Both gaps were fixed in the `loop-check-licence` plugin itself: the watchlist went from 22 to 42
terms, and the scan now reads historical blob content and reports developer absolute paths.
Re-running the audit against the pre-rewrite repository reproduces the exposure the first pass
declared absent.

---

## What the rewrite did

Executed 2026-07-28 with explicit owner authorisation, after a verified `git bundle` backup.
Substitution only — no commit deleted, no code deleted.

| What was replaced | Replaced with |
|---|---|
| The reference project studied in the cross-validation run, and its organisation | the reference project · the reference organisation |
| A Python NLP toolkit named as a rejected alternative | the Python NLP library |
| A graph database named as an optional backend | a graph database |
| Two vector stores named in a positioning table | an embedded vector store · a hosted vector store |
| One further memory vendor named in package names | redacted-vendor |
| Developer absolute paths, `/home/<account>` | `<HOME>` |

The originals are deliberately not listed here. This document is published; naming them would put
back exactly what the rewrite took out. The authoritative list lives in the audit database
(`.claude/check-licence-evidence.db`, gitignored) and in the replacement file used for the run.

`openmemory` was preserved deliberately — it is a locked name and a shipped interop surface
(`themory mcp --compat openmemory`); removing it would break the feature. `compromise` was
preserved as a declared npm dependency.

Two things were preserved by precision rather than by luck: `São Paulo` (1107 lines, a city name
in entity-extraction fixtures) and the test fixture `Paulo likes coffee` (797 lines). A broad rule
on the account name would have corrupted both and left comments reading *"the first occurrence of
`<user>` sits inside `mcpaulo`"*. The rule was narrowed to the one phrasing that referred to the
actual account.

**Verified after the push, by cloning the published repository from scratch:** 1294 commits,
73 tags, zero occurrences of any target term in content or messages, `openmemory` and
`compromise` counts identical to before, 1140 files with none added and none removed.

### What it cost

- **Every commit SHA changed.** SHAs cited in `CHANGELOG.md` entries, issues and pull requests are
  now dead references. This is not recoverable.
- Every existing clone and fork is invalid and must be re-cloned; they cannot be merged back.
- Re-pushing the 73 tags re-triggered the tag-triggered workflows at each historical commit, where
  the workflow file is an obsolete one from before the org transfer. That produced 82 failing runs,
  since deleted, and rebuilt and re-signed the `v0.56.0` GHCR image from the rewritten commit — so
  that image now has a different digest. If a future rewrite is ever needed, push branches and
  tags as separate, deliberate steps.

### What was NOT remediated

A history rewrite is the only way to remove anything from history, and each pass costs another
force-push plus another invalidation of every clone. Nothing else was found that warrants a second
pass. Specifically, the dev-host IP that the first pass called "the one that argues for action"
**does not exist in this repository** — see § Verdict.

## Reproducing this audit

```bash
bash /path/to/loop-check-licence/scripts/setup-loop-check-licence.sh "$PWD" full
python3 /path/to/loop-check-licence/scripts/scan_mentions.py \
  --db-path "$PWD/.claude/check-licence-evidence.db" --target "$PWD" --json-summary
```

Expected now: every hit — whether `match_kind='file'`, `'commit_message'` or `'history_blob'` —
is `openmemory` or `compromise`. Any other term is a regression, and a term appearing only under
`history_blob` still counts: a clean tree is not a clean repository.

The scan reads historical blob content by default. `--skip-history` is faster and prints the
reduced coverage; a run made with it must not be reported as full coverage.

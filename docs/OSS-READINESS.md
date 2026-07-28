# OSS readiness — audit and residual risk

**Audit date:** 2026-07-28 · **Branch:** `workspace` · **Method:** `loop-check-licence` full mode
(mention scan over every tracked file + every commit message), plus gitleaks, plus a manual sweep
for secrets, internal hosts, personal data and dangling references.

This document exists so that whoever presses "make public" knows exactly what was cleaned, what
was deliberately kept, and what could not be fixed without violating the project's own rules.

---

## Verdict

**LOW_RISK for the current tree. MEDIUM_RISK for the git history, and that risk is unresolved.**

The working tree carries **zero** mentions of a competitor or reference project. The git history
carries **43 mentions across 44 commits**, and cleaning it requires a history rewrite, which is
prohibited by the project's Rule 4. See § Residual risk.

---

## What was measured

| Surface | Before | After |
|---|---|---|
| Competitor mentions in tracked files | 253 | **0** |
| `openmemory` in tracked files (kept — shipped feature) | 146 | 130 |
| Competitor mentions in commit messages | 43 | **43 (unchanged — see below)** |
| Secrets (gitleaks, full tree) | 0 | 0 |
| Developer absolute paths (`/home/<user>/…`) in tracked files | 11 | **0** |
| Dangling references to `.claude/` internal docs | 72 | **0** |

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

### The reference-clones section in `CLAUDE.md`

Described three `--depth 1` clones under `.claude/knowledge-base/references/` used for design
study. The clones were gitignored and never entered git; the section described a directory that no
longer exists.

---

## What was deliberately kept

**`openmemory` — 130 mentions, all intentional.** This is not a leak. It is the name of a
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

## Residual risk — the git history

**43 mentions of competitor names live across 44 commit messages and cannot be removed without
rewriting history.**

Their nature matters for judging the risk: nearly all are research citations of the form
*"grounded in X/Y research"*, *"blueprint validated against X"*, *"deep research (X clone + Y)"*.
They record that prior art was studied. They are not copied code, not disparagement, and not
secrets. The honest summary is that they are mildly embarrassing, not dangerous.

They also do not stand alone. The history carries a **second, more serious** exposure already
recorded in `CHANGELOG.md`: the dev host's IP address appears in 9 commits from `e75a2cd` onward,
along with paths and a username. Any decision about the history has to cover both, and the IP is
the one that argues for action.

### The three options

| Option | What it costs | What it buys |
|---|---|---|
| **Accept and mitigate** | Nothing in the repo. Requires real mitigation on the host: firewall, key rotation — obscurity is not a control. | Keeps 1,342 commits of public provenance, which is much of what makes an OSS project credible. |
| **Publish via a clean mirror** | Loses the entire public history. Does **not** violate Rule 4, since the existing repo is untouched. | Nothing sensitive is ever published. |
| **Rewrite this repository's history** | Violates Rule 4 (force-push to a protected branch). Invalidates every existing clone, fork and commit SHA — including SHAs referenced from CHANGELOG entries, issues and PRs. | Same history, sanitized. |

### If the owner chooses to rewrite

The project owner has selected this option. It is **not executed by this audit** — Rule 4 forbids
the assistant from force-pushing `main`, `develop` or `workspace`. The commands below are for a
human to run deliberately, having read what they destroy.

```bash
# 0. Back up first. This is the only step that is not destructive.
git bundle create ../theo-memory-backup-$(date +%F).bundle --all

# 1. Install git-filter-repo (do NOT use filter-branch).
pipx install git-filter-repo   # or: pip install --user git-filter-repo

# 2. Author the replacement list. One rule per line.
#    Cover BOTH exposures: competitor names AND the dev-host IP/paths/username.
cat > /tmp/replacements.txt <<'EOF'
regex:(?i)\bREDACTED\b==>the reference implementation
regex:(?i)\bREDACTED\b==>the reference implementation
regex:(?i)\bREDACTED\b==>the reference implementation
regex:(?i)\bzep\b==>the reference implementation
<THE_DEV_HOST_IP>==><DEV_HOST>
EOF

# 3. Rewrite commit messages only (--replace-message leaves file contents alone).
git filter-repo --replace-message /tmp/replacements.txt --force

# 4. Verify BEFORE pushing. Expect zero hits.
git log --all --format=%B | grep -icE 'REDACTED|REDACTED|REDACTED|\bzep\b'

# 5. Push. This is the irreversible step, and it requires temporarily lifting
#    branch protection on main/develop/workspace.
#    Every collaborator must re-clone afterwards; existing clones cannot be merged back.
git push --force --all && git push --force --tags
```

Do not skip step 4. `--replace-message` rewrites messages but not file contents, so if a competitor
name or the IP is inside a *file* in an old commit, this leaves it there. The current tree is
clean, but historical file contents were not audited line by line — verify before you push.

One consequence worth naming in advance: **every commit SHA changes.** CHANGELOG entries in this
repo cite SHAs (`0589a8f`, `b2909ff`, `fca24a7`, and many more), as do issues and PR discussions.
Those citations all become dead references. That is the real price, and it is not recoverable.

---

## Reproducing this audit

```bash
bash /path/to/loop-check-licence/scripts/setup-loop-check-licence.sh "$PWD" full
python3 /path/to/loop-check-licence/scripts/scan_mentions.py \
  --db-path "$PWD/.claude/check-licence-evidence.db" --target "$PWD" --json-summary
```

Expected on a clean tree: every `match_kind='file'` hit is `openmemory`. Any other term appearing
in a file is a regression.

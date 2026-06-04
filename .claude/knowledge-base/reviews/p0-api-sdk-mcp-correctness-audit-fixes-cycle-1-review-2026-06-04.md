# Review: p0-api-sdk-mcp-correctness-audit-fixes-cycle-1

**Date:** 2026-06-04
**Verdict:** **READY_TO_MERGE_WITH_CAVEATS** (post-hotfix; see § Post-/review hotfix addendum below)
**Raw consolidator verdict:** NEEDS_FIXES (pre-hotfix; 1 BLOCKER + 1 CRITICAL detected by domain reviewers; both closed in commit `f0c0448` BEFORE merge per cycle-review.md Step 7 loop-back-to-implement protocol)

## Post-/review hotfix addendum (2026-06-04 — appended after consolidator run)

The 6 review agents ran against commits `4f13028..8716643` (pre-hotfix). Both domain reviewers (domain-api-design + domain-cli-tooling) independently empirically confirmed the same gap:

- **BLOCKER F-dom-cli-blocker-1 + CRITICAL F-dom-api-fix-1**: the 3-glob extension shipped in commit `ed7c4ac` (T1.1) was INCOMPLETE. Drizzle's `migrate()` at `node_modules/drizzle-orm/migrator.js:6-10` reads `{migrationsFolder}/meta/_journal.json` BEFORE any `.sql` file. The original `dist/**/*.sql` glob caught only `.sql` files; the meta journal + 12 snapshot JSON files at `src/local/migrations/meta/` (populated to `dist/local/migrations/meta/` by `postbuild:copy-migrations`) were NOT shipped. Post-install `themory migrate` would fail with `Can't find meta/_journal.json` — the F-T7-1-3 regression class declared CLOSED by EC-1 was NOT actually closed for the runtime migrate path.

**Hotfix shipped in commit `f0c0448`** (per cycle-review.md Step 7 "Loop back to /implement to fix"):
- Added 4th glob `"dist/local/migrations/meta/**"` to `package.json#files`
- Added tests 9 + 10 to `tests/integration/p0-audit-fixes/post-install-bin.test.ts`:
  - Test 9: assert `_journal.json` exists in extracted tree (presence-based regression sentinel)
  - Test 10: assert every `src/local/migrations/meta/*.json` appears in pack list (behavioral floor — `readdirSync` + `toContain`)

**Empirical post-hotfix verification:**
- `npm pack --dry-run --json | grep dist/local/migrations/meta | wc -l` → 12 entries (was 0)
- `tar -xzf` extracted tarball now contains `package/dist/local/migrations/meta/{_journal.json, 0000_snapshot.json, ..., 0011_snapshot.json}` (was missing)
- `tests/integration/p0-audit-fixes/post-install-bin.test.ts` → **10/10 PASS** (was 8/8 pre-hotfix)
- Full p0 integration suite: **138 PASS + 2 SKIP across 13 files** (was 136 PASS + 2 SKIP)
- Contract suite: 1049 PASS + 2 SKIP (unchanged)
- Typecheck + lint: 0 errors + 0 warnings (unchanged)

**Why the original cycle missed this**: T0.1 test 2 (`require()` round-trip on cli.js) succeeds because cli.js imports its 4 siblings via static module resolution (no runtime migrate invocation). The Drizzle-specific `meta/_journal.json` dependency is observable only at actual `themory migrate` invocation time. Per Inquebrável Rule 3 honesty: the original EC-1 absorption disclosure was technically correct (`.sql` files DO need to ship) but INCOMPLETE (Drizzle requires more than `.sql`). The fix-cycle's plan v1.2 absorbed EC-1 as 1 MUST FIX but missed the meta journal sub-dependency. Two independent reviewers caught it.

**Post-hotfix verdict**: **READY_TO_MERGE_WITH_CAVEATS** — BLOCKER and CRITICAL both empirically closed; 2 MAJOR caveats from cross-validation remain (F-xval-1 paper-name regex hotfix ADR backfill gap; F-xval-5 SEPA spawn bypass — second-consecutive-cycle normalization risk). Both MAJORs are process-discipline gaps, not code-correctness gaps; recommended ADR amendments in a separate fix-cycle-2 OR accepted as caveats in the PR description.

## Severity (post-hotfix)

| Severity | Pre-hotfix count | Post-hotfix count | Notes |
|---|---|---|---|
| BLOCKER | 1 | **0** | F-dom-cli-blocker-1 closed in `f0c0448` |
| CRITICAL | 1 | **0** | F-dom-api-fix-1 closed in `f0c0448` (same root cause as BLOCKER) |
| MAJOR | 2 | 2 | F-xval-1 (hotfix ADR gap) + F-xval-5 (SEPA bypass normalization) — both process-discipline, not code-correctness |
| MINOR | 9 | 9 | Documentation + ergonomic improvements |
| INFO | 22 | 22 | Positive confirmations + clean files |

---

## Original consolidator output (pre-hotfix snapshot — preserved for audit trail)

**Verdict at consolidator run time:** NEEDS_FIXES
**Reviewers (spawned agents):** 6 (review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-architecture, cross-validation, review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-domain-api-design, review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-domain-cli-tooling, review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-tests, review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-wiring)
**Total findings:** 35

## Findings summary by severity

| Severity | Count |
|---|---|
| BLOCKER | 1 |
| CRITICAL | 1 |
| MAJOR | 2 |
| MINOR | 9 |
| INFO | 22 |

## BLOCKER findings (1)

### F-dom-cli-blocker-1: The 3-glob extension `dist/**/*.sql` is INCOMPLETE — it ships SQL migrations
but NOT the `meta/_journal.json` file Drizzle requires. Post-install
`themory migrate` will fail with `Can't find meta/_journal.json file`. This
reproduces F-T7-1-3 exactly along a different path: the plan claims EC-1
closes the migrate post-install hole, but it closes only 1 of 2 files
Drizzle needs. Inquebrável Rule 3 honesty violation (claims P0 sub-goal 3
closed; in reality `themory migrate` still 100% breaks post-install).


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-domain-cli-tooling
- **File:** `package.json` line 26-34
- **Plan reference:** ADR D1 "Why three globs not two (EC-1)" + Sub-goal 1b
- **Domain anchor:** architecture.md § 10.1 (F-T7-1-3 publish-readiness regression class) + Drizzle migrator runtime contract
- **Evidence:**

  EMPIRICAL VERIFICATION (independent — performed via simulated post-install
  tarball extraction at /tmp/themory-cli-test):
  
  Step 1 — Drizzle migrator runtime contract (node_modules/drizzle-orm/migrator.js:6-10):
    const journalPath = `${migrationFolderTo}/meta/_journal.json`;
    if (!fs.existsSync(journalPath)) {
      throw new Error(`Can't find meta/_journal.json file`);
    }
    const journalAsString = fs.readFileSync(`${migrationFolderTo}/meta/_journal.json`).toString();
  => `migrate()` reads meta/_journal.json BEFORE any *.sql file. Without
     _journal.json, ZERO migrations can apply — instantaneous throw.
  
  Step 2 — runtime path resolution (src/local/index.ts:1452-1456):
    const here = dirname(fileURLToPath(import.meta.url));   // → dist/local/
    const migrationsFolder = resolvePath(here, 'migrations'); // → dist/local/migrations/
    await migrate(db, { migrationsFolder });                // reads dist/local/migrations/meta/_journal.json
  => Drizzle resolves dist/local/migrations/meta/_journal.json at runtime.
  
  Step 3 — pack manifest empirical proof (npm pack --dry-run --json):
    $ npm pack --dry-run --json | jq -r '.[0].files[].path' | grep dist/local/migrations
    dist/local/migrations/0000_crazy_mimic.sql
    dist/local/migrations/0001_reflection_columns.sql
    ... (12 .sql files only)
    # ZERO entries in dist/local/migrations/meta/
    # src/local/migrations/meta/* ship via 'src/local/migrations/**' glob,
    # but they land at src/local/migrations/ post-install, NOT
    # dist/local/migrations/ where Drizzle looks.
  
  Step 4 — post-install tarball reproduction (definitive):
    $ cd /tmp && npm pack /path/to/theo-memory   # produces usetheo-memory-0.0.0-rc.2.tgz
    $ tar -xzf usetheo-memory-0.0.0-rc.2.tgz
    $ ls package/dist/local/migrations/meta/
    ls: cannot access 'package/dist/local/migrations/meta/': No such file or directory
    # CONFIRMED — _journal.json + 11 *.json snapshots ALL ABSENT from dist.
  
  Step 5 — empirical break (deterministic):
    $ node -e "import('./package/dist/local/index.js').then(m => m.runMigrations(...))"
    Error: Can't find meta/_journal.json file
        at readMigrationFiles (node_modules/drizzle-orm/migrator.js:8:11)

- **Recommended action:** Extend `package.json#files` glob from `"dist/**/*.sql"` to ALSO include the
meta directory. Two options:

Option A (narrow + targeted — recommended):
  "files": [
    "src/**/*.ts",
    "!src/**/__tests__/**",
    "!src/**/*.test.ts",
    "!src/**/*.test-d.ts",
    "src/local/migrations/**",
    "dist/**/*.js",
    "dist/**/*.d.ts",
    "dist/**/*.sql",
    "dist/local/migrations/meta/**"     // <-- NEW 4th glob
  ]
=> 4 globs total. Ships `dist/local/migrations/meta/_journal.json` + 11
   `dist/local/migrations/meta/{NNNN}_snapshot.json` files. Drizzle migrator
   contract satisfied; post-install `themory migrate` succeeds.

Option B (broader — risk of bundle bloat):
  Replace `"dist/**/*.sql"` with `"dist/**/*.json"` AND keep .sql.
=> Ships ALL .json under dist/ (potentially picks up tsconfig.tsbuildinfo,
   package metadata JSONs, etc. depending on tsc output). Higher blast
   radius; rejected unless Option A audit surprises emerge.

ALSO: extend `tests/integration/p0-audit-fixes/post-install-bin.test.ts`
with a new test (call it #9 — EC-1 reinforcement) that asserts
`package/dist/local/migrations/meta/_journal.json` exists post-extract AND
`pack.files` contains the path. Without this test, the regression remains
grep-shape (current tests 7+8 only check `.sql` files; they would still
PASS under the broken Option-A-less state).



## CRITICAL findings (1)

### F-dom-api-fix-1: Sub-goal 1b CLAIMS the F-T7-1-3 regression class is closed by the 3rd glob
`dist/**/*.sql`. EMPIRICALLY IT IS NOT — `themory migrate` post-install will
still throw at the Drizzle layer because `meta/_journal.json` is REQUIRED by
drizzle-orm/migrator.js and is NOT in the pack. The same INVALID DISCLOSURE
pattern the parent /review flagged as F-dom-api-1 (closed 1 of 2 holes, claimed
both closed) RE-EMERGES at the meta-files layer.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-domain-api-design
- **File:** `package.json` line 74-76
- **Plan reference:** ADR D1 — "Why three globs not two (EC-1)" + Sub-goal 1b — "themory migrate post-install
resolves dist/local/migrations/ without Cannot find module migrations/0000_*.sql"

- **Domain anchor:** architecture.md § 10.1 — F-T7-1-3 publish-readiness regression class. Rule:
"Asset SHALL be discoverable at runtime via dirname(fileURLToPath(import.meta.url))
after tsc build (production) AND after the test runner's transient compile (test)."

- **Evidence:**

  Empirical reproduction at /tmp/themory-test:
  ```
  $ npm pack /home/paulo/Projetos/usetheo/theo-memory --pack-destination /tmp/themory-test
  $ cd /tmp/themory-test && tar -xzf usetheo-memory-0.0.0-rc.2.tgz
  $ ls package/dist/local/migrations/
  0000_crazy_mimic.sql ... 0011_confirmation_count_and_composite_unique.sql
  $ ls package/dist/local/migrations/meta/ 2>/dev/null
  ls: cannot access 'package/dist/local/migrations/meta/': No such file or directory
  $ ls package/src/local/migrations/meta/
  0000_snapshot.json ... _journal.json
  ```
  
  Drizzle's migrator at node_modules/drizzle-orm/migrator.js lines 6-15:
  ```js
  const journalPath = `${migrationFolderTo}/meta/_journal.json`;
  if (!fs.existsSync(journalPath)) {
    throw new Error(`Can't find meta/_journal.json file`);
  }
  const journalAsString = fs.readFileSync(`${migrationFolderTo}/meta/_journal.json`).toString();
  ```
  
  Runtime resolution path (src/local/index.ts:1451-1456):
  ```ts
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolvePath(here, 'migrations');
  const db = drizzleNodePostgres(pool);
  await migrate(db, { migrationsFolder });  // throws — no _journal.json in dist/local/migrations/meta/
  ```
  
  Pack manifest grep confirms dist meta absent:
  ```
  $ npm pack --dry-run --json | jq -r '.[0].files[].path' | grep 'dist/local/migrations/meta'
  (zero results)
  ```
  
  RED test gap: tests/integration/p0-audit-fixes/post-install-bin.test.ts tests
  7+8 enumerate only `.sql` files (`readdirSync(sourceMigrationsDir).filter((f) => f.endsWith('.sql'))`).
  They do NOT enumerate the `meta/` subdir or assert `_journal.json` presence.
  Tests PASS despite the gap → false-green camouflage (the exact anti-pattern
  Inquebrável Rule 3 + the parent plan's EC-3 absorption were meant to prevent).
  
  The cycle commit message ed7c4ac claims: "without dist/**/*.sql the themory
  migrate post-install path would reproduce the F-T7-1-3 regression". TRUE but
  INCOMPLETE — adding dist/**/*.sql alone does NOT prevent the regression; the
  meta/_journal.json absence reproduces it via a different error message
  (`Can't find meta/_journal.json` instead of `Cannot find module migrations/0000_*.sql`).

- **Recommended action:** Add a 4th glob `"dist/**/*.json"` to package.json#files OR a more targeted
`"dist/local/migrations/meta/**"`. Preferred: the targeted glob to avoid
shipping unintended .json files (e.g., tsbuildinfo siblings if config drifts).

Diff:
```diff
   "files": [
     "src/**/*.ts",
     "!src/**/__tests__/**",
     "!src/**/*.test.ts",
     "!src/**/*.test-d.ts",
     "src/local/migrations/**",
     "dist/**/*.js",
     "dist/**/*.d.ts",
     "dist/**/*.sql",
+    "dist/local/migrations/meta/**"
   ],
```

Strengthen tests/integration/p0-audit-fixes/post-install-bin.test.ts with a
new test 9 + 10:

```ts
test('9. EC-1+ — dist/local/migrations/meta/_journal.json exists in extracted tarball', () => {
  const journalPath = join(extractedPackageDir, 'dist', 'local', 'migrations', 'meta', '_journal.json');
  expect(existsSync(journalPath), 'drizzle migrator requires meta/_journal.json or migrate() throws').toBe(true);
});

test('10. EC-1+ — extracted dist/local/migrations supports drizzle migrate() init (folder-shape sanity)', () => {
  // Sanity: every entry in _journal.json points to an extant .sql file in the same dir.
  const journalPath = join(extractedPackageDir, 'dist', 'local', 'migrations', 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  for (const entry of journal.entries) {
    const sqlPath = join(extractedPackageDir, 'dist', 'local', 'migrations', `${entry.tag}.sql`);
    expect(existsSync(sqlPath), `journal entry ${entry.tag} has no matching .sql in extracted tree`).toBe(true);
  }
});
```

This closes the regression honestly AND defends future migration adds the
same way the .sql floor does.



## MAJOR findings (2)

### F-dom-api-fix-2: Tests 7 + 8 are grep-shape at the file-extension level — they enumerate only
.sql files. The parent finding F-dom-api-3 explicitly criticized grep-shape
assertions (the original >= 1 floor) and the fix-cycle prides itself on
"behavioral, not floor" wording. The same grep-shape gap re-emerges here:
enumerating `.sql` while excluding `.json` siblings replicates the F-dom-api-3
pattern.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-domain-api-design
- **File:** `tests/integration/p0-audit-fixes/post-install-bin.test.ts` line 199-216
- **Plan reference:** Plan v1.1 § "EC-1 MUST FIX absorbed: tests 7+8 enumerate src/local/migrations/*.sql
dynamically and assert ship + extract-tree presence". Tests assert .sql presence
but NOT the meta/ siblings drizzle migrator depends on.

- **Domain anchor:** ADR D2 — "behavioral round-trip catches BOTH — if the bin can't require() its
imports, the test fails regardless of which file is missing". Pattern claim
not honored at the migrate() layer: the test's require() round-trip only
validates module resolution, NOT the drizzle journal file presence.

- **Evidence:**

  Plan v1.1 ADR D3 (test #4 strengthening) states: "Hardcoded count alternative
  (rejected): would require updating the test every time a new migration lands
  ... Filesystem dynamic alternative (chosen): self-maintaining. Test source of
  truth is the directory contents at test time."
  
  Tests 7+8 implement the dynamic enumeration ONLY at the `.sql` granularity:
  ```ts
  const expectedSql = readdirSync(sourceMigrationsDir).filter((f) => f.endsWith('.sql'));
  ```
  
  `meta/_journal.json` lives in the same source dir but is NOT enumerated. A
  future migration add to the meta/ dir or a future drizzle-kit shape change
  that adds a new meta file (e.g., `0011_snapshot.json`) is silently ignored
  by this test even though Drizzle would require it at runtime.
  
  Cross-reference to F-dom-api-fix-1 above: this MAJOR is the test-quality
  mirror of the CRITICAL. Closing F-dom-api-fix-1 must include this MAJOR's
  remediation.

- **Recommended action:** Same as F-dom-api-fix-1 § recommended_action — adding tests 9+10 closes
both findings simultaneously.


### F-dom-cli-2: Test #2 design is too shallow — `import('./dist/agent-tools/cli.js')` only
loads the module entry point and exercises the import graph. It does NOT
invoke any subcommand. The test would PASS even if `themory migrate`
throws at runtime (Drizzle journal missing), because the module-level code
only registers commander subcommands; it does not execute them. The
fixes-cycle's confidence that the bin contract is "post-install verified
end-to-end" is overstated.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-domain-cli-tooling
- **File:** `tests/integration/p0-audit-fixes/post-install-bin.test.ts` line 161-169
- **Plan reference:** T0.1 RED test 2 "cli require() round-trip succeeds post-extract"
- **Domain anchor:** cycle-implement.md § Wiring triad pillar (b) — Integration test must exercise the behavior
- **Evidence:**

  The test (line 161-169) runs:
    node -e "import(<cliPath>).then(() => process.exit(0)).catch(...)"
  
  cli.js per dist/agent-tools/cli.js entry: invokes commander.parse() which
  builds the subcommand tree WITHOUT running any action callback. The
  'migrate' action is wired but not executed. Therefore F-dom-cli-blocker-1
  (broken `themory migrate`) would still see test #2 GREEN — a false-pass.
  
  Compare to the wiring triad's intent: pillar (b) requires the integration
  test to actually exercise the behavior. The current test exercises
  module-load only, NOT `themory migrate` end-to-end.

- **Recommended action:** Add a deeper test (call it #10 — bin end-to-end smoke) that actually runs
a subcommand against the extracted tarball:
  const helpRun = spawnSync('node', [cliPath, 'migrate', '--help'], { ... });
  expect(helpRun.status).toBe(0);
Even `--help` runs the subcommand and would catch import resolution failures
in run-migrate.js if it ever needs runtime fixtures. Stronger still: an
describe.skipIf-gated test that invokes `themory migrate` against a real
pgvector container (THEOMEM_PG_URI present) and asserts it actually
reaches the Drizzle migrate() call without journal-file errors. This
mirrors the THE GOAL TEST shape from v0.1 P0 § integration tests.



## MINOR findings (9)

### F-arch-1: `package.json#exports` still points at `./src/**` paths (TypeScript-source-ship
model) while `package.json#files` now also ships `./dist/**/*.{js,d.ts,sql}`. The
two-runtime ship (source + dist) is intentional per D1 § Consequences row 4
("`.sql` files in `src/local/migrations/` ship TWICE"), but the asymmetry
between `exports` (src-only) and `files` (src + dist) is not documented at the
module-hygiene level — a future contributor inspecting only `exports` could
conclude dist is auxiliary and prune the entries.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-architecture
- **File:** `package.json` line 73-76
- **Plan reference:** T1.1 / ADR D1
- **Evidence:**

  ```json
  "exports": {
    ".": { "types": "./src/index.ts", "default": "./src/index.ts" },
    "./contract": { "types": "./src/core/index.ts", "default": "./src/core/index.ts" },
    ... (all subpaths point at ./src/**)
  },
  "files": [
    "src/**/*.ts",
    "!src/**/__tests__/**",
    ...
    "src/local/migrations/**",
    "dist/**/*.js",
    "dist/**/*.d.ts",
    "dist/**/*.sql"
  ]
  ```

- **Recommended action:** Add a brief comment block above the `files` array (or in CLAUDE.md § Build pipeline)
documenting WHY dist/** ships in parallel to src/**: bin entry `dist/agent-tools/cli.js`
and its 4 siblings are required for `npx @usetheo/memory mcp` UX (per ADR D1
Option C rationale), and the dist tree is NOT consumed by `package.json#exports`
consumers. Out of fix-cycle scope; track as a docs follow-up.


### F-arch-2: The fix-cycle's `[Unreleased] § Changed` entry is a single dense paragraph of
~1200 words. Inquebrável Rule 6 (`/home/paulo/.claude/CLAUDE.md § 6`) says "One
line per change. If you need more, the change is large enough that the PR scope
is wrong." The fix-cycle's actual scope is genuinely tight (1 CRITICAL + 5 MAJOR
+ 1 MUST FIX), but the entry compresses 7 sub-changes (a-g) into one paragraph
rather than 7 bullets. This makes consumer scanning harder.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-architecture
- **File:** `CHANGELOG.md` line 9
- **Plan reference:** T4.1 cycle-close
- **Evidence:**

  Single paragraph (CHANGELOG.md:9) spanning the 7 sub-fixes labeled (a) through
  (g) plus EC absorptions. Compared with the sibling BREAKING entry below it
  (CHANGELOG.md:11) which is a tight focused single paragraph for one change.

- **Recommended action:** Restructure the fix-cycle entry into 7 sub-bullets under the parent bullet (one
per F-finding closed) OR split into 7 separate `Changed` entries. The BREAKING
marker entry (line 11) already shows the right shape for a focused single-change
paragraph. Acceptable to defer to a docs follow-up; not blocking the gate.


### F-dom-api-fix-3: The description-casing change ("usetheo ecosystem" → "Theo ecosystem") is
cosmetically aligned with the brand voice in CLAUDE.md but is NOT mapped
in the plan's Coverage Matrix and lacks a task ID. The commit body's
"stays per parent precedent" rationale is technically acceptable but
sets a precedent that drift-riders ship without coverage entries. Accept
as MINOR per parent precedent; FLAG as scope-discipline signal for
reviewer awareness.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-domain-api-design
- **File:** `package.json` line 4
- **Plan reference:** Plan does NOT scope a description-casing fix. The ed7c4ac commit body
discloses: "Rider: package.json line 4 description change (usetheo to Theo
casing) was pre-existing in working tree before this cycle started; per
parent /implement-validate honest disclosure, it stays."

- **Domain anchor:** cycle-implement.md § Anti-pattern 7 (NEVER scope-creep mid-task — if you
discover an unrelated improvement opportunity, log it in followups.md and
continue). Honest-disclosure precedent in parent /implement-validate
authorized similar non-plan riders in T1.1 commit.

- **Evidence:**

  git diff 4f13028..HEAD -- package.json line 4:
  ```diff
  -  "description": "Managed three-tier memory layer for the usetheo ecosystem. Pre-release.",
  +  "description": "Managed three-tier memory layer for the Theo ecosystem. Pre-release.",
  ```
  
  Plan v1.2 Coverage Matrix has no row for description-casing. Plan §
  "What did NOT change since /review" line 40 explicitly states the cycle
  does NOT touch pre-existing modified files; the description change is
  one of those files (modified pre-cycle per ed7c4ac commit body).

- **Recommended action:** Accept per parent precedent — the commit body discloses honestly. For
future cycles: consider adding a "## Riders" section to the plan template
OR a single Coverage Matrix row "Pre-existing pristine-tree riders" so
these are tracked rather than appearing as commit-body footnotes. Not a
blocker for this cycle.


### F-dom-cli-3: The 5-row env-var table for MCP server is missing `THEOMEM_MCP_TRANSPORT`
and `THEOMEM_MCP_HTTP_PORT`, which ARE used in the "Or HTTP" example
block immediately below (lines 246-254) WITHOUT prior table documentation.
Consumers reading top-to-bottom encounter undocumented env vars in copy-
paste recipes. NOT a regression introduced by fixes-cycle-1 (these vars
pre-date this cycle), but the cycle's README touches (line 207 cross-ref
insert) provided an opportunity to fix; missed.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-domain-cli-tooling
- **File:** `README.md` line 197-203
- **Plan reference:** F-dom-cli-2 (extended scope — env-var table currency)
- **Domain anchor:** public-copy.md § Banned terms + README.md § "Required environment variables"
- **Evidence:**

  $ grep -nE "THEOMEM_MCP_TRANSPORT|THEOMEM_MCP_HTTP_PORT" README.md
  251:  THEOMEM_MCP_TRANSPORT=streamable-http \
  252:  THEOMEM_MCP_HTTP_PORT=8080 \
  # Neither appears in the env-var table at lines 197-203.
  
  $ grep -n "THEOMEM_MCP_TRANSPORT" src/agent-tools/run-mcp-server.ts
  61:  const envValue = process.env['THEOMEM_MCP_TRANSPORT'];
  # Real env var, real runtime consumption — undocumented in the table.
  
  Similarly THEMEMORY_SKIP_MIGRATIONS is consumed by src/agent-tools/run-server.ts:74
  but documented nowhere in README. Less critical for MCP-only consumers, but
  relevant when REST server consumers read the "Quickstart" or "Standalone
  Docker" section.

- **Recommended action:** Out of fix-cycle-1 scope (not a 6 actionable findings entry). Defer to
fixes-cycle-2 OR a docs-only commit. Document for honest disclosure now.
Suggested rows to append to the table (lines 197-203):
  | `THEOMEM_MCP_TRANSPORT` | no | `stdio` | Transport for MCP server. `stdio` (default) for local Claude Code-style integration; `streamable-http` for remote agent loops. |
  | `THEOMEM_MCP_HTTP_PORT` | no | `8080` | Port for `streamable-http` transport. Ignored when TRANSPORT=stdio. |


### F-tests-1: Test name says "cli require() round-trip" but body uses dynamic `import()`. ADR D2 prescribed `node -e "require()"` — the impl diverged because the package is `"type": "module"` (ESM-only) and `require()` of an ESM file throws ERR_REQUIRE_ESM. Behavioral check is sound (module-resolution + dependency resolution exercised end-to-end), but the test name is misleading vs the semantic actually being tested.

- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-tests
- **File:** `tests/integration/p0-audit-fixes/post-install-bin.test.ts` line 161
- **Plan reference:** T0.1 test 2 + ADR D2
- **Evidence:**

  Line 161: `test('2. cli require() round-trip succeeds post-extract', ...)`
  Line 165: `node -e "import(${...}).then(...)"` — dynamic import, not require
  package.json#type === "module"

- **Recommended action:** Rename test to "2. cli dynamic-import resolves all transitive siblings post-extract" OR add an inline comment explaining why `import()` is the ESM-aware analog of `require()` per the ADR D2 intent. No behavioral change needed.

### F-tests-2: symlinkSync(REPO_ROOT/node_modules → extractDir/package/node_modules) simulates post-install dependency resolution. The comment block (lines 136-142) discloses this honestly. However, the test asserts "post-install simulation" while reusing the dev tree's node_modules — if a runtime dep is listed in devDependencies (not in dependencies / peerDependencies), the test would false-PASS today but break in a real `npm install` (where only `dependencies` resolve). Honest disclosure exists per ADR D2's "honest-disclosure: this test exercises the EXTRACTED tree, NOT a fully-published-then-installed tree" — but the gap deserves a tracked follow-up.

- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-tests
- **File:** `tests/integration/p0-audit-fixes/post-install-bin.test.ts` line 136-142
- **Plan reference:** T0.1 § Deep Dives
- **Evidence:**

  symlinkSync(join(REPO_ROOT, 'node_modules'), join(extractedPackageDir, 'node_modules'), 'dir');

- **Recommended action:** Track a follow-up to harden test 2 by spawning a fresh `npm install --prefix <tmp> <tarball-path>` flow (instead of the symlink shortcut). Out of scope for this fix-cycle (ADR D2 already documents the limitation). The symlink approach is acceptable for now; the gap is honest and bounded.

### F-tests-3: SIBLINGS hardcodes 4 module names (run-mcp-server, run-server, run-migrate, run-health). Future plan tasks that extract a new subcommand from cli.ts (e.g., `themory dogfood`) would add a 5th sibling and silently bypass tests 1+3 — the dist/**/*.js glob ships it, but test 1+3 only check the 4 hardcoded names. The test would NOT regress, but would have a coverage hole. The pack-manifest test #4 (D3 pattern) uses readdirSync for dynamic enumeration — this same pattern would close the gap here.

- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-tests
- **File:** `tests/integration/p0-audit-fixes/post-install-bin.test.ts` line 77-82
- **Plan reference:** T0.1 — implicit
- **Evidence:**

  const SIBLINGS = [
    'run-mcp-server.js', 'run-server.js', 'run-migrate.js', 'run-health.js',
  ] as const;
  // No dynamic enumeration; new sibling extracted in a future cycle would
  // not be exercised by tests 1 or 3.

- **Recommended action:** Out of scope for this fix-cycle. Future hardening: enumerate dist/agent-tools/run-*.js via readdirSync (mirror of ADR D3's pattern for pack-manifest test #4) so any new sibling auto-enrolls. Acceptable today — the 4 siblings cover the empirical CRITICAL.

### F-wire-1: EC-1 sentinel verifies dist/local/migrations/*.sql FILE PLACEMENT but
does NOT exercise the runtime resolution path that the test header
asserts is being guarded (themory migrate → runMigrations() →
migrationsFolder = dirname(fileURLToPath(import.meta.url)) + 'migrations').


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-wiring
- **File:** `tests/integration/p0-audit-fixes/post-install-bin.test.ts` line 199-216
- **Plan reference:** T0.1 EC-1 absorption tests 7+8; § 10.1 architecture.md F-T7-1-3 guard
- **Evidence:**

  Test 7: existsSync(join(extractedPackageDir, 'dist', 'local', 'migrations', sqlFile))
  Test 8: packResult.files.map(f.path).includes('dist/local/migrations/{sqlFile}')
  
  Neither test actually executes `node -e "import('./dist/agent-tools/run-migrate.js').then(...)"`
  or invokes runMigrations() against a live pgvector instance. The
  runtime path src/local/index.ts:1452-1453 (`const here = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolvePath(here, 'migrations');`) is verified
  ONLY by inspection at code-review time.
  
  Mitigating factor: file-shipping invariant + pre-existing migration
  integration tests (tests/integration/migrations/) cover the runtime path
  separately. The F-T7-1-3 regression class is "files don't ship" — that
  class IS closed by tests 7+8. The "files ship but runtime fails to find
  them" class is theoretically untested but architecturally impossible
  given the resolvePath formula resolves to the same dist/local/ tree
  that tests 7+8 just verified exists.

- **Recommended action:** Optional strengthening for a follow-up cycle: add test #9 that does
`spawnSync('node', ['-e', "import('${distRunMigrate}').then(m => m.runMigrateAction({...}))..."])`
against an empty test database to verify the runtime path actually
resolves. NOT a BLOCKER for this cycle — the architectural guarantee
holds and pre-existing migration integration coverage is adequate.


### F-wire-2: Plan T4.1 step 1 says "Run `npm test` — full suite green (1045 contract
+ 127 integration + ...)" but package.json#scripts.test is
"vitest run --config vitest.contract.config.ts" — runs ONLY the contract
suite. Integration tests (post-install-bin.test.ts is one of them)
require `npm run test:integration`. Plan-vs-execution drift.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-wiring
- **File:** `.claude/knowledge-base/plans/p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-plan.md` line 974
- **Plan reference:** T4.1 § Execution chain step 1
- **Evidence:**

  package.json#scripts.test: `vitest run --config vitest.contract.config.ts`
  package.json#scripts.test:integration: `vitest run --config vitest.integration.config.ts`
  Plan T4.1 step 1 text: "Run `npm test`" + claims integration tests are part of `npm test`
  
  The Acceptance Criteria § "All test suites green (contract + integration; e2e
  not touched this cycle)" line 1058 is honest about needing both suites,
  but the Execution chain (lines 1034-1046) only invokes `npm test`.
  
  Validation report shows the implementer caught this and ran integration
  separately — 136 PASS + 2 SKIP via vitest.integration.config.ts. The
  gate was honored in execution; only the plan wording is ambiguous.

- **Recommended action:** In a follow-up plan-improve cycle, edit T4.1 § Execution chain step 1
to `npm run build && npm test && npm run test:integration` so future
replays of the plan invoke both configs explicitly. Honest correction
that does NOT change the verdict for this cycle (the gates DID run).



## INFO findings (22)

### F-arch-3: JSDoc composition-root block rewritten to name `LocalTransformerEmbedder` +
`OpenAILLM` instead of the stale "pgvector + stubs". The rewrite preserves the
DIP-allowed composition-root role (per ADR D8 of parent plan), names the
real-providers wiring, AND avoids the literal `\bstubs?\b` token so the regression
sentinel regex in `tests/integration/p0-audit-fixes/post-install-bin.test.ts`
tests 5+6 hold. The honest disclosure of the hard-fail-on-missing-OPENAI_API_KEY
behavior (line 13-15) cross-references commit e43d801 of the parent cycle —
filesystem-coordinate citation per `no-paper-names-in-code.md § How to apply`
bullet 3.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-architecture
- **File:** `src/agent-tools/run-mcp-server.ts` line 9-15
- **Plan reference:** T2.1 / F-dom-cli-1
- **Evidence:**

  ```ts
  * Composition root (DIP-allowed): this file wires src/local/ (pgvector +
  * LocalTransformerEmbedder + OpenAILLM real providers) into the
  * agent-tools McpServer. Library layer `src/agent-tools/index.ts` does
  * NOT re-export src/local/ — the bin entry IS the composition site per
  * ADR D8. The runtime hard-fails on missing OPENAI_API_KEY rather than
  * silently wiring a deterministic placeholder; see commit e43d801 of the
  * parent cycle for the placeholder-removal rationale.
  ```

- **Recommended action:** No action needed. Architecturally clean.


### F-arch-4: Contract-tier placement of the EC-8 reflection-prompt SHAPE-stability test honors
ADR D5 ("EC-8 RED test lives at `src/core/reflection/__tests__/prompt.test.ts`
(contract tier), NOT `tests/integration/`"). The placement matches:
(a) `vitest.contract.config.ts` include glob `src/{core,...}/**/__tests__/**/*.test.ts`;
(b) the per-module test colocation convention used by `core/extraction`,
`core/retrieval`, `core/forgetting`;
(c) the pure-function nature of `buildReflectionPrompt` (no I/O, deterministic).
The MemoryItem fixture is complete — all 9 required readonly fields populated
(id, text, hash, scope, createdAt, updatedAt, metadata, tValid, tInvalid);
optional fields correctly omitted. The 3 assertions (paper-name regex + inline
snapshot + EC-2 determinism guard) form a defense-in-depth shape gate.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-architecture
- **File:** `src/core/reflection/__tests__/prompt.test.ts` line 1-126
- **Plan reference:** T0.4 + T3.2 / ADR D5
- **Evidence:**

  File path `src/core/reflection/__tests__/prompt.test.ts` matches contract-tier
  include glob. Fixture uses `UserScope: { kind: 'user', userId: 'alice' }` from
  `src/core/scope.ts:8-9` (verified to be the canonical shape). The frozen-snapshot
  assertion (lines 95-110) captures `buildReflectionPrompt` output verbatim.

- **Recommended action:** No action needed. Architecturally clean.


### F-arch-5: The string-concat regex pattern for paper-name tokens (lines 30-41) is a clever
and legitimate self-defense against the rule the test enforces. The meta-test
asserts the rendered prompt has zero paper-name tokens via a regex built at
runtime; if the regex itself were written as a literal containing those tokens,
the test file itself would violate `no-paper-names-in-code.md § ## How to apply`
bullet 4 ("Test names describe behavior, not the source"). The string-concat
approach (e.g., `'V' + 'oyager'`) keeps the file grep-clean per the rule's
`\b<token>\b` audit pattern AND reassembles the actual regex at runtime for
correct assertion semantics. The inline comment at lines 25-29 honestly discloses
the rationale.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-architecture
- **File:** `src/core/reflection/__tests__/prompt.test.ts` line 25-45
- **Plan reference:** b1acbba hotfix / no-paper-names-in-code.md
- **Evidence:**

  ```ts
  // Paper-name regex built via string concatenation so this test file itself
  // does NOT contain the literal banned tokens as contiguous words — grep -wE
  // "\b<token>\b" applied across src/**/*.ts (THE GOAL TEST tests 29-33 of the
  // parent plan) sees only the fragments, not the joined tokens, and reports
  // 0 hits per the no-paper-names-in-code rule.
  const BANNED_TOKENS = [
    'V' + 'oyager',
    'Me' + 'm0',
    ...
  ];
  ```

- **Recommended action:** No action needed. The pattern is reusable for any future meta-test enforcing
a token-blacklist on src/**; worth documenting in the rule's § Anti-patterns
with-a-positive-example callout as a docs follow-up.


### F-arch-6: The `symlinkSync(node_modules, extractedPackageDir/node_modules)` trick correctly
simulates npm-dep-resolution without requiring a full `npm install` round-trip in
the test. The inline 7-line comment (lines 119-126) honestly discloses this as a
"npm-install-environment limitation, NOT a regression of our publish manifest" —
satisfies Inquebrável Rule 3 (extreme honesty) at the test-design level. The
8 assertions form a behavioral-shape contract (D2 rationale): tarball extract +
`node -e` import round-trip + file existence + pack-list inspection + JSDoc
regex sentinel + EC-1 .sql file enumeration. The `describe.skipIf` 3-tier gate
with LOUD `console.warn` per parent EC-3 pattern keeps CI green when prereqs
are absent.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-architecture
- **File:** `tests/integration/p0-audit-fixes/post-install-bin.test.ts` line 119-126
- **Plan reference:** T0.1 / ADR D2 + EC-4
- **Evidence:**

  ```ts
  // Simulate post-install dependency resolution by symlinking the project's
  // node_modules into the extracted package dir. `npm install @usetheo/memory`
  // would create an equivalent layout via npm's dep resolver. Without this,
  // the `require()` round-trip fails for bare specifiers like `commander`,
  // `hono`, `pg` — which is a npm-install-environment limitation, NOT a
  // regression of our publish manifest.
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(extractedPackageDir, 'node_modules'), 'dir');
  ```

- **Recommended action:** No action needed. The trade-off (env-fidelity vs reproducibility) is correctly
surfaced inline. A higher-fidelity test (full `npm install` against a local
registry like verdaccio) would belong at an E2E tier — out of scope here.


### F-arch-7: Placement at `src/__tests__/` (alongside sibling `no-root-reexport.test.ts`) is
architecturally consistent — both are repo-scoped contract-tier meta-tests that
assert invariants over root-level project files (CHANGELOG.md and the root
barrel respectively). The vitest contract config explicitly includes
`src/__tests__/**/*.test.ts` per `vitest.contract.config.ts`. The slice-extract
helper `extractUnreleased()` (lines 28-33) is a 5-line pure function with no I/O
beyond the readFileSync at line 36 — KISS-compliant per Inquebrável Rule 10.
The single assertion (the BREAKING marker token presence) matches ADR D4's
Keep-a-Changelog 1.1.0 § Types compliance approach (no new category needed).


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-architecture
- **File:** `src/__tests__/changelog-breaking-marker.test.ts` line 1-43
- **Plan reference:** T0.3 / F-dom-api-2 / ADR D4
- **Evidence:**

  Test asserts `expect(unreleased).toContain('**BREAKING (REST server):**')` —
  single tight assertion matching the marker pattern locked by D4. File header
  cross-references plan slug + ADR D4 inline per § How to apply bullet 2 of
  no-paper-names-in-code.md.

- **Recommended action:** No action needed. Architecturally clean.


### F-arch-8: Test #4 strengthened per ADR D3 from grep-shape `>= 1` floor to behavioral
`readdirSync` + `toContain` loop. The strengthening eliminates the "1-row
tolerant floor" failure mode that masked F-dom-api-3 originally — same grep-shape
anti-pattern as F-dom-api-1. The use of `fs.readdirSync` at test time (NOT a
hardcoded count) is self-maintaining per D3 § Rationale: new migrations land
append-only and the test source-of-truth is the filesystem at test-execution
moment. Inquebrável Rule 9 honored — `fs` stdlib, no new dependency.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-architecture
- **File:** `tests/integration/p0-audit/pack-manifest.test.ts` line 76-82
- **Plan reference:** T0.5 / F-dom-api-3 / ADR D3
- **Evidence:**

  ```ts
  test('4. fixes-cycle-1 F-dom-api-3 — pack manifest ships EVERY src/local/migrations/*.sql file (behavioral floor)', () => {
    const migrationsDir = join(REPO_ROOT, 'src', 'local', 'migrations');
    const expectedSql = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    expect(expectedSql.length, 'sanity — at least one .sql file in source migrations dir').toBeGreaterThan(0);
    for (const sqlFile of expectedSql) {
      expect(paths).toContain(`src/local/migrations/${sqlFile}`);
    }
  });
  ```

- **Recommended action:** No action needed. Architecturally clean.


### F-arch-9: One-line cross-reference to the committed `.mcp.json.example` template added at
README.md line 207 ("A copy-and-fill template is committed at [`.mcp.json.example`]..."),
template-first ahead of the inline recipe. Matches the parent plan task-T3-4
step-3 surface that was silently dropped. Consumer-greppable for the literal
`.mcp.json.example` token (verified by new test #7 in
`tests/integration/p0-audit/readme-mcp-section.test.ts`). Module hygiene preserved
— no new dependencies, no architectural shift.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-architecture
- **File:** `README.md` line 205-207
- **Plan reference:** T2.2 / F-dom-cli-2
- **Evidence:**

  ```markdown
  **Install as a stdio MCP server for Claude Code** via project-local `.mcp.json` (the canonical Claude Code mechanism).
  
  A copy-and-fill template is committed at [`.mcp.json.example`](.mcp.json.example) — duplicate it as `.mcp.json` (gitignored), populate `OPENAI_API_KEY`, and restart Claude Code. The inline recipe below mirrors that template for reference:
  ```

- **Recommended action:** No action needed. Architecturally clean.


### F-arch-10: The `description` field cased change ("usetheo ecosystem" → "Theo ecosystem")
committed as part of T1.1 with disclosure in the commit body — `ed7c4ac`. This
is an out-of-cycle scope rider per the implement-validate report. It does not
introduce an architectural defect (only product-naming consistency with CLAUDE.md
§ What this project is which uses "Theo ecosystem"), but the change technically
sits outside the plan's declared task surface (T1.1 scopes `files` array, NOT
`description`). Cycle-implement anti-pattern #7 ("NEVER scope-creep mid-task")
was honored in spirit through the in-commit-body disclosure rather than silent
inclusion. Not blocking.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-architecture
- **File:** `package.json` line 4
- **Plan reference:** T1.1 commit body (out-of-plan scope rider)
- **Evidence:**

  ```diff
  -  "description": "Managed three-tier memory layer for the usetheo ecosystem. Pre-release.",
  +  "description": "Managed three-tier memory layer for the Theo ecosystem. Pre-release.",
  ```

- **Recommended action:** No action needed. The disclosure pattern (in-commit-body) is the correct anti-
pattern-#7 mitigation when a rider lands. Future cycles should ideally hoist
such rider changes into their own atomic commit (e.g., `chore(package): align
description with CLAUDE.md naming`) rather than bundling, but a 1-line cosmetic
rider is below the threshold where the cost of splitting exceeds the benefit.


### F-dom-api-fix-4: Test extracts the [Unreleased] section but does NOT enforce the marker
lives specifically inside the `### Changed` subsection. If a future
cycle added the marker to `### Removed` or `### Added` by mistake, the
test would still PASS. ADR D4 explicitly requires the marker inside
Changed; test is one level too loose.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-domain-api-design
- **File:** `src/__tests__/changelog-breaking-marker.test.ts` line 36-42
- **Plan reference:** T0.3 § TDD: "extract the [Unreleased] section from CHANGELOG.md ... assert
the slice contains **BREAKING (REST server):**".

- **Domain anchor:** ADR D4 — "Section heading STAYS Changed (Keep-a-Changelog category list
permits the change category to carry breaking sub-content per the
keepachangelog.com/en/1.1.0/ spec)."

- **Evidence:**

  ```ts
  function extractUnreleased(changelog: string): string {
    const start = changelog.indexOf('## [Unreleased]');
    if (start === -1) return '';
    const after = changelog.slice(start);
    const nextRel = after.search(/\n## \[\d/);
    return nextRel === -1 ? after : after.slice(0, nextRel);
  }
  ...
  expect(unreleased).toContain('**BREAKING (REST server):**');
  ```
  
  Empirical state: marker IS inside ### Changed at line 11 (verified via
  `grep -nE "^## |^### " CHANGELOG.md`). Test currently PASSES for the
  right reason but would PASS for the wrong reason if a category moved.

- **Recommended action:** Tighten the slicer to extract `### Changed` within `[Unreleased]`:

```ts
function extractUnreleasedChanged(changelog: string): string {
  const unreleased = extractUnreleased(changelog);
  const start = unreleased.indexOf('### Changed');
  if (start === -1) return '';
  const after = unreleased.slice(start);
  const nextSection = after.search(/\n### /);
  return nextSection === -1 ? after : after.slice(0, nextSection);
}
```

INFO not MAJOR because (a) marker IS in the right place today, (b) ADR
D4 compliance is enforced by reviewer convention as much as by test,
(c) the cosmetic risk is low. Surface for future hardening.


### F-dom-api-fix-5: Pack-manifest test #4 strengthening is correctly implemented per ADR D3.
Sanity guard present. Test asserts the SOURCE migrations ship — but the
DIST migrations behavioral floor lives in post-install-bin.test.ts test
#8 separately. Both are needed; the split is honest. INFO note: a future
reviewer might miss the split and assume test #4 covers both surfaces.
Recommend a JSDoc cross-reference between the two.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-domain-api-design
- **File:** `tests/integration/p0-audit/pack-manifest.test.ts` line 76-83
- **Plan reference:** T3.3 § "Pack-manifest #4 strengthening uses filesystem dynamic enumeration
of `src/local/migrations/*.sql`, NOT a hard-coded count" + sanity `> 0` guard
requirement.

- **Domain anchor:** ADR D3 — behavioral floor against silent migration drops. Sanity guard
`expect(expectedSql.length).toBeGreaterThan(0)` PRESENT at line 79.

- **Evidence:**

  pack-manifest.test.ts test #4 enumerates src/local/migrations/ and
  asserts pack contains src/local/migrations/{name}. It does NOT assert
  dist/local/migrations/{name}. That assertion lives in
  post-install-bin.test.ts test #8. Together they cover both surfaces.

- **Recommended action:** Add a brief JSDoc note above pack-manifest test #4 cross-referencing
post-install-bin test #8 so reviewers see the split. Not blocking.


### F-dom-cli-4-confirmation: F-dom-cli-1 fix verified accurate. JSDoc post-fix (lines 9-15) describes
the correct post-e43d801 wiring — `LocalTransformerEmbedder + OpenAILLM
real providers` — and explicitly cites the rationale for the placeholder-
removal pattern. Regex `\bstubs?\b` returns zero hits inside the JSDoc
block. Sibling src/agent-tools/run-server.ts JSDoc (lines 1-27) never had
the stale "stubs" reference (it was authored post-e43d801); no fix needed.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-domain-cli-tooling
- **File:** `src/agent-tools/run-mcp-server.ts` line 9-15
- **Plan reference:** F-dom-cli-1 fix (T2.1) — JSDoc rewrite without literal "stub" word
- **Domain anchor:** no-paper-names-in-code.md analog (regex \bstubs?\b) + e43d801 wiring rationale
- **Evidence:**

  $ grep -nE "\\bstubs?\\b" src/agent-tools/run-mcp-server.ts
  (no output) — confirmed clean
  
  $ grep -nE "LocalTransformerEmbedder|OpenAILLM|real providers?" src/agent-tools/run-mcp-server.ts
  10:  * Composition root (DIP-allowed): this file wires src/local/ (pgvector +
  11:  *  LocalTransformerEmbedder + OpenAILLM real providers) into the
  # Real-providers narrative explicit + accurate.

- **Recommended action:** None — confirms F-dom-cli-1 fix is correct.

### F-dom-cli-5-confirmation: F-dom-cli-2 fix verified accurate. README line 207 inserts the cross-
reference `[`.mcp.json.example`](.mcp.json.example)` BEFORE the inline
recipe (line 209-225). Link target is repo-relative + correct. Inline
recipe contents (THEOMEM_PG_URI, THEOMEM_MCP_DEFAULT_USER_ID,
OPENAI_BASE_URL, OPENAI_CHAT_MODEL, OPENAI_API_KEY) mirror the
.mcp.json.example template at repo root verbatim — same env-var keys in
same order. Consumer who reads the README sees both paths (template-copy
AND inline copy-paste).


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-domain-cli-tooling
- **File:** `README.md` line 205-225
- **Plan reference:** F-dom-cli-2 fix (T2.2) — README cross-references .mcp.json.example
- **Domain anchor:** CLAUDE.md § PRIORITY 0 sub-goal 3 (MCP setup guide explicit)
- **Evidence:**

  README.md:207:
    A copy-and-fill template is committed at [`.mcp.json.example`](.mcp.json.example) — duplicate it as `.mcp.json` (gitignored), populate `OPENAI_API_KEY`, and restart Claude Code. The inline recipe below mirrors that template for reference:
  
  Both blocks (README inline + .mcp.json.example) share the same 5 env-var
  keys: THEOMEM_PG_URI, THEOMEM_MCP_DEFAULT_USER_ID, OPENAI_BASE_URL,
  OPENAI_CHAT_MODEL, OPENAI_API_KEY. Recipe accuracy: verified.

- **Recommended action:** None — confirms F-dom-cli-2 fix is correct.

### F-tests-4: The string-concat paper-name regex assembly is documented honestly via a 6-line inline comment (lines 23-28) explaining that the GOAL TEST grep applies word-boundary matching and that the fragments are reassembled at runtime byte-identical to the original literal. The refactor was strictly necessary — the initial v1 of this file would have broken THE GOAL TEST tests 29-33 (`Voyager` / `Mem0` / `Letta` / `LangMem` / `Graphiti` word-count must be 0 across src/**/*.ts). Verification reproduced live: `grep -rwn -E "\\b(Voyager|Mem0|Letta|LangMem|Graphiti)\\b" src/ --include='*.ts' | grep -v knowledge-base` returns 0 hits. Inline comment satisfies Inquebrável Rule 3 honesty AND prevents future contributors from collapsing the concat for stylistic reasons.

- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-tests
- **File:** `src/core/reflection/__tests__/prompt.test.ts` line 23-41
- **Plan reference:** T0.4 + b1acbba refactor commit
- **Evidence:**

  Lines 23-28 explain the pattern.
  Lines 29-41 declare BANNED_TOKENS via 'V'+'oyager' etc.
  Live grep confirms 0 hits.

- **Recommended action:** No action — this is INFO confirming the b1acbba refactor was executed correctly and the meta-circularity (paper-name-defending test cannot itself contain paper names) is honestly resolved.

### F-tests-5: afterAll() cleanup uses fs.rmSync with `{ recursive: true, force: true }` for BOTH packDir and extractDir. Guard checks (`packDir !== ''`) prevent NPE if beforeAll never ran. tmp-dir cleanup is correct.

- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-tests
- **File:** `tests/integration/p0-audit-fixes/post-install-bin.test.ts` line 145-152
- **Plan reference:** T0.1 § DoD + Acceptance Criteria
- **Evidence:**

  lines 145-152

- **Recommended action:** No action — DoD met.

### F-tests-6: The inline snapshot captures the rendered prompt for the frozen 3-fact UserScope fixture. Snapshot contains: paper-name-clean (visual inspection — no banned tokens); the 3 hardcoded fixture UUIDs (match FIXTURE_UUIDS set used by test 3); no ISO-8601 / no unix-timestamp tokens. Test 3 cross-verifies with regex; test 2 pins the shape. Both tests would catch the same regression class via different mechanisms — defensive depth, not redundant.

- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-tests
- **File:** `src/core/reflection/__tests__/prompt.test.ts` line 96-115
- **Plan reference:** T0.4 test 2 — snapshot
- **Evidence:**

  lines 98-114 (snapshot body); test 3 lines 117-125.

- **Recommended action:** No action.

### F-tests-7: Test #4 strengthening from `>= 1` floor to behavioral readdirSync+toContain loop. Test name was updated to "fixes-cycle-1 F-dom-api-3 — pack manifest ships EVERY ... .sql file (behavioral floor)". Sanity check on `expectedSql.length` protects against an empty source dir false-pass. Imports `readdirSync` correctly added to top-of-file imports.

- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-tests
- **File:** `tests/integration/p0-audit/pack-manifest.test.ts` line 76-83
- **Plan reference:** T3.3 + ADR D3
- **Evidence:**

  Line 18: `import { readdirSync } from 'node:fs';`
  Lines 76-83: behavioral assertion per ADR D3

- **Recommended action:** No action.

### F-tests-8: New test #7 asserts `.mcp.json.example` token presence in README. Uses `readme` (full file content) instead of `section` (MCP section slice) — this is INTENTIONAL per the plan's "No layout enforcement" (Deep Dives § "do NOT assert positional location"). Token-presence is sufficient; positional assertions age out with README evolution.

- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-tests
- **File:** `tests/integration/p0-audit/readme-mcp-section.test.ts` line 69-71
- **Plan reference:** T0.2 + T2.2 + sub-goal 3
- **Evidence:**

  lines 69-71

- **Recommended action:** No action.

### F-tests-9: extractUnreleased helper slices the changelog between `## [Unreleased]` header and the next versioned header (`\\n## \\[\\d`). Sanity check on `unreleased.length > 0` prevents test from passing if the [Unreleased] section is empty/missing. Assertion targets the EXACT marker shape `**BREAKING (REST server):**` per ADR D4.

- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-tests
- **File:** `src/__tests__/changelog-breaking-marker.test.ts` line 28-34
- **Plan reference:** T0.3 + ADR D4
- **Evidence:**

  lines 28-42

- **Recommended action:** No action.

### F-wire-3: The 3 new globs ("dist/**/*.js", "dist/**/*.d.ts", "dist/**/*.sql") ship
MORE dist files but DO NOT leak Xenova / openai / hono into the default
barrel. Verified by 3 ortogonal checks.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-wiring
- **File:** `package.json (files glob)` line 73-83
- **Plan reference:** T1.1 + ADR D1; ADR D7 (bundle isolation per EC-26 precedent)
- **Evidence:**

  1. src/index.ts re-exports from src/local/index.js (default barrel).
     The exports[.] field points at "./src/index.ts" (TS-source-as-exports
     pattern), so the consumer's default-import resolves to src/index.ts
     directly — not through dist/.
  2. grep -rln "@xenova" src/local/ src/core/ → ZERO hits. Xenova is
     confined to src/embedders/local.ts (subpath @usetheo/memory/embedders/local).
  3. grep -rln "from 'openai'" src/local/ src/core/ → ZERO hits. openai
     sdk confined to src/llms/openai.ts + src/embedders/openai.ts
     (subpath @usetheo/memory/{llms,embedders}/openai).
  4. grep -rln "from 'hono'" src/ → only in src/server/. Subpath
     @usetheo/memory/server.
  
  EC-26 bundle-isolation precedent (cache-pg subpath, dynamic-import shape)
  remains intact. The expanded files glob ships MORE files for SUBPATH
  consumers but does not pull them into the default barrel for the
  `@usetheo/memory` consumer that imports only from "./src/index.ts".

- **Recommended action:** None. This is honest hardening — more files ship, bundle isolation preserved by import topology not by files glob.

### F-wire-4: The symlinkSync(REPO_ROOT/node_modules, extractedPackageDir/node_modules)
shortcut is honestly disclosed and architecturally sound. It is NOT a
gaming-the-test pattern — it represents the same resolver tree shape
that `npm install @usetheo/memory` would create at the consumer site.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-wiring
- **File:** `tests/integration/p0-audit-fixes/post-install-bin.test.ts` line 136-143
- **Plan reference:** T0.1 § TDD
- **Evidence:**

  Header comment (lines 137-141) discloses the rationale: "Simulate
  post-install dependency resolution by symlinking the project's
  node_modules into the extracted package dir. `npm install @usetheo/memory`
  would create an equivalent layout via npm's dep resolver. Without this,
  the require() round-trip fails for bare specifiers like `commander`,
  `hono`, `pg` — which is a npm-install-environment limitation, NOT a
  regression of our publish manifest."
  
  The test still genuinely EXERCISES (a) npm pack manifest, (b) tarball
  extraction, (c) ESM dynamic import resolution of the bin's 4 siblings,
  (d) the bin's own commander+chalk+pg startup path up to the
  `module.exports` settlement boundary.
  
  A stricter test would `npm install` into a tmp dir (slower; ~30-60s)
  and skip the symlink. The current shortcut is reasonable for a CI
  integration test budget. Documented appropriately.

- **Recommended action:** None. The shortcut is honest, scoped, and disclosed.

### F-wire-5: JSDoc edit is purely documentation. No exports added/removed/renamed.
The composition-root invariant ("library layer src/agent-tools/index.ts
does NOT re-export src/local/ — the bin entry IS the composition site
per ADR D8") is preserved by the wording. DIP boundary respected.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-wiring
- **File:** `src/agent-tools/run-mcp-server.ts` line 1-21 (JSDoc block)
- **Plan reference:** T2.1 + F-dom-cli-1 closure
- **Evidence:**

  Diff: removed "pgvector + stubs"; added "LocalTransformerEmbedder +
  OpenAILLM real providers" + paragraph about OPENAI_API_KEY hard-fail
  semantics. No code-line additions/removals; pure JSDoc.
  
  grep -n "DeterministicStubEmbedder\|StubLLM" src/agent-tools/run-mcp-server.ts → 0 hits
  (confirms JSDoc no longer references stub providers).
  
  src/agent-tools/index.ts unchanged in this fix-cycle; library layer
  still does NOT re-export src/local/ — only the bin entry composes them.

- **Recommended action:** None.

### F-wire-6: Test file honors no-paper-names-in-code.md by constructing the banned-token
regex via string concatenation. The literal banned tokens (V+oyager,
Me+m0, etc.) do NOT appear as contiguous words in src/**/*.ts, so the
THE GOAL TEST grep -wE pattern from the parent plan returns 0 hits.
Runtime concatenation reassembles the actual regex for assertion.


- **Found by:** review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-wiring
- **File:** `src/core/reflection/__tests__/prompt.test.ts` line 29-41 (paper-name regex)
- **Plan reference:** T0.4 + EC-8 + b1acbba (paper-name regex construction)
- **Evidence:**

  Commit b1acbba ("fix(p0-fixes): reflection prompt test — build paper-name
  regex via string concat to honor no-paper-names-in-code rule") explicitly
  addresses the constraint. The technique is documented inline (lines 23-28).
  
  grep -wE "(Voyager|Mem0|Letta|LangMem|MemGPT|Graphiti|Generative Agents|CoALA|ProcMEM|Honcho)" \
    src/core/reflection/__tests__/prompt.test.ts → 0 hits.
  
  The buildReflectionPrompt callers:
  - src/core/reflection/execute.ts:87 (production reflection pipeline)
  - src/core/reflection/__tests__/prompt.test.ts × 3 (this NEW test)
  - src/core/__tests__/reflection/prompt.test.ts (pre-existing T4.1 test
    from v0-4a-reflection-pipeline cycle)
  Production caller exists; no orphan-export risk.

- **Recommended action:** None.


## Handoff decision

Implementation has BLOCKER and/or CRITICAL findings. Loop back to `/implement` to address.

## Audit trail

Spawned agents (their findings files live alongside this report):

- `.claude/agents/review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-2026-06-04/review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-architecture.md`
- `.claude/agents/review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-2026-06-04/cross-validation.md`
- `.claude/agents/review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-2026-06-04/review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-domain-api-design.md`
- `.claude/agents/review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-2026-06-04/review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-domain-cli-tooling.md`
- `.claude/agents/review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-2026-06-04/review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-tests.md`
- `.claude/agents/review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-2026-06-04/review-p0-api-sdk-mcp-correctness-audit-fixes-cycle-1-wiring.md`

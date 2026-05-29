# Plan: discover-web v0.1 — close 11 cycle-discover.md v1.1 downstream items

> **Version 1.1** — Ship the 11 downstream items declared in `.claude/rules/cycle-discover.md § Versioning v1.1 (2026-05-22)` as "NOT yet shipped — follow-up work" so that the cycle-discover contract (prior_art 5th corner + URL allowlist + snapshot enforcement + URL fabrication detection) becomes operationally enforceable end-to-end. Today the contract is documented, the allowlist file + snapshots directory exist (used in practice during v0-3-agent-tools-mcp), but the 5 SKILL.md files, 3 deterministic Python checkers, 2 golden rules, 2 threshold files, and 1 token-budget entry are silently un-extended — the gate is bypass-able by accident. This plan closes that gap.

> **Change log:**
> - **v1.0 (2026-05-25):** initial draft. Coverage Matrix 13/13.
> - **v1.1 (2026-05-25):** absorbed 8 MUST FIX + 5 SHOULD TEST + 2 DOCUMENT from `discover-web-v0-1-edge-cases-2026-05-25.md`. ADR D1 specified `_extract_snapshot_body()` algorithm verbatim (EC-2). T0.1 accept-0-or-4 placeholder logic + audit existing blueprints (EC-4, EC-7). T2.1 expanded with URL canonicalization + total-timeout budget + 4 new tests (EC-1, EC-3, EC-9, EC-10, EC-13). New task T2.2.5 backfills `DEFER-CORNER: prior_art` in existing v0-3 blueprints (EC-4). T3.2 deep dives reinforce file-referenced halt-loop pattern + add `mkdir -p` step 6.5 (EC-5, EC-8). T4.1 adds code-fence skip logic (EC-6). T6.1 adds positive-metrics test (EC-12). Notes EC-14/15 as accepted risks in Context. Coverage Matrix grows to 14/14.

## Goal

> "Enable `/discover-execute` to cite URLs from the existing `.claude/rules/discover-web-allowlist.txt` with mandatory snapshot persistence at `.claude/knowledge-base/discoveries/snapshots/{slug}/{sha256}.md`, so that `/discover-confidence` caps any blueprint containing a fabricated, orphan-allowlist, or snapshot-mismatched URL citation at 49 (INVALID), measured by `pytest .claude/skills/discover-confidence/tests` reporting ≥ 6 new URL-citation test cases passing AND a golden-fixture blueprint with one intentionally-fabricated URL returning `verdict == INVALID` with `hard_caps_triggered` containing `fabricated_url_citation`."

## Context

### What exists today (partial state — half-shipped contract)

| Item from cycle-discover.md v1.1 § Downstream | Current state |
|---|---|
| #1 `discover-plan-golden-rule.md` — 5 corners + URL fab + allowlist + snapshot stable identifiers | NOT extended — file still references only 4 corners (`empty_corner_tests/deps/tools/techniques`) |
| #2 `discover-blueprint-golden-rule.md` — same expansions | NOT extended |
| #3 `discover-plan-thresholds.txt` + `discover-blueprint-thresholds.txt` — bump sunset + cite v1.1 ADR | NOT bumped — both files show `YOUR_ADR_REF` placeholder |
| #4 `discover-web-allowlist.txt` — NEW FILE with seed | **SHIPPED 2026-05-22** + 3 extra entries added during v0-3-agent-tools-mcp Q7 (2026-05-23) |
| #5 `discover-plan/SKILL.md` + template — declare prior_art questions | NOT updated — no occurrence of `prior_art`/`WebSearch` in `.claude/skills/discover-*/SKILL.md` |
| #6 `discover-execute/SKILL.md` + halt-loop prompt — wire WebSearch/WebFetch + snapshot-write | NOT updated — same scan |
| #7 `check_reference_citations.py` — extend for URL + snapshot + optional HTTP 200 | NOT extended — zero occurrences of `https://`/`allowlist`/`snapshot`/`prior_art` |
| #8 `check_research_coverage.py` — recognize 5th corner | NOT extended — 4 corner regex hardcoded |
| #9 `discover-improve/` Phase A — handle URL fabrication markers + snapshot regeneration | NOT updated |
| #10 `token-budget.md` — bump `/discover-execute` estimate by +30k tokens/question | NOT updated |
| #11 `.gitignore` confirm `snapshots/` IS committed | **EFFECTIVELY DONE** — `git ls-files .claude/knowledge-base/discoveries/snapshots/` returns 4 files (v0-3 cycle wrote them); allowlist is also `git ls-files` tracked |

**Net:** 2/11 items shipped (#4 + #11); 9/11 items pending. The cycle is **operationally silent** — the v0-3-agent-tools-mcp blueprint successfully wrote 4 snapshots + cited URLs from the allowlist, but `/discover-confidence` did NOT verify them (the URL never reached `check_reference_citations.py` because its regex still only matches `.claude/knowledge-base/references/{...}`). A future blueprint could cite a fabricated `https://made-up-paper.example/x` and pass confidence, defeating Inquebrável Rule 3 (extreme honesty).

### Evidence of the gap

```bash
$ grep -c "https://\|allowlist\|snapshot\|prior_art" .claude/skills/discover-confidence/scripts/check_reference_citations.py
0

$ grep -l "prior_art\|WebSearch\|WebFetch" .claude/skills/discover-*/SKILL.md
(no output)

$ grep "YOUR_ADR_REF" .claude/rules/discover-plan-thresholds.txt
SHIPPABLE|90|2027-01-31|YOUR_ADR_REF
SHIPPABLE_WITH_CAVEATS|70|2027-01-31|YOUR_ADR_REF
NON_SHIPPABLE|50|2027-01-31|YOUR_ADR_REF
INVALID|0|2027-01-31|YOUR_ADR_REF
```

### Why this matters NOW (motivation)

1. **Downstream cycle-design-patterns blocked:** the next planned skill (`cycle-design-patterns v0.1`) needs `WebSearch`/`WebFetch` wired into the halt-loop to pull GoF / Fowler / DDD blueprints. Without this plan, design-patterns becomes recall-from-training-data (frágil per Anti-pattern #10 in cycle-discover.md).
2. **Rule 9 (Não Reinvente):** every future plan that declares a NEW dep should have a prior_art question evaluating mature libs. Today that's impossible at scale because the halt-loop can't even WebSearch.
3. **Audit-trail completeness:** the v0-3 cycle wrote snapshots and cited URLs but no checker validates them. A bug, a typo, OR a hallucinated URL slipped through silently — we just got lucky.

### Accepted risks (per `discover-web-v0-1-edge-cases-2026-05-25.md`)

- **EC-14 — Snapshot file > 50KB has O(n) sha256 cost:** snapshots are markdown text only; observed max ~30KB (MCP spec page in v0-3). sha256 at 30KB is <5ms in Python; even at 500KB would be <50ms. Not worth optimizing; pre-accepted.
- **EC-15 — `discover-plan-confidence` sibling skill may not exist yet:** `discover-plan-golden-rule.md` (extended in T1.1) is currently consumed only by future `discover-plan-confidence/run_discover_plan_score.py`. If that skill is never shipped, the golden rule still earns its keep via `discover-blueprint-golden-rule.md` (sibling extended in T1.2) which IS consumed by the existing `check_reference_citations.py`. No code break either way; pre-accepted as potential debt only.

## Objective

- [ ] Sub-goal 1 — `discover-plan-golden-rule.md` + `discover-blueprint-golden-rule.md` document 5-corner + URL hard caps (file content carries `fabricated_url_citation`, `domain_not_in_allowlist`, `snapshot_missing_or_corrupt`, `empty_corner_prior_art`, `rule9_verdict_missing` stable identifiers)
- [ ] Sub-goal 2 — `discover-plan-thresholds.txt` + `discover-blueprint-thresholds.txt` cite v1.1 ADR (no `YOUR_ADR_REF` placeholder remaining), sunset bumped to 2027-07-31
- [ ] Sub-goal 3 — `check_reference_citations.py` accepts URL citations alongside `.claude/knowledge-base/references/{...}`; validates allowlist + snapshot file + sha256 match; emits `fabricated_url_citation` / `domain_not_in_allowlist` / `snapshot_missing_or_corrupt` per cap
- [ ] Sub-goal 4 — `check_research_coverage.py` + `check_blueprint_completeness.py` recognize the 5th corner (`prior_art`) and emit `empty_corner_prior_art` when missing
- [ ] Sub-goal 5 — `discover-plan/SKILL.md` + `discovery-plan-template.md` document the `prior_art` corner + per-question `source:` field (`.claude/knowledge-base/references/{project}` OR `web`)
- [ ] Sub-goal 6 — `discover-execute/SKILL.md` + halt-loop prompt + `blueprint-template.md` instruct iteration on WebSearch/WebFetch invocation + snapshot-write-before-cite
- [ ] Sub-goal 7 — `discover-improve/` Phase A handles URL markers (`<!-- BLOCKED: url-fabricated -->`, `<!-- BLOCKED: snapshot-missing -->`)
- [ ] Sub-goal 8 — `token-budget.md` § `cycle-discover` estimates updated (`+30k tokens per active prior_art question`)
- [ ] Sub-goal 9 — `.gitignore` documented: snapshots/ committed (audit), `.progress-*.json` still gitignored
- [ ] Sub-goal 10 — Integration-equivalent test: a fixture blueprint containing 3 URL citations (1 valid + 1 off-allowlist + 1 snapshot-missing) scored via `run_blueprint_score.py` returns `verdict == INVALID` with both stable identifiers triggered

## ADRs

### D1 — Snapshot file format: markdown with frontmatter, NOT JSON

**Decision:** Snapshots at `.claude/knowledge-base/discoveries/snapshots/{slug}/{sha256}.md` use the existing convention observed in v0-3-agent-tools-mcp (`# Snapshot: {url}\n---\n**Source:** WebFetch {date} (allowlisted domain {domain})\n\n{content}`).

**Alternatives considered:**
- (a) JSON files with `{url, fetched_at, content, sha256}` — easier to parse, but breaks the human-readability gain of the current markdown convention; would force migration of the 4 existing snapshots.
- (b) Markdown WITHOUT delimiter line — but the `---\n` is what `sha256` is computed over (per cycle rule: `sha256({url}\n---\n{fetched-content})`), and the convention is already in production.

**Rationale:** Inquebrável Rule 11 (YAGNI) + Inquebrável Rule 9 (Não Reinvente). The convention works and is already used. We standardize what exists.

**Consequences:** `check_reference_citations.py` parses the markdown header to extract the cited URL; the rest of the file is the snapshot body.

**Body extraction algorithm (EC-2 absorbed — locked verbatim):**

```python
def _extract_snapshot_body(file_content: str, url: str) -> str:
    """Extract the fetched-content body from a snapshot file, stripping the
    3-line header convention introduced by v0-3-agent-tools-mcp.

    Header convention (D1):
        Line 1: `# Snapshot: {url}`
        Line 2: `---`
        Line 3: `**Source:** WebFetch {date} (allowlisted domain {domain})`
        Line 4: (blank line)
        Line 5+: {fetched-content}

    Returns the body starting at line 5. Raises ValueError if header malformed
    (signals a hand-edited or migration-needed snapshot file).
    """
    expected_h1 = f"# Snapshot: {url}\n"
    if not file_content.startswith(expected_h1):
        raise ValueError(f"snapshot header mismatch: expected '{expected_h1!r}' at start")
    rest = file_content[len(expected_h1):]
    if not rest.startswith("---\n"):
        raise ValueError("snapshot missing '---\\n' separator on line 2")
    after_separator = rest[len("---\n"):]
    # Skip the **Source:** line + 1 blank separator line
    parts = after_separator.split("\n", 2)
    if len(parts) < 3 or not parts[0].startswith("**Source:**"):
        raise ValueError("snapshot missing '**Source:**' line 3 OR blank line 4")
    return parts[2]


def _compute_snapshot_sha256(url: str, body: str) -> str:
    """sha256 over the URL + separator + body. Locked per cycle-discover.md v1.1.
    Trailing newline of body is included if present in the file."""
    return hashlib.sha256(f"{url}\n---\n{body}".encode()).hexdigest()
```

**Re-validation flow:**
1. Read snapshot file content.
2. Extract URL from line 1 header.
3. Extract body via `_extract_snapshot_body(content, url)`.
4. Compute `_compute_snapshot_sha256(url, body)`.
5. Compare to filename stem (`Path(file).stem`).
6. Mismatch → emit `snapshot_missing_or_corrupt` (per D6).

If a snapshot is hand-edited, the hash will mismatch — desired honesty signal. The v0-3 snapshots committed at `.claude/knowledge-base/discoveries/snapshots/v0-3-agent-tools-mcp/` MUST validate clean under this algorithm; if any do not, that's a Phase 0 audit failure (T0.1 includes the verification).

### D2 — URL allowlist scope: exact-match host, subdomains require own entry

**Decision:** A URL citation `https://{host}/{path}` is allowlisted IFF `{host}` appears verbatim as a line in `.claude/rules/discover-web-allowlist.txt` (after stripping comments). Subdomains are NOT auto-allowed.

**Alternatives considered:**
- (a) Suffix-match: `arxiv.org` covers `cs.arxiv.org`, `bio.arxiv.org`, etc. — but defeats audit purpose; a typo `arxiv-fake.org` would slip if we did substring; safer to require explicit entry.
- (b) Wildcard syntax (`*.arxiv.org`) — adds parser complexity; the current allowlist already documents subdomain rule in its header comments; honor what's there.

**Rationale:** matches the existing rule in the allowlist file (header comment lines 9-10: "Subdomains are NOT auto-allowed. If you cite `spec.modelcontextprotocol.io`, that subdomain needs its own entry"); already validated in v0-3 cycle where `spec.modelcontextprotocol.io` + `modelcontextprotocol.io` were added as separate entries.

**Consequences:** When a discovery cites a new subdomain, the cycle aborts with `domain_not_in_allowlist` and the human must add the entry (with inline rationale per cycle rule). One-time friction; long-term audit win.

### D3 — Optional WebFetch HTTP check at confidence time: soft cap, NEVER hard

**Decision:** `check_reference_citations.py` does NOT perform WebFetch by default. When invoked with `--check-urls-live`, it issues a HEAD request per URL; HTTP 4xx/5xx OR timeout triggers `soft_floor_url_unreachable` (cap 70, NOT 49).

**Alternatives considered:**
- (a) Always live-check — but networks are flaky, vendor URLs move, and CI runs offline; would make `/discover-confidence` non-deterministic. Cap 49 (INVALID) on a transient outage is unjust.
- (b) Never live-check — but a vendor blog deleted post-snapshot would never surface; the soft cap encourages opportunistic checking without hard-failing on a 503.

**Rationale:** Snapshot IS the source of truth (cycle rule v1.1 Anti-pattern #9: "snapshot-first, cite second"). Live URL is best-effort signal of continued relevance, not authority.

**Consequences:** Default `/discover-confidence` runs are offline + deterministic. Optional `--check-urls-live` flag added for review-time spot-check. Cap is downgraded (70 vs 49) because snapshot integrity already passed.

### D4 — `snapshots/` directory IS git-tracked (audit), `.progress-*.json` stays gitignored

**Decision:** `.claude/knowledge-base/discoveries/snapshots/` is committed to git (already in practice — 4 files tracked under `v0-3-agent-tools-mcp/`). `.gitignore` currently lists `.claude/knowledge-base/discoveries/.progress-*.json` (correctly — progress files are session-local state).

**Alternatives considered:**
- (a) Gitignore snapshots/ — defeats the entire audit-trail purpose; reviewers couldn't verify what was actually fetched at discovery time.
- (b) Add a `.gitkeep` requirement OR a per-slug README — the `.gitkeep` is already present in v0-3 snapshot dir; adding READMEs would be YAGNI.

**Rationale:** Inquebrável Rule 3 (extreme honesty) + cycle rule v1.1 Anti-pattern #10 ("NEVER fabricate a URL from training-data recall"). The snapshot is what we assert as truth; deleting it on commit would make the assertion unverifiable.

**Consequences:** Repo size grows over time (snapshot content text). Mitigation: snapshots are markdown text only (no binaries), typical 2-20 KB each; 4 snapshots from v0-3 total ~30 KB. Negligible per cycle. Rotation policy is `.claude/rules/audit-trail-rotation.md` — snapshots follow the same 30-day-post-merge → `_archive/` flow as other audit artifacts.

### D5 — WebSearch/WebFetch wiring: Skill-tool-level instruction, runtime ToolSearch by Claude

**Decision:** `/discover-execute` SKILL.md instructs each halt-loop iteration to (a) invoke `ToolSearch` with query `select:WebSearch,WebFetch` to load the deferred tool schemas, (b) call WebSearch with the question's `prior_art` keywords, (c) inspect results, (d) call WebFetch on the chosen result URL, (e) verify domain is in allowlist (via `Bash grep`), (f) write snapshot to `.claude/knowledge-base/discoveries/snapshots/{slug}/{sha256}.md`, (g) THEN cite in blueprint.

**Alternatives considered:**
- (a) Build a custom `discover-fetch` skill that wraps WebFetch — adds layers; YAGNI (Rule 11). The 7-step convention can live in SKILL.md prose.
- (b) Eagerly load WebSearch/WebFetch in SKILL.md's `allowed-tools` frontmatter — but Claude Code's frontmatter doesn't dynamically load deferred tools; the ToolSearch select step is the canonical mechanism per the system reminder pattern.

**Rationale:** Minimum-viable wiring. The halt-loop driver prompt already instructs per-iteration behavior; adding the 7-step prior_art protocol is incremental.

**Consequences:** Each iteration that touches `prior_art` carries the +30k token overhead (per `token-budget.md` D5). The halt-loop budget needs adjustment per question (cycle rule v1.1 says max 1-3 prior_art questions per plan to stay within budget).

### D6 — Stable identifier scheme for the 4 new hard caps + 3 new soft caps

**Decision:** Stable identifiers consumed by `hard_caps_triggered` JSON output use this scheme (mirrors existing `empty_corner_*` + `fabricated_citation` pattern):

| Cap | Stable ID | Verdict cap |
|---|---|---|
| URL not found in allowlist | `domain_not_in_allowlist` | 49 (INVALID) |
| URL cited without snapshot | `snapshot_missing_or_corrupt` | 49 (INVALID) |
| URL fabricated (no WebFetch trace) | `fabricated_url_citation` | 49 (INVALID) |
| Prior_art corner empty | `empty_corner_prior_art` | 49 (INVALID) |
| Prior_art question lacks Rule 9 verdict (`ADOPT`/`REJECT`/`DEFER`) | `rule9_verdict_missing` | 49 (INVALID) |
| URL unreachable via live WebFetch (when `--check-urls-live` flag) | `soft_floor_url_unreachable` | 70 (SHIPPABLE_WITH_CAVEATS) |
| Vendor blog citation older than 18 months | `soft_floor_stale_blog_citation` | 89 |
| Dep-candidate evaluated ADOPT without pinned version | `soft_floor_unpinned_dep_candidate` | 89 |

**Alternatives considered:**
- (a) Combine `domain_not_in_allowlist` + `snapshot_missing_or_corrupt` into single `invalid_url_citation` — but caller can't distinguish "URL fine, snapshot missing" (fixable by re-running WebFetch) from "domain banned" (requires allowlist change); separation is actionable.
- (b) Hyphenated IDs (`domain-not-in-allowlist`) — but siblings use underscore. Consistency wins.

**Rationale:** Matches sibling pattern in `plan-confidence-golden-rule.md` and `deps-audit-golden-rule.md`. Stable identifiers are the API the cycle rule's "Rules that cannot be bent" table cites.

**Consequences:** `hard_caps_triggered` list can grow non-trivially for a blueprint with many URL issues. JSON output is unambiguous, machine-parseable, and `discover-improve` Phase A can target each ID specifically.

### D7 — `discover-improve` Phase A URL handling: mark + skip, never silently retry

**Decision:** When `discover-confidence` reports a URL hard cap, Phase A of `discover-improve` inserts a sentinel comment in the blueprint above the offending citation:
- `<!-- BLOCKED: url-fabricated — no snapshot at expected path: snapshots/{slug}/{sha256}.md -->`
- `<!-- BLOCKED: domain-not-in-allowlist — add {host} to .claude/rules/discover-web-allowlist.txt with rationale OR remove this citation -->`
- `<!-- BLOCKED: snapshot-corrupt — sha256 of file does not match expected; re-fetch via WebFetch -->`

Phase A does NOT automatically re-WebFetch (would silently mask drift) or auto-add to allowlist (would defeat the audit). Phase B (LLM) may decide to remove the citation OR escalate to human.

**Alternatives considered:**
- (a) Auto re-WebFetch on snapshot-missing — opaque to reviewer; honest sentinel is better.
- (b) Auto-add to allowlist with `TODO` rationale — Inquebrável Rule 3 (extreme honesty) forbids — every allowlist entry needs rationale at add time, not later.

**Rationale:** mirrors how Phase A handles fabricated `.claude/knowledge-base/references/` paths today (marks `<!-- BLOCKED: path not found -->`, never invents alternatives).

**Consequences:** Halt-loop may not converge if all URLs are off-allowlist; surfaces to human honestly per `discover-improve` stop condition. Better than auto-fixing into a worse state.

## Dependency Graph

```text
Phase 0 ──▶ Phase 1 ──▶ Phase 2 ──▶ Phase 3 ──▶ Phase 4 ──▶ Phase 5 ──▶ Phase 6
audit       golden     python      skill       improve     docs +      integration
+EC-4       rules      scripts     prompts     phase A     budget      validation
audit                  +T2.2.5     +EC-5/8     +EC-6
                       (EC-4)      callouts    fence-skip
                       backfill                logic
```

Phase 1 (golden rules) MUST land before Phase 2 (scripts) — the stable identifiers from D6 are referenced in script implementations. Phase 2 includes T2.1 → T2.2 → T2.2.5 → T2.3 in strict order (T2.2.5 depends on T0.1 audit + T2.2 enforcement landing in same logical unit per EC-4; backfill BEFORE the breaking change becomes visible). Phase 4 depends on Phase 2 (URL marker syntax tested in confidence scripts). Phase 5 (docs) parallel with Phase 4. Phase 6 always last.

**EC-4 ordering invariant:** T2.2.5 MUST land in the SAME PR (or strictly between T2.2 and any /discover-confidence re-run) — otherwise existing blueprints regress silently. Plan-confidence cannot detect this regression because the test fixtures are isolated.

## Dependencies

### Existing — use as-is

| Package / file | Version | Ecosystem | Why |
|---|---|---|---|
| `.claude/rules/discover-web-allowlist.txt` | shipped 2026-05-22 (18 domains) | n/a | Already used by v0-3 cycle; format documented in file header |
| `.claude/knowledge-base/discoveries/snapshots/` | shipped (v0-3 wrote 4 files) | n/a | git-tracked audit-trail dir |
| WebSearch (built-in) | Claude Code deferred tool | runtime | The web search invocation primitive |
| WebFetch (built-in) | Claude Code deferred tool | runtime | The URL content fetch primitive |
| pytest + conftest.py | already in `.claude/skills/discover-*/tests/` | python | Test framework for deterministic checkers |

### New — to be introduced

| Package / file | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| (none) | n/a | n/a | n/a | Pure refactor + script extension; reuses existing infra. |

### Removed

| Package / file | Last version | Why removed |
|---|---|---|
| (none) | | |

## Phase 0: Audit current state + verify pre-conditions

**Objective:** Confirm the 2/11 already-shipped items are actually in the state assumed by the plan; record a baseline snapshot.

### T0.1 — Verify allowlist + snapshots dir + threshold-file shape

#### Objective
Lock down the assumption that allowlist + snapshots dir exist as expected before touching anything; produce evidence in a Phase 0 progress note.

#### Evidence
Verified during plan drafting: `git ls-files .claude/rules/discover-web-allowlist.txt` returns the path; `git ls-files .claude/knowledge-base/discoveries/snapshots/` returns 4 + 1 `.gitkeep`. But the implementer must re-verify at task start (state may have changed).

#### Files to edit
```text
.claude/knowledge-base/implementations/.progress-discover-web-v0-1.json (NEW; gitignored per .gitignore pattern)
```

#### Deep file dependency analysis
None. This task is read-only diligence.

#### Deep Dives
**Required state for plan to proceed:**
- `.claude/rules/discover-web-allowlist.txt` exists AND has ≥ 15 entries AND each entry has inline rationale
- `.claude/knowledge-base/discoveries/snapshots/` exists AND is git-tracked (NOT gitignored)
- `.claude/rules/discover-plan-thresholds.txt` AND `discover-blueprint-thresholds.txt` exist with `YOUR_ADR_REF` **count == 0 OR == 4** (clean states only — partial-state is human-confusing per EC-7)
- **EC-2 verification:** every existing snapshot at `.claude/knowledge-base/discoveries/snapshots/v0-3-agent-tools-mcp/*.md` MUST re-validate under the D1 algorithm — recompute sha256 from extracted body + URL and compare to filename. ANY mismatch halts Phase 0 (snapshot is hand-edited OR header convention drifted).
- **EC-4 baseline:** enumerate existing blueprints lacking prior_art corner (`find .claude/knowledge-base/discoveries/blueprints -name "*.md" -exec grep -L "prior_art\|DEFER-CORNER: prior_art" {} \;`) — record list in progress JSON for T2.2.5 to backfill.

If any precondition fails: HALT and surface to human BEFORE writing any code.

#### Tasks
1. `cat .claude/rules/discover-web-allowlist.txt | grep -v '^#' | grep -v '^$' | wc -l` — assert ≥ 15
2. `git ls-files .claude/knowledge-base/discoveries/snapshots/ | wc -l` — assert ≥ 1
3. **EC-7 absorbed:** `grep -c "YOUR_ADR_REF" .claude/rules/discover-plan-thresholds.txt` — assert result ∈ `{0, 4}`. If 0 → T1.3 already done, mark skip in progress JSON. If 4 → T1.3 pending, normal flow. Any other count → HALT with message "partial threshold-file state; human must reconcile before /implement proceeds".
4. **EC-2 absorbed:** for each `.md` file under `.claude/knowledge-base/discoveries/snapshots/v0-3-agent-tools-mcp/`, run a quick Python snippet (inline in commit body) that applies the D1 `_extract_snapshot_body` + `_compute_snapshot_sha256` algorithm and asserts filename stem matches computed sha256. Any mismatch → HALT.
5. **EC-4 absorbed:** enumerate existing blueprints under `.claude/knowledge-base/discoveries/blueprints/` (if any exist) lacking either a `prior_art` corner header OR a `<!-- DEFER-CORNER: prior_art -->` marker. Record the list in progress JSON (consumed by T2.2.5). If list is empty → T2.2.5 becomes a no-op task; mark accordingly.
6. Write progress note JSON to `.claude/knowledge-base/implementations/.progress-discover-web-v0-1.json` with shape: `{slug, iterations_used, tasks: [...], audit: {allowlist_count, snapshot_count, placeholder_count, snapshot_validation: "PASS"|"FAIL+list", existing_blueprints_needing_defer: [...]}}`

#### TDD
```text
RED:     None — Phase 0 is read-only audit; no code under test.
GREEN:   Implementer commits a 1-paragraph audit note as the first commit.
REFACTOR: None expected.
VERIFY:  Bash assertions above all return success codes.
```

#### Acceptance Criteria
- [ ] All 6 verifications (3 Bash + EC-7 placeholder count + EC-2 snapshot re-validation + EC-4 blueprint enumeration) pass
- [ ] Progress JSON exists at `.claude/knowledge-base/implementations/.progress-discover-web-v0-1.json` with `audit` sub-object populated
- [ ] Audit note logged in implementation md OR in commit body
- [ ] Pass: no source files changed (audit-only phase)
- [ ] If EC-2 snapshot validation FAILED: halt + surface (do NOT proceed silently to Phase 1)
- [ ] If EC-4 blueprint list is empty: progress JSON records `existing_blueprints_needing_defer: []` so T2.2.5 can mark itself no-op

#### DoD
- [ ] All assertions documented in commit message
- [ ] Progress JSON shape matches sibling cycles' pattern (slug + iterations_used + tasks array + audit)
- [ ] If placeholder count == 0: implementation contract marks T1.3 as `pre-shipped, skip`

---

## Phase 1: Golden rules + thresholds expansion

**Objective:** Document the 5 new hard cap stable IDs + 3 soft caps in both golden rules; replace `YOUR_ADR_REF` placeholders with v1.1 ADR ref + bump sunset.

### T1.1 — Extend `discover-plan-golden-rule.md` for 5-corner + URL caps

#### Objective
Add the 5 new hard cap stable IDs (`empty_corner_prior_art`, `fabricated_url_citation`, `domain_not_in_allowlist`, `snapshot_missing_or_corrupt`, `rule9_verdict_missing`) + 3 soft caps to `.claude/rules/discover-plan-golden-rule.md` so that the contract is the source of truth before any script consumes it.

#### Evidence
`discover-plan-golden-rule.md` currently lists only `empty_corner_{tests,deps,tools,techniques}` + `fabricated_citation` + 4 SHIPPABLE_WITH_CAVEATS caps. The cycle rule v1.1 added 3 new hard gates (allowlist, snapshot, Rule 9 verdict) that the per-skill golden rule does NOT yet reflect.

#### Files to edit
```text
.claude/rules/discover-plan-golden-rule.md — extend (existing file; +1 to "## The Rule" section, +5 to stable ID list)
```

#### Deep file dependency analysis
- File is referenced by `.claude/skills/discover-plan-confidence/SKILL.md` (sibling skill — note this file mentions it may not exist yet; verify) AND by `check_reference_citations.py` (extending in Phase 2). Phase 2 cites the IDs declared here.
- No other file depends on this rule today; downstream is open.

#### Deep Dives
**Surgical addition pattern:** insert 5 new rules under "## The Rule" numbered 7-11 (existing has 6). Insert 3 new soft caps under "## Soft gates" numbered 3-5 (existing has 2). Insert 5 new rows in "## Rules that cannot be bent" table. Update "## Related" links if needed.

**Invariant preserved:** existing rules 1-6 and existing soft caps 1-2 are NOT modified. Backward compat for any script that consumes existing IDs.

#### Tasks
1. Read current `discover-plan-golden-rule.md` (already done at plan-drafting; ~120 lines)
2. Add rules 7-11 to "## The Rule" with full text per D6 table
3. Add soft caps 3-5 to "## Soft gates" with cap values 70 / 89 / 89
4. Add 5 rows to "## Rules that cannot be bent" table mapping each new ID to its enforcing script (`check_reference_citations.py` / `check_research_coverage.py`)
5. Append a row to "## Log of changes" with date 2026-05-25 + reference to this plan

#### TDD
```text
RED:     test_discover_plan_golden_rule_lists_url_caps() — pytest reads the .md, asserts each of the 5 new stable IDs appears verbatim. Test FAILS before edit.
GREEN:   Edit file; test passes.
REFACTOR: None expected (declarative rule file).
VERIFY:  pytest .claude/skills/discover-confidence/tests/test_discover_plan_golden_rule_consistency.py
```

NEW test file: `.claude/skills/discover-confidence/tests/test_discover_plan_golden_rule_consistency.py` (~30 lines) reads the .md file and asserts substring presence for each new ID. Pure structural assertion, no logic.

#### Acceptance Criteria
- [ ] All 5 new stable IDs present in `discover-plan-golden-rule.md`
- [ ] All 3 new soft cap IDs present
- [ ] "## Rules that cannot be bent" table updated with 5 new rows
- [ ] "## Log of changes" entry added with date + plan reference
- [ ] No regression — existing rules 1-6 + soft caps 1-2 untouched (grep assertion)
- [ ] Pass: lint — markdown file, no lint required (n/a)

#### DoD
- [ ] Test `test_discover_plan_golden_rule_consistency.py` passes
- [ ] File size ≤ 250 LoC (currently ~120; estimated +60 after edits = 180 LoC)

### T1.2 — Extend `discover-blueprint-golden-rule.md` for same 5+3 caps

#### Objective
Apply the same expansion to the blueprint golden rule sibling.

#### Evidence
`discover-blueprint-golden-rule.md` mirrors `discover-plan-golden-rule.md`'s shape but targets blueprints (output of `/discover-execute`). Same 5+3 cap structure applies.

#### Files to edit
```text
.claude/rules/discover-blueprint-golden-rule.md — extend (mirrors T1.1)
```

#### Deep file dependency analysis
- Consumed by `.claude/skills/discover-confidence/SKILL.md` + `check_reference_citations.py` + `check_research_coverage.py`.
- Phase 2 scripts reference IDs declared here.

#### Deep Dives
Same pattern as T1.1. The blueprint version uses slightly different vocabulary ("blueprint citation" vs "plan citation") but the cap semantics are identical.

#### Tasks
1. Apply same 5+3 cap additions per T1.1 pattern
2. Adjust prose to reference "blueprint" not "plan"
3. Log entry in change log

#### TDD
```text
RED:     test_discover_blueprint_golden_rule_lists_url_caps() — pytest substring check. Test FAILS before edit.
GREEN:   Edit file.
REFACTOR: None.
VERIFY:  pytest .claude/skills/discover-confidence/tests/test_discover_blueprint_golden_rule_consistency.py
```

#### Acceptance Criteria
- [ ] All 5+3 stable IDs present
- [ ] Existing structure untouched
- [ ] Log entry added

#### DoD
- [ ] Test passes
- [ ] File size ≤ 250 LoC

### T1.3 — Replace `YOUR_ADR_REF` placeholders + bump sunset in both threshold files

#### Objective
`discover-plan-thresholds.txt` + `discover-blueprint-thresholds.txt` both have 4 entries with `YOUR_ADR_REF` placeholder. Replace with `cycle-discover.md#v1.1-2026-05-22` and bump sunset from 2027-01-31 to 2027-07-31 (re-calibration cycle).

#### Evidence
```bash
$ grep "YOUR_ADR_REF" .claude/rules/discover-plan-thresholds.txt | wc -l
4
```

#### Files to edit
```text
.claude/rules/discover-plan-thresholds.txt — modify 4 lines
.claude/rules/discover-blueprint-thresholds.txt — modify 4 lines
```

#### Deep file dependency analysis
- Consumed by `run_blueprint_score.py` + (when shipped) `run_discover_plan_score.py` for band cutoffs. The cutoff values (90/70/50/0) are NOT changing; only the `adr-ref` field and sunset date are.

#### Deep Dives
Format per file header: `<band-name>|<min-score>|<sunset-date>|<adr-ref>`. The threshold files are simple text; parsing is split-on-pipe.

#### Tasks
1. `sed -i 's/YOUR_ADR_REF/cycle-discover.md#v1.1-2026-05-22/g' .claude/rules/discover-plan-thresholds.txt` (verify diff first)
2. `sed -i 's/2027-01-31/2027-07-31/g' .claude/rules/discover-plan-thresholds.txt`
3. Same 2 commands for `discover-blueprint-thresholds.txt`

#### TDD
```text
RED:     test_thresholds_no_placeholder() — pytest grep for "YOUR_ADR_REF" in both files; expects 0 matches. Test FAILS before edit.
GREEN:   Run sed; test passes.
REFACTOR: None.
VERIFY:  pytest .claude/skills/discover-confidence/tests/test_thresholds_no_placeholder.py
```

#### Acceptance Criteria
- [ ] 0 occurrences of `YOUR_ADR_REF` in both files
- [ ] 8 lines reference `cycle-discover.md#v1.1-2026-05-22`
- [ ] Sunset 2027-07-31 in both files
- [ ] Pass: format — pipe-delimited shape preserved (no extra/missing pipes)

#### DoD
- [ ] Test passes
- [ ] `run_blueprint_score.py` still loads thresholds successfully (smoke test)

---

## Phase 2: Confidence script extension (deterministic Python checkers)

**Objective:** Extend `check_reference_citations.py` to handle URL citations (allowlist + snapshot + sha256); extend `check_research_coverage.py` + `check_blueprint_completeness.py` to recognize the 5th corner.

### T2.1 — Extend `check_reference_citations.py` for URL citations

#### Objective
Add URL detection + allowlist validation + snapshot file existence + sha256 hash verification + optional WebFetch live check (gated by `--check-urls-live`).

#### Evidence
Current state:
```bash
$ grep -c "https://\|allowlist\|snapshot" .claude/skills/discover-confidence/scripts/check_reference_citations.py
0
```
The file only matches `.claude/knowledge-base/references/{...}` pattern. URLs are silently ignored.

#### Files to edit
```text
.claude/skills/discover-confidence/scripts/check_reference_citations.py — extend (~120 LoC currently → ~250 LoC after; below 500 budget)
.claude/skills/discover-confidence/tests/test_check_reference_citations.py — extend with URL test cases
.claude/skills/discover-confidence/tests/fixtures/blueprints/url_citations/ (NEW dir) — 3 fixture blueprints + 2 sample snapshots
```

#### Deep file dependency analysis
- File is imported by `run_blueprint_score.py` (top-level entry) — extension preserves existing function signature; just adds new fields to the returned dict.
- `_find_project_root()` helper reused; new `_load_allowlist()` and `_compute_snapshot_sha256()` added as private helpers.
- Existing `.claude/knowledge-base/references/{...}` extraction continues to work — URL extraction is additive.

#### Deep Dives
**New regex:** `URL_CITATION_RE = re.compile(r"https?://[^\s)>\"\\]+")` — matches URLs in markdown prose, table cells, JSDoc-style citations.

**EC-1 absorbed — URL canonicalization helper (explicit, NOT in-passing):**

```python
TRAILING_PUNCT = ".,;!?)]"
def _canonicalize_url_match(raw: str) -> str:
    """Strip trailing punctuation that markdown/prose context may have included
    in the regex match. URLs in real text often appear as 'cite arxiv.org/abs/x.'
    where the trailing period is sentence punctuation, NOT part of the URL.

    Stripping is right-only and stops at first non-punct char (no global strip).
    """
    return raw.rstrip(TRAILING_PUNCT)
```

Apply to every URL extracted before hashing OR lookup. The post-strip is non-negotiable per EC-1 — without it, a blueprint with "See https://arxiv.org/abs/2304.03442." emits a false-positive snapshot-mismatch on every run.

**Allowlist loader (EC-13 absorbed — CRLF tolerance):** read `.claude/rules/discover-web-allowlist.txt`; for each line: skip blank lines + lines starting with `#`; **`.rstrip()` the line first to drop CR + LF + trailing spaces** (handles Windows checkout, autoCRLF, copy-paste); split on whitespace; first token is the domain. Inline-comment everything-after-first-token ignored.

**EC-3 absorbed — `--check-urls-live` total-timeout budget:**

```python
LIVE_CHECK_TOTAL_BUDGET_SEC = 30  # cap for whole run, not per-URL
LIVE_CHECK_PER_URL_TIMEOUT_SEC = 5

def _check_urls_live(urls: list[str]) -> dict[str, str]:
    """Best-effort HEAD per URL, total budget capped. Returns {url: status}.
    status ∈ {'ok', 'unreachable', 'budget-exceeded'}.

    Uses a single thread + monotonic-clock budget check between URLs (NOT
    urllib's timeout, which doesn't cover DNS). Skipped URLs marked
    'budget-exceeded' → soft_floor_url_unreachable with reason context.
    """
    import time
    deadline = time.monotonic() + LIVE_CHECK_TOTAL_BUDGET_SEC
    results = {}
    for url in urls:
        if time.monotonic() >= deadline:
            results[url] = 'budget-exceeded'
            continue
        try:
            req = urllib.request.Request(url, method='HEAD')
            with urllib.request.urlopen(req, timeout=LIVE_CHECK_PER_URL_TIMEOUT_SEC) as resp:
                results[url] = 'ok' if 200 <= resp.status < 400 else 'unreachable'
        except Exception:
            results[url] = 'unreachable'
    return results
```

The total-budget cap is what saves CI when an offline runner accidentally invokes `--check-urls-live`: max 30s total, regardless of URL count.

**Snapshot path resolution:**
```python
def _expected_snapshot_path(slug: str, url: str, content: str) -> Path:
    sha = hashlib.sha256(f"{url}\n---\n{content}".encode()).hexdigest()
    return project_root / ".claude/knowledge-base/discoveries/snapshots" / slug / f"{sha}.md"
```

**Snapshot integrity check:** When the snapshot file exists, parse its content, extract the body, recompute sha256, compare to filename. Mismatch → `snapshot_missing_or_corrupt`. The body extraction strips the `# Snapshot: {url}\n---\n**Source:** ...\n\n` header per D1 convention.

**Stable ID emission:** the existing function returns `{"hard_caps_triggered": [...], "soft_caps_triggered": [...], ...}`. New IDs appended to the existing list.

**Optional `--check-urls-live` flag:** invoked from `run_blueprint_score.py --check-urls-live`. When set, for each URL whose snapshot is valid, issue `urllib.request.urlopen(url, timeout=5)` HEAD request; non-200/timeout → `soft_floor_url_unreachable` (cap 70). Skipped by default for determinism.

**Backward compat:** existing fixtures + tests still pass — the URL extension is purely additive.

#### Tasks
1. Add `URL_CITATION_RE` constant + `_load_allowlist()` + `_expected_snapshot_path()` + `_check_url_citation()` helpers
2. Extend the main extraction loop to find URL citations alongside `.claude/knowledge-base/references/` citations
3. For each URL: domain check → snapshot file exists → sha256 match (3 separate ID emission paths)
4. Add `--check-urls-live` argparse flag to `run_blueprint_score.py` (forwards to this checker)
5. Update returned dict shape: add `url_citations_total`, `url_citations_allowlisted`, `url_citations_snapshotted`
6. Update `__main__` block (if present) for CLI ergonomics

#### TDD
```text
RED:     test_url_citation_in_allowlist_with_valid_snapshot_passes()
RED:     test_url_citation_off_allowlist_emits_domain_not_in_allowlist()
RED:     test_url_citation_missing_snapshot_emits_snapshot_missing_or_corrupt()
RED:     test_url_citation_corrupted_snapshot_emits_snapshot_missing_or_corrupt()
RED:     test_url_citation_with_check_urls_live_unreachable_emits_soft_floor()
RED:     test_referencia_extraction_unchanged_when_urls_added() (regression)
RED:     test_url_strips_trailing_sentence_punctuation() (EC-1) — input "See https://arxiv.org/abs/x." → extracted URL is bare, no `.`
RED:     test_url_with_query_string_hashes_differently_from_bare_url() (EC-9) — `?source=foo` produces different sha256
RED:     test_url_trailing_slash_hashes_differently() (EC-10) — `/abs/x` vs `/abs/x/` produces different sha256
RED:     test_load_allowlist_strips_cr_line_endings() (EC-13) — fixture with `arxiv.org\r\n` matches `arxiv.org`
RED:     test_check_urls_live_total_budget_caps_at_30s_offline() (EC-3) — 100 URLs offline, total wall-time ≤ 35s (5s slack)
GREEN:   Implement helpers + extend main loop
REFACTOR: Extract `_canonicalize_url_match()` + `_extract_snapshot_body()` + `_compute_snapshot_sha256()` + `_check_urls_live()` as private module-level helpers
VERIFY:  pytest .claude/skills/discover-confidence/tests/test_check_reference_citations.py -v
```

Fixtures needed:
- `fixtures/blueprints/url_citations/valid_allowlisted_url.md` — cites `https://arxiv.org/abs/2304.03442` + sha256 matches snapshot
- `fixtures/blueprints/url_citations/off_allowlist_url.md` — cites `https://made-up.example/x`
- `fixtures/blueprints/url_citations/snapshot_missing.md` — cites allowlisted URL but no snapshot file present
- `fixtures/snapshots/test-slug/{sha256}.md` — 2 sample snapshots matching the 2 fixture blueprints with valid setup

#### Acceptance Criteria
- [ ] All 11 new tests pass (6 original + 5 EC-absorbed)
- [ ] Existing tests in `test_check_reference_citations.py` continue to pass (backward compat)
- [ ] Stable IDs from D6 used verbatim in emissions
- [ ] `_canonicalize_url_match`, `_extract_snapshot_body`, `_compute_snapshot_sha256`, `_check_urls_live` are private module-level helpers (testable in isolation)
- [ ] Pass: lint — Python ruff via `.claude/skills/discover-confidence/tests/conftest.py` convention
- [ ] Pass: complexity — extended file ≤ 300 LoC (revised from 250 to accommodate EC absorptions)

#### DoD
- [ ] All RED tests written + initially failing
- [ ] All GREEN tests passing after implementation
- [ ] `run_blueprint_score.py` still works on existing fixture blueprints
- [ ] EC-3 budget test demonstrates ≤ 35s wall-clock against 100 offline URLs (proves the budget cap holds)

### T2.2 — Extend `check_research_coverage.py` for 5th corner (`prior_art`)

#### Objective
Add the 5th corner regex + emit `empty_corner_prior_art` when missing (and no `<!-- DEFER-CORNER: prior_art -->` marker present).

#### Evidence
```python
$ grep -E "tests|deps|tools|techniques|prior_art" .claude/skills/discover-confidence/scripts/check_research_coverage.py
    ("tests", r"##\s+Coverage\s+Corner\s+1\s*(?:—|-)\s*Integration\s+Tests"),
    ("deps", r"##\s+Coverage\s+Corner\s+2\s*(?:—|-)\s*Dependencies"),
    ("tools", r"##\s+Coverage\s+Corner\s+3\s*(?:—|-)\s*Tools"),
    ("techniques", r"##\s+Coverage\s+Corner\s+4\s*(?:—|-)\s*Techniques"),
```
4 corners hardcoded; the 5th is missing.

#### Files to edit
```text
.claude/skills/discover-confidence/scripts/check_research_coverage.py — modify (add 1 tuple entry)
.claude/skills/discover-confidence/tests/test_check_research_coverage.py — extend with 3 prior_art test cases
.claude/skills/discover-confidence/tests/fixtures/blueprints/prior_art/ (NEW dir) — 3 fixture blueprints
```

#### Deep file dependency analysis
- Returns dict consumed by `run_blueprint_score.py`. Adding a corner to the list is additive — existing 4-corner blueprints continue to score with 4 corners populated + 1 deferred (or 1 empty → cap).
- BUT: this is a **breaking change** for any in-flight blueprint that did NOT declare prior_art. Mitigation: blueprints that lack the section can add `<!-- DEFER-CORNER: prior_art | this blueprint predates v1.1 -->` to pass; T5.x flag this in the blueprint template.

#### Deep Dives
**Regex addition:**
```python
("prior_art", r"##\s+Coverage\s+Corner\s+5\s*(?:—|-)\s*Prior[\s-]Art"),
```
The "Prior Art" header allows space OR hyphen between words (markdown convention varies).

**DEFER-CORNER marker recognizer:** already in the file (used by other corners). Just needs the 5th key in the emission loop.

**Stable ID emission:** `empty_corner_prior_art` per D6.

#### Tasks
1. Add 5th tuple to `CORNER_PATTERNS` list (or equivalent constant)
2. Update emission loop to include `prior_art` in the iteration
3. Verify `<!-- DEFER-CORNER: prior_art -->` marker is recognized identically to others

#### TDD
```text
RED:     test_blueprint_with_5_corners_populated_passes()
RED:     test_blueprint_missing_prior_art_corner_emits_empty_corner_prior_art()
RED:     test_blueprint_prior_art_deferred_with_marker_passes()
RED:     test_4_corner_blueprint_now_fails_without_prior_art_or_defer() (breaking-change assertion)
GREEN:   Add 5th tuple + emission logic
REFACTOR: None expected
VERIFY:  pytest .claude/skills/discover-confidence/tests/test_check_research_coverage.py -v
```

#### Acceptance Criteria
- [ ] 5th corner detected via regex
- [ ] `empty_corner_prior_art` emitted when missing + no DEFER marker
- [ ] DEFER-CORNER marker for prior_art works identically
- [ ] All 4 new tests pass
- [ ] Existing tests for 4 corners continue passing (refactor or add `prior_art` deferral to fixtures)

#### DoD
- [ ] Tests pass
- [ ] No regression in `run_blueprint_score.py` against existing fixtures (some may need DEFER-CORNER added — log in commit)

### T2.2.5 — Backfill `DEFER-CORNER: prior_art` in pre-v1.1 blueprints (EC-4 absorbed)

#### Objective
Insert `<!-- DEFER-CORNER: prior_art | predates cycle-discover.md v1.1 (2026-05-22); no retroactive web research scheduled — see plan discover-web-v0-1 -->` marker at the end of every blueprint enumerated by T0.1 EC-4 audit. Otherwise T2.2's 5th-corner enforcement causes legitimate existing blueprints to start emitting `empty_corner_prior_art` silently post-merge.

#### Evidence
Per EC-4 in `discover-web-v0-1-edge-cases-2026-05-25.md`: T2.2 is a breaking change for blueprints written under the 4-corner contract. The DEFER-CORNER marker is the cycle rule's honest way to acknowledge an intentionally-empty corner. Backfilling at the moment of breaking-change-landing keeps existing audit trail valid.

#### Files to edit
```text
.claude/knowledge-base/discoveries/blueprints/{slug}-blueprint.md — append DEFER-CORNER marker for each slug listed in T0.1 progress JSON
```

If T0.1's `existing_blueprints_needing_defer` list is empty, this task becomes a no-op — record `(no-op: no existing blueprints lack the prior_art corner)` in commit body and proceed.

#### Deep file dependency analysis
- These blueprints are consumed (in theory) by future re-scoring runs of `/discover-confidence`. After T2.2 lands, they'd fail with `empty_corner_prior_art`. Backfill makes them pass with a documented deferral rather than silent failure.
- No code dependency.

#### Deep Dives
**Marker placement:** at the END of each blueprint (after all content, before final `---` or EOF). The cycle-discover.md format allows DEFER-CORNER markers anywhere in the file (they're HTML comments). End-of-file is least intrusive.

**Marker text (verbatim — no template variables):**
```text
<!-- DEFER-CORNER: prior_art | predates cycle-discover.md v1.1 (2026-05-22); no retroactive web research scheduled — see plan discover-web-v0-1 -->
```

**Idempotency:** if a blueprint already contains a `DEFER-CORNER: prior_art` marker (rare but possible), skip — do NOT add a duplicate. Use `grep -q` before insert.

#### Tasks
1. Read `existing_blueprints_needing_defer` array from `.claude/knowledge-base/implementations/.progress-discover-web-v0-1.json`
2. For each path: verify file still lacks the marker (`! grep -q "DEFER-CORNER: prior_art" file`); skip if present
3. Append the verbatim marker as the last line of the file
4. Commit with body listing every backfilled file + slug

#### TDD
```text
RED:     test_blueprint_with_defer_corner_marker_passes_check_research_coverage() — fixture blueprint lacks prior_art section but HAS the marker; `check_research_coverage.py` does NOT emit `empty_corner_prior_art`
RED:     test_idempotent_backfill_does_not_duplicate_marker() — apply backfill twice; assert exactly one marker present
GREEN:   Implement append-if-missing logic in a `.claude/skills/discover-improve/scripts/backfill_defer_corner.py` (NEW; ~40 LoC)
REFACTOR: None expected
VERIFY:  pytest .claude/skills/discover-improve/tests/test_backfill_defer_corner.py -v
```

#### Acceptance Criteria
- [ ] If `existing_blueprints_needing_defer` is empty → task is no-op + commit body says so
- [ ] If non-empty → every listed blueprint has the verbatim marker appended exactly once
- [ ] Re-running `check_research_coverage.py` against the patched blueprints does NOT emit `empty_corner_prior_art`
- [ ] Idempotent: re-running the backfill is a no-op (does not duplicate markers)

#### DoD
- [ ] All RED tests pass
- [ ] Backfill commit lists every patched blueprint path
- [ ] If 0 blueprints needed backfill: this DoD is met trivially + audit note in commit confirms why

---

### T2.3 — Extend `check_blueprint_completeness.py` for 5th corner header

#### Objective
The completeness checker also enumerates mandatory sections. Add the 5th corner section header to its expected list.

#### Evidence
Sibling pattern to T2.2; same file shape.

#### Files to edit
```text
.claude/skills/discover-confidence/scripts/check_blueprint_completeness.py — modify
.claude/skills/discover-confidence/tests/test_check_blueprint_completeness.py — extend
```

#### Deep file dependency analysis
Same as T2.2.

#### Deep Dives
The completeness checker has a `MANDATORY_SECTIONS` list. Add 5th corner header.

#### Tasks
1. Add the 5th corner header to the mandatory sections list (or marker dict)
2. Update test fixtures if any

#### TDD
```text
RED:     test_blueprint_completeness_requires_5_corner_header()
GREEN:   Add section.
REFACTOR: None expected
VERIFY:  pytest .claude/skills/discover-confidence/tests/test_check_blueprint_completeness.py
```

#### Acceptance Criteria
- [ ] Section listed in MANDATORY_SECTIONS
- [ ] Test passes
- [ ] No regression

#### DoD
- [ ] Test passes; existing tests pass

---

## Phase 3: Skill prose + template updates (discover-plan + discover-execute)

**Objective:** Document the prior_art corner in user-facing skill prose + templates; instruct the halt-loop on WebSearch/WebFetch/snapshot protocol.

### T3.1 — `discover-plan/SKILL.md` + `discovery-plan-template.md` document prior_art corner

#### Objective
Update the skill prose to declare the 5th corner; add a `source:` field to the per-question table requiring `.claude/knowledge-base/references/{project}` OR `web`.

#### Evidence
`grep -l "prior_art\|prior-art\|priorArt" .claude/skills/discover-*/SKILL.md` returns nothing. Skill is still 4-corner-only.

#### Files to edit
```text
.claude/skills/discover-plan/SKILL.md — extend prose (Step 3, Step 4, Quality Rules)
.claude/skills/discover-plan/templates/discovery-plan-template.md — add 5th corner row + source column
```

#### Deep file dependency analysis
- SKILL.md is invoked when user runs `/discover-plan {slug}`. Template is the source of truth for plan shape.
- Downstream: `discover-edge-cases` + `discover-execute` consume plans authored from this template.

#### Deep Dives
**Step 3 expansion:** the 4-corner Mandatory section list becomes a 5-corner list. Add the prior_art corner with examples ("Does any mature lib already do BM25 indexing? Letta paper claims X — is X reproducible? Does Pinecone's metadata-filter pricing tier change our cost model?").

**Question budget:** keep at 5-10 total, but rebalance — `prior_art` corner caps at 3 (consistent with other corners' max-3 rule per cycle rule v1.1). 1-3 prior_art questions per plan typical.

**`source:` field:** new column in per-question table. Values: `.claude/knowledge-base/references/{project}` (local) OR `web` (will use WebSearch + WebFetch + snapshot). When source is `web`, the question's "Method" column MUST cite at least one expected domain from the allowlist (sanity gate; verified at confidence time).

#### Tasks
1. Read current `discover-plan/SKILL.md` (~200 LoC); identify insertion points
2. Add prior_art to the 4-corner enumeration (now 5)
3. Add `source:` field requirement to template
4. Update Quality Rules section with the new rule: "Every prior_art question MUST declare candidate sources (domains from allowlist)"
5. Add cross-reference to `cycle-discover.md § Versioning v1.1` for the prior_art rationale

#### TDD
```text
RED:     test_discovery_plan_template_has_5_corner_column()
RED:     test_discover_plan_skill_md_mentions_prior_art_and_source_field()
GREEN:   Edit files.
REFACTOR: None expected.
VERIFY:  pytest .claude/skills/discover-confidence/tests/test_discover_skill_prose_consistency.py
```

NEW test file: `test_discover_skill_prose_consistency.py` (~40 lines) reads the .md files and asserts substring presence — purely structural.

#### Acceptance Criteria
- [ ] `prior_art` mentioned in `discover-plan/SKILL.md` Step 3 and Step 4
- [ ] Template includes 5th corner + source column
- [ ] Cross-reference to cycle-discover.md v1.1 present
- [ ] Pass: markdown lint (n/a — no md lint configured)

#### DoD
- [ ] Test passes
- [ ] Manual smoke: can read the updated SKILL.md and understand prior_art expectations without prior context

### T3.2 — `discover-execute/SKILL.md` + halt-loop prompt + `blueprint-template.md` document WebSearch/WebFetch/snapshot protocol

#### Objective
The halt-loop iteration protocol expands from "iterate over `.claude/knowledge-base/references/`" to "iterate over `.claude/knowledge-base/references/` OR `web` per question source". Document the 7-step prior_art protocol (per D5).

#### Evidence
Same `grep` result — no skill mentions WebSearch.

#### Files to edit
```text
.claude/skills/discover-execute/SKILL.md — extend (likely +40-60 lines)
.claude/skills/discover-execute/prompts/*.md — extend halt-loop driver prompt (the file Claude reads each iteration)
.claude/skills/discover-execute/templates/blueprint-template.md — add 5th corner section
```

#### Deep file dependency analysis
- `prompts/*.md` is the file ralph-loop replays each iteration. The driver instruction must be self-contained per Inquebrável (the loop has no memory between iterations).
- `blueprint-template.md` defines the shape of the blueprint that `/discover-execute` writes; must include the 5th corner section header so `check_blueprint_completeness.py` (T2.3) finds it.

#### Deep Dives
**EC-5 absorbed — file-referenced halt-loop pattern is MANDATORY:**

The 7-step protocol below contains `bash grep` invocations + multi-line text with backticks. Inlining it as the `ralph-loop:ralph-loop` positional argument would trigger shell parse errors per `.claude/rules/loop-engine-convention.md § How to invoke ralph-loop:ralph-loop safely`. The 7-step protocol therefore lives ONLY inside `.claude/skills/discover-execute/prompts/{name}-prompt.md`; the `/discover-execute` SKILL.md MUST invoke ralph-loop with the file-referenced pattern:

```text
Read .claude/halt-loop-prompts/discover-execute-{slug}.md and follow its instructions for this halt-loop iteration.
```

Plus `--completion-promise 'BLUEPRINT_COMPLETE'` and `--max-iterations N`. This is non-negotiable; violating it = halt-loop fails to start (observed regression history per `loop-engine-convention.md`).

**7-step prior_art protocol (lives in `.claude/skills/discover-execute/prompts/{name}-prompt.md`, NEVER in ralph-loop arg):**
1. Pick a question whose `source:` field is `web`
2. Invoke `ToolSearch` with `select:WebSearch,WebFetch` to load deferred tool schemas
3. Call WebSearch with the question's keywords + a relevance hint (`site:arxiv.org` OR similar)
4. Choose the most relevant result URL; verify its host appears in `.claude/rules/discover-web-allowlist.txt` (via `Bash grep`)
5. If host not in allowlist: HALT this question; emit `<!-- BLOCKED: domain-not-in-allowlist -->` marker; pick another question OR ask user to add to allowlist
6. Call WebFetch on the URL; capture content
6.5. **EC-8 absorbed — ensure snapshot dir exists BEFORE write:** `Bash mkdir -p .claude/knowledge-base/discoveries/snapshots/{slug}/`. Idempotent; safe to run every iteration. Without this, the first snapshot per new slug fails with `FileNotFoundError`.
7. Compute sha256 of `{url}\n---\n{content}` per ADR D1; write snapshot file at `.claude/knowledge-base/discoveries/snapshots/{slug}/{sha256}.md` using D1 format (header lines 1-4 + body); ONLY THEN cite the URL in the blueprint

**Anti-pattern reinforcement:** the prompt MUST instruct: "NEVER cite a URL the WebSearch result did not return — no memory-based citations." (cycle rule v1.1 Anti-pattern #10).

**Blueprint template 5th corner section:**
```markdown
## Coverage Corner 5 — Prior Art

### {Question summary}
- **Source:** `web`
- **Domains queried:** {host1}, {host2}
- **Verdict (Rule 9):** `ADOPT` | `REJECT` | `DEFER`
- **Rationale:** {1-2 sentences}
- **Citations:** {URL + snapshot hash}
```

The `Verdict (Rule 9)` field is mandatory per D6 — emits `rule9_verdict_missing` cap if blank.

#### Tasks
1. Add 7-step protocol to halt-loop driver prompt
2. Add anti-pattern callouts (no memory citations, snapshot-first)
3. Extend `blueprint-template.md` with the 5th corner section template
4. Update SKILL.md prose to describe the new capability
5. Add cross-reference to `cycle-discover.md` v1.1 + this plan

#### TDD
```text
RED:     test_discover_execute_skill_mentions_websearch_and_snapshot()
RED:     test_halt_loop_prompt_includes_7_step_protocol()
RED:     test_blueprint_template_has_5_corner_section_with_verdict_field()
GREEN:   Edit files.
REFACTOR: None expected.
VERIFY:  pytest .claude/skills/discover-confidence/tests/test_discover_skill_prose_consistency.py -v
```

#### Acceptance Criteria
- [ ] SKILL.md mentions WebSearch + WebFetch + snapshot + allowlist
- [ ] Halt-loop prompt has 7-step protocol verbatim INCLUDING step 6.5 (`mkdir -p`)
- [ ] Halt-loop prompt has the "NEVER cite a URL WebSearch did not return" anti-pattern callout (cycle rule v1.1 #10)
- [ ] SKILL.md invokes ralph-loop with file-referenced pattern (NOT inline) per EC-5
- [ ] Blueprint template includes 5th corner section header (matches T2.3 regex)
- [ ] All 3 tests pass + 1 new test (EC-5/EC-8 absorption check below)

#### DoD
- [ ] Tests pass (including new `test_halt_loop_prompt_mentions_mkdir_step_6_5` per EC-8 + `test_skill_md_uses_file_referenced_ralph_loop_pattern` per EC-5)
- [ ] Manual smoke: re-read updated prompt; instructions are unambiguous and shell-safe per `.claude/rules/loop-engine-convention.md § How to invoke ralph-loop:ralph-loop safely`
- [ ] **EC-11 SHOULD TEST absorbed as DoD:** after T6.1 passes, run `/discover-execute` against a single-prior_art-question fixture plan + measure actual token consumption from Claude Code session log. Record the observation in the implementation contract. If consumption > 50k per question (vs the +30k estimate), file a followup `F-T5.1-1` to revise `token-budget.md` band. The measurement itself is mandatory; the followup is conditional.

---

## Phase 4: discover-improve Phase A URL handling

**Objective:** When `discover-confidence` emits URL hard caps, Phase A of `discover-improve` inserts honest BLOCKED markers (per D7); never auto-WebFetch or auto-allowlist.

### T4.1 — Extend `apply_fixes.py` to recognize URL hard cap IDs + insert sentinel markers

#### Objective
The deterministic Phase A of `discover-improve` reads `hard_caps_triggered` from a previous `discover-confidence` score and applies fixes. Today it handles `fabricated_citation` (for `.claude/knowledge-base/references/`). Extend for the 3 new URL caps per D7.

#### Evidence
`apply_fixes.py` exists at `.claude/skills/discover-improve/scripts/apply_fixes.py`. Sibling pattern proven.

#### Files to edit
```text
.claude/skills/discover-improve/scripts/apply_fixes.py — extend
.claude/skills/discover-improve/tests/test_apply_fixes.py — extend with 3 URL cap tests
```

#### Deep file dependency analysis
- Consumed by `discover-improve/SKILL.md` halt-loop prompt (Phase A invocation).
- Adding handlers for new cap IDs is additive — existing fix logic for `fabricated_citation` is preserved.

#### Deep Dives
**Per cap ID, the marker inserted:**
| Cap ID | Sentinel marker text |
|---|---|
| `fabricated_url_citation` | `<!-- BLOCKED: url-fabricated — no snapshot at expected path: snapshots/{slug}/{sha256}.md; re-run /discover-execute to regenerate OR remove this citation -->` |
| `domain_not_in_allowlist` | `<!-- BLOCKED: domain-not-in-allowlist — add {host} to .claude/rules/discover-web-allowlist.txt with rationale OR remove this citation -->` |
| `snapshot_missing_or_corrupt` | `<!-- BLOCKED: snapshot-corrupt — sha256 of file does not match expected; re-fetch via WebFetch OR remove this citation -->` |

**Anti-action:** the apply_fixes script SHALL NOT:
- Invoke WebFetch (would mask drift)
- Modify the allowlist file (would defeat audit)
- Modify the snapshot file content (would break hash)

These actions are explicit refusals — the human OR a fresh `/discover-execute` cycle iteration handles them.

**EC-6 absorbed — code-fence-aware insertion:**

URLs may appear inside `` ``` `` code fences as **documentation examples** (`curl https://example.com/api`, `import 'https://cdn.example/x'`). Those URLs are NOT factual citations and MUST NOT get BLOCKED markers inserted — the marker would (a) appear visibly in code output, (b) likely break the language's syntax for that fence (bash/python/json don't accept HTML comments mid-line).

Algorithm: pre-walk the blueprint to identify fence regions:

```python
def _identify_fence_ranges(content: str) -> list[tuple[int, int]]:
    """Return list of (start_line, end_line) tuples (1-indexed, inclusive) for
    every fenced code block. A fence opens on a line starting with ``` and
    closes on the next line starting with ``` at the same or zero indent.
    Nested fences not supported (markdown spec doesn't allow them anyway).
    """
    ranges = []
    lines = content.split('\n')
    in_fence = False
    fence_start = None
    for i, line in enumerate(lines, start=1):
        stripped = line.lstrip()
        if stripped.startswith('```'):
            if in_fence:
                ranges.append((fence_start, i))
                in_fence = False
                fence_start = None
            else:
                in_fence = True
                fence_start = i
    return ranges

def _line_is_inside_fence(line_no: int, fence_ranges: list[tuple[int, int]]) -> bool:
    return any(start <= line_no <= end for start, end in fence_ranges)
```

Before inserting any BLOCKED marker for a URL at line N, check `_line_is_inside_fence(N, fences)`. If True → skip insertion + log "skipped marker insertion for URL inside code fence at line N (likely documentation example, not citation)" so the implementer knows the cap wasn't silenced silently.

#### Tasks
1. Add 3 cap handler functions to `apply_fixes.py`
2. Each handler reads the score report (JSON) to find the offending URL + line number
3. Insert sentinel comment immediately above the line containing the URL
4. Each handler returns `True` (marker inserted) — fix is NOT considered "resolved" (the marker is the honest record, not a fix)
5. Update the main `apply_fixes()` orchestrator to dispatch on the new IDs

#### TDD
```text
RED:     test_fabricated_url_citation_inserts_sentinel_marker()
RED:     test_domain_not_in_allowlist_inserts_sentinel_marker()
RED:     test_snapshot_missing_inserts_sentinel_marker()
RED:     test_no_url_fix_invokes_webfetch() (negative — assert no network call)
RED:     test_url_in_code_fence_does_not_get_blocked_marker() (EC-6) — fixture with ``` curl https://off-allowlist.example ``` inside bash fence; assert NO marker inserted at that line + skip-log emitted
RED:     test_url_outside_fence_still_gets_marker_when_url_in_fence_also_present() (EC-6) — same URL appears once in fence + once in prose; assert marker on prose occurrence ONLY
GREEN:   Implement 3 handlers + dispatcher entries + fence-walk pre-pass
REFACTOR: Extract `_insert_blocked_marker_above_line()` + `_identify_fence_ranges()` + `_line_is_inside_fence()` as private helpers
VERIFY:  pytest .claude/skills/discover-improve/tests/test_apply_fixes.py -v
```

#### Acceptance Criteria
- [ ] All 3 cap IDs trigger marker insertion (in prose context)
- [ ] All 3 cap IDs are SKIPPED when URL is inside a `` ``` `` fence (with explicit skip-log per EC-6)
- [ ] Marker text matches D7 verbatim
- [ ] No WebFetch invocation (assertion via mock)
- [ ] No allowlist modification (assertion via mock)
- [ ] Existing `fabricated_citation` handler still works (regression)
- [ ] `_identify_fence_ranges` correctly handles 0, 1, multiple, and adjacent fences

#### DoD
- [ ] All RED + GREEN tests pass (6 total: 4 original + 2 EC-6)
- [ ] File size ≤ 300 LoC (currently ~150 estimated; +60 for fence logic)

---

## Phase 5: Docs + housekeeping

**Objective:** Update token-budget estimate; confirm `.gitignore` is correct; document the cross-references.

### T5.1 — Update `.claude/rules/token-budget.md` `/discover-execute` estimate

#### Objective
Bump the `/discover-execute` cost band by +30k tokens per active prior_art question (per cycle rule v1.1 § Downstream change #10).

#### Evidence
Current `token-budget.md` § `cycle-discover` shows `/discover-execute | 30-100k`. With 1-3 prior_art questions adding +30k each, new band: `30-190k` (30k base + max 3 questions × 30k each + ~70k for .claude/knowledge-base/references/ work).

#### Files to edit
```text
.claude/rules/token-budget.md — modify (1 row in cycle-discover table + 1 sentence in note)
```

#### Deep file dependency analysis
None — pure docs.

#### Deep Dives
Add a clarifying sentence: "When the discovery plan declares N prior_art questions (max 3), add +30k tokens per question to the upper bound — WebFetch + snapshot-write + Allowlist verification add overhead."

#### Tasks
1. Edit the `/discover-execute` row to show the new upper bound
2. Add the clarifying note
3. Update the "Full chain" row if needed

#### TDD
```text
RED:     None — pure docs change.
GREEN:   Edit file.
REFACTOR: None expected.
VERIFY:  Manual review — token-budget.md is human reference, no automated test.
```

#### Acceptance Criteria
- [ ] Estimate band updated
- [ ] Clarifying note present
- [ ] Cross-reference to cycle-discover.md v1.1 added

#### DoD
- [ ] Manual diff review confirms edit shape
- [ ] No regressions in sibling sections

### T5.2 — Verify `.gitignore` is already correct (no change needed; document the audit)

#### Objective
Cycle rule v1.1 § Downstream change #11 says "confirm snapshots/ IS committed (NOT gitignored). Allowlist IS committed." Already true at plan-drafting; just record the verification.

#### Evidence
```bash
$ grep "snapshots" .gitignore
(no match — confirmed NOT gitignored)
$ git ls-files .claude/knowledge-base/discoveries/snapshots/ | wc -l
5
```

#### Files to edit
```text
(none — verification only)
```

#### Deep file dependency analysis
None.

#### Tasks
1. Run the 2 verification commands above
2. Log result in implementation md

#### TDD
```text
RED:     None — verification only.
GREEN:   Run commands; log result.
REFACTOR: None.
VERIFY:  Bash commands return expected results.
```

#### Acceptance Criteria
- [ ] No new gitignore entry needed
- [ ] Verification logged

#### DoD
- [ ] Audit note in commit body

---

## Phase 6: Integration Validation (MANDATORY)

**Objective:** End-to-end smoke test — write a fixture blueprint with one valid + one fabricated URL citation, run `run_blueprint_score.py`, assert verdict is INVALID with both new stable IDs in `hard_caps_triggered`. This is the THE GOAL metric for this plan.

### T6.1 — Golden-fixture end-to-end smoke test

#### Objective
Demonstrate the full chain works: a blueprint with mixed valid/invalid URL citations produces the expected verdict.

#### Evidence
The Goal metric of this plan IS this test passing.

#### Files to edit
```text
.claude/skills/discover-confidence/tests/fixtures/blueprints/url_citations/mixed_valid_invalid.md (NEW)
.claude/skills/discover-confidence/tests/fixtures/snapshots/url_citations_smoke/{sha256_for_valid_url}.md (NEW)
.claude/skills/discover-confidence/tests/test_run_blueprint_score_url_smoke.py (NEW)
```

#### Deep file dependency analysis
Integration of all Phase 1-4 work. If any phase regressed, this smoke test catches it.

#### Deep Dives
**Fixture blueprint shape (mixed_valid_invalid.md):**
- Sections: all 5 corners populated
- 3 URL citations:
  1. `https://arxiv.org/abs/2304.03442` — allowlisted, snapshot exists, sha256 matches (VALID)
  2. `https://made-up-fake.example/x` — off-allowlist (should trigger `domain_not_in_allowlist`)
  3. `https://arxiv.org/abs/9999.99999` — allowlisted but no snapshot file present (should trigger `snapshot_missing_or_corrupt`)
- 1 referencia citation that exists (regression — old behavior preserved)

**Expected verdict:** `INVALID` with `hard_caps_triggered` containing BOTH `domain_not_in_allowlist` AND `snapshot_missing_or_corrupt`. Final score capped at 49.

#### Tasks
1. Write the fixture blueprint (~80 lines markdown)
2. Write the 1 valid snapshot file (~30 lines markdown matching D1 format)
3. Write the smoke test that imports `run_blueprint_score` and asserts verdict + ID list
4. Run `pytest .claude/skills/discover-confidence/tests/test_run_blueprint_score_url_smoke.py -v`

#### TDD
```text
RED:     test_mixed_valid_invalid_blueprint_returns_invalid_verdict()
RED:     test_mixed_valid_invalid_blueprint_lists_both_stable_ids()
RED:     test_mixed_valid_invalid_blueprint_final_score_capped_at_49()
RED:     test_mixed_valid_invalid_blueprint_valid_referencia_citation_still_counted() (regression)
RED:     test_mixed_blueprint_url_metrics_counted_positively() (EC-12) — assert result["url_citations_total"] == 3, result["url_citations_allowlisted"] == 2, result["url_citations_snapshotted"] == 1
GREEN:   Fixture exists + smoke test passes
REFACTOR: None expected
VERIFY:  pytest .claude/skills/discover-confidence/tests -v
```

#### Acceptance Criteria
- [ ] Verdict == INVALID
- [ ] Both stable IDs appear in `hard_caps_triggered`
- [ ] Final score == 49 (capped)
- [ ] Existing .claude/knowledge-base/references/ citation still counted (regression)
- [ ] EC-12 positive metrics: 3 total URLs, 2 allowlisted, 1 fully snapshotted (the others fail at different gates)
- [ ] Test runtime < 5 seconds (deterministic, no network)

#### DoD
- [ ] Smoke test passes
- [ ] No network calls during test (verified via mock or `--no-network` env)
- [ ] Full pytest suite passes: `pytest .claude/skills/discover-confidence/tests` AND `pytest .claude/skills/discover-improve/tests`

### T6.2 — Full validation chain

#### Objective
Run all skill-level tests + lint + manual review of all touched files.

#### Files to edit
```text
(none — verification chain)
```

#### Deep file dependency analysis
None — pure validation.

#### Tasks
1. `pytest .claude/skills/discover-confidence/tests -v` — all green
2. `pytest .claude/skills/discover-improve/tests -v` — all green
3. `npm test` + `npm run typecheck` + `npm run lint` — ensure no TS/JS regression (we touched no `.ts` files; should be no-op)
4. Manual review of CHANGELOG.md entry per Inquebrável Rule 6
5. Manual review of file sizes (all under 500 LoC budget per `architecture.md § Module hygiene`)

#### TDD
```text
RED:     None — verification phase.
GREEN:   All commands return success.
REFACTOR: None.
VERIFY:  All commands above.
```

#### Acceptance Criteria
- [ ] Discover-confidence pytest suite: all green
- [ ] Discover-improve pytest suite: all green
- [ ] TS suites: still green (no regression — sanity)
- [ ] CHANGELOG.md updated under `[Unreleased]` with discover-web v0.1 entry
- [ ] All touched files ≤ 500 LoC

#### DoD
- [ ] All assertions pass
- [ ] Implementation md updated with all task SHAs
- [ ] Plan archived to `.claude/knowledge-base/plans/completed/` after `/review` returns READY_TO_MERGE + PR merged

---

## Coverage Matrix

| # | Cycle-discover.md v1.1 § Downstream item OR edge-case absorption | Task(s) | Resolution |
|---|---|---|---|
| 1 | `discover-plan-golden-rule.md` — 5 corners + URL fab + allowlist + snapshot stable IDs | T1.1 | Add 5 hard cap rules + 3 soft caps + table rows |
| 2 | `discover-blueprint-golden-rule.md` — same expansions | T1.2 | Mirror T1.1 for blueprint sibling |
| 3 | `discover-plan-thresholds.txt` + `discover-blueprint-thresholds.txt` — bump sunset + cite v1.1 ADR | T1.3 | Replace `YOUR_ADR_REF` + bump sunset |
| 4 | `discover-web-allowlist.txt` — NEW FILE with seed | (already shipped 2026-05-22 + 2026-05-23) | Verified in T0.1 — no action |
| 5 | `discover-plan/SKILL.md` + template — declare prior_art questions | T3.1 | Update SKILL.md prose + template column |
| 6 | `discover-execute/SKILL.md` + halt-loop prompt — wire WebSearch/WebFetch | T3.2 | Add 7-step protocol + blueprint template 5th section |
| 7 | `check_reference_citations.py` — extend for URL + snapshot | T2.1 | Add URL regex + allowlist + snapshot + sha256 logic |
| 8 | `check_research_coverage.py` — recognize 5th corner | T2.2 | Add 5th tuple to CORNER_PATTERNS |
| 8b | `check_blueprint_completeness.py` — recognize 5th corner header | T2.3 | Add 5th corner to MANDATORY_SECTIONS |
| 9 | `discover-improve/` Phase A — handle URL markers | T4.1 | Extend `apply_fixes.py` with 3 cap handlers |
| 10 | `token-budget.md` — bump `/discover-execute` estimate | T5.1 | +30k per prior_art question |
| 11 | `.gitignore` — confirm snapshots/ IS committed | T5.2 | Verified — no change needed |
| 12 | Integration smoke test (THE GOAL metric) | T6.1 | Golden-fixture end-to-end test |
| 13 | Full validation | T6.2 | pytest + lint + CHANGELOG |
| 14 | **EC-4 absorption — backfill `DEFER-CORNER: prior_art` in pre-v1.1 blueprints** | T2.2.5 | Append verbatim marker to each blueprint enumerated in T0.1 audit |

**Coverage: 14/14 items (100%)**

## Edge-case absorption traceability (v1.1)

| EC | Severity | Absorbed in | Mechanism |
|---|---|---|---|
| EC-1 | MUST FIX | T2.1 Deep Dives + new test `test_url_strips_trailing_sentence_punctuation` | `_canonicalize_url_match()` helper + post-strip step |
| EC-2 | MUST FIX | ADR D1 + T0.1 verification step #4 | `_extract_snapshot_body()` + `_compute_snapshot_sha256()` algorithms specified verbatim |
| EC-3 | MUST FIX | T2.1 Deep Dives + new test `test_check_urls_live_total_budget_caps_at_30s_offline` | `_check_urls_live()` with `LIVE_CHECK_TOTAL_BUDGET_SEC = 30` |
| EC-4 | MUST FIX | T0.1 step #5 + new T2.2.5 + Dependency Graph ordering invariant | Audit + backfill DEFER-CORNER marker |
| EC-5 | MUST FIX | T3.2 Deep Dives + new test `test_skill_md_uses_file_referenced_ralph_loop_pattern` | File-referenced halt-loop pattern callout |
| EC-6 | MUST FIX | T4.1 Deep Dives + new tests `test_url_in_code_fence_does_not_get_blocked_marker` + `test_url_outside_fence_still_gets_marker_when_url_in_fence_also_present` | `_identify_fence_ranges()` + skip-if-in-fence |
| EC-7 | MUST FIX | T0.1 step #3 acceptance | Accept placeholder count ∈ `{0, 4}` |
| EC-8 | MUST FIX | T3.2 7-step protocol step 6.5 + new test `test_halt_loop_prompt_mentions_mkdir_step_6_5` | `mkdir -p` before snapshot write |
| EC-9 | SHOULD TEST → DoD | T2.1 new test `test_url_with_query_string_hashes_differently_from_bare_url` | Test ensures query string is hashed |
| EC-10 | SHOULD TEST → DoD | T2.1 new test `test_url_trailing_slash_hashes_differently` | Test ensures trailing slash matters |
| EC-11 | SHOULD TEST → DoD | T3.2 DoD measurement step | Mandatory token-consumption observation after T6.1; conditional followup `F-T5.1-1` |
| EC-12 | SHOULD TEST → DoD | T6.1 new test `test_mixed_blueprint_url_metrics_counted_positively` | Asserts positive URL metrics dict shape |
| EC-13 | SHOULD TEST → DoD | T2.1 new test `test_load_allowlist_strips_cr_line_endings` | Allowlist loader strips CR |
| EC-14 | DOCUMENT | Context § Accepted risks | snapshot sha256 cost accepted |
| EC-15 | DOCUMENT | Context § Accepted risks | discover-plan-confidence absent — golden rule still load-bearing via blueprint sibling |

**Total: 8 MUST FIX + 5 SHOULD TEST + 2 DOCUMENT = 15 edge cases absorbed (100% of edge-case review report)**

## Global Definition of Done

- [ ] All phases (0-6) completed
- [ ] All tests passing — `pytest .claude/skills/discover-confidence/tests` + `pytest .claude/skills/discover-improve/tests` + `npm test` (sanity for TS suite)
- [ ] Zero TypeScript errors — `npm run typecheck` (sanity — no TS changed)
- [ ] Zero lint warnings — `npm run lint` (sanity — no TS changed)
- [ ] File-size budget respected — every touched file ≤ 500 lines (`architecture.md § Module hygiene`)
- [ ] CHANGELOG.md updated under `[Unreleased]` with one Added entry referencing this plan slug + the 11 downstream items closed (Inquebrável Rule 6)
- [ ] Backward compatibility preserved — existing `.claude/knowledge-base/references/` citation extraction unchanged; existing 4-corner blueprints either pass with explicit DEFER-CORNER OR fail with `empty_corner_prior_art` (breaking change documented in commit body)
- [ ] Runtime-metric proof — T6.1 smoke test demonstrates verdict==INVALID with both new stable IDs observed in `hard_caps_triggered` JSON output (the runtime metric is this test passing)
- [ ] Plan archived — after `/review` returns `READY_TO_MERGE` AND the PR has been merged to `main`, move `.claude/knowledge-base/plans/discover-web-v0-1-plan.md` to `.claude/knowledge-base/plans/completed/discover-web-v0-1-plan.md` per `audit-trail-rotation.md`
- [ ] Cycle-discover.md v1.1 § Downstream block updated — strike through items 1-11 OR add a "DONE 2026-MM-DD" annotation per item; do NOT remove the change-log entry (audit trail)

## Final Phase: Integration Validation (MANDATORY)

> This phase runs AFTER all implementation phases are complete. The plan is NOT done until the integration validation chain passes.

**Objective:** Validate that the implemented changes work in a real workload — the golden-fixture end-to-end test in T6.1 IS the integration validation. Phase 6 already covers this; this section reinforces the gate.

### Execution

```bash
pytest .claude/skills/discover-confidence/tests -v
pytest .claude/skills/discover-improve/tests -v
npm test
npm run typecheck
npm run lint
```

### Acceptance Criteria

- [ ] All pytest suites green
- [ ] All npm suites green (sanity — no TS changes)
- [ ] T6.1 smoke test verdict==INVALID with both new stable IDs (THE GOAL metric)
- [ ] No flaky tests — re-run pytest 3× consecutively; all 3 runs identical

### If Validation Fails

1. Identify whether failure is caused by this plan's changes vs pre-existing (Phase 0 audit baseline)
2. Fix all plan-caused failures before declaring complete
3. Re-run the validation chain
4. Pre-existing issues logged in PR description but do NOT block plan completion

---

**End of plan.**

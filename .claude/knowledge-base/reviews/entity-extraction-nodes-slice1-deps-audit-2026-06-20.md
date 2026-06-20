# Deps-Audit — entity-extraction-nodes-slice1

Date: 2026-06-20
Plan: `.claude/knowledge-base/plans/entity-extraction-nodes-slice1-plan.md`
Verdict: **PASS** (no CRITICAL/HIGH/MEDIUM CVE; declared + version-pinned + Rule-9-evaluated)

## Declared dependencies (from plan § Dependencies)

| Package | Declared range | Type | On registry? | Resolved | License | Deprecated? |
|---|---|---|---|---|---|---|
| `compromise` | `^14.0.0` | OPTIONAL (lazy `require`, regex fallback) | YES (npm) | `14.15.1` (satisfies `^14.0.0`) | MIT | No |

## CVE check

- **OSV API** (`api.osv.dev/v1/query`, npm/compromise@14.15.1, 2026-06-20): `{}` — zero advisories.
- **npm audit** (`--package-lock-only` on a throwaway manifest with `compromise@^14.0.0`): `vulnerabilities: {}` — zero.
- Result: **no CRITICAL / HIGH / MEDIUM / LOW CVE**.

## Rule 9 evaluation (Não Reinvente)

- **Alternatives considered:** spaCy (Python — wrong runtime, rejected per CLAUDE.md Amendment 2026-06-20), `wink-nlp` (heavier model deps), `natural` (older, less maintained), regex-only (insufficient for compound/proper-noun typing).
- **Selected:** `compromise` — it is the exact lib Mem0's TS implementation uses (`.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/utils/entity_extraction.ts`), pure-JS (no native build), MIT, actively maintained (latest 14.15.1), small transitive footprint.
- **Encapsulation:** wrapped behind the `EntityExtractor` DIP (plan ADR D1) — swappable per DIP; lazy-loaded so absence degrades to regex fallback (no hard runtime dependency).

## Soft gates

- Lockfile drift / stale-deps / multiple-lockfiles: N/A (single new optional dep; lockfile updated at install time in `/implement`).

## Notes

- Version pin is a caret range `^14.0.0` (declared in plan). Acceptable: compromise follows semver; majors are infrequent. The DIP boundary contains blast radius if a future major changes the API.
- As an OPTIONAL dep with a regex fallback, even a future advisory can be mitigated by not installing it (the extractor still works in degraded mode) — a favorable supply-chain posture.

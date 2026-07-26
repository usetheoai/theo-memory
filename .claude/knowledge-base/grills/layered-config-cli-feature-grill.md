---
slug: layered-config-cli
generated_by: roadmap-feature
milestone_id: M25
date: 2026-07-26
status: completed
---

# Grill — M25 Layered config + `themory config` CLI

## Q1 — What & why now
Full LAYERED config resolution (deep-merge: defaults → `~/.themory/config.json` global →
`./.themory.json` project → env (THEOMEM_PG_URI, OPENAI_*, THEMORY_OIDC_*, …) → CLI flags)
PLUS a `themory config init/set/get/list` subcommand (init writes a commented `.themory.json`;
get/list resolve + show the source layer; secrets masked in `list`).
**Why now:** clearest mem0-parity gap (mem0's CLI has config; ours does not) + highest
operator-ergonomics ROI (Configuration was the lowest cross-validation dimension, 2.5/5).
Centralizes config that is today scattered across many env vars.

## Q2 — Dependencies
depends_on: the consolidated `themory` CLI (shipped, M18-era). All milestones are [x], so
no real blocker — M25 extends the CLI + feeds the factory/server/mcp. Can start now.

## Q3 — Definition of Done (5 bullets)
1. `loadConfig()` deep-merges defaults→global→project→env→flags; PRECEDENCE unit-tested (env>project, flag>env).
2. `themory config init/set/get/list` works; get/list show the SOURCE layer of each key.
3. ≥1 real consumer wired (e.g. `themory server` resolves THEOMEM_PG_URI via loadConfig).
4. SECRETS: `config list` masks; `config set` refuses secret keys to the file (env-only, ADR D4 precedent).
5. Unit (precedence) + integration (CLI round-trip) tests green; CHANGELOG updated.

## Q4 — Top 2 new risks
R1 (HIGH) Secret leakage: `.themory.json` could store an API key in plaintext + get committed.
  Mitigation: `config set` refuses secret keys (env-only, ADR D4); `config list` masks; `init` warns/gitignores.
R2 (MED) Precedence confusion: a file value silently overriding a deliberate env (or vice versa).
  Mitigation: `config get`/`list` ALWAYS show the resolved source layer; precedence tested + documented.

## SOTA delta
No new peers — mem0 (`cli/python/src/mem0_cli/config.py` + per-component config classes) and
memsearch (`config.py:357` layered resolution) are already cloned references. Existing set sufficient.

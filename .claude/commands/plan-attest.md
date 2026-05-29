---
description: "Compute SHA256 of the active plan file and persist it to .claude/.attestations/{slug}.sha256. Subsequent UserPromptSubmit hooks validate the live plan against this hash; mismatch blocks injection (tamper defense)."
disable-model-invocation: true
allowed-tools: "Bash Read"
---

Attest a plan file: compute SHA256 and store under `.claude/.attestations/{slug}.sha256`.

Steps:

1. Parse the argument. If the user passes a slug, use that. If empty, resolve the active plan:
   - Prefer `${PLAN_SLUG}` env var if set
   - Then `.claude/.active_plan` pointer file contents
   - Then newest file in `.claude/knowledge-base/plans/*-plan.md` by mtime
2. Run `bash .claude/scripts/attest-plan.sh {slug}` to write the hash atomically (temp file + rename).
3. Print confirmation: `attested {slug} -> {hash}`.
4. Remind the user: "Any future edit to `.claude/knowledge-base/plans/{slug}-plan.md` will cause the next UserPromptSubmit hook to block injection. Re-run `/plan-attest {slug}` after intentional edits to refresh the hash."

If the slug cannot be resolved AND no plans exist, refuse with "no plans found".

If the user wants to attest ALL plans at once: `/plan-attest --all` (forwards to `attest-plan.sh --all`).
If the user wants to verify (read-only) without rewriting: `/plan-attest --verify {slug}`.

## Why this exists

Plan files are read by the UserPromptSubmit hook on every prompt. Without
attestation, an attacker who could write to disk (or social engineering) could
inject instructions into the plan that the agent would treat as context. The
SHA256 stored under `.claude/.attestations/` is the trust anchor: only edits
the user EXPLICITLY approves (by re-running `/plan-attest`) refresh the hash.
All other edits are surfaced as "PLAN TAMPERED" and the plan content is NOT
injected into context until the user approves.

Inspired by planning-with-files v2.43.0's attest-plan.sh + UserPromptSubmit
attestation flow. The implementation under `.claude/scripts/attest-plan.sh`
uses atomic temp-rename + optional `flock` for parallel-session safety.

## Notes

- Attestation files are NOT committed to git (added to `.gitignore` automatically when first hash is written).
- Plan-confidence and other deterministic scorers do NOT consult attestation — they read the file fresh; attestation only affects the UserPromptSubmit injection path.
- If a plan is mass-updated by a tool (e.g., `/plan-improve` halt-loop), the operator should re-attest at the end of the loop.

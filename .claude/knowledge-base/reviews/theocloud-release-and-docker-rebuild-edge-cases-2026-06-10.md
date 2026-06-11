# Edge Case Review — theocloud-release-and-docker-rebuild

Date: 2026-06-10
Tasks analyzed: 5
Edge cases found: 8 (MUST FIX: 3, SHOULD TEST: 3, DOCUMENT: 2)

## MUST FIX

### EC-1: Docker Hub `if` guard uses `env.DOCKERHUB_TOKEN` but secrets are not exposed as env vars
- **Affected task:** T2.2
- **Family:** Permission / Integration
- **Scenario:** The plan's pseudo-code uses `if: env.DOCKERHUB_TOKEN != ''` but GitHub Actions secrets are NOT automatically available as env vars — they're available as `secrets.DOCKERHUB_TOKEN`. Using `env.` will always evaluate to empty string, silently skipping Docker Hub publish even when the secret is configured.
- **Impact:** Docker Hub publish never fires despite correct secret configuration. Silent failure — the operator believes dual-publish is active but only GHCR receives images.
- **Suggested fix:** Use `if: secrets.DOCKERHUB_TOKEN != ''` OR define an env mapping at job level: `env: DOCKERHUB_TOKEN: ${{ secrets.DOCKERHUB_TOKEN }}` and then reference `env.DOCKERHUB_TOKEN` in steps. The former is simpler.

### EC-2: Docker Hub push rebuilds the image instead of pushing the pre-scanned image
- **Affected task:** T2.2
- **Family:** State / Integration
- **Scenario:** The plan's pseudo-code shows a second `docker/build-push-action@v6` for Docker Hub. This rebuilds the image from scratch, producing a DIFFERENT image digest than the one Trivy scanned. The image pushed to Docker Hub was never scanned — it bypasses the Trivy gate.
- **Impact:** Security contract violation — Trivy scans image A, but image B (a second build) is pushed to Docker Hub. Layer caching makes them LIKELY identical but NOT guaranteed (e.g., npm install could resolve a different transitive version if the registry updated between builds).
- **Suggested fix:** Build once with `load: true`, scan it, then push the SAME image to both registries. Use `docker tag themory:scan-target ghcr.io/usetheo/themory:$TAG` + `docker tag themory:scan-target docker.io/usetheo/themory:$TAG` + `docker push` for each. OR use a single `docker/build-push-action` with multiple tags spanning both registries.

### EC-3: Compose file `THEMORY_IMAGE` default still points to GHCR-only after T2.1 edit
- **Affected task:** T2.1
- **Family:** State / Format
- **Scenario:** T2.1 only bumps `0.1.0-alpha` to `0.2.0` but the compose file default remains `ghcr.io/usetheo/themory:${VERSION:-0.2.0}` — pointing at GHCR. Per D1, Docker Hub is now the primary discoverability path. An operator following the README (which T3.2 changes to `usetheo/themory:0.2.0`) and then running `docker compose up` will pull from GHCR (compose default) while the README tells them Docker Hub. Not a crash but a consistency gap.
- **Impact:** Confusing divergence between README primary registry (Docker Hub) and compose default (GHCR). Operators may report "README says X, compose pulls from Y".
- **Suggested fix:** Either (a) change compose default to `docker.io/usetheo/themory:${VERSION:-0.2.0}` to match README, OR (b) document explicitly that compose defaults to GHCR while `docker pull` examples use Docker Hub. Option (a) is cleaner — 1-line edit.

## SHOULD TEST

### EC-4: `gh pr create` fails if theo-cloud remote is not the expected org
- **Affected task:** T1.1
- **Suggested test:** Before `gh pr create`, verify `gh repo view --json nameWithOwner -q .nameWithOwner` matches expected `usetheo/theo-cloud`. Abort with clear message if the remote points elsewhere (fork, personal copy).

### EC-5: `0.1.0-alpha` string survives in non-Docker README sections
- **Affected task:** T3.2
- **Suggested test:** `test_no_stale_alpha_refs` — after T3.2, `grep -c '0.1.0-alpha' README.md` MUST return 0. Plan's validation already includes this, but a pre-commit check would catch partial edits. The current README has exactly 2 occurrences (lines 180, 185) — verify both are replaced.

### EC-6: `themory keys rotate` may not exist as a distinct subcommand
- **Affected task:** T3.1
- **Suggested test:** Verify `themory keys rotate --help` actually works before documenting it. Item 20 acceptance mentions `rotate` in the CLI, but if the rotate subcommand is actually `revoke` + `create` (no atomic rotate), the docs should document the 2-step manual pattern, not a non-existent `rotate` command.

## DOCUMENT

### EC-7: Docker Hub org creation is a manual prerequisite with no automated check
- **Accepted risk:** T2.2's `if` guard degrades gracefully (GHCR-only publish if Docker Hub secrets missing), but there's no CI job that WARNS the operator the Docker Hub publish was skipped. First few releases could silently publish to GHCR-only without anyone noticing the Docker Hub path is dead. Acceptable because: the plan already documents this in Drawbacks & Risks and T2.2 Deep Dives. A follow-up could add a `docker pull usetheo/themory:$TAG` smoke step, but it's out of scope for this operational plan.

### EC-8: `edge` tag published on main push accumulates unbounded images on GHCR
- **Accepted risk:** Each push to `main` creates a new `sha-<short>` tagged image on GHCR. Over time this accumulates storage. Docker Hub is not affected (only stable tags per D2). GHCR's free tier for public repos has no storage limit currently. Acceptable for pre-release; lifecycle policy can be added later.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 0 | 1 | 0 |
| T2.1 | 1 | 1 | 0 | 0 |
| T2.2 | 4 | 2 | 0 | 2 |
| T3.1 | 1 | 0 | 1 | 0 |
| T3.2 | 1 | 0 | 1 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT

The 3 MUST FIX items are all low-effort fixes (EC-1: change `env.` to `secrets.`; EC-2: use single build + multi-tag push; EC-3: update compose default registry). None require new modules or significant rework.

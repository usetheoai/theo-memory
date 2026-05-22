# Changelog

## [Unreleased]

### Added

- Implementation plan `memory-contract-v0-0-plan.md` v1.2 for Roadmap Item 1 (v0.0 Contract design). Five phases, 14 tasks, 9 ADRs (D1-D9 ratifying CLAUDE.md locked decisions + resolving Open questions Q2-Q6). Coverage Matrix 31/31. Verdict via `/plan-confidence`: SHIPPABLE 100/100.
- Audit trail for cycle-plan v1.1 run: edge-case review (11 edges absorbed v1.0 → v1.1), `/deps-audit` report (FAIL_MEDIUM → 2 bumps absorbed v1.1 → v1.2 → re-audit PASS), `/plan-confidence` report.

### Status

Pre-release. v0.0 contract plan validated; v0.0 implementation pending via `/implement` halt-loop on feature branch `feat/memory-contract-v0-0`.

### Known issues

- v0.1 readiness gate: verify `npm view @usetheo/memory` returns 404 or is owned by the `@usetheo` npm org, and that the publish auth token is provisioned. Not a v0.0 task; flagged for v0.1 implementation kickoff (per plan T0.1 DoD + EC-11 absorption).

# Follow-ups — dogfood-unified-journey-suite (do NOT expand task scope; log for later)

## From SEPA pre-COMMIT T1.1 (test-hardening, not correctness gaps)
- [ ] T1.1: add secret off-by-one boundary fixtures — 19-char after `theo_live_` (allowed) / 20-char (rejected) — to pin `{20,}` inclusivity.
- [ ] T1.1: add a `bad_date` malformed-date evidence fixture (currently the `bad_date` fail-closed path is untested).

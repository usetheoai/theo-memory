/**
 * Derive the 500-conversation DMR subset from the upstream MSC dataset.
 *
 * Drift-T7.2-1 placeholder: real MSC fetch + filter + transform pipeline
 * is deferred to a follow-up cycle. This placeholder documents the
 * intended interface so T8.1 v0.8.md reproducibility runbook can cite
 * the script path.
 *
 * Expected interface when shipped:
 *   `node benchmarks/scripts/derive-dmr-subset.ts --msc-path ... --out ...`
 *
 * Reproduces the REDACTED paper subset selection (sessions 1-5 windowing,
 * 500-conversation slice).
 *
 * @see plan v1.2 § T7.2 + ADR D2
 */

export const PLACEHOLDER_NOTICE =
  'derive-dmr-subset.ts is a placeholder; real MSC → DMR derivation deferred to follow-up cycle';

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  console.log(PLACEHOLDER_NOTICE);
  console.log('When implemented, this script will:');
  console.log('  1. Fetch the MSC dataset from upstream');
  console.log('  2. Apply the REDACTED 500-conversation selection criteria');
  console.log('  3. Write the derived JSON to the path specified by --out');
  process.exit(0);
}

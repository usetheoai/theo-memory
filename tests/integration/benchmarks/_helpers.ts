/**
 * Env-gated `describe` helpers for vendor integration tests.
 *
 * Per plan v1.3 § Phase 4 / T4.1 + blueprint R4 (env-gate canonical), each
 * vendor integration test file uses a `describeMem0 / describeZep /
 * describeLetta` wrapper that gates the entire suite on the corresponding
 * `_API_KEY` env var presence. Without the key, vitest reports the block
 * as SKIPPED (clean exit code 0); with the key, the block runs against
 * the real SaaS endpoint.
 *
 * This pattern keeps CI-without-secrets viable for forks (per EC-14
 * documented risk) while preserving real-boundary validity for cron CI
 * on main + manual local-dev runs.
 *
 * EC-8 pre-flight: vitest 4 retains `describe.skip` as the canonical
 * conditional-skip mechanism (the ternary `cond ? describe : describe.skip`
 * pattern works in any vitest >= 0.x).
 */
import { describe } from 'vitest';

export const describeMem0 = process.env.MEM0_API_KEY ? describe : describe.skip;
export const describeZep = process.env.ZEP_API_KEY ? describe : describe.skip;
export const describeLetta = process.env.LETTA_API_KEY ? describe : describe.skip;

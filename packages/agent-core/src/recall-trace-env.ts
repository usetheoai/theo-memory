/**
 * @internal Recall-trace env resolution for the agent-tools subpath (CLI/MCP/REST).
 * NOT part of the public `@usetheo/memory/agent-tools` API surface (re-exported
 * from `agent-tools-memory.ts` for the shared composition root).
 *
 * One SRP module for the three `THEOMEM_RECALL_TRACE*` env knobs so the shared
 * Memory factory stays under the module-size budget (architecture.md § 3):
 *   - enabled flag        (`THEOMEM_RECALL_TRACE`)
 *   - per-workspace opt-out (`THEOMEM_RECALL_TRACE_DISABLED_WORKSPACES`)
 *   - retention window    (`THEOMEM_RECALL_TRACE_MAX_AGE_SECONDS`)
 *
 */

/**
 * explainable-recall-read S2 (/review F-arch-1) — opt-in accountable-forgetting
 * recall tracing, wired at a single shared site so server + MCP + CLI honor one
 * `THEOMEM_RECALL_TRACE` flag. Default OFF → no `recallTrace` → recall() writes no
 * `recall_traces` rows (byte-unchanged) AND the paired REST read route is not mounted.
 * When `true`, the write (the shared factory) + the read port (run-server's
 * createServer) are enabled together so `GET /v1/recall-traces/:recallId` returns data.
 */
export function resolveRecallTraceEnabled(): boolean {
  return process.env['THEOMEM_RECALL_TRACE'] === 'true';
}

/**
 * explainable-recall M4 governance (FX1 /review M4-R1) — operator-reachable
 * per-workspace opt-out. Parses `THEOMEM_RECALL_TRACE_DISABLED_WORKSPACES` as a
 * CSV of workspace ids: each such workspace writes ZERO trace rows even when
 * tracing is enabled (fail-closed at the write gate, in-memory, no per-recall DB
 * read). Unset/empty → `[]` (no workspace opted out). Whitespace + empty entries
 * are trimmed/dropped so `"wsA, , wsB "` → `['wsA','wsB']`.
 */
export function resolveRecallTraceDisabledWorkspaces(): readonly string[] {
  const raw = process.env['THEOMEM_RECALL_TRACE_DISABLED_WORKSPACES'];
  if (raw === undefined || raw.trim() === '') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Default recall-trace retention window when the env is unset: 30 days. */
export const DEFAULT_RECALL_TRACE_MAX_AGE_SECONDS = 2_592_000;

/**
 * explainable-recall M4 governance (FX2 /review M4-R2) — parse + VALIDATE the
 * retention window. An unvalidated `Number(env)` is a full-table-wipe footgun: a
 * negative value flips the sweep predicate to `NOW() + interval` (matches every
 * row across every tenant); NaN throws on every tick (silent no-run → unbounded
 * growth). Unset → the 30-day default. An explicitly-set NON-positive / non-finite
 * value is a fail-fast startup error (error-handling.md § 2), never a silent wipe.
 *
 * @throws {RangeError} when the env is set but not a positive finite number.
 */
export function resolveRecallTraceMaxAgeSeconds(): number {
  const raw = process.env['THEOMEM_RECALL_TRACE_MAX_AGE_SECONDS'];
  if (raw === undefined || raw.trim() === '') return DEFAULT_RECALL_TRACE_MAX_AGE_SECONDS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new RangeError(
      `THEOMEM_RECALL_TRACE_MAX_AGE_SECONDS must be a positive finite number of seconds; got ${JSON.stringify(raw)}`,
    );
  }
  return n;
}

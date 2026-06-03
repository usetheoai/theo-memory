/**
 * Health endpoints: `/v1/health` (readiness) + `/v1/health/db` (liveness).
 *
 * - EC-16 (document): no caching; query-each-time. Acceptable for low-frequency
 *   probes. Honest disclosure: a future cycle MAY add caching if probe cost
 *   grows.
 * - EC-17: `/v1/health/db` wraps `dbProbe` in 2s timeout via `Promise.race`.
 *   When `dbProbe` is not provided (no consumer wiring), returns 503 — the
 *   composition root MUST inject the probe (per ADR D11 DIP discipline,
 *   `src/server/` does not import `pg`).
 */
import type { Context } from 'hono';

const DB_PROBE_TIMEOUT_MS = 2_000;

export function healthHandler(
  c: Context,
  readinessProbe?: () => boolean,
): Response {
  // EC-33 absorption (T2.3): when the composition root injects a readiness
  // probe (typically: "Memory factory finished warming"), return 503 while
  // the probe returns false. Avoids "container says healthy but Memory not
  // ready" race during cold-start before `themory server` is wired in K8s
  // with a readinessProbe pointing here. When no probe injected (legacy
  // composition roots without warm-up async), fall through to 200.
  if (readinessProbe !== undefined && !readinessProbe()) {
    return c.json({ status: 'unavailable', reason: 'warming_up' }, 503);
  }
  return c.json({ status: 'ok' }, 200);
}

export async function healthDbHandler(
  c: Context,
  dbProbe: (() => Promise<void>) | undefined,
): Promise<Response> {
  if (dbProbe === undefined) {
    return c.json({ status: 'unavailable', reason: 'no_probe_configured' }, 503);
  }
  try {
    await Promise.race([
      dbProbe(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('db_probe_timeout')), DB_PROBE_TIMEOUT_MS),
      ),
    ]);
    return c.json({ status: 'ok' }, 200);
  } catch {
    return c.json({ status: 'unavailable' }, 503);
  }
}

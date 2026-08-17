/**
 * @internal Server process-lifecycle for `themory server` — the listener error
 * handler + idempotent graceful shutdown. Extracted from `run-server.ts` (SRP,
 * architecture.md § 3): composing/binding the server is one responsibility;
 * reacting to OS signals + draining resources on exit is another.
 *
 * Preserves the EC-32 idempotent-shutdown guard and adds the M4 drain (FX5
 * /review M4-R5): the retention cron is stopped AND its in-flight sweep awaited
 * before the pg pool closes, so a mid-DELETE tick never hits a closing pool.
 */

/** The subset of the http listener the lifecycle needs. */
export interface ServerListenerLike {
  close: (cb?: (err?: Error) => void) => void;
  on?: (event: string, cb: (err: NodeJS.ErrnoException) => void) => void;
}

export interface ServerLifecycleDeps {
  readonly listener: ServerListenerLike;
  readonly port: number;
  /** pg pool — closed last, after the listener + retention cron drain. */
  readonly pool: { end: () => Promise<void> };
  /** M4 retention cron handle; `stop()` drains the in-flight tick (FX5). */
  readonly retentionCron?: { stop: () => Promise<void> };
  /**
   * The cross-workspace pool the retention sweep runs on, when one exists.
   * Separate from `pool` because it authenticates as a different role; closed
   * in the same order for the same reason — after the cron has drained.
   */
  readonly workerPool?: { end: () => Promise<void> };
  /** Max ms to wait for the listener to close before forcing shutdown (EC-32). */
  readonly shutdownTimeoutMs: number;
}

/**
 * Wire the listener EADDRINUSE/error handler + register SIGTERM/SIGINT graceful
 * shutdown. Returns the (idempotent) shutdown function for callers/tests.
 */
export function installServerLifecycle(deps: ServerLifecycleDeps): () => void {
  const { listener, port, pool, retentionCron, workerPool, shutdownTimeoutMs } = deps;

  if (listener.on !== undefined) {
    listener.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        process.stderr.write(`themory server: Port ${String(port)} already in use\n`);
        process.exit(1);
        return;
      }
      process.stderr.write(`themory server: listen error: ${err.message}\n`);
      process.exit(1);
    });
  }

  // EC-32 idempotent shutdown — guard against double-fire.
  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void (async () => {
      try {
        await Promise.race([
          new Promise<void>((resolve, reject) => {
            listener.close((err) => (err !== undefined ? reject(err) : resolve()));
          }),
          new Promise<void>((resolve) => setTimeout(resolve, shutdownTimeoutMs)),
        ]);
        await retentionCron?.stop(); // M4 FX5 — drain the in-flight sweep before the pool closes
        await workerPool?.end();
        await pool.end();
      } finally {
        process.exit(0);
      }
    })();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return shutdown;
}

/**
 * Bounded-concurrency async map for the e2e-qa harness. LongMemEval examples are
 * fully scope-isolated (`memory.user('lme_<question_id>')`), so processing several
 * at once is data-safe and produces the SAME per-example scores as serial — it only
 * cuts wall-clock (the full 500-question run is LLM-extraction-bound). Serial is the
 * default (limit=1); a limit > 1 is what makes the full run feasible.
 */

/**
 * Run `fn` over `items` with at most `limit` promises in flight. Results preserve the
 * input order (result[i] ↔ items[i]). Any rejection propagates (fail-loud) — a
 * throttled/failed example must not be silently dropped from the benchmark.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const width = Math.max(1, Math.min(Math.trunc(limit), items.length || 1));
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: width }, () => worker()));
  return results;
}

/**
 * Run `fn`; on throw, return `onError(message)` instead of propagating. For the
 * benchmark this converts a single example's recall/answer/judge failure (a
 * transient 5xx, a context-length overflow on one huge conversation) into a
 * scored miss with an `error` field — one bad example never aborts a 500-question
 * run. The message is stringified defensively (Error → .message, else String()).
 */
export async function runSafely<R>(
  fn: () => Promise<R>,
  onError: (message: string) => R,
): Promise<R> {
  try {
    return await fn();
  } catch (err) {
    return onError(err instanceof Error ? err.message : String(err));
  }
}

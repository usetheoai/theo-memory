/**
 * Deterministic hash + Fisher-Yates helpers shared by the v0.4b integration
 * test fixtures. Closes F-tests-1 + F-tests-2 MAJOR.
 *
 * The previous shipped fixtures used `Math.random().toString(36).slice(2)`
 * as a hash suffix to defend against UNIQUE-constraint collisions when test
 * rows leaked across runs. That defense made the test seeds non-reproducible:
 * a flake at test run N could not be reproduced at test run N+1 because the
 * hash inputs differed across runs.
 *
 * v0.4b-fixes T11.2 replaces the `Math.random()` suffix with a
 * deterministic counter scoped to the test run (per-fixture-call hash
 * counter). Combined with the existing test-prefix conventions
 * (`h-t7-1-cluster-`, `h-t4-1-`, etc.), the hash space stays unique within a
 * test AND reproducible across runs.
 *
 * Fisher-Yates with a seeded RNG replaces the
 * `Array.sort(() => Math.random() - 0.5)` shape used in the eval runner
 * (`tests/eval/forgetting/run.ts`). The seeded shuffle produces
 * byte-identical permutations for the same seed (EC-8 absorption).
 *
 * @see .claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md § T11.2
 */

/**
 * Linear Congruential Generator with the Numerical Recipes constants.
 * Seeded RNGs are sufficient for deterministic test fixtures + the eval
 * runner's random-baseline shuffle. NOT cryptographically secure; never use
 * for security-sensitive paths.
 */
export function makeSeededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/**
 * Returns a Fisher-Yates-shuffled copy of `input`, using the seeded RNG.
 * Same seed → byte-identical output across runs (EC-8 absorption).
 */
export function shuffleDeterministic<T>(input: readonly T[], seed: number): T[] {
  const rng = makeSeededRandom(seed);
  const out = [...input];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    const swap = out[j];
    if (tmp === undefined || swap === undefined) continue;
    out[i] = swap;
    out[j] = tmp;
  }
  return out;
}

/**
 * Creates a stateful per-test-run hash counter. The returned function emits
 * a stable string suffix (`prefix-N`) for each call where N increases
 * monotonically from 0. Different counter instances are independent.
 */
export function makeHashCounter(prefix: string): () => string {
  let n = 0;
  return () => {
    const s = `${prefix}-${String(n)}`;
    n++;
    return s;
  };
}

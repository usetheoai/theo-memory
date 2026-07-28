/**
 * M25 T1.1 — pure layered-config resolver.
 *
 * Deep-merges ordered config layers (defaults → global → project → env → flags)
 * into a single `{ value, source }` pair. Later layers win; every resolved key
 * records which layer name supplied its winning value (source-attribution — the
 * reason M25 hand-rolls this instead of using cosmiconfig/conf, plan ADR-1).
 *
 * PURE — no fs / os / env / Date / Math.random. Deterministic given its input.
 * The I/O (reading the files, mapping env) lives in the infrastructure loader
 * (`packages/core/src/infrastructure/config/load.ts`) per architecture.md § 2.
 *
 */

/** One config source. Higher index in the array wins on conflict. */
export interface ConfigLayer {
  readonly name: string;
  readonly values: Record<string, unknown>;
}

/** Resolved config: merged values + per-key winning-layer attribution. */
export interface ResolvedConfig {
  /** The merged key → value map. */
  readonly value: Record<string, unknown>;
  /** Per top-level key, the name of the layer that supplied the winning value. */
  readonly source: Record<string, string>;
}

/** A plain (non-array, non-null) object — the only shape we recurse into. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Recursively merge `incoming` onto `base`, returning a NEW object (base is not
 * mutated). Two plain objects at the same key merge; any other pairing (array,
 * primitive, object-vs-primitive) replaces — the incoming value wins.
 */
function deepMerge(
  base: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(incoming)) {
    const next = incoming[key];
    const prev = out[key];
    out[key] = isPlainObject(prev) && isPlainObject(next) ? deepMerge(prev, next) : next;
  }
  return out;
}

/**
 * Resolve ordered layers into `{ value, source }`. Layers are applied left→right;
 * the last layer that sets a key wins its value AND its source attribution.
 */
export function resolveConfig(layers: readonly ConfigLayer[]): ResolvedConfig {
  let value: Record<string, unknown> = {};
  const source: Record<string, string> = {};
  for (const layer of layers) {
    value = deepMerge(value, layer.values);
    for (const key of Object.keys(layer.values)) {
      source[key] = layer.name;
    }
  }
  return { value, source };
}

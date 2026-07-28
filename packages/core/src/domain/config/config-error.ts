/**
 * M25 T2.1 — typed config-parse error.
 *
 * Lives in its own module (not the shared `domain/errors.ts`, which is already
 * at the 300-LoC file-size ceiling) but follows the identical error-class
 * pattern: a stable `name` literal + `Object.setPrototypeOf` so `instanceof`
 * survives ESM/CJS + dynamic-import boundaries.
 *
 * Thrown when a layered-config file (`~/.themory/config.json` or
 * `./.themory.json`) exists but cannot be read/parsed (malformed JSON, or an
 * unreadable/permission-denied read). Fail-loud at the config boundary
 * (Rule 8): a corrupt config MUST NOT degrade to a silent empty `{}` — the
 * operator would unknowingly run on defaults. The offending `path` is named in
 * the message and carried as a field; the underlying error is preserved via
 * `cause`.
 *
 */
export class ConfigParseError extends Error {
  override readonly name = 'ConfigParseError' as const;

  readonly path: string;

  constructor(path: string, cause: unknown) {
    super(
      `Failed to parse config file ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.path = path;
    Object.setPrototypeOf(this, ConfigParseError.prototype);
  }
}

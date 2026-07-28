/**
 * M25 T1.2 — pure secret predicate + mask.
 *
 * The security line (plan ADR-3): secret keys are NEVER written to a config
 * file (env-only) and their values are masked in `config get` / `config list`
 * output. Both the CLI (refuse-on-set, mask-on-print) and the loader (drop
 * file-sourced secrets) consume this predicate.
 *
 * PURE — no fs / os / env / Date / Math.random.
 *
 */

/**
 * A key is secret when it contains KEY / SECRET / TOKEN / PASSWORD / BOOTSTRAP
 * (case-insensitive). Matches the measured secret surface: OPENAI_API_KEY,
 * THEMEMORY_API_KEY, THEMORY_OIDC_CLIENT_SECRET, THEMORY_ADMIN_BOOTSTRAP_TOKEN,
 * THEOMEM_MIGRATE_TOKEN, etc. (plan Baseline Context § Config surface).
 */
const SECRET_KEY_PATTERN = /KEY|SECRET|TOKEN|PASSWORD|BOOTSTRAP/i;

/** True when `key` names a secret whose value must never be persisted to a file. */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

/** Fixed mask that leaks NO character of the original secret value. */
export function maskSecret(_value: string): string {
  return '••••';
}

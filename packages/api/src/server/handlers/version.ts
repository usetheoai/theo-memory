/**
 * Build/version metadata endpoint: `GET /v1/version` (auth-exempt).
 *
 * Surfaces the package identity plus the build-time provenance injected via
 * env (`THEOMEM_VERSION` / `THEOMEM_GIT_SHA` / `THEOMEM_BUILD_TIME`) so a
 * deployed image can report exactly which commit + build it is running. All
 * three fall back to honest sentinels (`dev` / `unknown`) when not wired, and
 * `node` reflects the live runtime. Env is read via bracket notation per the
 * repo's `noUncheckedIndexedAccess` strictness.
 *
 * @see Plan claude-code-memory-integration-plan § M6 T1.1
 */
import type { Context } from 'hono';

export function versionHandler(c: Context): Response {
  return c.json(
    {
      name: '@usetheo/memory',
      version: process.env['THEOMEM_VERSION'] ?? 'dev',
      git_sha: process.env['THEOMEM_GIT_SHA'] ?? 'unknown',
      built_at: process.env['THEOMEM_BUILD_TIME'] ?? 'unknown',
      node: process.version,
    },
    200,
  );
}

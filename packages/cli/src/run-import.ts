/**
 * `themory import claude-code` composition root (M12 T1.2, blueprint D1/D2).
 *
 * Thin runner over the DETERMINISTIC migrator (`./import/migrate-claude-code.mjs` — the M6 T2.1
 * pipeline: parse → fail-closed scrub → map → chunked batch, dry-run default). This runner ONLY
 * resolves flags + endpoint/token, then delegates; it never re-implements pipeline logic.
 *
 * Endpoint/token precedence (D2 — zero-config on kit machines):
 *   1. `THEOMEM_MIGRATE_URL` / `THEOMEM_MIGRATE_TOKEN`   (explicit override, back-compat)
 *   2. `THEOMEM_MEMORY_URL` (+ `THEOMEM_MEMORY_PATH_PREFIX`) / `THEOMEM_MEMORY_TOKEN`  (env)
 *   3. the same keys parsed from `~/.claude/theo-memory.env`  (the kit's config file)
 *   4. the migrator's built-in default (http://127.0.0.1:8080)
 *
 * Mirrors the kit's `theo-lib.mjs` resolution shape so the CLI and the hooks agree on where the
 * memory lives. Reads NOTHING at module load (env-free `--help` boot preserved).
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ImportClaudeCodeOptions {
  readonly commit?: boolean;
  readonly source?: string;
}

/** Parse the kit env file (`KEY=VALUE` lines; `#` comments ignored). Missing file → {}. */
export function parseKitEnvFile(path: string): Record<string, string> {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

/** Resolve `{ url, token }` per the D2 precedence. Pure given (env, fileVars) — unit-testable. */
export function resolveImportEndpoint(
  env: Record<string, string | undefined>,
  fileVars: Record<string, string>,
): { url: string | undefined; token: string | undefined } {
  // 1. Explicit migrate override.
  if (env['THEOMEM_MIGRATE_URL'] !== undefined && env['THEOMEM_MIGRATE_URL'] !== '') {
    return { url: env['THEOMEM_MIGRATE_URL'], token: env['THEOMEM_MIGRATE_TOKEN'] || undefined };
  }
  // 2/3. Kit-shape resolution: env wins over the file, per key (theo-lib.mjs precedence).
  const base = env['THEOMEM_MEMORY_URL'] || fileVars['THEOMEM_MEMORY_URL'] || '';
  const prefix = env['THEOMEM_MEMORY_PATH_PREFIX'] || fileVars['THEOMEM_MEMORY_PATH_PREFIX'] || '';
  const token = env['THEOMEM_MEMORY_TOKEN'] || fileVars['THEOMEM_MEMORY_TOKEN'] || undefined;
  if (base !== '') {
    return { url: `${base.replace(/\/+$/, '')}${prefix}`, token };
  }
  // 4. Neither configured → let the migrator use its built-in default.
  return { url: undefined, token };
}

export async function runImportClaudeCode(opts: ImportClaudeCodeOptions): Promise<void> {
  const fileVars = parseKitEnvFile(join(homedir(), '.claude', 'theo-memory.env'));
  const { url, token } = resolveImportEndpoint(process.env, fileVars);
  if (url !== undefined) process.env['THEOMEM_MIGRATE_URL'] = url;
  if (token !== undefined && (process.env['THEOMEM_MIGRATE_TOKEN'] ?? '') === '') {
    process.env['THEOMEM_MIGRATE_TOKEN'] = token;
  }
  const argv: string[] = [];
  if (opts.commit === true) argv.push('--commit');
  if (opts.source !== undefined) argv.push('--source', opts.source);
  // Lazy-load the engine (keeps `--help` boot free of fs walks).
  const { main } = (await import('./import/migrate-claude-code.mjs')) as {
    main: (argv?: string[]) => Promise<void>;
  };
  await main(argv);
}

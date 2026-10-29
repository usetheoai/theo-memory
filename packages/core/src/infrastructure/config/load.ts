/**
 * M25 T2.1 + T2.2 — layered-config file helpers + `loadConfig` composition.
 *
 * INFRASTRUCTURE (architecture.md § 2): the only place that touches fs/env. The
 * pure resolver + secret predicate live in `domain/config/`. `loadConfig`
 * composes the five layers — defaults → global file → project file → env →
 * flags — via `resolveConfig` (later wins; ADR-2 precedence).
 *
 * SECRET DISCIPLINE (ADR-3): secret keys are NEVER sourced from a file. File
 * layers are stripped of secret keys before composition, so a committed
 * `.themory.json` carrying `OPENAI_API_KEY` is inert — secrets are env-only.
 *
 * Cwd/home/env are INJECTED (defaulting to process.cwd()/os.homedir()/
 * process.env) so tests drive real temp dirs without global-state coupling.
 *
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { ConfigParseError } from '../../domain/config/config-error.js';
import { resolveConfig, type ConfigLayer, type ResolvedConfig } from '../../domain/config/resolve.js';
import { isSecretKey } from '../../domain/config/secrets.js';

const GLOBAL_DIR = '.themory';
const GLOBAL_FILE = 'config.json';
const PROJECT_FILE = '.themory.json';

/**
 * The config-relevant env keys (plan Baseline Context § Config surface). The env
 * layer is filtered to THESE keys only — process.env holds thousands of unrelated
 * vars; config resolution must not slurp them. Files may carry any non-secret key.
 */
export const KNOWN_CONFIG_KEYS: readonly string[] = [
  // non-secret
  'THEOMEM_PG_URI',
  'THEOMEM_WORKER_PG_URI',
  'THEOMEM_MEMORY_JOBS',
  'OPENAI_CHAT_MODEL',
  'OPENAI_BASE_URL',
  'THEMORY_BASE_URL',
  'THEMORY_CORS_ORIGIN',
  'THEMORY_OIDC_ISSUER',
  'HOST',
  'PORT',
  'NODE_ENV',
  'EMBEDDING_DIM',
  'THEMEMORY_REQUIRE_CREDENTIAL',
  'THEMEMORY_ALLOW_DESTRUCTIVE_DIM_CHANGE',
  'THEMEMORY_SKIP_MIGRATIONS',
  // secret (env-only)
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'VOYAGE_API_KEY',
  'THEMEMORY_API_KEY',
  'THEOMEM_MIGRATE_TOKEN',
  'THEMORY_OIDC_CLIENT_SECRET',
  'THEMORY_ADMIN_BOOTSTRAP_TOKEN',
];

/** Absolute path of the global config file for a given home dir. */
export function globalConfigPath(home: string): string {
  return join(home, GLOBAL_DIR, GLOBAL_FILE);
}

/** Absolute path of the project config file for a given cwd. */
export function projectConfigPath(cwd: string): string {
  return join(cwd, PROJECT_FILE);
}

/** Read + parse a JSON config file. Missing → `{}`; anything else → typed error. */
function readJsonFile(path: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    // Unreadable / permission-denied — fail loud, never a silent empty.
    throw new ConfigParseError(path, err);
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      // Valid JSON but not an object (array/primitive/null) — fail LOUD, not a silent
      // `{}`; a config file must be a JSON object so an operator sees the real mistake.
      throw new ConfigParseError(path, new Error('config file must be a JSON object'));
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new ConfigParseError(path, err);
  }
}

/** Read the global config file (`~/.themory/config.json`). Missing → `{}`. */
export function readGlobalConfig(home: string = homedir()): Record<string, unknown> {
  return readJsonFile(globalConfigPath(home));
}

/** Read the project config file (`./.themory.json`). Missing → `{}`. */
export function readProjectConfig(cwd: string = process.cwd()): Record<string, unknown> {
  return readJsonFile(projectConfigPath(cwd));
}

/** Persist `values` to the project config file as pretty JSON (overwrites). */
export function saveProjectConfig(cwd: string, values: Record<string, unknown>): void {
  // Defense-in-depth (ADR-3): NEVER persist a secret to the file, even if one was
  // hand-edited into it — stripping on save purges an accidentally-added secret
  // rather than rewriting it verbatim.
  const safe = stripSecrets(values);
  mkdirSync(cwd, { recursive: true });
  writeFileSync(projectConfigPath(cwd), `${JSON.stringify(safe, null, 2)}\n`, 'utf8');
}

/** Drop secret keys — file layers must never contribute a secret value (ADR-3). */
function stripSecrets(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(values)) {
    if (!isSecretKey(key)) out[key] = values[key];
  }
  return out;
}

/** Build the env layer from the KNOWN config keys present in `env`. */
function envLayer(env: Record<string, string | undefined>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of KNOWN_CONFIG_KEYS) {
    const v = env[key];
    if (v !== undefined) out[key] = v;
  }
  return out;
}

export interface LoadConfigOptions {
  /** CLI flags — the highest-precedence layer. */
  readonly flags?: Record<string, unknown>;
  /** Working dir for the project file. Defaults to `process.cwd()`. */
  readonly cwd?: string;
  /** Home dir for the global file. Defaults to `os.homedir()`. */
  readonly home?: string;
  /** Env map. Defaults to `process.env`. */
  readonly env?: Record<string, string | undefined>;
}

/**
 * Compose the five config layers into `{ value, source }`. Precedence low→high:
 * defaults → global file → project file → env → flags. File layers are stripped
 * of secret keys (ADR-3). A malformed file fails loud (ConfigParseError).
 */
export function loadConfig(opts: LoadConfigOptions = {}): ResolvedConfig {
  const cwd = opts.cwd ?? process.cwd();
  const home = opts.home ?? homedir();
  const env = opts.env ?? process.env;

  const layers: ConfigLayer[] = [
    { name: 'defaults', values: {} },
    { name: 'global', values: stripSecrets(readGlobalConfig(home)) },
    { name: 'project', values: stripSecrets(readProjectConfig(cwd)) },
    { name: 'env', values: envLayer(env) },
    { name: 'flags', values: opts.flags ?? {} },
  ];
  return resolveConfig(layers);
}

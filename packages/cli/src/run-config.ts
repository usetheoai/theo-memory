/**
 * `themory config` subcommand orchestrator — M25 T3.1.
 *
 * The operator surface for the layered-config resolver:
 *   - `themory config init`          — write a skeleton `./.themory.json` (non-secret keys)
 *   - `themory config set <k> <v>`   — persist a non-secret key to the project file
 *   - `themory config get <k>`       — print a resolved value + its winning source layer
 *   - `themory config list`          — print every resolved key = value (source: layer)
 *
 * Security line (ADR-3): `set` REFUSES secret keys (env-only); `get`/`list` mask
 * secret values. Mirrors the `run-keys.ts` context/injection shape. cwd/home/env
 * are injected for testability against temp dirs.
 *
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

import {
  loadConfig,
  readProjectConfig,
  saveProjectConfig,
  projectConfigPath,
  isSecretKey,
  maskSecret,
  KNOWN_CONFIG_KEYS,
} from '@usetheo/memory/config';
import type { Command } from 'commander';

export interface RunConfigContext {
  /** Project working dir (holds `.themory.json`). */
  readonly cwd: string;
  /** Home dir (holds `~/.themory/config.json`). */
  readonly home: string;
  /** Env map used for resolution. */
  readonly env: Record<string, string | undefined>;
  /** Injection seam for tests; defaults to process.stdout.write. */
  readonly writeStdout?: (s: string) => void;
  /** Injection seam for tests; defaults to process.stderr.write. */
  readonly writeStderr?: (s: string) => void;
}

function io(ctx: RunConfigContext): { stdout: (s: string) => void; stderr: (s: string) => void } {
  return {
    stdout: ctx.writeStdout ?? ((s) => process.stdout.write(s)),
    stderr: ctx.writeStderr ?? ((s) => process.stderr.write(s)),
  };
}

/** Non-secret config keys — the init skeleton surface (secrets are env-only). */
function nonSecretKeys(): string[] {
  return KNOWN_CONFIG_KEYS.filter((k) => !isSecretKey(k));
}

/** Render one resolved key line, masking secret values. */
function renderKey(key: string, value: unknown, source: string): string {
  const shown = isSecretKey(key) ? maskSecret(String(value)) : String(value);
  return `${key} = ${shown} (source: ${source})\n`;
}

export function runConfigInit(ctx: RunConfigContext): number {
  const { stdout, stderr } = io(ctx);
  const path = projectConfigPath(ctx.cwd);
  if (existsSync(path)) {
    stderr(`config init: ${path} already exists — refusing to overwrite.\n`);
    return 1;
  }
  const skeleton: Record<string, unknown> = {
    _comment:
      'themory config — non-secret keys only. Secrets (API keys / tokens / passwords) are env-only; set the environment variable instead. Precedence: defaults < this file < ~/.themory/config.json < env < CLI flags.',
  };
  for (const key of nonSecretKeys()) skeleton[key] = '';
  saveProjectConfig(ctx.cwd, skeleton);
  stdout(`Wrote config skeleton to ${path}\n`);
  return 0;
}

export function runConfigSet(ctx: RunConfigContext, key: string, value: string): number {
  const { stdout, stderr } = io(ctx);
  if (isSecretKey(key)) {
    stderr(
      `config set: '${key}' is a secret key — secrets are env-only and are NEVER written to a file. ` +
        `Set the environment variable ${key} instead.\n`,
    );
    return 1;
  }
  const current = readProjectConfig(ctx.cwd);
  current[key] = value;
  saveProjectConfig(ctx.cwd, current);
  stdout(`Set ${key} in ${projectConfigPath(ctx.cwd)}\n`);
  return 0;
}

export function runConfigGet(ctx: RunConfigContext, key: string): number {
  const { stdout, stderr } = io(ctx);
  const { value, source } = loadConfig({ cwd: ctx.cwd, home: ctx.home, env: ctx.env });
  if (!(key in value)) {
    stderr(`config get: '${key}' is not set.\n`);
    return 1;
  }
  stdout(renderKey(key, value[key], source[key] ?? 'unknown'));
  return 0;
}

export function runConfigList(ctx: RunConfigContext): number {
  const { stdout } = io(ctx);
  const { value, source } = loadConfig({ cwd: ctx.cwd, home: ctx.home, env: ctx.env });
  const keys = Object.keys(value).sort();
  if (keys.length === 0) {
    stdout('No config set.\n');
    return 0;
  }
  for (const key of keys) stdout(renderKey(key, value[key], source[key] ?? 'unknown'));
  return 0;
}

/** Build the runtime config context from the process (cwd/home/env). */
function processConfigCtx(): RunConfigContext {
  return { cwd: process.cwd(), home: homedir(), env: process.env };
}

/**
 * Register the `themory config init/set/get/list` command group on `program`.
 * Kept here (not inlined in cli.ts) so the router stays thin — the config
 * surface is one cohesive module (SRP).
 */
export function registerConfigCommand(program: Command): void {
  const config = program
    .command('config')
    .description(
      'Manage layered config (precedence: defaults < ~/.themory/config.json < ./.themory.json < env < flags).',
    );
  config
    .command('init')
    .description('Write a ./.themory.json skeleton (non-secret keys; refuses to overwrite).')
    .action(() => process.exit(runConfigInit(processConfigCtx())));
  config
    .command('set <key> <value>')
    .description('Persist a non-secret key to ./.themory.json (secret keys refused — env-only).')
    .action((key: string, value: string) => process.exit(runConfigSet(processConfigCtx(), key, value)));
  config
    .command('get <key>')
    .description('Print a resolved value and its source layer (secrets masked).')
    .action((key: string) => process.exit(runConfigGet(processConfigCtx(), key)));
  config
    .command('list')
    .description('Print every resolved key = value (source: layer); secrets masked.')
    .action(() => process.exit(runConfigList(processConfigCtx())));
}

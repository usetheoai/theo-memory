/**
 * M7 regression — the kit must reach the gateway using the DOCUMENTED configuration.
 *
 * `THEOMEM_MEMORY_PATH_PREFIX` was read only from `process.env`, while `loadEnv()`
 * parses `~/.claude/theo-memory.env` and returned just `{url, token}` — the prefix key
 * was parsed and then dropped. Both the README and the env example tell users to set it
 * *in that file*, so anyone following the gateway instructions got an empty prefix,
 * posted to theo-memory's raw REST path, and got nothing: `post()` fails soft and
 * returns null, so the misconfiguration was silent.
 *
 * Talking to the gateway is not cosmetic — it is what strips the client credential and
 * injects a per-tenant one downstream (CWE-441). A silently-ignored prefix means the
 * kit keeps sending the user's key straight to the service.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KIT_LIB = new URL(
  '../../../docs/claude-code-kit/hooks/theo-lib.mjs',
  import.meta.url,
).href;

let home: string;
const savedHome = process.env.HOME;

/** Writes a `~/.claude/theo-memory.env` exactly as install.sh + the docs describe. */
function writeEnvFile(lines: string[]): void {
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'theo-memory.env'), `${lines.join('\n')}\n`);
}

/** Fresh module instance per call — loadEnv reads HOME at call time, but be explicit. */
async function loadEnv(): Promise<{ url: string; token: string | null; pathPrefix: string }> {
  const mod = (await import(`${KIT_LIB}?t=${Math.random()}`)) as {
    loadEnv: () => { url: string; token: string | null; pathPrefix: string };
  };
  return mod.loadEnv();
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'theo-kit-home-'));
  process.env.HOME = home;
  delete process.env.THEOMEM_MEMORY_URL;
  delete process.env.THEOMEM_MEMORY_TOKEN;
  delete process.env.THEOMEM_MEMORY_PATH_PREFIX;
});

afterEach(() => {
  process.env.HOME = savedHome;
  delete process.env.THEOMEM_MEMORY_PATH_PREFIX;
  rmSync(home, { recursive: true, force: true });
});

describe('claude-code kit — gateway path prefix (M7)', () => {
  it('reads the prefix from the env file, as the docs instruct', async () => {
    writeEnvFile([
      'THEOMEM_MEMORY_URL=https://app-dev.usetheo.dev',
      'THEOMEM_MEMORY_PATH_PREFIX=/v1/memory',
    ]);

    const env = await loadEnv();

    // Pre-fix this was '' — the documented gateway setup did nothing.
    expect(env.pathPrefix).toBe('/v1/memory');
    expect(env.url).toBe('https://app-dev.usetheo.dev');
  });

  it('lets the environment override the file, matching url/token precedence', async () => {
    writeEnvFile(['THEOMEM_MEMORY_PATH_PREFIX=/v1/memory']);
    process.env.THEOMEM_MEMORY_PATH_PREFIX = '/v1/other';

    expect((await loadEnv()).pathPrefix).toBe('/v1/other');
  });

  it('leaves the prefix empty when unset, so raw-REST setups are unaffected', async () => {
    writeEnvFile(['THEOMEM_MEMORY_URL=http://127.0.0.1:8080']);

    expect((await loadEnv()).pathPrefix).toBe('');
  });

  it('strips a trailing slash so the joined path has no double separator', async () => {
    writeEnvFile(['THEOMEM_MEMORY_PATH_PREFIX=/v1/memory/']);

    expect((await loadEnv()).pathPrefix).toBe('/v1/memory');
  });
});

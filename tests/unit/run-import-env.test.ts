/**
 * M12 T1.2 — `themory import claude-code` endpoint/token resolution (blueprint D2).
 * Precedence: THEOMEM_MIGRATE_* override → THEOMEM_MEMORY_* env → kit env file → undefined (module default).
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { parseKitEnvFile, resolveImportEndpoint } from '../../packages/cli/src/run-import.js';

const dir = mkdtempSync(join(tmpdir(), 'm12-env-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('M12 import endpoint resolution (D2 precedence)', () => {
  it('test_migrate_env_override_wins', () => {
    const r = resolveImportEndpoint(
      { THEOMEM_MIGRATE_URL: 'http://x:1', THEOMEM_MEMORY_URL: 'http://y:2' },
      { THEOMEM_MEMORY_URL: 'http://z:3' },
    );
    expect(r.url).toBe('http://x:1');
  });

  it('test_memory_env_beats_kit_file_and_returns_path_prefix_separately', () => {
    // theo-lib parity (issue #109 live E2E): the gateway REWRITES /v1/memory/X → /v1/X, so the
    // prefix must NOT be baked into the base url (that yields /v1/memory/v1/remember/batch →
    // rewritten /v1/v1/... → 404). The caller composes `prefix + verb-path-without-/v1`.
    const r = resolveImportEndpoint(
      { THEOMEM_MEMORY_URL: 'https://env.example/', THEOMEM_MEMORY_PATH_PREFIX: '/v1/memory', THEOMEM_MEMORY_TOKEN: 't-env' },
      { THEOMEM_MEMORY_URL: 'https://file.example', THEOMEM_MEMORY_TOKEN: 't-file' },
    );
    expect(r.url).toBe('https://env.example'); // trailing slash stripped, prefix NOT baked in
    expect(r.pathPrefix).toBe('/v1/memory');
    expect(r.token).toBe('t-env');
  });

  it('test_kit_file_used_when_env_absent', () => {
    const r = resolveImportEndpoint({}, { THEOMEM_MEMORY_URL: 'https://file.example', THEOMEM_MEMORY_PATH_PREFIX: '/v1/memory', THEOMEM_MEMORY_TOKEN: 't-file' });
    expect(r.url).toBe('https://file.example');
    expect(r.pathPrefix).toBe('/v1/memory');
    expect(r.token).toBe('t-file');
  });

  it('test_user_id_override_resolved_like_the_kit_hooks', () => {
    // theo-lib parity: THEOMEM_MEMORY_USER_ID (env → kit file) pins the write scope explicitly;
    // absent → undefined so the gateway's edge-injected X-Theo-User-Id binds the tier.
    const r1 = resolveImportEndpoint({ THEOMEM_MEMORY_USER_ID: 'u-env' }, { THEOMEM_MEMORY_USER_ID: 'u-file' });
    expect(r1.userId).toBe('u-env');
    const r2 = resolveImportEndpoint({}, { THEOMEM_MEMORY_USER_ID: 'u-file' });
    expect(r2.userId).toBe('u-file');
    const r3 = resolveImportEndpoint({}, {});
    expect(r3.userId).toBeUndefined();
  });

  it('test_nothing_configured_returns_undefined_for_module_default', () => {
    const r = resolveImportEndpoint({}, {});
    expect(r.url).toBeUndefined();
    expect(r.token).toBeUndefined();
  });

  it('test_parseKitEnvFile_parses_and_tolerates_missing', () => {
    const p = join(dir, 'theo-memory.env');
    writeFileSync(p, '# comment\nTHEOMEM_MEMORY_URL=https://kit.example\n\nBROKENLINE\nTHEOMEM_MEMORY_TOKEN=tok\n');
    expect(parseKitEnvFile(p)).toEqual({ THEOMEM_MEMORY_URL: 'https://kit.example', THEOMEM_MEMORY_TOKEN: 'tok' });
    expect(parseKitEnvFile(join(dir, 'nope.env'))).toEqual({}); // missing file → {} (never throws)
  });
});

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

  it('test_memory_env_beats_kit_file_and_appends_path_prefix', () => {
    const r = resolveImportEndpoint(
      { THEOMEM_MEMORY_URL: 'https://env.example/', THEOMEM_MEMORY_PATH_PREFIX: '/v1/memory', THEOMEM_MEMORY_TOKEN: 't-env' },
      { THEOMEM_MEMORY_URL: 'https://file.example', THEOMEM_MEMORY_TOKEN: 't-file' },
    );
    expect(r.url).toBe('https://env.example/v1/memory'); // trailing slash stripped + prefix appended
    expect(r.token).toBe('t-env');
  });

  it('test_kit_file_used_when_env_absent', () => {
    const r = resolveImportEndpoint({}, { THEOMEM_MEMORY_URL: 'https://file.example', THEOMEM_MEMORY_PATH_PREFIX: '/v1/memory', THEOMEM_MEMORY_TOKEN: 't-file' });
    expect(r.url).toBe('https://file.example/v1/memory');
    expect(r.token).toBe('t-file');
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

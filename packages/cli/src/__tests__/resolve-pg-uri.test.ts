/**
 * M25 T3.2 RED — real-consumer THEOMEM_PG_URI resolution via loadConfig.
 *
 * `themory server` resolves the DB URI through the layered resolver (wiring the
 * resolver into a real caller, DoD bullet 3). Back-compat is the load-bearing
 * assertion: an env-only deployment MUST resolve to the exact same URI as before
 * (env wins over any file per ADR-2).
 *
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { projectConfigPath } from '@usetheo/memory/config';
import { describe, expect, it } from 'vitest';

import { resolvePgUri } from '../resolve-pg-uri.js';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'm25-pg-'));
}

describe('resolvePgUri', () => {
  it('env_only_backcompat: env value used, identical to the pre-M25 behavior', () => {
    const uri = resolvePgUri({ cwd: tmp(), home: tmp(), env: { THEOMEM_PG_URI: 'postgres://env-host/db' } });
    expect(uri).toBe('postgres://env-host/db');
  });

  it('project_file_no_env: file value used when env is absent', () => {
    const cwd = tmp();
    writeFileSync(projectConfigPath(cwd), JSON.stringify({ THEOMEM_PG_URI: 'postgres://file-host/db' }));
    const uri = resolvePgUri({ cwd, home: tmp(), env: {} });
    expect(uri).toBe('postgres://file-host/db');
  });

  it('env_wins_over_file: env overrides a stale project file (ADR-2 R2 mitigation)', () => {
    const cwd = tmp();
    writeFileSync(projectConfigPath(cwd), JSON.stringify({ THEOMEM_PG_URI: 'postgres://stale-file/db' }));
    const uri = resolvePgUri({ cwd, home: tmp(), env: { THEOMEM_PG_URI: 'postgres://env-host/db' } });
    expect(uri).toBe('postgres://env-host/db');
  });

  it('unset_everywhere: undefined when neither env nor file supplies it', () => {
    expect(resolvePgUri({ cwd: tmp(), home: tmp(), env: {} })).toBeUndefined();
  });
});

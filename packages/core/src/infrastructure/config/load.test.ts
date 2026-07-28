/**
 * M25 T2.1 + T2.2 RED — file load/save helpers + loadConfig composition.
 *
 * Uses real temp dirs (mkdtemp) as injected home/cwd — no global-state coupling,
 * no touching the operator's real ~/.themory. Malformed JSON must fail LOUD
 * (typed ConfigParseError), never a silent empty (plan Failure scenarios).
 *
 */
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ConfigParseError } from '../../domain/config/config-error.js';
import {
  loadConfig,
  readGlobalConfig,
  readProjectConfig,
  saveProjectConfig,
  globalConfigPath,
  projectConfigPath,
} from './load.js';

const tmps: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'm25-cfg-'));
  tmps.push(d);
  return d;
}
function writeGlobal(home: string, obj: unknown): void {
  mkdirSync(join(home, '.themory'), { recursive: true });
  writeFileSync(globalConfigPath(home), JSON.stringify(obj));
}
function writeProject(cwd: string, raw: string): void {
  writeFileSync(projectConfigPath(cwd), raw);
}

afterEach(() => {
  // temp dirs live under the OS tmpdir; leaving them is harmless for CI.
  tmps.length = 0;
});

/** Assert `read()` throws a ConfigParseError whose message names `path`. */
function expectConfigParseError(read: () => unknown, path: string): void {
  expect(read).toThrow(ConfigParseError);
  try {
    read();
  } catch (err) {
    expect((err as ConfigParseError).message).toContain(path);
  }
}

describe('file helpers', () => {
  it('reads_global_and_project: both files parsed', () => {
    const home = tmp();
    const cwd = tmp();
    writeGlobal(home, { HOST: 'gh' });
    writeProject(cwd, JSON.stringify({ PORT: '9' }));
    expect(readGlobalConfig(home)).toEqual({ HOST: 'gh' });
    expect(readProjectConfig(cwd)).toEqual({ PORT: '9' });
  });

  it('missing_files_are_empty_not_error: no file → {}', () => {
    expect(readGlobalConfig(tmp())).toEqual({});
    expect(readProjectConfig(tmp())).toEqual({});
  });

  it('malformed_json_throws_typed: bad JSON → ConfigParseError naming the file', () => {
    const cwd = tmp();
    writeProject(cwd, '{ not valid json ');
    expectConfigParseError(() => readProjectConfig(cwd), projectConfigPath(cwd));
  });

  it('save_writes_project_file: round-trips {k:v}', () => {
    const cwd = tmp();
    saveProjectConfig(cwd, { HOST: '1.2.3.4' });
    expect(existsSync(projectConfigPath(cwd))).toBe(true);
    expect(readProjectConfig(cwd)).toEqual({ HOST: '1.2.3.4' });
    // sanity: it is real JSON on disk.
    expect(JSON.parse(readFileSync(projectConfigPath(cwd), 'utf8'))).toEqual({ HOST: '1.2.3.4' });
  });

  it('non_object_json_throws_typed: valid-but-non-object JSON → ConfigParseError (fail loud)', () => {
    const cwd = tmp();
    writeProject(cwd, '[1,2,3]'); // valid JSON, wrong shape — must NOT be coerced to {}
    expectConfigParseError(() => readProjectConfig(cwd), projectConfigPath(cwd));
  });

  it('save_strips_secrets: a secret hand-edited into the file is purged on save (ADR-3 defense-in-depth)', () => {
    const cwd = tmp();
    // Simulate an operator who hand-wrote a secret into the file.
    writeProject(cwd, JSON.stringify({ HOST: 'h', OPENAI_API_KEY: 'sk-leaked' }));
    // A later save (e.g. `config set HOST x`) must NOT re-persist the secret.
    saveProjectConfig(cwd, { ...readProjectConfig(cwd), HOST: 'x' });
    const onDisk = readFileSync(projectConfigPath(cwd), 'utf8');
    expect(onDisk).not.toContain('OPENAI_API_KEY');
    expect(onDisk).not.toContain('sk-leaked');
    expect(readProjectConfig(cwd)).toEqual({ HOST: 'x' });
  });
});

describe('loadConfig — 5-layer precedence (ADR-2)', () => {
  it('env_overrides_project: env wins over project file', () => {
    const cwd = tmp();
    writeProject(cwd, JSON.stringify({ THEOMEM_PG_URI: 'postgres://A' }));
    const out = loadConfig({ cwd, home: tmp(), env: { THEOMEM_PG_URI: 'postgres://B' } });
    expect(out.value['THEOMEM_PG_URI']).toBe('postgres://B');
    expect(out.source['THEOMEM_PG_URI']).toBe('env');
  });

  it('flag_overrides_env: CLI flag wins over env', () => {
    const out = loadConfig({
      cwd: tmp(),
      home: tmp(),
      env: { THEOMEM_PG_URI: 'postgres://B' },
      flags: { THEOMEM_PG_URI: 'postgres://C' },
    });
    expect(out.value['THEOMEM_PG_URI']).toBe('postgres://C');
    expect(out.source['THEOMEM_PG_URI']).toBe('flags');
  });

  it('secret_from_env_only: env secret resolves; a file-sourced secret is dropped', () => {
    const cwd = tmp();
    // project file tries to smuggle a secret AND override the env one.
    writeProject(cwd, JSON.stringify({ OPENAI_API_KEY: 'file-secret' }));
    const out = loadConfig({ cwd, home: tmp(), env: { OPENAI_API_KEY: 'env-secret' } });
    expect(out.value['OPENAI_API_KEY']).toBe('env-secret');
    expect(out.source['OPENAI_API_KEY']).toBe('env');
  });

  it('secret_in_file_without_env_is_absent: file secret never loaded even with no env', () => {
    const cwd = tmp();
    writeProject(cwd, JSON.stringify({ OPENAI_API_KEY: 'file-secret' }));
    const out = loadConfig({ cwd, home: tmp(), env: {} });
    expect(out.value['OPENAI_API_KEY']).toBeUndefined();
  });
});

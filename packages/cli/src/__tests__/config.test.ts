/**
 * M25 T3.1 RED — `themory config init/set/get/list` integration.
 *
 * Drives the orchestrators against injected temp HOME/cwd/env (no global-state
 * coupling; never touches the operator's real ~/.themory). Covers the security
 * line: `set` refuses secret keys (env-only, ADR-3); `get`/`list` mask secrets.
 *
 */
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { projectConfigPath } from '@usetheo/memory/config';
import { describe, expect, it } from 'vitest';

import { runConfigInit, runConfigSet, runConfigGet, runConfigList } from '../run-config.js';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'm25-cli-'));
}

interface Cap {
  ctx: Parameters<typeof runConfigInit>[0];
  out: string[];
  err: string[];
}
function makeCtx(over: { cwd?: string; home?: string; env?: Record<string, string | undefined> } = {}): Cap {
  const out: string[] = [];
  const err: string[] = [];
  return {
    ctx: {
      cwd: over.cwd ?? tmp(),
      home: over.home ?? tmp(),
      env: over.env ?? {},
      writeStdout: (s) => out.push(s),
      writeStderr: (s) => err.push(s),
    },
    out,
    err,
  };
}

describe('themory config init', () => {
  it('init_writes_commented_skeleton + refuses to overwrite', () => {
    const { ctx, err } = makeCtx();
    expect(runConfigInit(ctx)).toBe(0);
    expect(existsSync(projectConfigPath(ctx.cwd))).toBe(true);
    const raw = readFileSync(projectConfigPath(ctx.cwd), 'utf8');
    // valid JSON, carries a comment note, non-secret keys only (no API_KEY).
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(parsed).some((k) => k.includes('_comment') || k.startsWith('_'))).toBe(true);
    expect(Object.keys(parsed)).toContain('THEOMEM_PG_URI');
    expect(Object.keys(parsed).some((k) => k.includes('API_KEY') || k.includes('SECRET'))).toBe(false);
    // second init refuses (non-zero, file preserved).
    expect(runConfigInit(ctx)).not.toBe(0);
    expect(err.join('')).toMatch(/exist|overwrite/i);
  });
});

describe('themory config set', () => {
  it('set_persists_to_project_file', () => {
    const { ctx } = makeCtx();
    expect(runConfigSet(ctx, 'HOST', '1.2.3.4')).toBe(0);
    const parsed = JSON.parse(readFileSync(projectConfigPath(ctx.cwd), 'utf8')) as Record<string, unknown>;
    expect(parsed['HOST']).toBe('1.2.3.4');
  });

  it('set_secret_key_refused: non-zero, env-only message, file NOT written', () => {
    const { ctx, err } = makeCtx();
    expect(runConfigSet(ctx, 'OPENAI_API_KEY', 'sk-secret')).not.toBe(0);
    expect(existsSync(projectConfigPath(ctx.cwd))).toBe(false);
    expect(err.join('')).toMatch(/env/i);
    expect(err.join('')).not.toContain('sk-secret');
  });
});

describe('themory config get', () => {
  it('get_shows_value_and_source', () => {
    const { ctx, out } = makeCtx();
    runConfigSet(ctx, 'HOST', '9.9.9.9');
    expect(runConfigGet(ctx, 'HOST')).toBe(0);
    const printed = out.join('');
    expect(printed).toContain('HOST');
    expect(printed).toContain('9.9.9.9');
    expect(printed).toContain('project');
  });

  it('get_masks_secret: a secret value is never printed in the clear', () => {
    const { ctx, out } = makeCtx({ env: { OPENAI_API_KEY: 'sk-super-secret' } });
    expect(runConfigGet(ctx, 'OPENAI_API_KEY')).toBe(0);
    const printed = out.join('');
    expect(printed).toContain('••••');
    expect(printed).not.toContain('sk-super-secret');
  });
});

describe('themory config list', () => {
  it('list_masks_secrets: secret value never printed', () => {
    const { ctx, out } = makeCtx({ env: { OPENAI_API_KEY: 'sk-super-secret', HOST: 'h' } });
    expect(runConfigList(ctx)).toBe(0);
    const printed = out.join('');
    expect(printed).toContain('OPENAI_API_KEY');
    expect(printed).toContain('••••');
    expect(printed).not.toContain('sk-super-secret');
    // non-secret still shown in the clear with its source layer.
    expect(printed).toContain('HOST');
    expect(printed).toContain('env');
  });
});

/**
 * M20 (#118) — the stale-dist guard fails FAST with a typed error when the running dist is older
 * than src, and is a no-op otherwise. Negative-case tests:
 * they assert the SPECIFIC typed error + message, not merely "it throws".
 */
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { StaleDistError, checkStaleDist } from '../stale-dist-guard.js';

let root = '';

/** Sets a file's mtime to `epochSec` seconds since the epoch (deterministic ordering). */
function touchAt(path: string, epochSec: number): void {
  utimesSync(path, epochSec, epochSec);
}

/** Creates dist/cli.js + src/cli.ts under `root` and returns their paths (DRY test setup). */
function seed(): { distFile: string; srcFile: string } {
  const distFile = join(root, 'dist', 'cli.js');
  const srcFile = join(root, 'src', 'cli.ts');
  writeFileSync(distFile, '// built');
  writeFileSync(srcFile, '// source');
  return { distFile, srcFile };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'stale-dist-'));
  mkdirSync(join(root, 'dist'));
  mkdirSync(join(root, 'src'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('checkStaleDist (#118)', () => {
  test('throws a typed StaleDistError with an actionable message when dist is older than src', () => {
    const { distFile, srcFile } = seed();
    touchAt(distFile, 1000); // dist built at t=1000
    touchAt(srcFile, 2000); // src edited AFTER at t=2000 → dist is stale

    expect(() => checkStaleDist(distFile, join(root, 'src'))).toThrow(StaleDistError);
    try {
      checkStaleDist(distFile, join(root, 'src'));
      throw new Error('expected StaleDistError');
    } catch (err) {
      expect(err).toBeInstanceOf(StaleDistError);
      expect((err as Error).name).toBe('StaleDistError');
      expect((err as Error).message).toContain('pnpm build');
    }
  });

  test('does not throw when dist is newer than src (fresh build)', () => {
    const { distFile, srcFile } = seed();
    touchAt(srcFile, 1000);
    touchAt(distFile, 2000); // dist built AFTER the last src edit → fresh

    expect(() => checkStaleDist(distFile, join(root, 'src'))).not.toThrow();
  });

  test('does not throw when dist and src share the same mtime (only src-newer is stale)', () => {
    const { distFile, srcFile } = seed();
    touchAt(srcFile, 1500);
    touchAt(distFile, 1500); // equal mtime → NOT stale (EC-2)

    expect(() => checkStaleDist(distFile, join(root, 'src'))).not.toThrow();
  });

  test('ignores newer test/decl files — only production source triggers staleness', () => {
    const { distFile, srcFile } = seed();
    touchAt(srcFile, 1000); // production source older than dist
    touchAt(distFile, 2000);
    // A test file edited AFTER the build must NOT mark the build stale (it never becomes dist output).
    const testFile = join(root, 'src', 'cli.test.ts');
    writeFileSync(testFile, '// test');
    touchAt(testFile, 3000);
    const declFile = join(root, 'src', 'types.d.ts');
    writeFileSync(declFile, '// decl');
    touchAt(declFile, 3000);

    expect(() => checkStaleDist(distFile, join(root, 'src'))).not.toThrow();
  });

  test('is a no-op when src/ is absent (published package — ADR D2)', () => {
    const { distFile } = seed();
    touchAt(distFile, 1000);

    // srcRoot null AND a non-existent path both mean "no source to compare" → no throw.
    expect(() => checkStaleDist(distFile, null)).not.toThrow();
    expect(() => checkStaleDist(distFile, join(root, 'does-not-exist'))).not.toThrow();
  });
});

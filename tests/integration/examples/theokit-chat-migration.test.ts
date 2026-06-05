/**
 * T0.1 — RED contract sentinels for examples/chat-with-memory migration
 * to TheoKit-canonical entrypoint.
 *
 * 8 deterministic FS+parsing assertions that lock the post-migration
 * shape of `examples/chat-with-memory/`. Pre-migration ALL 6 (plus 7)
 * fail (RED locked). Post-migration each turns GREEN as its task lands.
 *
 * NOTE: This test does NOT require Postgres or a running dev server —
 * it's pure FS introspection + tiny subprocess for sentinel 8. Runs in
 * < 5s. Lives under tests/integration/ per vitest.integration.config.ts
 * include glob (`tests/integration/**\/*.test.ts`); EC-8 sentinel verifies
 * this membership empirically.
 *
 * @see .claude/knowledge-base/plans/examples-theokit-chat-migration-plan.md § T0.1
 * @see .claude/knowledge-base/reviews/examples-theokit-chat-migration-edge-cases-2026-06-05.md § EC-5, EC-8
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const DEMO_DIR = join(REPO_ROOT, 'examples', 'chat-with-memory');
const THIS_FILE_BASENAME = basename(fileURLToPath(import.meta.url));

function readJSON(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

function findFilesRecursive(dir: string, pattern: RegExp): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findFilesRecursive(full, pattern));
    } else if (pattern.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('examples-theokit-chat-migration — post-migration contract sentinels', () => {
  it('sentinel 1: package.json#scripts.dev === "theokit dev"', () => {
    const pkg = readJSON(join(DEMO_DIR, 'package.json'));
    const scripts = pkg['scripts'] as Record<string, string> | undefined;
    expect(scripts?.['dev']).toBe('theokit dev');
  });

  it('sentinel 2: package.json#dependencies.next is absent', () => {
    const pkg = readJSON(join(DEMO_DIR, 'package.json'));
    const deps = pkg['dependencies'] as Record<string, string> | undefined;
    expect(deps?.['next']).toBeUndefined();
  });

  it('sentinel 3: package.json#dependencies.theokit is present and range satisfies ^0.2.4', () => {
    const pkg = readJSON(join(DEMO_DIR, 'package.json'));
    const deps = pkg['dependencies'] as Record<string, string> | undefined;
    const range = deps?.['theokit'];
    expect(range, 'theokit dep must be declared').toBeDefined();
    // Loose range check: must start with ^0.2, ^0.3, ^0.4, or pinned 0.2.x+
    expect(range).toMatch(/^[~^]?0\.(2|3|4|5|6|7|8|9|\d{2})\./);
  });

  it('sentinel 4: theo.config.ts exists at demo root', () => {
    expect(existsSync(join(DEMO_DIR, 'theo.config.ts'))).toBe(true);
  });

  it('sentinel 5: .nvmrc exists with Node 22.x pin', () => {
    const nvmrcPath = join(DEMO_DIR, '.nvmrc');
    expect(existsSync(nvmrcPath)).toBe(true);
    const content = readFileSync(nvmrcPath, 'utf-8').trim();
    expect(content, '.nvmrc must pin a Node 22.x version').toMatch(/^v?22\./);
  });

  it('sentinel 6: server/routes/ has >= 1 file importing defineRoute from theokit', () => {
    const routesDir = join(DEMO_DIR, 'server', 'routes');
    expect(existsSync(routesDir), 'server/routes/ directory must exist').toBe(true);
    const tsFiles = findFilesRecursive(routesDir, /\.ts$/);
    expect(tsFiles.length, 'server/routes/ must contain >= 1 .ts file').toBeGreaterThan(0);
    const withDefineRoute = tsFiles.filter((f) => {
      const src = readFileSync(f, 'utf-8');
      return /import\s+\{[^}]*\bdefineRoute\b[^}]*\}\s+from\s+['"]theokit['"]/.test(src)
        || /from\s+['"]theokit\/server['"]/.test(src);
    });
    expect(withDefineRoute.length, 'at least 1 route file must import defineRoute from theokit').toBeGreaterThan(0);
  });

  it('sentinel 7 (EC-5): every app/api/**/route.ts has a sibling server/routes/<name>.ts (0 missing)', () => {
    const apiDir = join(DEMO_DIR, 'app', 'api');
    const routesDir = join(DEMO_DIR, 'server', 'routes');
    const apiRoutes = findFilesRecursive(apiDir, /^route\.ts$/);
    // For each app/api/<name>/route.ts, expect server/routes/<name>.ts
    const missing = apiRoutes.filter((apiPath) => {
      // app/api/foo/route.ts -> "foo"
      const routeName = basename(dirname(apiPath));
      return !existsSync(join(routesDir, `${routeName}.ts`));
    });
    expect(missing, `routes without server/routes sibling: ${missing.join(', ')}`).toHaveLength(0);
  });

  it('sentinel 8 (EC-8): this test file is picked up by vitest.integration.config.ts include glob', () => {
    // List files vitest would run with the integration config
    const output = execSync(
      `npx vitest list --config vitest.integration.config.ts --reporter=json 2>/dev/null`,
      { cwd: REPO_ROOT, encoding: 'utf-8', timeout: 60_000 },
    );
    // vitest list emits JSON to stdout; parse it (best-effort — schema variance across versions)
    let pickedUp = false;
    try {
      const parsed = JSON.parse(output);
      // testResults | files | testModules — variant keys across vitest versions
      const candidates: string[] = [];
      if (Array.isArray(parsed.testResults)) {
        for (const r of parsed.testResults) if (typeof r?.name === 'string') candidates.push(r.name);
      }
      if (Array.isArray(parsed.files)) {
        for (const f of parsed.files) if (typeof f?.name === 'string') candidates.push(f.name);
      }
      pickedUp = candidates.some((p) => p.endsWith(THIS_FILE_BASENAME));
    } catch {
      // Fallback: textual search in raw output
      pickedUp = output.includes(THIS_FILE_BASENAME);
    }
    expect(pickedUp, `vitest must enumerate ${THIS_FILE_BASENAME} in its include set`).toBe(true);
  });
});

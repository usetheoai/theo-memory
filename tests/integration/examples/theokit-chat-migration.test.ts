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
 */
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

  it('sentinel 7 (EC-5): every app/api/**/route.ts has a sibling server/routes/<rel-path>.ts (hierarchy preserved; 0 missing)', () => {
    const apiDir = join(DEMO_DIR, 'app', 'api');
    const routesDir = join(DEMO_DIR, 'server', 'routes');
    const apiRoutes = findFilesRecursive(apiDir, /^route\.ts$/);
    // For each app/api/<sub-path>/route.ts, expect server/routes/<sub-path>.ts
    // Per TheoKit URL convention (scanServerRoutes): server/routes/<rel-path> → /api/<rel-path>
    // — hierarchy preserved (e.g., memory/forget vs skills/forget avoid basename collision).
    const missing = apiRoutes.filter((apiPath) => {
      const relDirFromApi = dirname(apiPath).slice(apiDir.length + 1); // e.g., "memory/forget"
      return !existsSync(join(routesDir, `${relDirFromApi}.ts`));
    });
    expect(missing, `routes without server/routes hierarchy sibling: ${missing.join(', ')}`).toHaveLength(0);
  });

  it('sentinel 8 (EC-8): this test file matches vitest.integration.config.ts include glob', () => {
    // Read the include patterns directly from the config file. More robust than
    // shelling out to `vitest list` (whose JSON output is corrupted by parse
    // errors in unrelated test files in the same suite — Vitest 4.x behavior).
    const configPath = join(REPO_ROOT, 'vitest.integration.config.ts');
    expect(existsSync(configPath), 'vitest.integration.config.ts must exist').toBe(true);
    const configSrc = readFileSync(configPath, 'utf-8');
    // Heuristic: locate `include: [...]` (or `include:[...]`) and parse the array literal
    const match = configSrc.match(/include\s*:\s*\[([^\]]+)\]/);
    expect(match, 'config must declare an include array').not.toBeNull();
    const includeBody = match![1]!;
    const patterns = [...includeBody.matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1]!);
    expect(patterns.length, 'include array must contain at least one glob').toBeGreaterThan(0);
    // The integration glob `tests/integration/**\/*.test.ts` must match this file
    const relPath = `tests/integration/examples/${THIS_FILE_BASENAME}`;
    // Translate vitest globs (** and *) to a JS regex
    const matched = patterns.some((p) => {
      const re = new RegExp(
        '^' +
          p
            .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*\//g, '__DOUBLESTAR_SLASH__')
            .replace(/\*\*/g, '__DOUBLESTAR__')
            .replace(/\*/g, '[^/]*')
            .replace(/__DOUBLESTAR_SLASH__/g, '(?:.*/)?')
            .replace(/__DOUBLESTAR__/g, '.*') +
          '$',
      );
      return re.test(relPath);
    });
    expect(matched, `${relPath} must match one of: ${patterns.join(', ')}`).toBe(true);
  });
});

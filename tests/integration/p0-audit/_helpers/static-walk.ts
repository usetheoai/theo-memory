/**
 * T2.2 helper — recursive static-import graph walker.
 *
 * EC-7 absorption (SHOULD TEST): the walk MUST be RECURSIVE through
 * transitive imports until fixed-point. Depth-1 walk (just `entry` direct
 * imports) is insufficient because src/index.ts re-exports from sibling
 * files which themselves import from deeper paths.
 *
 * Walks `import { ... } from './x.js';` declarations only (NOT
 * `import type ...` — type-only imports are erased at runtime per TS spec
 * and do NOT contribute to the runtime bundle size).
 *
 * Returns a Set of absolute repo-relative paths reachable from the entry.
 *
 * @see .claude/knowledge-base/plans/p0-api-sdk-mcp-correctness-audit-plan.md § T2.2
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';

const RE_RUNTIME_IMPORT = /^\s*import(?!\s+type)\s+[^;]+?\s+from\s+['"]([^'"]+)['"]/gm;
const RE_SIDE_EFFECT_IMPORT = /^\s*import\s+['"]([^'"]+)['"]/gm;
const RE_VALUE_RE_EXPORT = /^\s*export(?!\s+type)\s+(?:\{[^}]*\}|\*)\s+from\s+['"]([^'"]+)['"]/gm;

function resolveSpec(currentDir: string, spec: string, repoRoot: string): string | null {
  if (!spec.startsWith('.')) return null; // external dep — not part of the in-repo bundle
  const candidate = join(currentDir, spec);
  // ESM `.js` extensions point at `.ts` source.
  if (candidate.endsWith('.js')) {
    const tsPath = candidate.slice(0, -3) + '.ts';
    if (existsSync(tsPath)) return resolve(tsPath);
  }
  if (existsSync(candidate)) {
    if (statSync(candidate).isDirectory()) {
      const idx = join(candidate, 'index.ts');
      if (existsSync(idx)) return resolve(idx);
    } else {
      return resolve(candidate);
    }
  }
  // Last fallback — strip extension and try .ts
  const tsExact = candidate.endsWith('.ts') ? candidate : candidate + '.ts';
  if (existsSync(tsExact)) return resolve(tsExact);
  return null;
}

/**
 * Walk the static-import graph starting at `entryAbsPath`. Returns the
 * Set of absolute paths reachable via runtime imports + value re-exports.
 * Type-only imports + external (non-`.`-prefixed) specifiers are excluded.
 */
export function walkStaticImports(entryAbsPath: string, repoRoot: string): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [resolve(entryAbsPath)];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    if (!existsSync(current)) continue;
    visited.add(current);
    const content = readFileSync(current, 'utf8');
    const currentDir = dirname(current);
    const seenInFile = new Set<string>();
    for (const re of [RE_RUNTIME_IMPORT, RE_SIDE_EFFECT_IMPORT, RE_VALUE_RE_EXPORT]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const spec = m[1]!;
        if (seenInFile.has(spec)) continue;
        seenInFile.add(spec);
        const resolved = resolveSpec(currentDir, spec, repoRoot);
        if (resolved !== null && !visited.has(resolved)) {
          queue.push(resolved);
        }
      }
    }
  }
  return visited;
}

/**
 * Convert a Set of absolute paths to repo-relative POSIX-style paths
 * suitable for inclusion in human-readable failure messages.
 */
export function toRelativePaths(visited: Set<string>, repoRoot: string): string[] {
  return Array.from(visited)
    .map((p) => relative(repoRoot, p).split(/[/\\]/).join('/'))
    .sort();
}

/**
 * Durable regression guard for theo-memory#82 (review finding F-tests-1).
 *
 * Every MCP tool memory-access site MUST bind the tenant workspace via
 * `workspaceScopedMemory(...)`. A bare `deps.memoryFactory()` at a memory op serves the
 * shared, workspace-UNBOUND `Memory` and re-opens the cross-tenant leak — and the rest of
 * the unit suite would stay green. This encodes the T3.1 acceptance grep ("no bare
 * memory-op factory") as a permanent structural test, so a future handler that forgets the
 * binding fails here instead of leaking in production.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCAN_DIRS = [HERE, join(HERE, '..', 'openmemory')];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('-schema.ts'))
    .map((f) => join(dir, f));
}

describe('workspace-binding coverage (T3.1 regression guard, #82)', () => {
  it('no MCP tool handler reaches a memory op via a bare deps.memoryFactory() (must wrap in workspaceScopedMemory)', () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const path of sourceFiles(dir)) {
        const src = readFileSync(path, 'utf8');
        src.split('\n').forEach((line, i) => {
          // A line that resolves memory from the factory WITHOUT the workspace seam.
          if (/deps\.memoryFactory\(\)/.test(line) && !/workspaceScopedMemory\s*\(/.test(line)) {
            offenders.push(`${path.replace(`${HERE}/`, '')}:${i + 1}  ${line.trim()}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * T1.2 — `src/core/index.ts` contract-barrel JSDoc + @see closure test.
 *
 * Mirrors T1.1 (src/index.ts) but for the contract barrel. Each export
 * statement gets a JSDoc block above with at least one `@see` cross-ref
 * per CLAUDE.md § PRIORITY 0 sub-goal 1.
 *
 * EC-13 absorption (DOCUMENT): `@see` targets may be plans, ADRs, or
 * knowledge-base coordinates — any path under `.claude/knowledge-base/`
 * counts as a valid cross-ref.
 *
 * @see .claude/knowledge-base/plans/p0-api-sdk-mcp-correctness-audit-plan.md § T1.2
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const CONTRACT_PATH = join(REPO_ROOT, 'packages', 'core', 'src', 'domain', 'index.ts');

interface ExportBlock {
  readonly startLine: number;
  readonly statementText: string;
}

function findExportBlocks(content: string): ExportBlock[] {
  const blocks: ExportBlock[] = [];
  const lines = content.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith('export ')) {
      let stmt = line;
      let j = i;
      while (!stmt.includes(';') && j + 1 < lines.length) {
        j += 1;
        stmt += '\n' + lines[j]!;
      }
      blocks.push({ startLine: i + 1, statementText: stmt });
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return blocks;
}

function findJsdocBlock(content: string, startLine: number): string | null {
  const lines = content.split('\n');
  let idx = startLine - 1;
  while (idx > 0 && lines[idx - 1]!.trim() === '') {
    idx -= 1;
  }
  if (idx <= 0) return null;
  if (!lines[idx - 1]!.includes('*/')) return null;
  let endLine = idx - 1;
  let startLineOfBlock = endLine;
  while (startLineOfBlock >= 0) {
    if (lines[startLineOfBlock]!.includes('/**')) {
      return lines.slice(startLineOfBlock, endLine + 1).join('\n');
    }
    startLineOfBlock -= 1;
  }
  return null;
}

describe('T1.2 — src/core/index.ts contract-barrel JSDoc + @see', () => {
  const content = readFileSync(CONTRACT_PATH, 'utf8');
  const blocks = findExportBlocks(content);

  test('1. src/core/index.ts contains 47 export statements (workspace baseline + entity/graph + usage-counter)', () => {
    // 47 = 43 (workspace baseline) + 3 entity-extraction slice type exports
    // (MemoryEntityStore / MemoryGraphStore + their param types; slices 1/2
    // 2026-06-20) + 1 usage-counter type export (UsageCounterStore;
    // themory-scoped-forget-and-retrieval-counter T2.2). Each has a JSDoc + @see block.
    expect(blocks.length).toBe(47);
  });

  test('2. every export statement has a JSDoc block above', () => {
    const missing: number[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!;
      if (findJsdocBlock(content, block.startLine) === null) {
        missing.push(block.startLine);
      }
    }
    expect(missing, `Missing JSDoc above lines: ${missing.join(', ')}`).toHaveLength(0);
  });

  test('3. every export statement JSDoc contains at least one @see cross-reference', () => {
    const missingSee: number[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!;
      const jsdoc = findJsdocBlock(content, block.startLine);
      if (jsdoc === null || !/@see/.test(jsdoc)) {
        missingSee.push(block.startLine);
      }
    }
    expect(missingSee, `Missing @see above lines: ${missingSee.join(', ')}`).toHaveLength(0);
  });
});

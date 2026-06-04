/**
 * T1.1 — `src/index.ts` barrel JSDoc + @see closure test.
 *
 * Verifies every export STATEMENT in src/index.ts has a `/** ... *\/` JSDoc
 * block immediately above with at least one `@see` cross-reference. T0.1
 * baseline counted 8 export statements (lines starting with `export `);
 * this test asserts each statement has the consumer-facing documentation
 * required by CLAUDE.md § PRIORITY 0 sub-goal 1.
 *
 * EC-13 absorption (DOCUMENT): `@see` can target plans, ADRs, CLAUDE.md
 * locked-names table, README, or knowledge-base coordinates — any
 * filesystem path under `.claude/knowledge-base/` or `..`-prefixed sibling
 * paths counts as a valid cross-ref.
 *
 * @see .claude/knowledge-base/plans/p0-api-sdk-mcp-correctness-audit-plan.md § T1.1
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const INDEX_PATH = join(REPO_ROOT, 'src', 'index.ts');

interface ExportBlock {
  readonly startLine: number;
  readonly statementText: string;
}

/**
 * Find each export STATEMENT in src/index.ts. A statement starts with
 * `export ` at column 0 and runs until its terminating semicolon. The
 * statement may span multiple lines (multi-name `{ A, B, C }` form).
 */
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

/**
 * Walk backward from `startLine` (1-indexed) to find a JSDoc block ending
 * at line `startLine - 1` (skipping blank lines). Returns the JSDoc text
 * if present, otherwise null.
 */
function findJsdocBlock(content: string, startLine: number): string | null {
  const lines = content.split('\n');
  let idx = startLine - 1;
  // Walk up past blank lines.
  while (idx > 0 && lines[idx - 1]!.trim() === '') {
    idx -= 1;
  }
  if (idx <= 0) return null;
  // The line at idx-1 (0-indexed) is the candidate `*/` end of JSDoc.
  if (!lines[idx - 1]!.includes('*/')) return null;
  // Walk up to find the `/**` start.
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

describe('T1.1 — src/index.ts barrel JSDoc + @see', () => {
  const content = readFileSync(INDEX_PATH, 'utf8');
  const blocks = findExportBlocks(content);

  test('1. src/index.ts contains exactly 8 export statements (T0.1 baseline)', () => {
    expect(blocks.length).toBe(8);
  });

  for (let i = 0; i < 8; i++) {
    test(`2.${i + 1}. export statement #${i + 1} (line ${blocks[i]?.startLine ?? '?'}) has a JSDoc block above`, () => {
      const block = blocks[i];
      expect(block).toBeDefined();
      const jsdoc = findJsdocBlock(content, block!.startLine);
      expect(jsdoc).not.toBeNull();
    });

    test(`3.${i + 1}. export statement #${i + 1} JSDoc contains at least one @see cross-reference`, () => {
      const block = blocks[i];
      expect(block).toBeDefined();
      const jsdoc = findJsdocBlock(content, block!.startLine);
      expect(jsdoc).not.toBeNull();
      expect(jsdoc!).toMatch(/@see/);
    });
  }
});
